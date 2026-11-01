/**
 * 移植自 wjp-source-code/src/lib/crypto.ts —— 耗材克重报价计算器（PolyJet 全彩打印）。
 *
 * 算法逻辑与源实现保持一致；移植时仅做类型严格化（noUncheckedIndexedAccess /
 * exactOptionalPropertyTypes）与 Biome 格式化调整，未改变任何数值行为。
 */
/**
 * 密码加解密工具
 *
 * 使用 SHA-256 哈希 + 盐值存储密码，避免明文。
 * 验证时对用户输入同样哈希后比对。
 *
 * 注意：这是前端层面的保护，不是安全级别的加密。
 * 真正敏感的密码应该在后端验证。这里用于防止普通用户查看开发者参数。
 */

// 预计算的密码哈希（SHA-256 of "moon@2026" + salt "wjp_salt_2026"）
// 客户端不存储明文密码
const SALT = "wjp_salt_2026";

// moon@2026 + wjp_salt_2026 的 SHA-256 哈希值
const PASSWORD_HASH =
  "86a4f412d0ff8488fbf460fe95399e907cd9140829de3af65107a7c4d5c74311";

/**
 * 计算字符串的 SHA-256 哈希
 */
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 哈希密码（加盐）
 */
export async function hashPassword(password: string): Promise<string> {
  return sha256(password + SALT);
}

/**
 * 验证密码
 * @param input 用户输入的密码
 * @returns 是否匹配
 */
export async function verifyPasswordHash(input: string): Promise<boolean> {
  const inputHash = await hashPassword(input);
  return inputHash === PASSWORD_HASH;
}

/**
 * 简单的 AES 加密/解密（用于本地存储配置等）
 * 使用 Web Crypto API
 */

const AES_KEY = "wjp_aes_key_2026";

async function getAesKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(AES_KEY);
  const hashBuffer = await crypto.subtle.digest("SHA-256", keyData);
  return crypto.subtle.importKey(
    "raw",
    hashBuffer,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * AES-GCM 加密
 */
export async function encrypt(text: string): Promise<string> {
  const key = await getAesKey();
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
  // 返回 base64(iv + ciphertext)
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

/**
 * AES-GCM 解密
 */
export async function decrypt(encryptedBase64: string): Promise<string> {
  const key = await getAesKey();
  const combined = Uint8Array.from(atob(encryptedBase64), (c) =>
    c.charCodeAt(0)
  );
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}
