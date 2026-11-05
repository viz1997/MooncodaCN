/**
 * POST /api/store/carts/[id]/line-items —— 加 line item 到 cart
 *
 * 同规格的行会合并数量(靠 `(cart_id, spec_hash)` 唯一索引)。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { addLineItem, getCart } from "@/features/storefront/lib/cart-store";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";
/** 一次写入 + 读回 + 逐行重算价 */
export const maxDuration = 15;

const lineItemSchema = z.object({
  productId: z.string().min(1),
  spec: z.object({
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
  }),
  quantity: z.number().int().min(1).max(100).default(1),
});

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

  try {
    const result = await addLineItem(id, parsed.data);
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
