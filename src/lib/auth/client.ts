"use client";

import { phoneNumberClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Better Auth 客户端配置
 *
 * 此客户端用于在 React 组件中进行认证操作:
 * - 社交登录 (GitHub, Google)
 * - 邮箱密码登录
 * - 手机号 + 密码登录（2026-09-16）—— phoneNumberClient 暴露 authClient.phoneNumber.* + authClient.signIn.phoneNumber
 * - 会话管理
 * - 登出
 */
export const authClient = createAuthClient({
  /**
   * 认证 API 基础 URL
   * 默认指向 /api/auth，与 API 路由匹配
   */
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  plugins: [phoneNumberClient()],
});

/**
 * 导出常用的认证方法，便于在组件中使用
 */
export const {
  // 会话相关
  useSession, // Hook: 获取当前会话状态
  getSession, // 函数: 获取会话 (非 Hook)

  // 登录方法
  signIn, // 登录 (邮箱密码或社交)

  // 登出方法
  signOut, // 登出当前会话

  // 注册方法
  signUp, // 注册新用户 (邮箱密码)
} = authClient;

/**
 * 发送密码重置邮件
 * 通过调用 Better Auth API 端点发送重置链接
 * @param email - 用户邮箱
 * @param redirectTo - 重置链接的跳转地址
 */
export async function forgetPassword(
  email: string,
  redirectTo = "/reset-password"
) {
  const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const response = await fetch(`${baseURL}/api/auth/forget-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      redirectTo,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to send reset email");
  }

  return response.json();
}

/**
 * 重置密码
 * @param newPassword - 新密码
 * @param token - 重置令牌 (从 URL 获取)
 */
export async function resetPassword(newPassword: string, token: string) {
  const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const response = await fetch(`${baseURL}/api/auth/reset-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      newPassword,
      token,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to reset password");
  }

  return response.json();
}

/**
 * 社交登录辅助函数
 */

/**
 * 使用 GitHub 登录
 * @param callbackURL - 登录成功后的跳转地址
 */
export async function signInWithGitHub(callbackURL = "/dashboard") {
  return signIn.social({
    provider: "github",
    callbackURL,
  });
}

/**
 * 使用 Google 登录
 * @param callbackURL - 登录成功后的跳转地址
 */
export async function signInWithGoogle(callbackURL = "/dashboard") {
  return signIn.social({
    provider: "google",
    callbackURL,
  });
}

/**
 * 邮箱密码登录
 * @param email - 用户邮箱
 * @param password - 用户密码
 * @param callbackURL - 登录成功后的跳转地址
 */
export async function signInWithEmail(
  email: string,
  password: string,
  callbackURL = "/dashboard"
) {
  return signIn.email({
    email,
    password,
    callbackURL,
  });
}

/**
 * 邮箱密码注册
 * @param email - 用户邮箱
 * @param password - 用户密码
 * @param name - 用户名称
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  name: string
) {
  return signUp.email({
    email,
    password,
    name,
  });
}

/**
 * 修改密码（已登录用户）
 * @param currentPassword - 当前密码
 * @param newPassword - 新密码
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string
) {
  const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const response = await fetch(`${baseURL}/api/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      currentPassword,
      newPassword,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message || "Failed to change password");
  }

  return data;
}

/**
 * 重新发送邮箱验证邮件
 * @param email - 用户邮箱
 */
export async function resendVerificationEmail(email: string) {
  const baseURL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const response = await fetch(`${baseURL}/api/auth/send-verification-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    throw new Error("Failed to send verification email");
  }

  return response.json();
}

/**
 * 刷新会话
 * 用于在会话数据更新后强制刷新客户端状态
 */
export async function reloadSession() {
  return getSession();
}

// ───────────────────────────────────────────────────────────────────────────
// 手机号登录 helpers（2026-09-16）
// 镜像 signInWithEmail 模式 + 服务端 phoneNumber 插件端点
// ───────────────────────────────────────────────────────────────────────────

/**
 * 手机号 + 密码登录。
 *
 * 边界：
 *   - 用户已 verify 后才能用密码登录（plugin.requireVerification: true）
 *   - 若返回 PHONE_NUMBER_NOT_VERIFIED → 前端应自动转 OTP 流程
 *   - 若返回 PHONE_NUMBER_NOT_EXIST → 用户首次注册要走 OTP（不是这个端点）
 *   - 登录成功后浏览器跳转到 caller 提供的 callbackURL（不在 BA 端点 body）
 */
export async function signInWithPhone(phoneNumber: string, password: string) {
  return signIn.phoneNumber({
    phoneNumber,
    password,
  });
}

/**
 * 发送手机号 OTP（登录 / 重置密码前调）。
 * 不区分场景 —— 服务端根据请求来源决定用途。
 */
export async function sendPhoneOtp(phoneNumber: string) {
  return authClient.phoneNumber.sendOtp({ phoneNumber });
}

/**
 * 验证 OTP：
 *   - disableSession: false（默认）→ 验证成功即建立 session
 *   - signUpOnVerification 自动创建新用户（首次注册）
 *   - updatePhoneNumber: true（已登录用户改绑手机号）需要单独传
 */
export async function verifyPhoneOtp(
  phoneNumber: string,
  code: string,
  options?: { updatePhoneNumber?: boolean; disableSession?: boolean }
) {
  return authClient.phoneNumber.verify({
    phoneNumber,
    code,
    ...(options?.updatePhoneNumber ? { updatePhoneNumber: true } : {}),
    ...(options?.disableSession !== undefined
      ? { disableSession: options.disableSession }
      : {}),
  });
}

/**
 * 请求密码重置 OTP（手机号用户忘了密码时走这条）。
 * 不需要当前密码 —— 服务端发 OTP 到该手机号。
 */
export async function requestPhonePasswordReset(phoneNumber: string) {
  return authClient.phoneNumber.requestPasswordReset({ phoneNumber });
}

/**
 * 用 OTP 重置密码（手机号路径）。
 * 成功后用户即可用新密码走 signInWithPhone。
 */
export async function resetPhonePassword(
  phoneNumber: string,
  otp: string,
  newPassword: string
) {
  return authClient.phoneNumber.resetPassword({
    phoneNumber,
    otp,
    newPassword,
  });
}
