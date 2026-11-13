/**
 * GET /api/print-orders/[orderNo] —— 打印工单详情
 *
 * 2026-11-02:登录后下单之后,这个接口**必须登录 + 必须是本人**。
 * 之前的匿名查单(订单号 + 令牌双因子)已经删掉了 —— 订单挂在账号名下,
 * 按 user_id 查就行。
 *
 * ## 别人的单返回 404,不是 403
 *
 * 403 等于告诉别人「这个订单号确实存在」。订单号是可以被枚举的
 * (`PO-20261101-XXXXXX` 这种格式,猜起来不难),返回 404 让攻击者分不清
 * 「不存在」和「不是你的」,少一条信息泄露。
 *
 * 归属校验写在 `getUserPrintOrderByOrderNo()` 里 —— 查出来是 null 就 404。
 */

import { type NextRequest, NextResponse } from "next/server";
import { getPrintOrderUser } from "@/features/print-quote/lib/auth";
import {
  listPrintOrderEvents,
  toPrintOrderEventView,
} from "@/features/print-quote/lib/order-events";
import {
  getUserPrintOrderByOrderNo,
  toUserPrintOrderDetail,
} from "@/features/print-quote/lib/order-store";
import {
  listShipmentsForOrder,
  toShipmentView,
} from "@/features/shipment/lib/shipment-store";
import { withApiLogging } from "@/lib/api-logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 三次读(订单 + 时间线 + 物流),30s 够 */
export const maxDuration = 30;

async function handle(
  request: NextRequest,
  ctx: { params: Promise<{ orderNo: string }> }
) {
  const ip = getClientIp(request);

  const rl = await checkRateLimit(ip, "printOrder");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  const user = await getPrintOrderUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "请先登录" },
      { status: 401, headers: getRateLimitHeaders(rl) }
    );
  }

  // Next 16:params 是 Promise,漏了 await 会拿到 "[object Promise]"
  const { orderNo } = await ctx.params;

  const row = await getUserPrintOrderByOrderNo(user.id, orderNo);
  if (!row) {
    // 不存在 和 不是你的 —— 同一个答案
    return NextResponse.json(
      { success: false, error: "工单不存在" },
      { status: 404, headers: getRateLimitHeaders(rl) }
    );
  }

  const events = await listPrintOrderEvents(row.id);
  // 物流(2026-11-13)—— 一个工单可能有多个包裹(补发 / 分开发)
  const shipments = await listShipmentsForOrder("print", row.id);

  return NextResponse.json(
    {
      order: toUserPrintOrderDetail(row),
      events: events.map(toPrintOrderEventView),
      // 响应形状**只涨不破** —— 老消费者忽略这个字段,不影响它们
      shipments: shipments.map(toShipmentView),
    },
    { headers: getRateLimitHeaders(rl) }
  );
}

export const GET = withApiLogging(handle);
