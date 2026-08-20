"use client";

import { App, Button, Divider, Input } from "antd";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { resendVerificationEmail, signInWithEmail } from "@/lib/auth/client";

import { AuthErrorAlert } from "./auth-error-alert";
import { AuthLogo } from "./auth-logo";

/** localStorage 键：上次成功登录的邮箱，下次自动填回输入框 */
const LAST_SIGNIN_EMAIL_KEY = "auth:last-signin-email";

/**
 * 登录表单组件
 *
 * 功能:
 * - 邮箱密码登录
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 1）
 * - Input / Button / Divider 切到 antd
 * - 密码字段用 antd Input.Password（自带眼睑切换，替代 shadcn 绝对定位的 eye 按钮）
 * - 成功提示用 antd App.useApp().message 替代 sonner
 */
export function SignInForm() {
  const t = useTranslations("Auth.signIn");
  const tCommon = useTranslations("Auth.common");
  const { message } = App.useApp();

  // 表单状态
  // 邮箱初始值从 localStorage 读上次成功登录的账号（仅客户端）。
  // 失败登录不写入——避免把输错的邮箱也记下来。
  const [email, setEmail] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(LAST_SIGNIN_EMAIL_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  /**
   * 重新发送验证邮件
   */
  const handleResendEmail = async () => {
    if (resendCooldown > 0 || !email) return;

    try {
      await resendVerificationEmail(email);
      setResendCooldown(60);
      const timer = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      // 静默失败
    }
  };

  /**
   * 处理邮箱密码登录
   */
  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      setError(t("errors.missingFields"));
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const result = await signInWithEmail(email, password);

      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          setError(t("errors.emailNotVerified"));
          setShowResend(true);
        } else {
          setError(t("errors.invalidCredentials"));
          setShowResend(false);
        }
        setIsLoading(false);
        return;
      }

      // 登录成功，记录本次邮箱到 localStorage（下次自动填回）
      try {
        window.localStorage.setItem(LAST_SIGNIN_EMAIL_KEY, email);
      } catch {
        // 隐私模式 / 配额满时静默忽略，不阻塞登录
      }
      message.success(t("success"));
      window.location.href = "/dashboard";
    } catch {
      setError(t("errors.invalidCredentials"));
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-6">
      {/* Logo 和标题 */}
      <div className="flex flex-col items-center space-y-2 text-center">
        <AuthLogo />
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* 错误提示 */}
      <AuthErrorAlert message={error} />

      {/* 重发验证邮件 */}
      {showResend && (
        <Button
          type="default"
          block
          onClick={handleResendEmail}
          disabled={resendCooldown > 0}
        >
          {resendCooldown > 0
            ? t("resendCooldown", { seconds: resendCooldown })
            : t("resendVerification")}
        </Button>
      )}

      {/* 分隔线 + 居中文案 */}
      <Divider plain className="!text-xs !uppercase">
        {tCommon("or")}
      </Divider>

      {/* 邮箱密码表单 */}
      <form onSubmit={handleEmailSignIn} className="space-y-4">
        {/* 邮箱输入 */}
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            {t("emailLabel")}
          </label>
          <Input
            id="email"
            type="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            autoComplete="email"
            size="large"
          />
        </div>

        {/* 密码输入 */}
        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            {t("passwordLabel")}
          </label>
          <Input.Password
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            autoComplete="current-password"
            size="large"
          />
        </div>

        {/* 忘记密码链接 */}
        <div className="text-left">
          <Link
            href="/forgot-password"
            className="text-sm text-muted-foreground underline hover:text-foreground transition-colors"
          >
            {t("forgotPassword")}
          </Link>
        </div>

        {/* 提交按钮 */}
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={isLoading}
          size="large"
        >
          {t("submit")}
        </Button>
      </form>
    </div>
  );
}
