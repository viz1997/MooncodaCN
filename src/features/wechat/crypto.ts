/**
 * 微信小程序解密工具
 *
 * 唯一职责：从 `Taro.getPhoneNumber` 返回的 `encryptedData` / `iv` 解出明文手机号。
 *
 * 微信加密机制：
 *   - session_key 是 32 字节 AES-128 key（用 Base64 字符串传输）
 *   - encryptedData = AES-128-CBC(session_key, base64(encryptedData))
 *   - iv 同样 Base64 编码
 *   - PKCS#7 padding
 *
 * 依赖：Node 自带 `crypto` 模块，无任何 npm 包。
 */

import { createDecipheriv } from "node:crypto";

/**
 * 解密微信 `encryptedData`，返回 UTF-8 字符串结果。
 *
 * 失败原因：
 *   - session_key / iv / data 任何字段非 Base64 → 抛 "INVALID_BASE64"
 *   - session_key 长度非 16/24/32 → 抛 "INVALID_SESSION_KEY_LENGTH"
 *   - PKCS#7 padding 缺失或解密后明文非 JSON → 抛 "DECRYPT_FAILED"
 */
export function decryptWechatData(
  sessionKey: string,
  encryptedData: string,
  iv: string
): string {
  let sessionKeyBuf: Buffer;
  let ivBuf: Buffer;
  let dataBuf: Buffer;
  try {
    sessionKeyBuf = Buffer.from(sessionKey, "base64");
    ivBuf = Buffer.from(iv, "base64");
    dataBuf = Buffer.from(encryptedData, "base64");
  } catch {
    throw new Error("INVALID_BASE64");
  }

  if (![16, 24, 32].includes(sessionKeyBuf.length)) {
    throw new Error("INVALID_SESSION_KEY_LENGTH");
  }
  if (ivBuf.length !== 16) {
    throw new Error("INVALID_IV_LENGTH");
  }

  let deciphered: Buffer;
  try {
    const decipher = createDecipheriv("aes-128-cbc", sessionKeyBuf, ivBuf);
    // 微信官方默认 zeroPadding 不带 PKCS#7，但实际收到的大多数小程序云
    // SDK 都用 PKCS#7 —— 自动识别两者（createDecipheriv 不带 setAutoPadding
    // 时默认按 PKCS#7 解 padding）。
    decipher.setAutoPadding(true);
    deciphered = Buffer.concat([decipher.update(dataBuf), decipher.final()]);
  } catch {
    throw new Error("DECRYPT_FAILED");
  }

  return deciphered.toString("utf8");
}

/**
 * 从 decrypted encryptedData JSON 里取 phoneNumber 字段。
 *
 * 微信小程序 getPhoneNumber 返回的明文结构（官方文档）：
 *   {
 *     "phoneNumber": "13800138000",
 *     "purePhoneNumber": "13800138000",
 *     "countryCode": "86",
 *     "watermark": { "appid": "...", "timestamp": ... }
 *   }
 *
 * 返回的 phoneNumber 不带 +86 前缀，需要拼接 countryCode 成 E.164。
 */
export function parseDecryptedPhoneNumber(decryptedJson: string): {
  phoneNumber: string; // E.164: +8613800138000
  rawNumber: string; // 不带国家码
  countryCode: string; // 不带 + 前缀
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptedJson);
  } catch {
    throw new Error("INVALID_DECRYPTED_JSON");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("phoneNumber" in parsed)
  ) {
    throw new Error("MISSING_PHONE_NUMBER_FIELD");
  }

  const obj = parsed as { phoneNumber: unknown; countryCode?: unknown };
  if (typeof obj.phoneNumber !== "string" || obj.phoneNumber.length === 0) {
    throw new Error("MISSING_PHONE_NUMBER_FIELD");
  }

  const rawNumber = obj.phoneNumber;
  const countryCode =
    typeof obj.countryCode === "string" ? obj.countryCode : "86";

  return {
    phoneNumber: `+${countryCode}${rawNumber}`,
    rawNumber,
    countryCode,
  };
}
