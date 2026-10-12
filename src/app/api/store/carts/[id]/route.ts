/**
 * GET /api/store/carts/[id] —— 取 cart
 *
 * 对齐 Medusa Store API `GET /store/carts/{id}`。
 * 切真 Medusa 时:转发到 Medusa,可选 expand line items。
 */

import { NextResponse } from "next/server";
import { getCart } from "@/features/storefront/lib/cart-store";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

async function handle(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const cart = getCart(id);

  if (!cart) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `cart ${id} 不存在` },
      { status: 404 }
    );
  }

  return NextResponse.json({ cart });
}

export const GET = withApiLogging(handle);
