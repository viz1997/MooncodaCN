"use client";

import { App, Button, Divider, Input } from "antd";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { resendVerificationEmail, signInWithEmail } from "@/lib/auth/client";

import { AuthErrorAlert } from "./auth-error-alert";
import { SignInTabs } from "./sign-in-tabs";

/** localStorage 键：上次成功登录的邮箱，下次自动填回输入框 */
const LAST_SIGNIN_EMAIL_KEY = "auth:last-signin-email";

/**
 * 从 window.location 读 callbackUrl 并做白名单校验（防止 open redirect）：
 * - 必须以 / 开头（相对路径）
 * - 不允许 // 开头（协议相对 → 外站）
 * - 不允许 /\ 开头（部分浏览器会 normalize 成 //）
 * - 不允许带语言前缀的 callbackUrl 重复前缀（/zh/zh/...）—— 后续在硬跳转
 *   前补语言前缀时需要先剥掉
 */
function resolvePostSignInUrl(): string {
  if (typeof window === "undefined") return "/dashboard";
  const raw = new URLSearchParams(window.location.search).get("callbackUrl");
  if (!raw) return "/dashboard";
  const isSafe =
    raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\");
  if (!isSafe) return "/dashboard";
  // 与 src/proxy.ts:147-161 同样的处理：callbackUrl 已带 /zh|/en 直接用，
  // 否则补上当前语言前缀（避免跳到无前缀路由被 intlMiddleware 二次重定向）
  const localeMatch = window.location.pathname.match(/^\/(en|zh)/);
  const locale = localeMatch ? localeMatch[1] : "";
  const hasLocalePrefix = /^\/(en|zh)(\/|$)/.test(raw);
  if (hasLocalePrefix) return raw;
  return locale ? `/${locale}${raw.startsWith("/") ? "" : "/"}${raw}` : raw;
}

/**
 * 邮箱密码登录（2026-09-16：拆出来单独组件，挂到 SignInTabs 的 email slot）
 *
 * 历史：原 SignInForm 把 OAuth + 邮箱 + 登录成功跳转都写在一起，
 * 现在新增手机号 tab 后需要把 logo + 标题 + error 三件套提到 SignInTabs 层，
 * 这里只保留邮箱 + 密码 + 忘记密码 + 提交。
 */
function EmailSignInForm() {
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
      window.location.href = resolvePostSignInUrl();
    } catch {
      setError(t("errors.invalidCredentials"));
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
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

/**
 * 登录表单（顶层入口）
 *
 * 2026-09-16：拆为 Tabs 结构，外层是 SignInTabs（标题 + Tab 切换），
 * email tab 复用拆出的 EmailSignInForm；phone tab 是新的 PhoneSignInForm。
 */
export function SignInForm() {
  return <SignInTabs emailForm={<EmailSignInForm />} />;
}
