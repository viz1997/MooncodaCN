"use client";

import { App, Button, Divider, Input } from "antd";
import { Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { GoogleIcon } from "@/features/shared/icons";
import {
  resendVerificationEmail,
  signInWithGoogle,
  signUpWithEmail,
} from "@/lib/auth/client";

import { AuthErrorAlert } from "./auth-error-alert";
import { AuthLogo } from "./auth-logo";

/**
 * 注册表单组件
 *
 * 功能:
 * - Google OAuth 注册
 * - 邮箱密码注册
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 1）
 * - Input / Button / Divider 切到 antd
 * - 成功提示用 antd App.useApp().message 替代 sonner
 * - 密码字段用 antd Input.Password（眼睑自动跟随主密码的 showPassword 状态）
 */
export function SignUpForm() {
  const t = useTranslations("Auth.signUp");
  const tCommon = useTranslations("Auth.common");
  const { message } = App.useApp();

  // 表单状态
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  /**
   * 启动重发冷却倒计时
   */
  const startCooldown = () => {
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
  };

  /**
   * 重新发送验证邮件
   */
  const handleResendEmail = async () => {
    if (resendCooldown > 0) return;

    try {
      await resendVerificationEmail(email);
      startCooldown();
    } catch {
      // 静默失败，不暴露用户是否存在
    }
  };

  /**
   * 处理 Google 注册
   */
  const handleGoogleSignUp = async () => {
    try {
      setIsLoading(true);
      setError(null);
      await signInWithGoogle();
    } catch {
      setError(t("errors.google"));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 处理邮箱密码注册
   */
  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name || !email || !password) {
      setError(t("errors.missingFields"));
      return;
    }

    if (password.length < 8) {
      setError(t("errors.passwordTooShort"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("errors.passwordMismatch"));
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const result = await signUpWithEmail(email, password, name);

      if (result.error) {
        setError(t("errors.emailInUse"));
        setIsLoading(false);
        return;
      }

      // 注册成功，显示验证邮件提示
      if (result.data?.token) {
        message.success(tCommon("success"));
        window.location.href = "/dashboard";
        return;
      }

      setEmailSent(true);
      startCooldown();
    } catch {
      setError(t("errors.emailInUse"));
      setIsLoading(false);
    }
  };

  // 邮箱验证提示
  if (emailSent) {
    return (
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/15 text-success">
            <Mail className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("verifyEmail.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("verifyEmail.description", { email })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("verifyEmail.hint")}
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <Button
            type="default"
            block
            onClick={handleResendEmail}
            disabled={resendCooldown > 0}
            size="large"
          >
            {resendCooldown > 0
              ? t("verifyEmail.resendCooldown", { seconds: resendCooldown })
              : t("verifyEmail.resend")}
          </Button>
          <Link
            href="/sign-in"
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            {t("verifyEmail.backToSignIn")}
          </Link>
        </div>
      </div>
    );
  }

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

      {/* OAuth 登录按钮 */}
      <Button
        type="default"
        block
        onClick={handleGoogleSignUp}
        disabled={isLoading}
        size="large"
        icon={<GoogleIcon className="h-4 w-4" />}
      >
        {tCommon("google")}
      </Button>

      {/* 分隔线 + 居中文案 */}
      <Divider plain className="!text-xs !uppercase">
        {tCommon("or")}
      </Divider>

      {/* 邮箱密码表单 */}
      <form onSubmit={handleEmailSignUp} className="space-y-4">
        {/* 姓名输入 */}
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            {t("nameLabel")}
          </label>
          <Input
            id="name"
            type="text"
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isLoading}
            autoComplete="name"
            size="large"
          />
        </div>

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
            placeholder={t("passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            autoComplete="new-password"
            size="large"
            visibilityToggle={{
              visible: showPassword,
              onVisibleChange: setShowPassword,
            }}
          />
        </div>

        {/* 确认密码输入（跟随 showPassword） */}
        <div className="space-y-2">
          <label htmlFor="confirmPassword" className="text-sm font-medium">
            {t("confirmPasswordLabel")}
          </label>
          <Input.Password
            id="confirmPassword"
            placeholder={t("confirmPasswordPlaceholder")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={isLoading}
            autoComplete="new-password"
            size="large"
            visibilityToggle={{
              visible: showPassword,
              onVisibleChange: setShowPassword,
            }}
          />
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

      {/* 登录链接 */}
      <p className="text-center text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link
          href="/sign-in"
          className="font-medium text-foreground hover:underline"
        >
          {t("signInLink")}
        </Link>
      </p>
    </div>
  );
}
