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
 * ## 收款通道挂了**不影响**下单
 *
 * 本地订单先落库,再建支付会话。通道那边失败时订单照样在,状态停在
 * `unpaid`,响应里 `paymentUrl` 是 null —— 前端提示「订单已创建,支付链接生成
 * 失败」,用户可以在详情页重取。
 *
 * 响应里还有一个 `paymentIssue` 字段(`null` = 没失败):区分「收款通道没配
 * 好」(重试没用)和「这次调用挂了」(重试有用),话术不一样。见
 * `features/storefront/lib/payment-issue.ts`。
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
  /**
   * 界面语言(`en` / `zh`)—— 打印工单的邮件通知语言
   *
   * 不传 = 中文。落库而不是取「当前请求的 locale」:改状态的邮件是**工作室**
   * 触发的,那时请求 locale 是 admin 的语言,不是下单用户的语言。
   */
  locale: z.enum(["en", "zh"]).nullish(),
  /**
   * 收款通道(2026-11-05)
   *
   * 不传 = 服务端挑第一个「开放了而且配好了」的通道(`ENABLED_PAYMENT_CHANNELS`
   * + `isConfigured()`)。
   *
   * 传了但那个通道现在不可用 → 503 `PAYMENT_CHANNEL_UNAVAILABLE`(不是 400)——
   * 「这个方式现在不可用」比「参数不合法」更贴近真实原因,前端也是按这个码
   * 提示的。
   */
  channel: z.enum(["wechat", "alipay", "shopify", "stripe"]).nullish(),
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
    case "PAYMENT_CHANNEL_UNAVAILABLE":
      return 503;
    // 券的问题是**可预期的用户输入错误**(过期 / 没满门槛 / 超限 …)——
    // 400,不是 500。客户端按 `couponErrorCode` 说人话。
    case "COUPON_INVALID":
      return 400;
    // 车里有**已下架**的商品(2026-11-14)—— 409,不是 500
    //
    // 409 = 「这个状态跟现在的请求冲突」—— 商品下架了,没法买。
    // 用户把那一行删掉就能结(界面会指出来是哪一件)。
    case "PRODUCT_UNAVAILABLE":
      return 409;
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

  // 4. 车 —— 从 cookie 拿,不接受客户端指定
  //
  //    现在只有**一张车**(2026-11-08):打印服务跟目录商品装同一个购物袋。
  //    车永远从 cookie 取 —— 客户端指定 id 的话,就能拿别人的车去结算。
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
      locale: parsed.data.locale ?? null,
      channel: parsed.data.channel ?? null,
    });

    return NextResponse.json(result, { headers: getRateLimitHeaders(rl) });
  } catch (error) {
    if (error instanceof CheckoutError) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
          // 优惠码场景带上**精确原因**(过期 / 没满门槛 / 超限 …)——
          // 客户端按它查文案表说人话,拿不到就退化到通用文案。
          ...(error.couponErrorCode
            ? { couponErrorCode: error.couponErrorCode }
            : {}),
        },
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
