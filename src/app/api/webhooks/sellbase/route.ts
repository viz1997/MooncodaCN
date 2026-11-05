/**
 * POST /api/webhooks/sellbase —— Sellbase 事件回调
 *
 * ## 签名
 *
 * 头形如 `Sellbase-Signature: t=<unix>,v1=<hex HMAC-SHA256("<t>.<raw body>")>`。
 * **必须读原始 body** —— `await request.json()` 之后再 `JSON.stringify` 回来
 * 的字节可能不一样(键序、空格、转义),签就对不上了。所以这里用
 * `await request.text()` 拿原始字符串,验签之后再 `JSON.parse`。
 *
 * 验签失败 → 401,不处理。伪造的「已付款」事件是最坏的情况。
 *
 * ## 事件白名单
 *
 * 只认 4 个:`order.paid` / `payment.succeeded` / `order.cancelled` /
 * `refund.created`。其余的一律 200 忽略 —— 回 4xx 的话 Sellbase 会一直
 * 重投,把这个端点打成噪音源。
 *
 * ## 幂等
 *
 * webhook 会重投。靠「状态转移本身幂等」处理(已是目标状态就 no-op),
 * 不另建去重表。详见 `sellbase/lib/webhook-handler.ts`。
 *
 * ## 响应
 *
 * 一律 200。处理失败也 200 —— Sellbase 只会因为 4xx/5xx 重投,而重投解决
 * 不了本地数据的问题(比如本地压根没有这张单),只会无限重试。
 */

import { eq } from "drizzle-orm";
import { after, type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { printOrder } from "@/db/schema";
import {
  notifyPrintOrderPaid,
  toPrintOrderMailInfo,
} from "@/features/print-quote/lib/notifications";
import {
  getSellbaseWebhookSecret,
  SellbaseNotConfiguredError,
} from "@/features/sellbase/lib/env";
import {
  classifySellbaseEvent,
  extractSellbaseOrderId,
  type SellbaseWebhookPayload,
} from "@/features/sellbase/lib/events";
import {
  SELLBASE_SIGNATURE_HEADER,
  verifySellbaseSignature,
} from "@/features/sellbase/lib/signature";
import { applySellbasePaymentAction } from "@/features/sellbase/lib/webhook-handler";
import { withApiLogging } from "@/lib/api-logger";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
/** 一次验签 + 一次 DB 写 + 一次(异步)邮件,30s 够 */
export const maxDuration = 30;

async function handle(request: NextRequest) {
  // ---- 1. 原始 body(验签要用字节,不能重新序列化) ----
  const rawBody = await request.text();

  // ---- 2. 验签 ----
  let secret: string;
  try {
    secret = getSellbaseWebhookSecret();
  } catch (error) {
    if (error instanceof SellbaseNotConfiguredError) {
      // 没配密钥 = 这个端点没法工作。503 让 Sellbase 看到「服务端问题」,
      // 比 200(假装收到了)好 —— 200 的话 Sellbase 以为投递成功,钱的状态
      // 就永远对不上了。
      logger.error({ err: error }, "Sellbase webhook 密钥未配置");
      return NextResponse.json(
        { success: false, error: "SELLBASE_NOT_CONFIGURED" },
        { status: 503 }
      );
    }
    throw error;
  }

  const signatureHeader = request.headers.get(SELLBASE_SIGNATURE_HEADER);
  const valid = verifySellbaseSignature(
    rawBody,
    signatureHeader,
    secret,
    Math.floor(Date.now() / 1000)
  );
  if (!valid) {
    logger.warn({ hasHeader: !!signatureHeader }, "Sellbase webhook 验签失败");
    return NextResponse.json(
      { success: false, error: "INVALID_SIGNATURE" },
      { status: 401 }
    );
  }

  // ---- 3. 解析 ----
  let payload: SellbaseWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as SellbaseWebhookPayload;
  } catch {
    logger.warn("Sellbase webhook 体不是合法 JSON");
    return NextResponse.json(
      { success: false, error: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const eventType = payload.type ?? "";

  // ---- 4. 分发 ----
  const action = classifySellbaseEvent(eventType, payload);
  const sellbaseOrderId = extractSellbaseOrderId(payload);

  const result = await applySellbasePaymentAction(action, sellbaseOrderId);

  logger.info(
    {
      eventType,
      sellbaseOrderId,
      kind: result.kind,
      orderType: result.orderType,
      orderNo: result.orderNo,
      changed: result.changed,
      reason: result.reason,
    },
    "Sellbase webhook 已处理"
  );

  // ---- 5. 收款成功 → 通知工作室 ----
  //
  // 邮件挂在响应之后发:响应先出去,serverless 冻结也不会丢信,也不会拖慢
  // webhook 的响应(Stripe / Sellbase 那边有重试计时器)。
  if (result.changed && result.kind === "mark_paid") {
    after(async () => {
      try {
        if (result.orderType === "print" && result.orderNo) {
          const rows = await db
            .select()
            .from(printOrder)
            .where(eq(printOrder.orderNo, result.orderNo))
            .limit(1);
          const row = rows[0];
          if (row) {
            await notifyPrintOrderPaid(toPrintOrderMailInfo(row));
          }
        }
      } catch (error) {
        logger.error(
          { err: error, orderNo: result.orderNo },
          "Sellbase webhook 收款通知发送失败"
        );
      }
    });
  }

  // 一律 200 —— 认不出来的事件不是错误
  return NextResponse.json({ success: true, kind: result.kind });
}

export const POST = withApiLogging(handle);
