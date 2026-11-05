/**
 * 支付宝签名 —— **纯函数**(不碰网络、不碰 DB、不读 env)
 *
 * ## 支付宝那套签名到底怎么算
 *
 * 1. 把要参与签名的参数**按 key 的 ASCII 升序**排好
 * 2. 拼成 `k1=v1&k2=v2&…` —— **value 原样**,不做 URL 编码
 * 3. 用**应用私钥**做一次 `RSA-SHA256` 签名,结果 base64
 * 4. base64 放进 `sign=` 参数
 *
 * ## 两种口径 —— `sign_type` 排不排进去
 *
 * 这是支付宝最容易踩的一个坑,两种场景不一样:
 *
 * | 场景 | `scope` | 排除的参数 |
 * |---|---|---|
 * | 发出去的请求(下单 / 查单) | `request` | 只排 `sign` —— **`sign_type` 要留着** |
 * | 收到的异步通知(验签) | `notify` | `sign` **和** `sign_type` 都排 |
 *
 * 排错了就是「签名怎么算都对不上」,而且不报错,只是平台返回
 * `Invalid signature`。
 *
 * ## 为什么单独一个文件
 *
 * 签名是这一条通道里最容易出错、又最难肉眼 review 出来的地方
 * (排序、排除项、base64、PEM 格式)。所以拆成纯函数,能进 `unit`
 * project 跑测试 —— 钉住「乱序参数也必须按升序拼」「改一个字节就验不过」
 * 这些不变量。
 */

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

/**
 * 待签字符串的两种口径
 *
 * - `request` —— 我们发给支付宝的请求:排除 `sign`,**保留** `sign_type`
 * - `notify` —— 支付宝发回来的通知:排除 `sign` **和** `sign_type`
 */
export type AlipaySignScope = "request" | "notify";

/**
 * 一批参数
 *
 * 值可以是 `undefined` / `null` / 空串 —— 那三种都**不进**待签字符串
 * (支付宝的签名跟微信不一样,微信会跳过空值,支付宝这里也照做)。
 */
export type AlipayParams = Record<string, string | undefined | null>;

/** 请求口径排除的 key */
const REQUEST_EXCLUDED = new Set(["sign"]);

/** 通知口径排除的 key */
const NOTIFY_EXCLUDED = new Set(["sign", "sign_type"]);

/**
 * ASCII 升序比较
 *
 * 不直接用 `Array.sort()` 的默认比较 —— 默认比较按 UTF-16 码元排,对 ASCII
 * 字符结果一样,但写出来更明确,也避免哪天混进一个非 ASCII 的 key 时
 * 悄悄排错位置。
 */
function compareAscii(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 值「有内容」吗 —— `undefined` / `null` / 空串都算没有 */
function isNonEmpty(value: string | undefined | null): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * 拼待签字符串
 *
 * @param params 参数表
 * @param scope 口径 —— 决定 `sign_type` 排不排(见文件头)
 */
export function buildSignContent(
  params: AlipayParams,
  scope: AlipaySignScope = "request"
): string {
  const excluded = scope === "notify" ? NOTIFY_EXCLUDED : REQUEST_EXCLUDED;

  const entries = Object.entries(params)
    .filter(
      (entry): entry is [string, string] =>
        !excluded.has(entry[0]) && isNonEmpty(entry[1])
    )
    .sort((a, b) => compareAscii(a[0], b[0]));

  return entries.map(([key, value]) => `${key}=${value}`).join("&");
}

/**
 * 规范化 PEM
 *
 * 环境变量里一行写不下完整私钥,惯例是把换行写成 `\n`。这里把它还原成真换行。
 *
 * 顺带补上结尾换行 —— PEM 规范要求最后一行带换行,缺了有些解析器会挑食。
 */
export function normalizePemKey(raw: string): string {
  const restored = raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
  return restored.endsWith("\n") ? restored : `${restored}\n`;
}

/**
 * 用**应用私钥**签名(RSA2 / RSA-SHA256),返回 base64
 *
 * 私钥不对 / 不是合法 PEM 时抛错 —— 那属于「配错了」,由调用方分类。
 */
export function signContent(content: string, appPrivateKeyPem: string): string {
  const key = createPrivateKey(normalizePemKey(appPrivateKeyPem));
  return sign("RSA-SHA256", Buffer.from(content, "utf8"), key).toString(
    "base64"
  );
}

/**
 * 用**支付宝公钥**验签(RSA2 / RSA-SHA256)
 *
 * 注意是支付宝公钥 —— 不是应用自己的公钥。应用公钥是给支付宝验我们的请求
 * 用的,方向反了的话永远验不过。
 *
 * 任何异常(公钥不合法 / sign 不是合法 base64)都当「验不过」,不往外抛 ——
 * 验签失败只是一个布尔结果,不该变成 500。
 */
export function verifySign(
  content: string,
  signature: string,
  alipayPublicKeyPem: string
): boolean {
  try {
    const key = createPublicKey(normalizePemKey(alipayPublicKeyPem));
    return verify(
      "RSA-SHA256",
      Buffer.from(content, "utf8"),
      key,
      Buffer.from(signature, "base64")
    );
  } catch {
    return false;
  }
}
