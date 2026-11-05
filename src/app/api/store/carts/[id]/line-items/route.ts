/**
 * POST /api/store/carts/[id]/line-items —— 加 line item 到 cart
 *
 * 同规格的行会合并数量(靠 `(cart_id, spec_hash)` 唯一索引)。
 *
 * ## 两种行
 *
 * - **目录商品行** —— 产品 + 规格(材质 / 尺寸 / AI 风格 / 配件 / 刻字),
 *   价格走 `calculatePricing()`。
 * - **打印服务行** —— 几何 + 交期 + 模型文件,价格走
 *   `computePrintServiceLinePrice()`(按克重)。判据是 `spec.printSpec`
 *   在不在,不是 productId(见 `storefront/lib/print-service.ts`)。
 *
 * 打印服务行的 metadata 由**服务端**重建(`buildPrintServiceMetadata()`)——
 * 客户端带来的标题 / 封面 / handle 一律不采信。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { isR2Configured, objectExists } from "@/features/image-gen/lib/r2";
import { normalizeDeliveryTier } from "@/features/print-quote/lib/delivery-tier";
import { isOwnModelUrl } from "@/features/print-quote/lib/upload-key";
import { addLineItem, getCart } from "@/features/storefront/lib/cart-store";
import {
  buildPrintServiceMetadata,
  PRINT_SERVICE_PRODUCT_ID,
} from "@/features/storefront/lib/print-service";
import type {
  CartLineItemMetadata,
  PrintServiceSpec,
} from "@/features/storefront/types";
import { withApiLogging } from "@/lib/api-logger";
import { getSessionFromRequest } from "@/lib/auth/request-session";

export const runtime = "nodejs";
/** 一次写入 + 读回 + 逐行重算价 */
export const maxDuration = 15;

/** 模型文件大小上限 —— 跟 `/api/print-orders/upload-url` 同一个口径 */
const MAX_MODEL_BYTES = 50 * 1024 * 1024;

/** 打印服务的几何 + 模型文件 */
const printSpecSchema = z.object({
  volumeCM3: z.number().positive().max(1_000_000),
  surfaceAreaCM2: z.number().min(0).max(1_000_000),
  dims: z
    .tuple([
      z.number().min(0).max(100_000),
      z.number().min(0).max(100_000),
      z.number().min(0).max(100_000),
    ])
    .refine(([x, y, z]) => x > 0 || y > 0 || z > 0, {
      message: "尺寸不能全为 0",
    }),
  supportWeightG: z.number().min(0).max(1_000_000).nullish(),
  selfSupportRatio: z.number().min(0).max(1_000_000).nullish(),
  /** 交期档位 —— 认不出来一律按标准档(不额外收费) */
  deliveryTier: z.enum(["standard", "express", "urgent"]).nullish(),
  modelFileName: z.string().min(1).max(255),
  modelObjectKey: z.string().min(1).max(512),
  modelUrl: z.string().min(1).max(2048),
  modelSizeBytes: z.number().int().positive().max(MAX_MODEL_BYTES).nullish(),
});

/** 打印服务行 —— 客户端只需要把 printSpec 填对 */
const printLineSchema = z.object({
  productId: z.string().min(1),
  productHandle: z.string().default(""),
  productTitle: z.string().default(""),
  productThumbnail: z.string().default(""),
  printSpec: printSpecSchema,
});

/** 目录商品行 */
const catalogLineSchema = z.object({
  productId: z.string(),
  productHandle: z.string(),
  productTitle: z.string(),
  productThumbnail: z.string().url(),
  materialId: z.string().min(1),
  sizeId: z.string().min(1),
  sizeCm: z.number().int().positive(),
  aiStyleId: z.string().min(1),
  engravingText: z.string().max(30).default(""),
  rushOrder: z.boolean().default(false),
  /** 选中的配件变体 id(2026-11-02 新增) */
  accessoryVariantIds: z.array(z.string().min(1)).default([]),
  previewImage: z.string().url(),
  originalImage: z.string().url(),
});

const lineItemSchema = z.object({
  productId: z.string().min(1),
  /**
   * 打印服务行排在前面
   *
   * 目录商品的字段对打印服务没有意义(材质 / 尺寸 / 配件),反之打印服务的
   * `printSpec` 对目录商品也没有 —— 两条分支的必填字段互不重叠,谁先谁后
   * 都不会误判。
   */
  spec: z.union([printLineSchema, catalogLineSchema]),
  quantity: z.number().int().min(1).max(100).default(1),
});

/** 是不是打印服务行 */
function isPrintLine(
  spec: z.infer<typeof lineItemSchema>["spec"]
): spec is z.infer<typeof printLineSchema> {
  return "printSpec" in spec && Boolean(spec.printSpec);
}

/**
 * 把解析出来的 spec 归一化成购物车行的 metadata
 *
 * 打印服务行走 `buildPrintServiceMetadata()` —— **服务端重建**,客户端带来的
 * 标题 / 封面 / handle 一律不采信(那三个字段在打印服务里是常量)。
 */
function toMetadata(
  spec: z.infer<typeof lineItemSchema>["spec"]
): CartLineItemMetadata {
  if (!isPrintLine(spec)) {
    return spec as CartLineItemMetadata;
  }
  const p = spec.printSpec;
  const printSpec: PrintServiceSpec = {
    volumeCM3: p.volumeCM3,
    surfaceAreaCM2: p.surfaceAreaCM2,
    dims: p.dims,
    supportWeightG: p.supportWeightG ?? null,
    selfSupportRatio: p.selfSupportRatio ?? null,
    // 认不出来的档位一律按标准档(不额外收费)—— 绝不按最贵的那档兜底
    deliveryTier: normalizeDeliveryTier(p.deliveryTier),
    modelFileName: p.modelFileName,
    modelObjectKey: p.modelObjectKey,
    modelUrl: p.modelUrl,
    modelSizeBytes: p.modelSizeBytes ?? null,
  };
  return buildPrintServiceMetadata({ spec: printSpec });
}

async function handle(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const cart = await getCart(id);
  if (!cart) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `cart ${id} 不存在` },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "请求体不是合法 JSON" },
      { status: 400 }
    );
  }

  const parsed = lineItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "line item 输入不合法",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const spec = parsed.data.spec;

  // 打印服务行:要登录 + 模型文件必须是自己分区里的那一个
  if (isPrintLine(spec)) {
    const session = await getSessionFromRequest(request);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        {
          error: "AUTH_REQUIRED",
          message: "打印服务需要先登录",
        },
        { status: 401 }
      );
    }

    if (!isR2Configured()) {
      return NextResponse.json(
        {
          error: "R2_NOT_CONFIGURED",
          message: "文件存储未配置,暂时无法加入购物车",
        },
        { status: 503 }
      );
    }

    // 归属校验:别人的模型、伪造的 URL 都不行
    if (
      !isOwnModelUrl(
        spec.printSpec.modelUrl,
        spec.printSpec.modelObjectKey,
        userId
      )
    ) {
      return NextResponse.json(
        {
          error: "INVALID_MODEL_URL",
          message: "模型文件地址不合法",
        },
        { status: 400 }
      );
    }

    // 文件必须真的在桶里 —— 工作室照着这个链接去取件,
    // 链接指向一个不存在的对象 = 一张没法开工的工单
    if (!(await objectExists(spec.printSpec.modelObjectKey))) {
      return NextResponse.json(
        {
          error: "MODEL_NOT_FOUND",
          message: "模型文件没找到,请重新上传",
        },
        { status: 422 }
      );
    }
  }

  try {
    const result = await addLineItem(id, {
      productId: isPrintLine(spec)
        ? PRINT_SERVICE_PRODUCT_ID
        : parsed.data.productId,
      spec: toMetadata(spec),
      quantity: parsed.data.quantity,
    });
    return NextResponse.json(
      { cart: result.cart, lineItem: result.lineItem },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "ADD_LINE_ITEM_FAILED",
        message: error instanceof Error ? error.message : "加入购物车失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(handle);
