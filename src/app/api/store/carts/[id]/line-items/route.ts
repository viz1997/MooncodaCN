/**
 * POST /api/store/carts/[id]/line-items —— 加 line item 到**商城购物袋**
 *
 * 同规格的行会合并数量(靠 `(cart_id, spec_hash)` 唯一索引)。
 *
 * ## 车里**只有目录商品**(2026-11-08)
 *
 * 工作室的说法:「不要放入购物车,放在这里 account/print-orders」。打印服务
 * 是另一条线 —— 工单自己建、自己收款(见 `POST /api/print-orders`)。
 *
 * 所以这个接口**只收目录商品行**:规格(尺寸 / 材质 / 配件)照旧,价格按
 * 目录算(服务端算,客户端带来的价一律不信)。
 *
 * ## 目录商品行不加登录门槛
 *
 * 游客也能有购物袋(不用登录)。这条不变 —— 小程序侧也是这么用的。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { addLineItem, getCart } from "@/features/storefront/lib/cart-store";
import {
  PRODUCT_UNAVAILABLE_CODE,
  ProductUnavailableError,
} from "@/features/storefront/lib/product-unavailable";
import type { CartLineItemMetadata } from "@/features/storefront/types";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";
/** 一次写入 + 读回 + 逐行重算价 */
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

  // 2. 目录商品行 —— 游客也能加
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
    // **下架的型号加不进**(2026-11-14)—— 回 409,不是 500
    //
    // 409 = 「这个状态跟现在的请求冲突」—— 商品下架了,没法买。
    // 500 会让工作室以为是服务器坏了。
    if (error instanceof ProductUnavailableError) {
      return NextResponse.json(
        { error: PRODUCT_UNAVAILABLE_CODE, message: error.message },
        { status: 409 }
      );
    }
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
