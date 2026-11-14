/**
 * POST /api/store/orders/[orderNo]/payment-link —— 重取付款入口
 *
 * 三种情况(见 `features/storefront/lib/order-payment.ts`):
 * - 还没入口 → 按订单行重建一次支付会话
 * - 有入口但失效 → 换新的
 * - 已经付了 → 拒绝
 *
 * ## 「入口」不止是链接
 *
 * 微信 Native 是**扫码**,不是跳转 —— 所以响应里有两个字段:
 * `paymentUrl`(跳转地址)和 `paymentQrCodeUrl`(二维码内容),有一个不是 null
 * 就算成功。
 *
 * ## 归属校验在数据层
 *
 * 别人的订单号查出来就是 null(上层转 404,不是 403 —— 403 等于告诉别人
 * 「这个订单号存在」,订单号是可以被枚举的)。
 */

import { type NextRequest, NextResponse } from "next/server";

import { ensureStorefrontOrderPaymentLink } from "@/features/storefront/lib/order-payment";
import { getUserStorefrontOrderByOrderNo } from "@/features/storefront/lib/orders";
import { withApiLogging } from "@/lib/api-logger";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 一次查询 + 一次 Sellbase 调用 */
export const maxDuration = 30;

async function handle(
  request: NextRequest,
  context: { params: Promise<{ orderNo: string }> }
) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, "storeCheckout");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  const { orderNo } = await context.params;

  const session = await getSessionFromRequest(request);
  const user = session?.user;
  if (!user?.id) {
    return NextResponse.json(
      { error: "AUTH_REQUIRED", message: "请先登录" },
      { status: 401, headers: getRateLimitHeaders(rl) }
    );
  }

  const result = await getUserStorefrontOrderByOrderNo(user.id, orderNo);
  if (!result) {
    return NextResponse.json(
      { error: "ORDER_NOT_FOUND", message: "订单不存在" },
      { status: 404, headers: getRateLimitHeaders(rl) }
    );
  }

  const link = await ensureStorefrontOrderPaymentLink(
    result.order,
    result.items
  );

  if (!link.ok) {
    /**
     * 「这一单不许再付了」那一族 → **409**(不是 502)
     *
     * 409 = 「这个状态跟现在的请求冲突」—— 钱已经发生了(付过了 / 支付宝说
     * 付了但我们核不上 / 退过了),再要一个付款入口就是让用户**付两次**。
     *
     * 502 是「这次调用挂了,重试就好」—— 那句话在这一档上是**错的**。
     */
    const status =
      link.code === "ALREADY_PAID" ||
      link.code === "ORDER_REFUNDED" ||
      link.code === "PAYMENT_UNVERIFIED"
        ? 409
        : 502;
    return NextResponse.json(
      { error: link.code, message: messageForCode(link.code) },
      { status, headers: getRateLimitHeaders(rl) }
    );
  }

  return NextResponse.json(
    {
      orderNo: result.order.orderNo,
      paymentUrl: link.paymentUrl,
      paymentQrCodeUrl: link.paymentQrCodeUrl,
    },
    { headers: getRateLimitHeaders(rl) }
  );
}

function messageForCode(code: string): string {
  switch (code) {
    case "ALREADY_PAID":
      return "这笔订单已经付过了";
    case "PAYMENT_UNVERIFIED":
      // ⚠️ 这一档**不能**说成「生成失败,请重试」—— 钱可能已经到了,
      // 让用户重试就是让他**付两次**(线上真踩过:SO-20261114-137332)。
      return "支付宝那边显示这笔已经付款成功,我们还在核对 —— 请不要重复付款,工作室会人工确认";
    case "ORDER_REFUNDED":
      return "这笔订单已经退过款了";
    case "CARRIER_MISSING":
      return "订单缺少载体信息,无法生成支付链接 —— 请联系工作室";
    case "PAYMENT_NOT_CONFIGURED":
      return "收款通道没配置好,请联系工作室";
    default:
      return "生成支付链接失败,请稍后重试";
  }
}

export const POST = withApiLogging(handle);
