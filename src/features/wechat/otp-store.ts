/**
 * 微信小程序登录 · code2Session 结果短期缓存
 *
 * 唯一职责：把 `/api/auth/wechat-phone-login` 路由拿到的
 * `{ openid, unionid }` 缓存 5 分钟，让 BA phoneNumber plugin 的
 * `verifyOTP` 钩子能在不知道原始 HTTP 请求的情况下查到。
 *
 * 这是微信登录的「桥」：
 *   - 路由拿 code → code2Session → decrypt phoneNumber → put(phone, payload)
 *   - BA verifyOTP(phone, "WECHAT_VERIFIED") → has(phone) → 返 true
 *   - BA callbackOnVerification(user) → consume(phone) → 拿到 payload 写 user.wechatOpenid
 *
 * 存储策略：
 *   - 生产（已配 UPSTASH_REDIS_REST_URL/TOKEN）：用 Upstash Redis REST API
 *   - dev（未配 Redis）：进程内 Map（每次 cold start 重置，足够 dev 用）
 *
 * TTL：300 秒（5 分钟）—— 与 BA OTP expiresIn 对齐（src/lib/auth/index.ts）；
 *   短于 OTP TTL 保证「bridge 已失效但 OTP 还能 verify」的悬空窗口不存在。
 *
 * 关联：Better Auth phoneNumber plugin verifyOTP（node_modules/better-auth/
 *   dist/plugins/phone-number/types.d.mts:39）。
 */

const TTL_SECONDS = 300; // 5 分钟
const REDIS_PREFIX = "wechat-otp:";

export interface WeChatOtpPayload {
  openid: string;
  unionid?: string;
}

// ============================================
// 进程内 Map fallback（dev）
// ============================================

interface Entry {
  payload: WeChatOtpPayload;
  expiresAt: number;
}

const memoryStore = new Map<string, Entry>();

function memoryGet(phone: string): WeChatOtpPayload | null {
  const entry = memoryStore.get(phone);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    memoryStore.delete(phone);
    return null;
  }
  return entry.payload;
}

function memoryPut(phone: string, payload: WeChatOtpPayload): void {
  memoryStore.set(phone, {
    payload,
    expiresAt: Date.now() + TTL_SECONDS * 1000,
  });
}

function memoryConsume(phone: string): WeChatOtpPayload | null {
  const payload = memoryGet(phone);
  memoryStore.delete(phone);
  return payload;
}

// ============================================
// Upstash Redis REST API（生产）
// ============================================

function isRedisEnabled(): boolean {
  return !!(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

async function redisGet(phone: string): Promise<WeChatOtpPayload | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const key = REDIS_PREFIX + phone;

  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { result: string | null };
  if (!data.result) return null;
  try {
    return JSON.parse(data.result) as WeChatOtpPayload;
  } catch {
    return null;
  }
}

async function redisPut(
  phone: string,
  payload: WeChatOtpPayload
): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const key = REDIS_PREFIX + phone;
  const value = JSON.stringify(payload);

  await fetch(
    `${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/ex/${TTL_SECONDS}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    }
  );
}

async function redisConsume(phone: string): Promise<WeChatOtpPayload | null> {
  // Upstash 没有原生「get + del」原子操作；用 pipeline（GET + DEL）保证
  // 同一 phoneNumber 不会被两次并发 verifyOTP 重复消费（生产 RPC 是单线程
  // 顺序执行，pipeline 也只是指令 batch —— 仍有可能两个 verifyOTP 同时
  // 拿到 payload；这里是 best-effort，不强一致）。
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const key = REDIS_PREFIX + phone;

  const resp = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["GET", key],
      ["DEL", key],
    ]),
    signal: AbortSignal.timeout(3000),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as Array<{ result: string | null }>;
  const value = data[0]?.result;
  if (!value) return null;
  try {
    return JSON.parse(value) as WeChatOtpPayload;
  } catch {
    return null;
  }
}

// ============================================
// 公开接口（透明 Redis / Memory 切换）
// ============================================

/**
 * 把 code2Session 结果缓存到 phoneNumber。重复 put 会覆盖（同一 phone
 * 多次授权走新流程时，正常情况不会发生 —— 但覆盖最安全）。
 */
export async function putWechatOtp(
  phone: string,
  payload: WeChatOtpPayload
): Promise<void> {
  if (isRedisEnabled()) {
    await redisPut(phone, payload);
    return;
  }
  memoryPut(phone, payload);
}

/**
 * 检查 phoneNumber 是否有未过期的 code2Session payload —— BA verifyOTP 钩子调用。
 */
export async function hasWechatOtp(phone: string): Promise<boolean> {
  if (isRedisEnabled()) {
    return (await redisGet(phone)) !== null;
  }
  return memoryGet(phone) !== null;
}

/**
 * 取并删除 payload —— BA callbackOnVerification 钩子调用，避免 openid 被
 * 同一 phoneNumber 多次绑定（虽然唯一约束兜底，但显式消费更干净）。
 */
export async function consumeWechatOtp(
  phone: string
): Promise<WeChatOtpPayload | null> {
  if (isRedisEnabled()) {
    return redisConsume(phone);
  }
  return memoryConsume(phone);
}
