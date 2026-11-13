/**
 * GET /api/store/payment-channels —— 现在能用的收款通道
 *
 * 结算页靠它画「选择支付方式」那几个按钮。
 *
 * ## 两道闸
 *
 * - **开放了** —— `ENABLED_PAYMENT_CHANNELS`(工作室说现在用哪几个)
 * - **配好了** —— `isConfigured()`(环境变量齐没齐)
 *
 * 两道都过的通道才出现在这儿。没配好的不渲染 —— 让用户点一个注定失败的
 * 按钮,比不给这个选项更糟。
 *
 * ## 旧的 Sellbase + Stripe 那条路不在这儿了
 *
 * 旧路的代码还住在 `src/features/sellbase/`(过渡期保留,已建好的旧单还能
 * 重取支付入口),但**新单不再走它** —— 所以这里不再返回那条旧通道。
 */

import { type NextRequest, NextResponse } from "next/server";

import { listPaymentChannels } from "@/features/payments/lib/registry";
import { withApiLogging } from "@/lib/api-logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 一次本地读,10s 绰绰有余 */
export const maxDuration = 10;

async function handle(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, "storeCheckout");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  return NextResponse.json(
    { channels: await listPaymentChannels() },
    { headers: getRateLimitHeaders(rl) }
  );
}

export const GET = withApiLogging(handle);
