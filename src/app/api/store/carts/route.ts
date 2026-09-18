/**
 * POST /api/store/carts —— 创建或取当前 cart(自动 cookie 关联)
 *
 * 对齐 Medusa Store API `POST /store/carts`。
 * 切真 Medusa 时:转发到 Medusa,cookie 关联由 Medusa 处理。
 */

import { NextResponse } from "next/server";
import {
  getCartId,
  getOrCreateCart,
  setCartId,
} from "@/features/storefront/lib/cart-store";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

async function handle() {
  // 优先返回 cookie 关联的 cart(Medusa V1 模式:游客也能有 cart)
  const cart = await getOrCreateCart();

  // 把 cart_id 写到 cookie(若还没写过)
  const existingId = await getCartId();
  if (!existingId) {
    await setCartId(cart.id);
  }

  return NextResponse.json({ cart }, { status: 201 });
}

export const POST = withApiLogging(handle);
