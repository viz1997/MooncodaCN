/**
 * POST /api/store/print-carts —— 创建或取当前**打印单**(自动 cookie 关联)
 *
 * cookie `wjp_print_cart_id` 关联打印单。跟商城购物袋(`wjp_cart_id`)是
 * **两个 cookie、两种车** —— 打印服务不走商城购物袋(工作室的说法:「模型
 * 打印是不走商城正常的购物车的,而是走打印下单」)。
 *
 * 游客也能有打印单(不用登录)—— 但**加打印服务行要登录**(模型文件要落到
 * 用户自己的 R2 分区里,归属校验靠那个)。
 */

import { NextResponse } from "next/server";
import { getOrCreatePrintCart } from "@/features/storefront/lib/cart-store";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";
/** 一次 DB 查询(找车 + 取行 + 逐行重算价) */
export const maxDuration = 15;

async function handle() {
  // cookie 关联的打印单;没有就新建一张(cookie 由 getOrCreatePrintCart 写)
  const cart = await getOrCreatePrintCart();

  return NextResponse.json({ cart }, { status: 201 });
}

export const POST = withApiLogging(handle);
