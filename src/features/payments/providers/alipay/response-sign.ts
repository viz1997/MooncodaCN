/**
 * 支付宝**同步接口响应**的验签 —— 纯函数(不碰网络、不碰 DB、不读 env)
 *
 * ## 待签字符串到底是谁
 *
 * 支付宝的同步接口(查单 / 预下单)在 `format=JSON` 时回的响应长这样:
 *
 * ```json
 * {
 *   "alipay_trade_query_response": {
 *     "code": "10000",
 *     "msg": "Success",
 *     "out_trade_no": "SO-20261114-E58728",
 *     "total_amount": "228.00"
 *   },
 *   "sign": "VrgnnGgRMNApB1…"
 * }
 * ```
 *
 * **支付宝签的是那个内层对象的 JSON 原文** —— 就是下面这一段:
 *
 * ```
 * {"code":"10000","msg":"Success","out_trade_no":"SO-20261114-E58728","total_amount":"228.00"}
 * ```
 *
 * - **含**大括号
 * - **不含**外层那个键名 ⇒ `alipay_trade_query_response=` **不许拼上去**
 * - **不含**外层的 `"sign"` 那一项
 *
 * 官方《同步接口验签》(`open.alipay.com/200/106120`)就是这么写的:
 * 「开发者只对支付宝返回的 json 中 response 的值做验签」。各家 SDK 也是这么
 * 实现的(Python 版 `alipay` 的 `_get_string_to_be_signed()`:从
 * `response_type` 后面那个 `{` 起,按大括号配平抠出原文 —— **不含**键名前缀)。
 *
 * ## ⚠️ 这里踩过的坑(2026-11-14 线上)
 *
 * 原来的实现把待签字符串拼成了 `alipay_trade_query_response={…}` ——
 * **多了一个前缀**。支付宝签的其实只是内层那段 ⇒ **每一笔查单响应都验不过**
 * ⇒ 判定层永远落在 `signature_invalid` ⇒ 订单永远停在 `unpaid`
 * (`SO-20261114-657E4A` ¥247 / `SO-20261114-137332` ¥249 /
 * `SO-20261114-E58728` ¥228 三单全是这个)。
 *
 * ⇒ 这个前缀是**硬编码的错**。所以有单测钉住
 * (`src/test/payments/pure/alipay-response-signature.test.ts`)。
 *
 * ## 为什么必须用**原文**而不是重新序列化
 *
 * 支付宝签的是它自己吐出来的那段字节。重新 `JSON.stringify` 一次的话:
 *
 * - 键顺序可能变(支付宝的键序是它自己定的)
 * - `\/` 会被还原成 `/`(支付宝吐的 `qr_code` 里就有 `https:\/\/…`)
 * - 数字格式可能变(`1.0` vs `1`)
 *
 * ⇒ 抠原文是**唯一**能验过的办法。
 */

import { verifySign } from "./sign";

/**
 * 查单响应的内层对象名
 *
 * 支付宝用 `api_name.replace(".", "_") + "_response"` 拼出来的 ——
 * `alipay.trade.query` ⇒ `alipay_trade_query_response`。
 */
export const ALIPAY_TRADE_QUERY_RESPONSE_KEY = "alipay_trade_query_response";

/**
 * 抠出原始响应体里某个顶层字段的**原文片段**
 *
 * 只处理顶层对象值(`{…}`)—— 支付宝的响应里需要验签的就是那一个内层对象。
 *
 * 括号配平时**要认字符串里的括号**(字符串里可能有 `{` / `}`),也要认转义
 * —— 抠错了就是一段错的原文,验签永远过不了。
 */
function extractRawObject(raw: string, key: string): string | null {
  const marker = `"${key}"`;
  const markerIndex = raw.indexOf(marker);
  if (markerIndex === -1) return null;

  let cursor = markerIndex + marker.length;
  while (cursor < raw.length && raw[cursor] !== ":") cursor++;
  cursor++; // 跳过冒号
  while (cursor < raw.length && /\s/.test(raw[cursor] ?? "")) cursor++;

  if (raw[cursor] !== "{") return null;

  let depth = 0;
  let inString = false;
  for (let i = cursor; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === "\\") {
        i++; // 跳过被转义的字符
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(cursor, i + 1);
    }
  }
  return null;
}

/**
 * 拼出**待验签的那段原文**
 *
 * ⭐ **不带 `key=` 前缀** —— 支付宝签的是内层对象本身(见文件头)。
 *
 * @param raw 支付宝回应的**原文**(不是 `JSON.parse` 之后重新拼的)
 * @param key 内层对象的键名(`alipay_trade_query_response`)
 * @returns 待签字符串;抠不出来(响应里没这个键 / 值不是对象)时 `null`
 */
export function buildAlipayResponseSignContent(
  raw: string,
  key: string
): string | null {
  return extractRawObject(raw, key);
}

/**
 * 验同步接口响应的签名
 *
 * @param raw 支付宝回应的**原文**
 * @param key 内层对象的键名
 * @param signature 响应里的 `sign`
 * @param alipayPublicKeyPem 支付宝公钥(不是应用公钥)
 */
export function verifyAlipayResponseSignature(params: {
  raw: string;
  key: string;
  signature: string | undefined | null;
  alipayPublicKeyPem: string;
}): boolean {
  const content = buildAlipayResponseSignContent(params.raw, params.key);
  if (content === null) return false;
  if (typeof params.signature !== "string" || !params.signature) return false;

  return verifySign(content, params.signature, params.alipayPublicKeyPem);
}
