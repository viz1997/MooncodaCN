/**
 * 小程序 SDK —— fetch 内核
 *
 * 用法:小程序入口 setupSdk({ baseUrl: "https://api.mooncoda.com" }) 一次,
 *      之后所有子模块(loginWithWechat / submitGenerate / ...) 自动用同一配置。
 *
 * 设计原则:
 *  - 不依赖任何 Node / 浏览器专属 API(纯 ES2020+,Taro 4 + 任意环境通吃)
 *  - Bearer 自动加(token 在 SdkConfig 里,各子模块不感知)
 *  - 401 触发 onUnauthorized 回调(由业务决定跳登录页)
 *  - 4xx/5xx 抛 ApiError 含业务 code,业务可按 code 分支处理
 *  - 支持 AbortSignal(轮询场景 cancel 用)
 *  - 支持 multipart/form-data(上传场景)
 *  - 默认 30s 超时,长轮询路由(/image/task)单独 override
 *
 * Token 持久化（2026-09-21）：
 *   - setSdkToken 写 wx.setStorageSync(TOKEN_STORAGE_KEY = "miniprogram-sdk:v1:token")，
 *     让小程序杀掉重开后 setupSdk 启动时能从 storage 读回,避免每次冷启动都
 *     要用户重新授权手机号（getPhoneNumber 是用户主动点,体验断裂）。
 *   - 退出登录 (logout) 同步清 storage。
 *   - 存储 key 加 SDK 版本前缀("miniprogram-sdk:v1:token"),未来 schema
 *     变更时可整体迁移/弃旧 key,不影响线上用户。
 *   - wx 全局 typeof 守卫:H5 / Node 调试环境(没 wx)静默跳过,只在真小
 *     程序环境生效。
 */

import type { ApiError, SdkConfig } from "./types";

/** wx 全局类型守卫 —— 真小程序有 wx,H5 / Node 没 wx */
type WxStorage = {
  setStorageSync: (key: string, data: string) => void;
  getStorageSync: (key: string) => string;
  removeStorageSync: (key: string) => void;
};

function getWx(): WxStorage | null {
  // 走 globalThis 访问 wx 全局 —— TS 不需要 declare global,真小程序编译
  // 命中(微信开发者工具 / Taro 编译产物自带 wx 全局),H5 / Node 调试
  // 走 fallback(null)。
  const w = (globalThis as { wx?: WxStorage }).wx;
  if (!w || typeof w.setStorageSync !== "function") return null;
  return w;
}

/** 当前 SDK 配置(全局唯一,setupSdk 调用后写入) */
let currentConfig: SdkConfig | null = null;

/**
 * 初始化 SDK(程序入口调一次)
 *
 * 启动时优先读 wx.storage 里上次持久化的 token,避免冷启动跳登录页
 * (用户感知:杀掉重开就要重授权手机号,体验差)。
 */
export function setupSdk(config: SdkConfig): void {
  // 1) 持久化 token 优先(用户上次登录态) → 2) 调用方传入 token(显式覆盖) → 3) 都没有 undefined
  const persistedToken = readPersistedToken();
  const initialToken = persistedToken ?? config.token;
  currentConfig = { timeoutMs: 30_000, ...config, token: initialToken };
}

/**
 * 更新 token(登录后调用,或 token 刷新)
 *
 * 同时写 wx.storage 持久化,小程序杀掉重开仍能恢复登录态。
 */
export function setSdkToken(token: string | undefined): void {
  if (!currentConfig) {
    throw new Error("setupSdk() must be called before setSdkToken()");
  }
  currentConfig = { ...currentConfig, token };
  // 持久化:真小程序走 wx.setStorageSync;H5 / Node 静默跳过
  const wx = getWx();
  if (wx) {
    try {
      if (token) wx.setStorageSync(TOKEN_STORAGE_KEY, token);
      else wx.removeStorageSync(TOKEN_STORAGE_KEY);
    } catch {
      // 隐私模式 / 配额满 / storage 被禁用 —— 静默忽略,不影响内存 token
    }
  }
}

/**
 * 读持久化的 token(供 setupSdk 启动恢复用)
 */
function readPersistedToken(): string | undefined {
  const wx = getWx();
  if (!wx) return undefined;
  try {
    const value = wx.getStorageSync(TOKEN_STORAGE_KEY);
    return value ? String(value) : undefined;
  } catch {
    return undefined;
  }
}

/** SDK token 在 wx.storage 里的 key。版本前缀防未来 schema 变更。 */
const TOKEN_STORAGE_KEY = "miniprogram-sdk:v1:token";

/** 读取当前 token */
export function getSdkToken(): string | undefined {
  return currentConfig?.token;
}

/** 读取当前 baseUrl */
export function getSdkBaseUrl(): string {
  if (!currentConfig) {
    throw new Error("setupSdk() must be called before any API call");
  }
  return currentConfig.baseUrl;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | undefined;
  /** JSON body,自动 JSON.stringify */
  json?: unknown;
  /** FormData body(上传场景) */
  formData?: FormData | undefined;
  /** URL search params */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Bearer token 覆盖(罕见场景:多账号切换) */
  token?: string | undefined;
  /** 取消信号 */
  signal?: AbortSignal | undefined;
  /** 超时 ms(默认 30s;轮询路由可加大) */
  timeoutMs?: number | undefined;
  /** 跳过自动 Bearer(免登录端点用) */
  skipAuth?: boolean | undefined;
}

const REQUEST_ERROR_SYMBOL = Symbol.for("MiniProgramSdk.RequestError");

export class SdkRequestError extends Error {
  readonly [REQUEST_ERROR_SYMBOL] = true;
  readonly status: number;
  readonly code: string | undefined;
  readonly raw: unknown;
  constructor(init: ApiError) {
    super(init.message);
    this.name = "SdkRequestError";
    this.status = init.status;
    this.code = init.code;
    this.raw = init.raw;
  }
}

function isSdkRequestError(err: unknown): err is SdkRequestError {
  if (!(err instanceof Error)) return false;
  return (
    (err as unknown as Record<symbol, unknown>)[REQUEST_ERROR_SYMBOL] === true
  );
}

/**
 * 底层 HTTP 调用(子模块内部用,业务不直接调)
 */
export async function sdkRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  if (!currentConfig) {
    throw new Error("setupSdk() must be called before any API call");
  }

  const {
    method = "GET",
    json,
    formData,
    query,
    token,
    signal,
    timeoutMs = currentConfig.timeoutMs ?? 30_000,
    skipAuth = false,
  } = options;

  // 拼 URL
  const url = new URL(path, currentConfig.baseUrl);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  // 拼 headers
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (formData !== undefined) {
    // multipart/form-data 由 fetch 自动加 boundary,不要手动设
    body = formData;
  }

  // 拼 Bearer
  if (!skipAuth) {
    const bearerToken = token ?? currentConfig.token;
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }
  }

  // 拼超时(AbortController)
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else
      signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
  }

  // 调用 fetch(Taro 环境会注入自己的 fetch;自定义优先)
  const fetcher = currentConfig.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (err instanceof Error && err.name === "AbortError") {
      throw new SdkRequestError({
        status: 0,
        message: "请求超时或被取消",
        code: "TIMEOUT",
      });
    }
    throw new SdkRequestError({
      status: 0,
      message: err instanceof Error ? err.message : "网络错误",
      code: "NETWORK_ERROR",
      raw: err,
    });
  }
  clearTimeout(timeoutHandle);

  // 401:触发回调
  if (response.status === 401) {
    currentConfig.onUnauthorized?.();
    throw new SdkRequestError({
      status: 401,
      message: "未登录或登录已过期",
      code: "UNAUTHORIZED",
    });
  }

  // 解析 body
  let parsed: unknown;
  const text = await response.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const body = parsed as { error?: string; code?: string } | undefined;
    throw new SdkRequestError({
      status: response.status,
      message: body?.error ?? `HTTP ${response.status}`,
      code: body?.code,
      raw: parsed,
    });
  }

  return parsed as T;
}

/** 重导出(供子模块复用) */
export { isSdkRequestError };
