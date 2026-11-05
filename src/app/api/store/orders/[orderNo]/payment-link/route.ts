/**
 * POST /api/store/orders/[orderNo]/payment-link —— 重取支付链接
 *
 * 三种情况(见 `features/storefront/lib/order-payment.ts`):
 * - 还没链接 → 用订单行重建一张 Sellbase 订单
 * - 有 Sellbase 订单但链接失效 → `POST /orders/:id/payment-link` 换新的
 * - 已经付了 → 拒绝
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
    const status =
      link.code === "ALREADY_PAID" || link.code === "ORDER_REFUNDED"
        ? 409
        : 502;
    return NextResponse.json(
      { error: link.code, message: messageForCode(link.code) },
      { status, headers: getRateLimitHeaders(rl) }
    );
  }

  return NextResponse.json(
    { orderNo: result.order.orderNo, paymentUrl: link.paymentUrl },
    { headers: getRateLimitHeaders(rl) }
  );
}

function messageForCode(code: string): string {
  switch (code) {
    case "ALREADY_PAID":
      return "这笔订单已经付过了";
    case "ORDER_REFUNDED":
      return "这笔订单已经退过款了";
    case "CARRIER_MISSING":
      return "订单缺少载体信息,无法生成支付链接 —— 请联系工作室";
    case "SELLBASE_NOT_CONFIGURED":
      return "收款通道没配置好,请联系工作室";
    default:
      return "生成支付链接失败,请稍后重试";
  }
}

export const POST = withApiLogging(handle);
