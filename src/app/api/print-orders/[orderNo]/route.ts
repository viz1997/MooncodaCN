/**
 * GET /api/print-orders/[orderNo] —— 查打印订单状态
 *
 * 匿名可查,但要 **订单号 + 令牌** 两个都对。订单号是给用户看的
 * (`PO-20261101-3F7K2A`),会被截图发到群里,所以光有订单号不能查 ——
 * 令牌在下单成功时给用户,存在浏览器本地。
 *
 * 查不到和令牌不对都返回 404 + 同一个错误码:不区分「订单不存在」和
 * 「令牌错了」,免得被用来探测哪些订单号存在。
 */

import { type NextRequest, NextResponse } from "next/server";

import { findPrintOrder } from "@/features/print-quote/lib/order-store";
import type { PrintOrderView } from "@/features/print-quote/lib/quote-types";
import { withApiLogging } from "@/lib/api-logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 一次 DB 读,10s 够 */
export const maxDuration = 10;

async function handle(
  request: NextRequest,
  context: { params: Promise<{ orderNo: string }> }
) {
  const ip = getClientIp(request);

  // 单独的桶 —— 「我的订单」列表一次加载会按本地存的订单数发 N 个请求,
  // 共用 global 桶的话会把同 IP 的其它接口一起拖下水
  const rl = await checkRateLimit(ip, "printOrder");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  const { orderNo } = await context.params;
  const token = request.nextUrl.searchParams.get("token") ?? "";

  if (!token) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "订单不存在" },
      { status: 404, headers: getRateLimitHeaders(rl) }
    );
  }

  const row = await findPrintOrder(orderNo, token);
  if (!row) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "订单不存在" },
      { status: 404, headers: getRateLimitHeaders(rl) }
    );
  }

  const view: PrintOrderView = {
    orderNo: row.orderNo,
    status: row.status,
    modelFileName: row.modelFileName,
    materialWeightG: Number(row.materialWeightG),
    supportWeightG:
      row.supportWeightG === null ? null : Number(row.supportWeightG),
    dims: [Number(row.dimX), Number(row.dimY), Number(row.dimZ)],
    totalPriceCents: row.totalPriceCents,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    createdAt: row.createdAt.toISOString(),
  };

  return NextResponse.json(
    { order: view },
    { headers: getRateLimitHeaders(rl) }
  );
}

export const GET = withApiLogging(handle);
