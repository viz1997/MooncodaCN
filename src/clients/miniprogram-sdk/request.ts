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
 */

import type { ApiError, SdkConfig } from "./types";

/** 当前 SDK 配置(全局唯一,setupSdk 调用后写入) */
let currentConfig: SdkConfig | null = null;

/**
 * 初始化 SDK(程序入口调一次)
 */
export function setupSdk(config: SdkConfig): void {
  currentConfig = { timeoutMs: 30_000, ...config };
}

/**
 * 更新 token(登录后调用,或 token 刷新)
 */
export function setSdkToken(token: string | undefined): void {
  if (!currentConfig) {
    throw new Error("setupSdk() must be called before setSdkToken()");
  }
  currentConfig = { ...currentConfig, token };
}

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
