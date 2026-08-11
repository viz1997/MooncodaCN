"use server";

import { eq, ilike, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { db } from "@/db";
import { creditsBalance, subscription, user } from "@/db/schema";
import { CREDITS_EXPIRY_DAYS } from "@/features/credits/config";
import { grantCredits } from "@/features/credits/core";
import { auth, isResendConfigured } from "@/lib/auth/index";
import { adminAction } from "@/lib/safe-action";

const withAdminUsersAction = (name: string) =>
  adminAction.metadata({ action: `support.adminUsers.${name}` });

/**
 * 手动创建用户 Schema
 */
const createUserSchema = z.object({
  name: z.string().min(1, "请输入用户名").max(50, "用户名最多50字符"),
  email: z.string().email("请输入有效的邮箱地址").max(255, "邮箱过长"),
  password: z
    .string()
    .min(8, "密码至少8位")
    .max(100, "密码最多100字符")
    .optional(),
  role: z.enum(["user", "admin"]).default("user"),
  needsVerification: z.boolean().default(false),
});

/**
 * 编辑用户 Schema
 *
 * password 字段为空字符串/null/undefined 表示不修改密码；
 * 非空则重置为目标用户的登录密码（>=8 位）。
 */
const updateUserSchema = z.object({
  userId: z.string().min(1, "用户ID不能为空"),
  name: z.string().min(1, "请输入用户名").max(50, "用户名最多50字符"),
  email: z.string().email("请输入有效的邮箱地址").max(255, "邮箱过长"),
  image: z
    .string()
    .max(500, "头像URL过长")
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  emailVerified: z.boolean(),
  needsVerification: z.boolean(),
  role: z.enum(["user", "admin"]),
  password: z
    .string()
    .max(100, "密码最多100字符")
    .optional()
    .transform((v) => (v && v.trim().length >= 8 ? v.trim() : undefined)),
});

/**
 * 创建用户 Action schema 导出 (供客户端使用)
 */
export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * 更新用户角色 Schema
 */
const updateUserRoleSchema = z.object({
  userId: z.string().min(1, "用户ID不能为空"),
  role: z.enum(["user", "admin"]),
});

/**
 * 封禁/解封用户 Schema
 */
const banUserSchema = z.object({
  userId: z.string().min(1, "用户ID不能为空"),
  banned: z.boolean(),
  reason: z.string().optional(),
});

/**
 * 手动充值积分 Schema
 */
const grantCreditsSchema = z.object({
  userId: z.string().min(1, "用户ID不能为空"),
  amount: z
    .number()
    .min(1, "积分数量必须大于0")
    .max(100000, "单次最多充值10万积分"),
  reason: z.string().min(1, "请填写充值原因").max(200, "原因最多200字符"),
});

/**
 * 搜索用户 Schema
 */
const searchUsersSchema = z.object({
  query: z.string().optional(),
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
});

/**
 * 获取所有用户列表 (管理员) - 增强版
 *
 * 包含积分余额和订阅状态
 */
export const getAllUsersAction = withAdminUsersAction("getAllUsers")
  .schema(searchUsersSchema.optional())
  .action(async ({ parsedInput }) => {
    const query = parsedInput?.query;

    // 构建用户选择字段
    const userSelectFields = {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      banned: user.banned,
      bannedReason: user.bannedReason,
      emailVerified: user.emailVerified,
      needsVerification: user.needsVerification,
      createdAt: user.createdAt,
    };

    // 根据是否有搜索条件构建查询
    const users = query?.trim()
      ? await db
          .select(userSelectFields)
          .from(user)
          .where(
            or(
              ilike(user.email, `%${query.trim()}%`),
              ilike(user.name, `%${query.trim()}%`)
            )
          )
          .orderBy(user.createdAt)
      : await db.select(userSelectFields).from(user).orderBy(user.createdAt);

    // 获取所有用户的积分余额
    const balances = await db
      .select({
        userId: creditsBalance.userId,
        balance: creditsBalance.balance,
        totalEarned: creditsBalance.totalEarned,
        totalSpent: creditsBalance.totalSpent,
        status: creditsBalance.status,
      })
      .from(creditsBalance);

    // 获取所有用户的订阅状态
    const subscriptions = await db
      .select({
        userId: subscription.userId,
        status: subscription.status,
        priceId: subscription.priceId,
        currentPeriodEnd: subscription.currentPeriodEnd,
      })
      .from(subscription);

    // 创建映射
    const balanceMap = new Map(balances.map((b) => [b.userId, b]));
    const subscriptionMap = new Map(subscriptions.map((s) => [s.userId, s]));

    // 合并数据
    const usersWithDetails = users.map((u) => ({
      ...u,
      credits: balanceMap.get(u.id) || null,
      subscription: subscriptionMap.get(u.id) || null,
    }));

    return { users: usersWithDetails };
  });

/**
 * 更新用户角色 (管理员)
 */
export const updateUserRoleAction = withAdminUsersAction("updateUserRole")
  .schema(updateUserRoleSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    // 防止管理员更改自己的角色
    if (data.userId === ctx.userId) {
      throw new Error("不能更改自己的角色");
    }

    // 验证用户存在
    const userResult = await db
      .select()
      .from(user)
      .where(eq(user.id, data.userId))
      .limit(1);

    if (userResult.length === 0) {
      throw new Error("用户不存在");
    }

    // 更新角色
    await db
      .update(user)
      .set({ role: data.role, updatedAt: new Date() })
      .where(eq(user.id, data.userId));

    // 刷新缓存
    revalidatePath("/admin/users");

    return {
      message: `用户角色已更新为 ${data.role === "admin" ? "管理员" : "普通用户"}`,
    };
  });

/**
 * 封禁/解封用户 (管理员)
 */
export const banUserAction = withAdminUsersAction("banUser")
  .schema(banUserSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    // 防止管理员封禁自己
    if (data.userId === ctx.userId) {
      throw new Error("不能封禁自己");
    }

    // 验证用户存在
    const userResult = await db
      .select()
      .from(user)
      .where(eq(user.id, data.userId))
      .limit(1);

    if (userResult.length === 0) {
      throw new Error("用户不存在");
    }

    // 获取目标用户 (经过上面检查，此处一定存在)
    const targetUser = userResult[0]!;

    // 不能封禁其他管理员
    if (targetUser.role === "admin" && data.banned) {
      throw new Error("不能封禁管理员账户");
    }

    // 更新封禁状态
    await db
      .update(user)
      .set({
        banned: data.banned,
        bannedReason: data.banned ? data.reason || null : null,
        updatedAt: new Date(),
      })
      .where(eq(user.id, data.userId));

    // 刷新缓存
    revalidatePath("/admin/users");

    return {
      message: data.banned ? "用户已被封禁" : "用户已解除封禁",
    };
  });

/**
 * 手动充值积分 (管理员)
 */
export const adminGrantCreditsAction = withAdminUsersAction("grantCredits")
  .schema(grantCreditsSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    // 验证用户存在
    const userResult = await db
      .select()
      .from(user)
      .where(eq(user.id, data.userId))
      .limit(1);

    if (userResult.length === 0) {
      throw new Error("用户不存在");
    }

    // 计算过期时间
    const expiresAt = CREDITS_EXPIRY_DAYS
      ? new Date(Date.now() + CREDITS_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
      : null;

    // 调用积分系统发放积分
    const result = await grantCredits({
      userId: data.userId,
      amount: data.amount,
      sourceType: "bonus",
      debitAccount: `ADMIN:${ctx.userId}`,
      transactionType: "admin_grant",
      expiresAt,
      sourceRef: `admin_grant_${Date.now()}`,
      description: `管理员充值: ${data.reason}`,
      metadata: {
        grantType: "admin_manual",
        adminId: ctx.userId,
        reason: data.reason,
      },
    });

    // 刷新缓存
    revalidatePath("/admin/users");

    return {
      message: `成功为用户充值 ${data.amount} 积分`,
      newBalance: result.newBalance,
    };
  });

/**
 * 获取单个用户详情 (管理员)
 */
export const getUserDetailAction = withAdminUsersAction("getUserDetail")
  .schema(z.object({ userId: z.string().min(1) }))
  .action(async ({ parsedInput: { userId } }) => {
    // 获取用户基本信息
    const userResult = await db
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (userResult.length === 0) {
      throw new Error("用户不存在");
    }

    // 获取积分余额
    const balanceResult = await db
      .select()
      .from(creditsBalance)
      .where(eq(creditsBalance.userId, userId))
      .limit(1);

    // 获取订阅状态
    const subscriptionResult = await db
      .select()
      .from(subscription)
      .where(eq(subscription.userId, userId))
      .limit(1);

    return {
      user: userResult[0],
      credits: balanceResult[0] || null,
      subscription: subscriptionResult[0] || null,
    };
  });

/**
 * 手动创建用户 (管理员)
 *
 * 通过 Better Auth admin 插件在服务器端调用 auth.api.createUser
 * 支持设置初始密码（否则仅创建无凭据账户）、指定角色
 */
export const createUserAction = withAdminUsersAction("createUser")
  .schema(createUserSchema)
  .action(async ({ parsedInput: data }) => {
    try {
      // 没有密码的账户必须需要邮箱验证
      const needsVerification = !data.password || data.needsVerification;

      const result = await auth.api.createUser({
        headers: await headers(),
        body: {
          name: data.name.trim(),
          email: data.email.trim(),
          password: data.password || undefined,
          role: data.role,
          data: {
            needsVerification,
            emailVerified: !needsVerification,
          },
        },
      });

      // 如果需要验证，发送验证邮件
      if (needsVerification && isResendConfigured) {
        await auth.api.sendVerificationEmail({
          headers: await headers(),
          body: { email: data.email.trim() },
        });
      }

      // 刷新缓存
      revalidatePath("/admin/users");

      return {
        message: needsVerification
          ? `成功创建用户 ${result.user.name}（需要邮箱验证）`
          : `成功创建用户 ${result.user.name}`,
        user: result.user,
      };
    } catch (error) {
      // Better Auth 会以 APIError 抛出错误，其中已包含人类可读的中文错误信息
      const message = error instanceof Error ? error.message : "创建用户失败";
      // 用户已存在是常见场景，给出明确提示
      if (/already exists/i.test(message)) {
        throw new Error("该邮箱已被注册，请更换邮箱");
      }
      throw new Error(message);
    }
  });

/**
 * 编辑用户 (管理员)
 *
 * 通过 Better Auth admin 插件在服务器端调用 auth.api.adminUpdateUser，
 * 可同时修改 name / email / image / emailVerified / needsVerification / role，
 * 并可选调用 auth.api.setUserPassword 重置密码。
 *
 * 不能编辑自己（避免误把自己降级或封禁）；邮箱冲突按 Better Auth 错误提示
 * 直接抛出友好消息。
 */
export const updateUserAction = withAdminUsersAction("updateUser")
  .schema(updateUserSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    // 防止管理员改自己（角色、邮箱、密码等都改会导致登录态/权限混乱）
    if (data.userId === ctx.userId) {
      throw new Error("不能编辑自己的账户，请使用个人设置");
    }

    // 验证用户存在（同时拿到旧 email 用于判断"邮箱未变"分支）
    const existing = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(eq(user.id, data.userId))
      .limit(1);

    if (existing.length === 0) {
      throw new Error("用户不存在");
    }

    const emailChanged =
      existing[0]!.email.toLowerCase() !== data.email.toLowerCase();

    try {
      // 1) 更新基础信息 + 自定义字段（role/emailVerified/needsVerification）
      const updated = await auth.api.adminUpdateUser({
        headers: await headers(),
        body: {
          userId: data.userId,
          data: {
            name: data.name.trim(),
            email: data.email.trim(),
            image: data.image,
            emailVerified: data.emailVerified,
            needsVerification: data.needsVerification,
            role: data.role,
          },
        },
      });

      // 2) 如果提供了新密码，调用 Better Auth 重置
      if (data.password) {
        await auth.api.setUserPassword({
          headers: await headers(),
          body: {
            userId: data.userId,
            newPassword: data.password,
          },
        });
      }

      // 3) 邮箱变化且未验证，重新发送验证邮件
      if (
        emailChanged &&
        !data.emailVerified &&
        data.needsVerification &&
        isResendConfigured
      ) {
        await auth.api.sendVerificationEmail({
          headers: await headers(),
          body: { email: data.email.trim() },
        });
      }

      revalidatePath("/admin/users");

      const parts: string[] = [`已更新用户 ${updated.name}`];
      if (data.password) parts.push("已重置密码");
      if (emailChanged) parts.push("邮箱已变更");

      return {
        message: `${parts.join("，")}（${updated.email}）`,
        user: updated,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新用户失败";
      if (/already exists|already.*user/i.test(message)) {
        throw new Error("该邮箱已被其他账户使用");
      }
      throw new Error(message);
    }
  });
