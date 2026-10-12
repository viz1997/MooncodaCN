/**
 * PUT /api/store/carts/[id]/line-items/[lineId] —— 更新 line item 数量
 * DELETE /api/store/carts/[id]/line-items/[lineId] —— 删除 line item
 *
 * 对齐 Medusa Store API:
 *  - PUT /store/carts/{id}/line-items/{line_id}
 *  - DELETE /store/carts/{id}/line-items/{line_id}
 *
 * 切真 Medusa 时:转发到 Medusa。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getCart,
  removeLineItem,
  updateLineItemQuantity,
} from "@/features/storefront/lib/cart-store";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

const updateQuantitySchema = z.object({
  quantity: z.number().int().min(0).max(100),
});

async function handlePut(
  request: Request,
  context: { params: Promise<{ id: string; lineId: string }> }
) {
  const { id, lineId } = await context.params;
  const cart = getCart(id);
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

  const parsed = updateQuantitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "quantity 必须在 0-100 之间(0 等同于删除)",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  try {
    const result = updateLineItemQuantity(id, lineId, parsed.data.quantity);
    return NextResponse.json({ cart: result.cart, lineItem: result.lineItem });
  } catch (error) {
    return NextResponse.json(
      {
        error: "UPDATE_FAILED",
        message: error instanceof Error ? error.message : "更新数量失败",
      },
      { status: 500 }
    );
  }
}

async function handleDelete(
  _request: Request,
  context: { params: Promise<{ id: string; lineId: string }> }
) {
  const { id, lineId } = await context.params;
  const cart = getCart(id);
  if (!cart) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `cart ${id} 不存在` },
      { status: 404 }
    );
  }

  try {
    const result = removeLineItem(id, lineId);
    return NextResponse.json({ cart: result.cart });
  } catch (error) {
    return NextResponse.json(
      {
        error: "DELETE_FAILED",
        message: error instanceof Error ? error.message : "删除失败",
      },
      { status: 500 }
    );
  }
}

export const PUT = withApiLogging(handlePut);
export const DELETE = withApiLogging(handleDelete);
