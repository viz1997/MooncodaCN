/**
 * POST /api/store/carts/[id]/line-items —— 加 line item 到**商城购物袋**
 *
 * 同规格的行会合并数量(靠 `(cart_id, spec_hash)` 唯一索引)。
 *
 * ## 一个接口,两种行(2026-11-08)
 *
 * 打印服务**并进商城购物袋**了 —— 工作室的说法:「不要 print-order,进入
 * 商城那个」。所以这个接口**两种行都收**:
 *
 * - **目录商品行** —— 规格(尺寸 / 材质 / 配件)照旧,价格按目录算
 * - **打印服务行** —— 用户自带 3D 模型,按克重计价(见 `print-service.ts`)
 *
 * 判据是「`spec` 里有没有 `printSpec`」—— 不是 `productId`(打印服务在目录
 * 里没有对应的商品,`productId` 是个哨兵值)。
 *
 * ## 打印服务行多三道校验
 *
 * 1. **必须登录** —— 工单属于谁。
 * 2. **模型文件是不是你的** —— `isOwnModelUrl()`:别人的模型、伪造的
 *    URL 都不行(模型的 R2 对象键按用户分区)。
 * 3. **文件是不是真的在桶里** —— 工作室照着这个链接去取件,链接指向一个
 *    不存在的对象 = 一张没法开工的工单。
 *
 * 打印服务行的 metadata 由**服务端**重建(`buildPrintServiceMetadata()`)——
 * 客户端带来的标题 / 封面 / handle 一律不采信。价格也是服务端算的
 * (按克重,见 `computePrintServiceLinePrice()`)。
 *
 * ## 目录商品行不加登录门槛
 *
 * 游客也能有购物袋(不用登录)。这条不变 —— 小程序侧也是这么用的。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { isR2Configured, objectExists } from "@/features/image-gen/lib/r2";
import { describeDbError } from "@/features/print-quote/lib/db-error";
import { normalizeDeliveryTier } from "@/features/print-quote/lib/delivery-tier";
import { isOwnModelUrl } from "@/features/print-quote/lib/upload-key";
import {
  addLineItem,
  getCart,
  isOwnCart,
} from "@/features/storefront/lib/cart-store";
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
/** 一次写入 + 读回 + 逐行重算价(打印服务行还要查一次 R2) */
export const maxDuration = 15;

/** 目录商品的规格 */
const catalogSpecSchema = z.object({
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

/**
 * 行 —— 外壳(两种行共用的那部分)
 *
 * `spec` 的形状分两种,靠「有没有 printSpec」判(见
 * `storefront/lib/print-service.ts`)。先按外壳解一遍只是为了拿到
 * `productId` / `quantity`,`spec` 本身交给下面各自的 schema 校验。
 */
const lineItemShellSchema = z.object({
  productId: z.string().min(1),
  spec: z.unknown(),
  quantity: z.number().int().min(1).max(100).default(1),
});

/** 目录商品行 */
const catalogLineSchema = z.object({
  productId: z.string().min(1),
  spec: catalogSpecSchema,
  quantity: z.number().int().min(1).max(100).default(1),
});

async function handle(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // 1. 解析 body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "请求体不是合法 JSON" },
      { status: 400 }
    );
  }

  const shell = lineItemShellSchema.safeParse(body);
  if (!shell.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "line item 输入不合法",
        issues: shell.error.issues,
      },
      { status: 400 }
    );
  }

  // 2. 打印服务行?—— 判据是「有没有 printSpec」
  const rawSpec = shell.data.spec;
  const isPrintLine =
    rawSpec !== null &&
    typeof rawSpec === "object" &&
    "printSpec" in (rawSpec as Record<string, unknown>);

  if (!isPrintLine) {
    // 目录商品行 —— 游客也能加
    const parsed = catalogLineSchema.safeParse(body);
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

    const cart = await getCart(id);
    if (!cart) {
      return NextResponse.json(
        { error: "CART_NOT_FOUND", message: `cart ${id} 不存在` },
        { status: 404 }
      );
    }

    try {
      const result = await addLineItem(id, {
        productId: parsed.data.productId,
        spec: parsed.data.spec as unknown as CartLineItemMetadata,
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

  // 3. 打印服务行 —— 登录 + 归属 + 文件存在
  //
  //    打印服务要挂在账号名下(工单属于谁),所以这一条要登录。
  const session = await getSessionFromRequest(request);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "AUTH_REQUIRED", message: "打印服务需要先登录" },
      { status: 401 }
    );
  }

  // 这张车是不是你的 —— 归属校验在这里做(id 能被枚举)
  if (!(await isOwnCart(id, userId))) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `购物车 ${id} 不存在` },
      { status: 404 }
    );
  }

  const cart = await getCart(id);
  if (!cart) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `购物车 ${id} 不存在` },
      { status: 404 }
    );
  }

  const printSpecParsed = printSpecSchema.safeParse(
    (rawSpec as { printSpec?: unknown }).printSpec
  );
  if (!printSpecParsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "打印服务行输入不合法",
        issues: printSpecParsed.error.issues,
      },
      { status: 400 }
    );
  }
  const p2 = printSpecParsed.data;

  if (!isR2Configured()) {
    return NextResponse.json(
      {
        error: "R2_NOT_CONFIGURED",
        message: "文件存储未配置,暂时无法加入购物袋",
      },
      { status: 503 }
    );
  }

  // 归属校验:别人的模型、伪造的 URL 都不行
  if (!isOwnModelUrl(p2.modelUrl, p2.modelObjectKey, userId)) {
    return NextResponse.json(
      { error: "INVALID_MODEL_URL", message: "模型文件地址不合法" },
      { status: 400 }
    );
  }

  // 文件必须真的在桶里 —— 工作室照着这个链接去取件
  if (!(await objectExists(p2.modelObjectKey))) {
    return NextResponse.json(
      { error: "MODEL_NOT_FOUND", message: "模型文件没找到,请重新上传" },
      { status: 422 }
    );
  }

  // 服务端重建规格 —— 客户端带来的标题 / 封面 / handle 一律不采信
  const printSpec: PrintServiceSpec = {
    volumeCM3: p2.volumeCM3,
    surfaceAreaCM2: p2.surfaceAreaCM2,
    dims: p2.dims,
    supportWeightG: p2.supportWeightG ?? null,
    selfSupportRatio: p2.selfSupportRatio ?? null,
    // 认不出来的档位一律按标准档(不额外收费)—— 绝不按最贵的那档兜底
    deliveryTier: normalizeDeliveryTier(p2.deliveryTier),
    modelFileName: p2.modelFileName,
    modelObjectKey: p2.modelObjectKey,
    modelUrl: p2.modelUrl,
    modelSizeBytes: p2.modelSizeBytes ?? null,
  };

  try {
    const result = await addLineItem(id, {
      productId: PRINT_SERVICE_PRODUCT_ID,
      spec: buildPrintServiceMetadata({ spec: printSpec }),
      quantity: 1,
    });
    return NextResponse.json(
      { cart: result.cart, lineItem: result.lineItem },
      { status: 201 }
    );
  } catch (error) {
    /**
     * 迁移脚本没跑 → 表 / 列不存在 → 500
     *
     * Drizzle 抛出来的 message 是一坨拼起来的 SQL,**看不出是迁移没跑**。
     * 所以这里用 `describeDbError()` 把真原因摘出来写进日志,响应体只给
     * 一句人话 —— 原始 SQL 不往外发(内部信息),但服务端日志里能直接看到
     * 「缺哪张表 / 哪一列」。
     */
    const dbInfo = describeDbError(error);
    if (dbInfo.missingRelation) {
      console.error(
        `[StoreCart] 加行失败 —— 数据库缺表 / 缺列(迁移脚本没跑?): ${dbInfo.message}`
      );
      return NextResponse.json(
        {
          error: "ADD_LINE_ITEM_FAILED",
          message: "加入购物袋失败 —— 服务端数据库还没更新",
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: "ADD_LINE_ITEM_FAILED",
        message: "加入购物袋失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(handle);
