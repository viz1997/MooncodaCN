/**
 * POST /api/webhooks/alipay —— 支付宝异步通知
 *
 * ## 响应口径 —— 支付宝只认一个字符串
 *
 * 支付宝认定「处理成功」的标准是响应体**严格等于** `success` 这个纯文本。
 * 别的(带引号的 `"success"`、JSON、空 body)一律当成失败,然后按计划重投
 * —— 默认会重投一整天,25 小时内最多 8 次。
 *
 * 所以:
 *
 * - 处理成功 → `200` + 纯文本 `success`
 * - 验签失败 → `401`(伪造的通知,不能落库)
 * - 没配好 → `503`(让支付宝看到「服务端问题」,比假装收到了好)
 * - DB 写失败 → `500`(这种应该重投 —— 重投能好)
 * - **本地没这张单** → 照样 `200 success`(认不出来的单号不是错误)
 *
 * ## 为什么收钱以这里为准
 *
 * 同步回跳(用户付完跳回 `return_url`)的查询参数**不能信** —— 谁都能自己拼
 * 一个出来。所以「钱到了」只认支付宝主动推过来的这条通知,而且必须验签。
 */

import { type NextRequest, NextResponse } from "next/server";

import { PaymentNotConfiguredError } from "@/features/payments/lib/types";
import {
  type AlipayNotifyOutcome,
  handleAlipayNotify,
  parseNotifyParams,
} from "@/features/payments/providers/alipay/webhook";
import { withApiLogging } from "@/lib/api-logger";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
/** 一次验签 + 一次 DB 写,30s 够 */
export const maxDuration = 30;

/**
 * 支付宝要的「成功」响应
 *
 * 必须是**纯文本** `success` —— 带引号、多一个空格、或者包成 JSON 都会被
 * 当成失败,然后无限重投。
 */
function plainSuccess(): Response {
  return new Response("success", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function handle(request: NextRequest) {
  // 表单编码的 body —— 验签要的是**原始值**,不能先解一遍再拼回去
  const rawBody = await request.text();
  const params = parseNotifyParams(rawBody);

  let outcome: AlipayNotifyOutcome;
  try {
    outcome = await handleAlipayNotify(params);
  } catch (error) {
    if (error instanceof PaymentNotConfiguredError) {
      // 没配支付宝公钥 = 这个端点没法工作。503 让支付宝看到「服务端问题」,
      // 比 200(假装收到了)好 —— 假装收到了,钱的状态就永远对不上。
      logger.error({ err: error }, "支付宝 webhook 未配置");
      return NextResponse.json(
        { success: false, error: "ALIPAY_NOT_CONFIGURED" },
        { status: 503 }
      );
    }
    // DB 写失败之类 —— 回 500,让支付宝重投(重投能好)
    logger.error({ err: error }, "支付宝 webhook 处理失败");
    return NextResponse.json(
      { success: false, error: "ALIPAY_FAILED" },
      { status: 500 }
    );
  }

  if (!outcome.verified) {
    // 验签失败 —— 伪造的通知,绝不落库
    logger.warn({ orderNo: outcome.orderNo }, "支付宝 webhook 验签失败");
    return NextResponse.json(
      { success: false, error: "INVALID_SIGNATURE" },
      { status: 401 }
    );
  }

  logger.info(
    {
      orderNo: outcome.orderNo,
      tradeNo: outcome.tradeNo,
      tradeStatus: outcome.tradeStatus,
      settled: outcome.settled,
      reason: outcome.reason,
    },
    "支付宝 webhook 已处理"
  );

  // 一律 success —— 认不出来的单号不是错误
  return plainSuccess();
}

export const POST = withApiLogging(handle);
