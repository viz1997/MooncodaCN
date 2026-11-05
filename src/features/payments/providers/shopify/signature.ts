/**
 * Shopify webhook 验签 —— **纯函数**
 *
 * ## 签名是怎么算的
 *
 * 头 `X-Shopify-Hmac-Sha256`,值是 `base64(HMAC-SHA256(原始 body, app 的
 * API secret))`。
 *
 * **必须用原始字节** —— `await request.json()` 之后再 `JSON.stringify` 回来
 * 的字节可能不一样(键序、空格、转义、Unicode 转义方式),签就对不上了。
 * 所以这里收 `Buffer`,路由那边先 `await request.arrayBuffer()` 拿到原始
 * 字节,验完签再 `toString("utf8")` 去解析 JSON。
 *
 * ## 比较用定长比较
 *
 * `crypto.timingSafeEqual` —— 逐字节比较的时间跟内容无关,不给「猜签」留
 * 时间差。长度不一样直接 false(那个函数要求两个 buffer 等长)。
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** 验签头的名字(小写 —— HTTP 头名不区分大小写) */
export const SHOPIFY_HMAC_HEADER = "x-shopify-hmac-sha256";

/** 算签名(测试和验签都用它) */
export function computeShopifyHmac(
  rawBody: string | Buffer,
  secret: string
): string {
  return createHmac("sha256", secret)
    .update(
      typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody
    )
    .digest("base64");
}

/**
 * 验签
 *
 * - 头缺失 → false
 * - 长度对不上 → false(不等长不能做定长比较)
 * - 签名不匹配 → false
 */
export function verifyShopifyHmac(
  rawBody: string | Buffer,
  headerValue: string | null | undefined,
  secret: string
): boolean {
  if (!headerValue) return false;

  const expected = Buffer.from(computeShopifyHmac(rawBody, secret), "utf8");
  const received = Buffer.from(headerValue.trim(), "utf8");
  if (expected.length !== received.length) return false;

  return timingSafeEqual(expected, received);
}
