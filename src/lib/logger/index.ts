/**
 * 日志模块
 *
 * 使用 Pino 实现结构化日志
 * 支持 Axiom 云日志服务（可选）
 * 未配置时回退到 console 输出
 *
 * 环境变量:
 * - AXIOM_TOKEN: Axiom API Token（可选）
 * - AXIOM_DATASET: Axiom 数据集名称（可选，默认 "mooncoda"）
 */

import pino from "pino";

// ============================================
// 配置检查
// ============================================

/**
 * 检查是否为生产环境
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

// ============================================
// Logger 创建
// ============================================

/**
 * 创建 Logger 实例
 *
 * 日志级别:
 * - production: info 及以上
 * - development: debug 及以上
 *
 * 输出目标:
 * - 配置了 Axiom: 发送到 Axiom + console
 * - 未配置 Axiom: 仅 console（开发环境美化输出）
 */
function createLogger(): pino.Logger {
  const level = isProduction() ? "info" : "debug";

  // 基础配置
  const baseOptions: pino.LoggerOptions = {
    level,
    base: {
      env: process.env.NODE_ENV,
      service: "mooncoda",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // 开发环境：美化输出
  if (!isProduction()) {
    try {
      return pino({
        ...baseOptions,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      });
    } catch {
      // pino-pretty 不可用时降级
      return pino(baseOptions);
    }
  }

  // 生产环境：结构化 JSON 输出到 stdout
  // 注: pino transport（@axiomhq/pino）在 Turbopack 打包后无法工作
  // 因为 transport 使用 worker_threads 按字符串路径动态加载模块
  // 生产环境日志收集建议通过外部采集（如 Axiom 的 Vercel Integration 或 log drain）
  return pino(baseOptions);
}

// ============================================
// Logger 实例（单例）
// ============================================

/**
 * 全局 Logger 实例
 */
export const logger = createLogger();

// ============================================
// 便捷方法
// ============================================

/**
 * 创建带上下文的子 Logger
 *
 * @example
 * ```ts
 * const log = createContextLogger({ userId: "123", requestId: "abc" });
 * log.info("User action");
 * ```
 */
export function createContextLogger(
  context: Record<string, unknown>
): pino.Logger {
  return logger.child(context);
}

/**
 * 创建请求级别的 Logger
 *
 * @example
 * ```ts
 * const log = createRequestLogger(request);
 * log.info("Processing request");
 * ```
 */
export function createRequestLogger(request: Request): pino.Logger {
  const url = new URL(request.url);

  return logger.child({
    requestId: crypto.randomUUID(),
    method: request.method,
    path: url.pathname,
    userAgent: request.headers.get("user-agent")?.slice(0, 100),
  });
}

// ============================================
// 类型化日志辅助
// ============================================

/**
 * 业务事件类型
 */
export type BusinessEvent =
  | "user.signup"
  | "user.login"
  | "user.logout"
  | "payment.checkout.started"
  | "payment.checkout.completed"
  | "payment.subscription.created"
  | "payment.subscription.canceled"
  | "credits.purchased"
  | "credits.consumed"
  | "credits.expired"
  | "ticket.created"
  | "ticket.replied"
  | "ticket.closed"
  | "email.sent"
  | "file.uploaded"
  | "file.deleted"
  | "admin.user.banned"
  | "admin.user.unbanned"
  | "webhook.creem.unhandled"
  | "webhook.creem.subscription.past_due"
  | "webhook.creem.subscription.paused"
  | "webhook.creem.subscription.upserted"
  | "webhook.creem.credits.granted"
  | "webhook.creem.credits.already_granted"
  | "webhook.creem.credits.grant_success";

/**
 * 记录业务事件
 *
 * @example
 * ```ts
 * logEvent("user.signup", { userId: "123", provider: "github" });
 * logEvent("payment.checkout.completed", { userId: "123", amount: 9.99 });
 * ```
 */
export function logEvent(
  event: BusinessEvent,
  data?: Record<string, unknown>
): void {
  logger.info({ event, ...data }, `Event: ${event}`);
}

/**
 * 把任意 unknown 错误展平成可记录的结构。
 *
 * 关键：Drizzle / pg / next-safe-action 等链路上抛出的 Error 通常把
 * "真正的根因"塞在 `cause` 里（比如 Postgres 的 unique_violation / fk_violation），
 * `error.message` 只剩一句 "Failed query: insert into ..."。
 * 不展开 cause 的话日志里看不到 column / constraint / detail，调试时只能猜。
 */
function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const out: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    // 1. 原生 cause（Node 16.9+ Error 链）
    const cause = (err as { cause?: unknown }).cause;
    if (cause !== undefined) {
      out.cause =
        cause instanceof Error
          ? serializeError(cause)
          : (cause as Record<string, unknown>);
    }
    // 2. 一些驱动会塞在 details / code / severity 字段
    for (const key of [
      "code",
      "severity",
      "detail",
      "hint",
      "position",
      "internalPosition",
      "internalQuery",
      "where",
      "schema",
      "table",
      "column",
      "constraint",
      "file",
      "line",
      "routine",
      "query",
      "params",
    ] as const) {
      const value = (err as unknown as Record<string, unknown>)[key];
      if (value !== undefined && !(key in out)) {
        out[key] = value;
      }
    }
    return out;
  }
  if (typeof err === "object" && err !== null) {
    return { ...(err as Record<string, unknown>) };
  }
  return { value: err };
}

/**
 * 记录错误（带堆栈 + cause + 驱动细节）
 *
 * @example
 * ```ts
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   logError(error, { context: "payment processing" });
 * }
 * ```
 */
export function logError(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (error instanceof Error) {
    logger.error(
      {
        err: serializeError(error),
        ...context,
      },
      error.message
    );
  } else {
    logger.error({ err: serializeError(error), ...context }, "Unknown error");
  }
}

/**
 * 记录警告
 */
export function logWarn(message: string, data?: Record<string, unknown>): void {
  logger.warn(data, message);
}

/**
 * 记录调试信息（仅开发环境）
 */
export function logDebug(
  message: string,
  data?: Record<string, unknown>
): void {
  logger.debug(data, message);
}

// ============================================
// API 响应日志
// ============================================

/**
 * 记录 API 响应
 */
export function logApiResponse(
  request: Request,
  response: Response,
  duration: number
): void {
  const url = new URL(request.url);
  const level =
    response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info";

  logger[level](
    {
      method: request.method,
      path: url.pathname,
      status: response.status,
      duration,
    },
    `${request.method} ${url.pathname} ${response.status} ${duration}ms`
  );
}

// ============================================
// 导出类型
// ============================================

export type { Logger } from "pino";
