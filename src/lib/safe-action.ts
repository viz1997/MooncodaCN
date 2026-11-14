import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSafeActionClient } from "next-safe-action";
import { z } from "zod";

import { auth } from "@/lib/auth/index";
import { logError, logger } from "@/lib/logger";
import { captureError } from "@/lib/monitoring";

const actionMetadataSchema = z
  .object({
    action: z.string().min(1),
  })
  .optional();

/**
 * 「这条错是给用户看的」—— 由**抛出方**自己标（`userFacing: true`）。
 *
 * ⚠️ 刻意**不**用 `instanceof`：核心层（`safe-action.ts`）不该 import 某个
 * feature 的错误类 ⇒ 靠一个约定俗成的标记属性认。
 *
 * 现在只有一处用它：目录字典的规格校验错
 * （`features/image-gen/lib/catalog-dictionary-validate.ts`）——
 * 「选了一个不存在的尺寸」是**用户填错了**，不是服务端炸了。
 *
 * ⚠️ **刻意不写成类型谓词**（`error is Error`）—— `handleServerError` 的
 * 入参类型本来就是 `Error`，谓词会把后面那段代码的 `error` 收窄成 `never`
 * ⇒ `error.message` 直接编译不过。返回「消息或 null」就够用了。
 */
function userFacingMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { userFacing?: unknown; message?: unknown };
  if (candidate.userFacing !== true) return null;
  return typeof candidate.message === "string" ? candidate.message : null;
}

/**
 * 基础 Action 客户端
 *
 * 用于创建不需要认证的 Server Actions
 * 自动集成日志和错误监控（开箱即用）
 */
const baseActionClient = createSafeActionClient({
  defineMetadataSchema: () => actionMetadataSchema,
  /**
   * 处理服务器错误
   * - 自动记录结构化日志
   * - 自动上报 Sentry（如已配置）
   * - 生产环境下隐藏具体错误信息
   */
  handleServerError(error) {
    // ⚠️ 标了「这条错是给用户看的」⇒ **生产环境也把原话带回去**，
    // 而且**不上报 Sentry**（那是用户的输入问题，不是故障）。
    // 没标的一律照旧糊掉 —— 免得把内部报错（表结构 / SQL）漏给用户。
    const userMessage = userFacingMessage(error);
    if (userMessage !== null) {
      logger.warn(
        { source: "server-action", message: userMessage },
        "User-facing server error"
      );
      return userMessage;
    }

    // 结构化日志记录
    logError(error, { source: "server-action" });

    // Sentry 上报（未配置时自动跳过）
    captureError(error, { source: "server-action" });

    // 生产环境返回通用错误信息
    if (process.env.NODE_ENV === "production") {
      return "服务器错误，请稍后重试";
    }

    return error.message;
  },
});

export const actionClient = baseActionClient.use(
  async ({ metadata, ctx, next }) => {
    const startTime = Date.now();
    const result = await next();
    const duration = Date.now() - startTime;
    const userId = (ctx as { userId?: string }).userId;
    const error =
      !result.success && "serverError" in result
        ? (result as { serverError?: unknown }).serverError
        : undefined;

    logger.info(
      {
        action: metadata?.action ?? "server-action",
        success: result.success,
        duration,
        ...(userId ? { userId } : {}),
        ...(error ? { error } : {}),
      },
      "Server action"
    );

    return result;
  }
);

/**
 * 受保护的 Action 客户端
 *
 * 用于创建需要用户认证的 Server Actions
 * 通过中间件验证用户会话，并将用户信息传递给 action
 */
export const protectedAction = actionClient.use(async ({ next }) => {
  /**
   * 获取当前用户会话
   * 使用 Better Auth 的 getSession 方法
   */
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  // 如果没有会话或用户信息，重定向到登录页
  if (!session || !session.user) {
    redirect("/sign-in");
  }

  // 设置用户上下文到日志
  logger.debug({ userId: session.user.id }, "Authenticated action executed");

  /**
   * 将用户信息传递给下游 action
   * ctx 对象可以在 action 中通过 ctx 参数访问
   */
  return next({
    ctx: {
      userId: session.user.id,
      user: session.user,
    },
  });
});

/**
 * 管理员 Action 客户端
 *
 * 用于创建需要管理员权限的 Server Actions
 * 在 protectedAction 基础上增加角色验证
 */
export const adminAction = protectedAction.use(async ({ next, ctx }) => {
  // 检查用户是否为管理员
  // 类型断言: role 字段在 Better Auth additionalFields 中定义
  const userWithRole = ctx.user as { role?: string };
  if (userWithRole.role !== "admin") {
    throw new Error("此操作需要管理员权限");
  }

  return next({
    ctx: {
      ...ctx,
      isAdmin: true,
    },
  });
});

/**
 * 2026-09-08：代理商 Action 客户端已删 —— (agent) route group 完全移除后没有 caller。
 * 如未来要恢复 ToB 业务，重新定义 agentAction 时记得在 schema.ts 的 user.agentId
 * 字段同时启用，并把 (agent) route group + checkAgent middleware 加回 proxy.ts。
 */
