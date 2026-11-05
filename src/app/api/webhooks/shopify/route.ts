/**
 * POST /api/webhooks/shopify —— Shopify 事件回调
 *
 * ## 签名
 *
 * 头 `X-Shopify-Hmac-Sha256` = `base64(HMAC-SHA256(原始 body, API secret))`。
 *
 * **验签密钥就是 Client Secret** —— 2026-01-01 起 Shopify 不再给单独的
 * API secret 了,Dev Dashboard 里那对 Client ID / Client Secret 中的 secret
 * 就是 HMAC 的 key。旧 app 那种独立的 `SHOPIFY_API_SECRET` 仍然认(配了就
 * 优先用)。见 `@/features/payments/providers/shopify/env.ts`。
 *
 * **必须用原始字节验签** —— `await request.json()` 之后再 `JSON.stringify`
 * 回来的字节可能不一样(键序、空格、转义),签就对不上。这里先
 * `await request.arrayBuffer()` 拿原始字节,验完再 `toString("utf8")` 解析。
 *
 * 验签失败 → 401,不处理。伪造的「已付款」事件是最坏的情况。
 *
 * ## topic
 *
 * - `orders/paid` —— 草稿单被付了 → 标已付
 * - `orders/cancelled` —— 标取消
 * - `refunds/create` —— 退款(**只**改支付状态)
 *
 * 其余 topic 一律 200 忽略 —— 回 4xx 的话 Shopify 会一直重投,把这个端点
 * 打成噪音源,还会把真正重要的支付事件挤掉。
 *
 * ## 幂等
 *
 * webhook 会重投。靠「状态转移本身幂等」处理(已是目标状态就 no-op),
 * 不另建去重表。详见 `@/features/payments/lib/settle.ts`。
 */

import { type NextRequest, NextResponse } from "next/server";

import {
  getShopifyApiSecret,
  ShopifyNotConfiguredError,
} from "@/features/payments/providers/shopify/env";
import {
  SHOPIFY_HMAC_HEADER,
  verifyShopifyHmac,
} from "@/features/payments/providers/shopify/signature";
import { handleShopifyWebhook } from "@/features/payments/providers/shopify/webhook";
import { withApiLogging } from "@/lib/api-logger";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
/** 一次验签 + 一次 DB 写,30s 够 */
export const maxDuration = 30;

async function handle(request: NextRequest) {
  // ---- 1. 原始 body(验签要用字节,不能重新序列化) ----
  const rawBody = Buffer.from(await request.arrayBuffer());

  // ---- 2. 验签 ----
  let secret: string;
  try {
    secret = getShopifyApiSecret();
  } catch (error) {
    if (error instanceof ShopifyNotConfiguredError) {
      // 没配密钥 = 这个端点没法工作。503 让 Shopify 看到「服务端问题」,
      // 比 200(假装收到了)好 —— 200 的话 Shopify 以为投递成功,钱的状态
      // 就永远对不上了。
      logger.error({ err: error }, "Shopify webhook 密钥未配置");
      return NextResponse.json(
        { success: false, error: "SHOPIFY_NOT_CONFIGURED" },
        { status: 503 }
      );
    }
    throw error;
  }

  const signature = request.headers.get(SHOPIFY_HMAC_HEADER);
  if (!verifyShopifyHmac(rawBody, signature, secret)) {
    logger.warn({ hasHeader: !!signature }, "Shopify webhook 验签失败");
    return NextResponse.json(
      { success: false, error: "INVALID_SIGNATURE" },
      { status: 401 }
    );
  }

  // ---- 3. 解析 ----
  const topic = request.headers.get("x-shopify-topic") ?? "";
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    logger.warn("Shopify webhook 体不是合法 JSON");
    return NextResponse.json(
      { success: false, error: "INVALID_JSON" },
      { status: 400 }
    );
  }

  // ---- 4. 落库 ----
  const result = await handleShopifyWebhook({ topic, payload });

  logger.info(
    {
      topic,
      orderNo: result.orderNo,
      changed: result.changed,
      reason: result.reason,
    },
    "Shopify webhook 已处理"
  );

  // 一律 200 —— 认不出来的事件不是错误
  return NextResponse.json({
    success: true,
    changed: result.changed,
    orderNo: result.orderNo,
  });
}

export const POST = withApiLogging(handle);
