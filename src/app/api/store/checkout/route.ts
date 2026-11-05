/**
 * POST /api/store/checkout —— 商城结算
 *
 * ## 结算必须登录
 *
 * 订单挂在账号名下(`storefront_order.user_id`),而且 Sellbase 按 **email**
 * upsert customer —— 邮箱必须是账号邮箱,不然两边对不上。所以未登录直接
 * 401,前端引导去登录(登录后购物车还在,cookie 不变)。
 *
 * 凭据两种都认:`Authorization: Bearer <token>`(微信小程序)或者 Better Auth
 * 的签名 cookie(浏览器)。见 `getSessionFromRequest`。
 *
 * ## 地址是**服务端查**的,不是客户端传的
 *
 * 客户端只传 `addressId`。服务端按 `userId` 查地址簿 —— 归属校验写死在
 * WHERE 里,别人的地址查出来就是 null。这样「客户端伪造地址」这条路从根上
 * 堵掉了,不用在 body 里收一堆地址字段再校验。
 *
 * ## 价全部服务端重算
 *
 * 见 `features/storefront/lib/checkout.ts` 的文件头。客户端带来的任何
 * 金额都不看。
 *
 * ## Sellbase 挂了**不影响**下单
 *
 * 本地订单先落库,再建 Sellbase 订单。Sellbase 那边失败时订单照样在,
 * 状态停在 `unpaid`,响应里 `paymentUrl` 是 null —— 前端提示「订单已创建,
 * 支付链接生成失败」,用户可以在详情页重取。
 */

import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getUserAddress } from "@/features/address/queries";
import { CART_COOKIE_NAME } from "@/features/storefront/lib/cart-store";
import { CheckoutError, checkout } from "@/features/storefront/lib/checkout";
import { withApiLogging } from "@/lib/api-logger";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 一次 DB 写 + 一次 Sellbase 建单(可能还有一次支付链接),30s 够 */
export const maxDuration = 30;

const checkoutSchema = z.object({
  /** 地址簿里的地址 id */
  addressId: z.string().min(1).max(64),
  /** 用户留言 */
  note: z.string().max(500).nullish(),
});

/** CheckoutError 的 code → HTTP 状态 */
function statusForCode(code: CheckoutError["code"]): number {
  switch (code) {
    case "CART_NOT_FOUND":
      return 404;
    case "CART_EMPTY":
      return 400;
    case "PRICING_FAILED":
      return 422;
    case "CARRIER_NOT_FOUND":
      return 503;
    default:
      return 500;
  }
}

async function handle(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, "storeCheckout");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  // 1. 必须登录
  //    Bearer(小程序)优先,cookie(浏览器)兜底 —— 见 `getSessionFromRequest`
  const session = await getSessionFromRequest(request);
  const user = session?.user;
  if (!user?.id) {
    return NextResponse.json(
      { error: "AUTH_REQUIRED", message: "结算需要先登录" },
      { status: 401, headers: getRateLimitHeaders(rl) }
    );
  }

  // 2. 解析 body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "请求体不是合法 JSON" },
      { status: 400, headers: getRateLimitHeaders(rl) }
    );
  }

  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "结算参数不合法",
        issues: parsed.error.issues,
      },
      { status: 400, headers: getRateLimitHeaders(rl) }
    );
  }

  // 3. 查地址(归属校验在数据层)
  const address = await getUserAddress(user.id, parsed.data.addressId);
  if (!address) {
    return NextResponse.json(
      { error: "ADDRESS_NOT_FOUND", message: "收货地址不存在" },
      { status: 404, headers: getRateLimitHeaders(rl) }
    );
  }

  // 4. 购物车 —— 从 cookie 拿,不接受客户端指定
  const cartId = (await cookies()).get(CART_COOKIE_NAME)?.value;
  if (!cartId) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: "购物车不存在或已过期" },
      { status: 404, headers: getRateLimitHeaders(rl) }
    );
  }

  // 5. 结算
  try {
    const result = await checkout({
      cartId,
      userId: user.id,
      email: user.email,
      address: {
        recipientName: address.recipientName,
        phone: address.phone,
        province: address.province,
        city: address.city,
        district: address.district,
        detail: address.detail,
      },
      note: parsed.data.note ?? null,
    });

    return NextResponse.json(result, { headers: getRateLimitHeaders(rl) });
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: statusForCode(error.code), headers: getRateLimitHeaders(rl) }
      );
    }
    console.error("[storefront] 结算失败", error);
    return NextResponse.json(
      { error: "CHECKOUT_FAILED", message: "结算失败,请稍后重试" },
      { status: 500, headers: getRateLimitHeaders(rl) }
    );
  }
}

export const POST = withApiLogging(handle);
