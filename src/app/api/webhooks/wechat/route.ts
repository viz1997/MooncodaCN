/**
 * POST /api/webhooks/wechat —— 微信支付 V3 回调
 *
 * ## 响应口径 —— 微信只认一个 JSON
 *
 * 微信认定「处理成功」的标准是响应体是 `{"code":"SUCCESS"}`:
 *
 * - 处理成功 → `200` + `{"code":"SUCCESS"}`
 * - 验签 / 解密失败 → `401` + `{"code":"FAIL","message":"…"}`(伪造的通知,不能落库)
 * - 没配好 → `503`(让微信看到「服务端问题」,比假装收到了好)
 * - DB 写失败 → `500`(这种应该重投 —— 重投能好)
 * - **本地没这张单** → 照样 `200 SUCCESS`(认不出来的单号不是错误)
 *
 * 回 `FAIL` 微信会重投(默认会重投一整天)。所以「认不出来的单号」必须回
 * SUCCESS,不然微信会一直推一个我们永远处理不了的单。
 *
 * ## 必须先读原始 body
 *
 * 验签要对的是**原始字节**,不是 `JSON.parse` 之后再 `JSON.stringify` 回来
 * 的结果(键序、空格、转义都可能不一样,签名就对不上)。所以这里用
 * `await request.text()` 拿原始字符串,验签之后再 `JSON.parse`。
 */

import { type NextRequest, NextResponse } from "next/server";

import { PaymentNotConfiguredError } from "@/features/payments/lib/types";
import {
  handleWechatNotify,
  WECHAT_NOTIFY_SUCCESS,
  type WechatNotifyOutcome,
  wechatNotifyFailure,
} from "@/features/payments/providers/wechat/webhook";
import { withApiLogging } from "@/lib/api-logger";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
/** 一次验签 + 一次解密 + 一次 DB 写,30s 够 */
export const maxDuration = 30;

async function handle(request: NextRequest) {
  // ---- 1. 原始 body(验签要用字节,不能重新序列化) ----
  const rawBody = await request.text();

  // ---- 2. 验签 + 解密 + 落库 ----
  let outcome: WechatNotifyOutcome;
  try {
    outcome = await handleWechatNotify({
      rawBody,
      headers: request.headers,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    if (error instanceof PaymentNotConfiguredError) {
      // 没配微信支付 = 这个端点没法工作。503 让微信看到「服务端问题」,
      // 比 200(假装收到了)好 —— 假装收到了,钱的状态就永远对不上。
      logger.error({ err: error }, "微信 webhook 未配置");
      return NextResponse.json(wechatNotifyFailure("微信支付未配置"), {
        status: 503,
      });
    }
    // DB 写失败之类 —— 回 500,让微信重投(重投能好)
    logger.error({ err: error }, "微信 webhook 处理失败");
    return NextResponse.json(wechatNotifyFailure("处理失败"), { status: 500 });
  }

  if (!outcome.verified) {
    // 验签 / 解密失败 —— 伪造的通知,绝不落库
    logger.warn(
      { orderNo: outcome.orderNo, reason: outcome.reason },
      "微信 webhook 验签失败"
    );
    return NextResponse.json(
      wechatNotifyFailure(outcome.reason ?? "验签失败"),
      { status: 401 }
    );
  }

  logger.info(
    {
      orderNo: outcome.orderNo,
      transactionId: outcome.transactionId,
      tradeState: outcome.tradeState,
      settled: outcome.settled,
      reason: outcome.reason,
    },
    "微信 webhook 已处理"
  );

  // 一律 SUCCESS —— 认不出来的单号不是错误
  return NextResponse.json(WECHAT_NOTIFY_SUCCESS);
}

export const POST = withApiLogging(handle);
