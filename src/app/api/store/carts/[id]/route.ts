/**
 * GET /api/store/carts/[id] —— 取 cart
 *
 * 单价是**重算**过的 —— 存的只是缓存(见 `cart-store.ts` 的说明)。
 */

import { NextResponse } from "next/server";
import { getCart } from "@/features/storefront/lib/cart-store";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";
/** 一次 DB 查询 + 逐行重算价 */
export const maxDuration = 15;

async function handle(
  _request: Request,
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

  return NextResponse.json({ cart });
}

export const GET = withApiLogging(handle);
