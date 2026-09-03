import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";

import { db } from "@/db";
import * as schema from "@/db/schema";
import {
  ResetPasswordEmail,
  VerifyEmailEmail,
} from "@/features/mail/templates/primary-action-email";
import { sendEmail } from "@/features/mail/utils";

export const isResendConfigured = Boolean(process.env.RESEND_API_KEY);

/**
 * Better Auth 服务端配置
 *
 * 此文件配置 Better Auth 的核心功能:
 * - 数据库适配器 (Drizzle + PostgreSQL)
 * - OAuth 提供商 (GitHub, Google)
 * - 会话配置
 * - 用户自定义字段
 */
export const auth = betterAuth({
  /**
   * 基础 URL 配置
   * 用于 OAuth 回调和邮件链接
   */
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",

  /**
   * 信任的来源
   * 允许从这些来源发起认证请求
   */
  trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"],

  /**
   * 数据库配置
   * 使用 Drizzle 适配器连接 PostgreSQL
   *
   * 启用 experimental.joins 后，Better Auth 会走
   * db.query.<model>.findFirst({ with: ... }) 路径，
   * 避免 fallback join（两次查询 + catch 后吞错日志）。
   * 前提是 schema 里给 auth 表配好 relations() —— 见 src/db/schema.ts。
   */
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  /**
   * 实验特性
   *
   * experimental.joins: true
   * - findSession 等带 join 的查询改用 Drizzle relational query（单 SQL）
   * - 替代 fallback join（双查询 + 静默吞错）
   * - 需要 schema.ts 中已为 user/session/account/verification 声明 relations()
   */
  experimental: {
    joins: true,
  },

  /**
   * 用户自定义字段配置
   * 将 role, banned, bannedReason, needsVerification, agentId 字段包含在会话用户中
   */
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false, // 用户不能通过注册/更新设置此字段
      },
      banned: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false, // 用户不能通过注册/更新设置此字段
      },
      bannedReason: {
        type: "string",
        required: false,
        input: false, // 用户不能通过注册/更新设置此字段
      },
      needsVerification: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false, // 仅管理员创建时设置
      },
      // 2026-09-03：代理商归属（ToB 业务自下单 / (agent) route group）。
      // - nullable：非代理商账号 agentId 为 null
      // - input: false：用户不能通过注册/更新自己改，只能 admin 后台或 SQL 写入
      // - 存于 user.agentId，FK → agent.id，ON DELETE SET NULL
      // 接入新 agent 业务时记得在 schema.ts 的 user 表加 agentId 列
      // （迁移见 drizzle/0006_agent_portal.sql）。
      agentId: {
        type: "string",
        required: false,
        input: false, // 仅 admin 后台或 SQL 写入
      },
    },
  },

  /**
   * 邮箱密码认证配置
   */
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: isResendConfigured,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your password - Mooncoda",
        react: ResetPasswordEmail({
          resetUrl: url,
          name: user.name || "there",
        }),
      });
    },
  },

  /**
   * 邮箱验证配置
   */
  ...(isResendConfigured
    ? {
        emailVerification: {
          sendOnSignUp: true,
          sendVerificationEmail: async ({ user, url }) => {
            await sendEmail({
              to: user.email,
              subject: "Verify your email - Mooncoda",
              react: VerifyEmailEmail({
                verifyUrl: url,
                name: user.name || "there",
              }),
            });
          },
        },
      }
    : {}),

  /**
   * 管理员插件
   *
   * 提供 admin 管理接口，允许管理员手动创建用户等操作
   * - defaultRole: 新用户默认角色 "user"
   * - adminRoles: 被视为管理员的角色
   */
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
  ],

  /**
   * OAuth 社交登录提供商配置
   * 目前仅支持邮箱密码登录，Google 登录已禁用
   */
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
  },

  /**
   * 会话配置
   */
  session: {
    // 会话过期时间: 7 天
    expiresIn: 60 * 60 * 24 * 7,
    // 刷新阈值: 1 天 (会话剩余不足 1 天时自动刷新)
    updateAge: 60 * 60 * 24,
    // 使用 Cookie 存储会话
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 分钟缓存
    },
  },
});

/**
 * 导出类型以供其他模块使用
 */
export type Auth = typeof auth;
