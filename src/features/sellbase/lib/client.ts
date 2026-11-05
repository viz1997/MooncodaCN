/**
 * Sellbase 服务端客户端
 *
 * 只有一个 admin 客户端 —— 本仓库不走 Sellbase 的原生购物车
 * (见 `architecture-sellbase-integration.md` 的「为什么不用原生购物车」),
 * 所以只有 admin 路由用得上:
 *
 * | 用途 | 路由 | scope |
 * |---|---|---|
 * | 目录同步 | `POST /products`(upsert) | `catalog:write` |
 * | 建订单 + 拿支付链接 | `POST /orders` | `orders:write` |
 * | 重发支付链接 | `POST /orders/:id/payment-link` | `orders:write` |
 * | 注册 webhook 端点 | `POST /webhooks` | `webhooks:write` |
 * | 读店铺配置(币种 / 税) | `GET /store` | `settings:write` 或任一 admin scope |
 *
 * ## 错误形状
 *
 * Sellbase 的错误统一是 `{code, message, hint}`。SDK 把它包成了
 * `SellbaseError`(用 `isSellbaseError` 判),但本仓库要在 Route Handler
 * 里把它翻译成自己的响应 —— 所以这里再包一层 `SellbaseApiError`,
 * 带上 HTTP 状态码和业务 code。
 */

import { createSellbase, type Sellbase } from "@sellbase/sdk";

import { getSellbaseConfig } from "./env";

/** 本仓库对 Sellbase 错误的封装 —— 带业务 code,方便 Route Handler 翻译 */
export class SellbaseApiError extends Error {
  /** 业务错误码,如 `NOT_FOUND` / `VALIDATION_ERROR` / `INSUFFICIENT_STOCK` */
  readonly code: string;
  /** 给用户看的提示(Sellbase 的 hint 拼在 message 后面) */
  readonly hint: string | null;
  /** HTTP 状态码 */
  readonly status: number;

  constructor(params: {
    code: string;
    message: string;
    hint?: string | null;
    status?: number;
  }) {
    super(params.message);
    this.name = "SellbaseApiError";
    this.code = params.code;
    this.hint = params.hint ?? null;
    this.status = params.status ?? 502;
  }

  /** 给用户看的完整文案(message + hint) */
  get displayMessage(): string {
    return this.hint ? `${this.message} —— ${this.hint}` : this.message;
  }
}

let cached: Sellbase | null = null;
let cachedConfigKey: string | null = null;

/**
 * 拿 admin 客户端(单例)
 *
 * 缓存键是 url + token —— 测试里换 env 不会拿到脏缓存。
 */
export function getSellbaseAdmin(): Sellbase {
  const config = getSellbaseConfig();
  const key = `${config.url}::${config.apiToken}`;

  if (cached && cachedConfigKey === key) return cached;

  cached = createSellbase({
    url: config.url,
    token: config.apiToken,
    // anonKey 是可选的 —— exactOptionalPropertyTypes 下不能显式传 undefined
    ...(config.anonKey ? { anonKey: config.anonKey } : {}),
  });
  cachedConfigKey = key;
  return cached;
}

/**
 * 把 SDK 抛出来的错误统一成 `SellbaseApiError`
 *
 * SDK 的错误类型是 `SellbaseError`(`{code, message, hint}`);网络错误、
 * JSON 解析错误之类的一律包成 `UPSTREAM_ERROR`。
 */
export function toSellbaseApiError(error: unknown): SellbaseApiError {
  if (error instanceof SellbaseApiError) return error;

  if (typeof error === "object" && error !== null) {
    const maybe = error as {
      code?: unknown;
      message?: unknown;
      hint?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };
    const code = typeof maybe.code === "string" ? maybe.code : null;
    const message =
      typeof maybe.message === "string" ? maybe.message : "Sellbase 请求失败";
    const hint = typeof maybe.hint === "string" ? maybe.hint : null;
    const status =
      typeof maybe.status === "number"
        ? maybe.status
        : typeof maybe.statusCode === "number"
          ? maybe.statusCode
          : 502;

    if (code) {
      return new SellbaseApiError({ code, message, hint, status });
    }
  }

  return new SellbaseApiError({
    code: "UPSTREAM_ERROR",
    message: error instanceof Error ? error.message : "Sellbase 请求失败",
    status: 502,
  });
}

/** 跑一个 Sellbase 调用,把错误统一包好 */
export async function callSellbase<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toSellbaseApiError(error);
  }
}
