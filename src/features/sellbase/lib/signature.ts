/**
 * Sellbase webhook 签名验签
 *
 * 签名方案跟 Stripe 一模一样(Stripe 是它的上游),所以别找「Sellbase 专用
 * 的算法」—— 没有:
 *
 * ```
 * Sellbase-Signature: t=<unix 秒>,v1=<hex HMAC-SHA256("<t>.<raw body>")>
 * ```
 *
 * - 签名对象是 **原始 body 字节**,不是 `JSON.parse` 之后再序列化的结果
 *   (重新序列化可能多空格、少字段,字节对不上)
 * - 一个 header 里可以有多个 `v1=`,**任一匹配即通过**(密钥轮换期会这样)
 * - 时间戳容差 300 秒,超了直接拒(防重放)
 *
 * 实现照 `sellbase-webhooks/index.js:65152-65158` 的 `verifyStripeSignature`。
 *
 * 这里是纯函数(node:crypto),不碰 env —— 单测直接喂参数。
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** 签名头名字(HTTP 头大小写不敏感) */
export const SELLBASE_SIGNATURE_HEADER = "sellbase-signature";

/** 时间戳容差(秒)—— 跟 Sellbase 自己的 `WEBHOOK_TOLERANCE_S` 一致 */
export const SELLBASE_WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * 定长比较
 *
 * node 的 `crypto.timingSafeEqual` 长度不等会**抛异常**,而 Sellbase 那边
 * 的实现是自己写的(长度不等直接 false)。这里保持同样的语义 —— 免得一个
 * 畸形的 header 把 webhook 路由打成 500。
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * 算一个签名 —— `hex(HMAC-SHA256(secret, "<timestamp>.<payload>"))`
 *
 * 签名端(`scripts/sync-sellbase-catalog.ts` 注册 webhook 时)用不上,
 * 但单测要拿它造「合法 header」,所以导出。
 */
export function computeSellbaseSignature(
  secret: string,
  timestampSeconds: number,
  payload: string
): string {
  return createHmac("sha256", secret)
    .update(`${timestampSeconds}.${payload}`)
    .digest("hex");
}

/**
 * 造一个合法的 `Sellbase-Signature` 头(测试 / 本地联调用)
 */
export function buildSellbaseSignatureHeader(
  secret: string,
  payload: string,
  timestampSeconds: number
): string {
  const sig = computeSellbaseSignature(secret, timestampSeconds, payload);
  return `t=${timestampSeconds},v1=${sig}`;
}

/**
 * 解析签名头
 *
 * 头形如 `t=123,v1=abc,v1=def`。解析不出来返回 null。
 */
export interface ParsedSignatureHeader {
  timestampSeconds: number;
  signatures: string[];
}

export function parseSellbaseSignatureHeader(
  header: string | null | undefined
): ParsedSignatureHeader | null {
  if (!header) return null;

  let timestampSeconds = Number.NaN;
  const signatures: string[] = [];

  for (const rawPart of header.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;

    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();

    if (key === "t") {
      timestampSeconds = Number(value);
    } else if (key === "v1") {
      signatures.push(value);
    }
  }

  if (!Number.isFinite(timestampSeconds) || signatures.length === 0) {
    return null;
  }
  return { timestampSeconds, signatures };
}

/**
 * 验签
 *
 * 返回 true = 签名有效。**任何一步不通过都返回 false,不抛异常** ——
 * webhook 路由拿到 false 就回 401,不该因为一个畸形请求打成 500。
 *
 * @param payload 原始 body 字符串(必须跟 Sellbase 投递的字节一致)
 * @param header  `Sellbase-Signature` 头的值
 * @param secret  端点的签名密钥
 * @param nowSeconds 当前时间(秒)—— 传进来是为了可测
 */
export function verifySellbaseSignature(
  payload: string,
  header: string | null | undefined,
  secret: string,
  nowSeconds: number
): boolean {
  const parsed = parseSellbaseSignatureHeader(header);
  if (!parsed) return false;

  // 时间戳超容差 → 拒(可能是重放)
  if (
    Math.abs(nowSeconds - parsed.timestampSeconds) >
    SELLBASE_WEBHOOK_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const expected = computeSellbaseSignature(
    secret,
    parsed.timestampSeconds,
    payload
  );
  return parsed.signatures.some((candidate) => safeEqual(candidate, expected));
}
