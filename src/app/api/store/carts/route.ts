/**
 * POST /api/store/carts —— 创建或取当前 cart(自动 cookie 关联)
 *
 * cookie `wjp_cart_id` 关联购物车。游客也能有 cart(不用登录)。
 */

import { NextResponse } from "next/server";
import { getOrCreateCart } from "@/features/storefront/lib/cart-store";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";
/** 一次 DB 查询(找 cart + 取行 + 重算价) */
export const maxDuration = 15;

async function handle() {
  // cookie 关联的 cart;没有就新建一张(cookie 由 getOrCreateCart 写)
  const cart = await getOrCreateCart();

  return NextResponse.json({ cart }, { status: 201 });
}

export const POST = withApiLogging(handle);
