"use client";

import { App, Button, Input } from "antd";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  resetPhonePassword,
  sendPhoneOtp,
  signInWithPhone,
  verifyPhoneOtp,
} from "@/lib/auth/client";
import { AuthErrorAlert } from "./auth-error-alert";
import { PhoneInputRow } from "./phone-input-row";
import { PhoneOtpInput } from "./phone-otp-input";

/**
 * 三步状态机：
 *   - "password"      默认。先尝试 signInWithPhone（密码路径）。
 *                       命中 PHONE_NUMBER_NOT_VERIFIED / PHONE_NUMBER_NOT_EXIST → 切 otp-sent。
 *                       命中 USER_NOT_FOUND → 切 otp-sent 并提示「该手机号未注册，将自动创建账号」。
 *   - "otp-sent"      OTP 已发送，显示 6 位输入框 + 倒计时。
 *                       verify → 自动 createUser + 建 session → 跳 /dashboard。
 *                       失败超过上限 → 切回 password 提示用密码。
 *   - "reset-password" for 忘记密码链路（from settings）。与 sign-in 路径共用
 *                       PhoneInputRow + PhoneOtpInput，但 verify 完调 resetPassword。
 *
 * 入口：<PhoneSignInForm mode="signin" /> | <PhoneSignInForm mode="reset" />
 *
 * 边界：
 *   - plugin.requireVerification: true → 新用户走 OTP，account.password 是 null
 *   - plugin 自带 60s/3 次 rate limit → 超限 BA 端点会返回 PHONE_RATE_LIMIT
 *   - 错误码翻译放在 Auth.signIn.phone.errors.*
 */
type Mode = "signin" | "reset";

export function PhoneSignInForm({ mode = "signin" }: { mode?: Mode }) {
  const t = useTranslations("Auth.signIn");
  const tPhone = useTranslations("Auth.signIn.phone");
  const { message } = App.useApp();

  const [phoneE164, setPhoneE164] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"password" | "otp-sent">("password");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  /**
   * 启动 60s 重发倒计时。
   * 用 setInterval 而非 useRef —— 卸载时 setState 会被 React 屏蔽，无需手动 clear。
   */
  const startResendCooldown = () => {
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
   * 发送 OTP（首次 + 重发共用）。
   * reset 模式也走同一个端点 —— 服务端 phoneNumber plugin 用同一个 sendOTP，
   * 区别只在 verify 后的动作。
   */
  const handleSendOtp = async () => {
    if (!phoneE164) {
      setError(tPhone("errors.phoneRequired"));
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      const res = await sendPhoneOtp(phoneE164);
      if (res.error) {
        setError(mapPhoneError(res.error.code, res.error.message));
        setIsLoading(false);
        return;
      }
      message.success(tPhone("otpSent"));
      setStep("otp-sent");
      startResendCooldown();
    } catch {
      setError(tPhone("errors.sendOtpFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 密码登录主流程（signin 模式专属）。
   * 失败码：
   *   PHONE_NUMBER_NOT_EXIST → 切 otp-sent（首次注册走 OTP）
   *   PHONE_NUMBER_NOT_VERIFIED → 切 otp-sent（OTP 路径会激活账号）
   *   INVALID_PHONE_NUMBER_OR_PASSWORD → 留在 password step
   *   TOO_MANY_ATTEMPTS → 提示稍后重试
   */
  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneE164 || !password) {
      setError(t("errors.missingFields"));
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      const res = await signInWithPhone(phoneE164, password);
      if (res.error) {
        const code = res.error.code;
        if (
          code === "PHONE_NUMBER_NOT_EXIST" ||
          code === "PHONE_NUMBER_NOT_VERIFIED"
        ) {
          // 切到 OTP 流程（首次注册或未验证）
          setError(null);
          await handleSendOtp();
          return;
        }
        setError(mapPhoneError(code, res.error.message));
        setIsLoading(false);
        return;
      }
      // 登录成功 → 跳 dashboard
      message.success(t("success"));
      window.location.href = "/dashboard";
    } catch {
      setError(t("errors.invalidCredentials"));
      setIsLoading(false);
    }
  };

  /**
   * 验证 OTP：
   *   - signin 模式 → verifyPhoneOtp → 自动建账号 + 建 session → 跳 /dashboard
   *   - reset 模式 → resetPhonePassword → 提示「密码已重置，请登录」+ 切回 password step
   */
  const handleVerify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (otp.length !== 6) {
      setError(tPhone("errors.invalidOtp"));
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      if (mode === "reset") {
        // reset 模式还要先让用户输入新密码，这里假设调用方传 password
        if (!password || password.length < 8) {
          setError(tPhone("errors.passwordRequired"));
          setIsLoading(false);
          return;
        }
        const res = await resetPhonePassword(phoneE164, otp, password);
        if (res.error) {
          setError(mapPhoneError(res.error.code, res.error.message));
          setIsLoading(false);
          return;
        }
        message.success(tPhone("resetSuccess"));
        // 切回 password step 让用户用新密码登录
        setStep("password");
        setPassword("");
        setOtp("");
        return;
      }
      const res = await verifyPhoneOtp(phoneE164, otp);
      if (res.error) {
        setError(mapPhoneError(res.error.code, res.error.message));
        setIsLoading(false);
        return;
      }
      message.success(t("success"));
      window.location.href = "/dashboard";
    } catch {
      setError(tPhone("errors.verifyFailed"));
      setIsLoading(false);
    }
  };

  /**
   * 错误码 → i18n key 翻译
   */
  const mapPhoneError = (code: string | undefined, fallback?: string) => {
    switch (code) {
      case "PHONE_NUMBER_NOT_EXIST":
        return tPhone("errors.phoneNotExist");
      case "PHONE_NUMBER_NOT_VERIFIED":
        return tPhone("errors.phoneNotVerified");
      case "INVALID_PHONE_NUMBER_OR_PASSWORD":
      case "INVALID_OTP":
        return tPhone("errors.invalidOtp");
      case "OTP_EXPIRED":
        return tPhone("errors.otpExpired");
      case "TOO_MANY_ATTEMPTS":
        return tPhone("errors.tooManyAttempts");
      case "PHONE_NUMBER_EXIST":
        return tPhone("errors.phoneExist");
      default:
        return fallback || tPhone("errors.generic");
    }
  };

  return (
    <div className="space-y-4">
      <AuthErrorAlert message={error} />

      <div className="space-y-2">
        <label htmlFor="phone" className="text-sm font-medium">
          {tPhone("phoneLabel")}
        </label>
        <PhoneInputRow
          phoneE164={phoneE164}
          setPhoneE164={setPhoneE164}
          disabled={isLoading}
          autoFocus
          placeholder={tPhone("phonePlaceholder")}
        />
      </div>

      {step === "password" && (
        <form onSubmit={handlePasswordSignIn} className="space-y-4">
          {mode === "reset" ? (
            // reset 模式：OTP 后要设新密码 —— 在 password step 就先展示
            <div className="space-y-2">
              <label htmlFor="newPassword" className="text-sm font-medium">
                {tPhone("newPasswordLabel")}
              </label>
              <Input.Password
                id="newPassword"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="new-password"
                size="large"
                placeholder={tPhone("newPasswordPlaceholder")}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="phonePassword" className="text-sm font-medium">
                {t("passwordLabel")}
              </label>
              <Input.Password
                id="phonePassword"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="current-password"
                size="large"
              />
              <button
                type="button"
                onClick={() => void handleSendOtp()}
                disabled={isLoading}
                className="text-xs text-muted-foreground underline hover:text-foreground transition-colors"
              >
                {tPhone("useOtpInstead")}
              </button>
            </div>
          )}

          <Button
            type="primary"
            htmlType="submit"
            block
            loading={isLoading}
            size="large"
          >
            {mode === "reset" ? tPhone("sendOtp") : t("submit")}
          </Button>
        </form>
      )}

      {step === "otp-sent" && (
        <form onSubmit={(e) => void handleVerify(e)} className="space-y-4">
          <PhoneOtpInput
            value={otp}
            onChange={setOtp}
            onResend={() => void handleSendOtp()}
            resendCooldown={resendCooldown}
            disabled={isLoading}
          />
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={isLoading}
            disabled={otp.length !== 6}
            size="large"
          >
            {mode === "reset" ? tPhone("resetSubmit") : tPhone("verifySubmit")}
          </Button>
          <button
            type="button"
            onClick={() => {
              setStep("password");
              setOtp("");
              setError(null);
            }}
            disabled={isLoading}
            className="block w-full text-center text-xs text-muted-foreground underline hover:text-foreground transition-colors"
          >
            {tPhone("backToPassword")}
          </button>
        </form>
      )}
    </div>
  );
}
