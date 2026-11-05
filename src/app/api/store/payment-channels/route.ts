/**
 * GET /api/store/payment-channels —— 现在能用的收款通道
 *
 * 结算页靠它画「选择支付方式」那几个按钮。
 *
 * ## 没配好的通道不显示
 *
 * `available: false` 的通道前端不渲染 —— 让用户点一个注定失败的按钮,比不给
 * 这个选项更糟。
 *
 * ## 过渡期多一条「旧通道」
 *
 * 新的三个通道(微信 / 支付宝 / Shopify)还没配好时,结算页不能一个选项都没有
 * —— 那等于关掉了收款。所以只要**三个新通道没全部就绪**,就额外返回旧的
 * Sellbase + Stripe 那条路。
 *
 * 三个都就绪之后,这条旧通道自动消失 —— 界面上就只剩三个支付方式。
 * 跑通之后把 `src/features/sellbase/` 整个拆掉,那时把下面那段
 * `legacyChannel` 一起删了。
 */

import { type NextRequest, NextResponse } from "next/server";

import { listPaymentChannels } from "@/features/payments/lib/registry";
import { isSellbaseConfigured } from "@/features/sellbase/lib/env";
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

/** 过渡期的旧通道(Sellbase + Stripe)—— 三个新通道都就绪之后就不再返回 */
function legacyChannel() {
  return {
    channel: "stripe" as const,
    label: "银行卡(旧收款通道)",
    description: "过渡期保留的收银台,新的三个通道就绪后自动下线",
    available: isSellbaseConfigured(),
  };
}

async function handle(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, "storeCheckout");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  const channels = listPaymentChannels();
  const allNewReady = channels.every((channel) => channel.available);

  return NextResponse.json(
    {
      channels: allNewReady ? channels : [...channels, legacyChannel()],
    },
    { headers: getRateLimitHeaders(rl) }
  );
}

export const GET = withApiLogging(handle);
