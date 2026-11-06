/**
 * POST /api/store/print-carts/[id]/line-items —— 加一行打印服务到**打印单**
 *
 * 打印单是**另一张车**(另一个 cookie `wjp_print_cart_id`、另一种性质
 * `kind = "print"`)。打印服务不走商城购物袋 —— 工作室的说法:「模型打印是
 * 不走商城正常的购物车的,而是走打印下单」。
 *
 * ## 三道校验
 *
 * 1. **这张车是不是你的** —— 路径里的 id 必须是当前 cookie 里那张打印单。
 *    归属校验在这里做(id 能被枚举,别人的车不该能加行)。
 * 2. **模型文件是不是你的** —— `isOwnModelUrl()` —— 别人的模型、伪造的
 *    URL 都不行(模型的 R2 对象键按用户分区)。
 * 3. **文件是不是真的在桶里** —— 工作室照着这个链接去取件,链接指向一个
 *    不存在的对象 = 一张没法开工的工单。
 *
 * 打印服务行的 metadata 由**服务端**重建(`buildPrintServiceMetadata()`)——
 * 客户端带来的标题 / 封面 / handle 一律不采信。价格也是服务端算的
 * (按克重,见 `computePrintServiceLinePrice()`)。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { isR2Configured, objectExists } from "@/features/image-gen/lib/r2";
import { normalizeDeliveryTier } from "@/features/print-quote/lib/delivery-tier";
import { isOwnModelUrl } from "@/features/print-quote/lib/upload-key";
import { CartKindMismatchError } from "@/features/storefront/lib/cart-kind";
import {
  addLineItem,
  getCart,
  getPrintCartId,
} from "@/features/storefront/lib/cart-store";
import {
  buildPrintServiceMetadata,
  PRINT_SERVICE_PRODUCT_ID,
} from "@/features/storefront/lib/print-service";
import type { PrintServiceSpec } from "@/features/storefront/types";
import { withApiLogging } from "@/lib/api-logger";
import { getSessionFromRequest } from "@/lib/auth/request-session";

export const runtime = "nodejs";
/** 一次写入 + 读回 + 逐行重算价 + 一次 R2 存在性检查 */
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

const lineItemSchema = z.object({
  productId: z.string().min(1),
  spec: printLineSchema,
  /** 打印服务恒为一件(一活一模型)—— 传了也按 1 算 */
  quantity: z.number().int().min(1).max(100).default(1),
});

async function handle(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // 1. 登录 —— 打印服务要挂在账号名下(工单属于谁)
  const session = await getSessionFromRequest(request);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "AUTH_REQUIRED", message: "打印服务需要先登录" },
      { status: 401 }
    );
  }

  // 2. 这张车是不是你的 —— 归属校验在这里做
  const ownCartId = await getPrintCartId();
  if (!ownCartId || ownCartId !== id) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `打印单 ${id} 不存在` },
      { status: 404 }
    );
  }

  const cart = await getCart(id);
  if (!cart) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `打印单 ${id} 不存在` },
      { status: 404 }
    );
  }

  // 3. 解析 body
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
        message: "打印服务行输入不合法",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const p = parsed.data.spec.printSpec;

  if (!isR2Configured()) {
    return NextResponse.json(
      {
        error: "R2_NOT_CONFIGURED",
        message: "文件存储未配置,暂时无法加入打印单",
      },
      { status: 503 }
    );
  }

  // 归属校验:别人的模型、伪造的 URL 都不行
  if (!isOwnModelUrl(p.modelUrl, p.modelObjectKey, userId)) {
    return NextResponse.json(
      { error: "INVALID_MODEL_URL", message: "模型文件地址不合法" },
      { status: 400 }
    );
  }

  // 文件必须真的在桶里 —— 工作室照着这个链接去取件
  if (!(await objectExists(p.modelObjectKey))) {
    return NextResponse.json(
      { error: "MODEL_NOT_FOUND", message: "模型文件没找到,请重新上传" },
      { status: 422 }
    );
  }

  // 服务端重建规格 —— 客户端带来的标题 / 封面 / handle 一律不采信
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
    if (error instanceof CartKindMismatchError) {
      return NextResponse.json(
        { error: "CART_KIND_MISMATCH", message: error.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: "ADD_LINE_ITEM_FAILED",
        message: error instanceof Error ? error.message : "加入打印单失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(handle);
