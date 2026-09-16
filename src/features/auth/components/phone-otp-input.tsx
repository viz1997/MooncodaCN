"use client";

import { Button, Input } from "antd";
import { useTranslations } from "next-intl";

/**
 * 6 位 OTP 输入 + 60s 倒计时 + 重发按钮（2026-09-16）
 *
 * 状态机（由调用方控制）：
 *   - resendCooldown > 0   → 按钮 disabled，显示「{n}s 后重发」
 *   - resendCooldown === 0 → 按钮 enabled，显示「重新发送」
 *
 * 注意：Input.OTP 是 antd 5.10+ 才有；锁定 ≥5.10 即可。
 */
export function PhoneOtpInput({
  value,
  onChange,
  onResend,
  resendCooldown,
  disabled = false,
  length = 6,
}: {
  value: string;
  onChange: (next: string) => void;
  onResend: () => void;
  resendCooldown: number;
  disabled?: boolean;
  length?: number;
}) {
  const t = useTranslations("Auth.signIn.phone");

  return (
    <div className="space-y-2">
      <label htmlFor="phone-otp" className="text-sm font-medium">
        {t("otpLabel")}
      </label>
      <Input.OTP
        id="phone-otp"
        length={length}
        value={value}
        onChange={onChange}
        disabled={disabled}
        size="large"
        aria-label={t("otpLabel")}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t("otpHint")}</span>
        <Button
          type="link"
          size="small"
          onClick={onResend}
          disabled={resendCooldown > 0 || disabled}
          className="!px-0"
        >
          {resendCooldown > 0
            ? t("resendCooldown", { seconds: resendCooldown })
            : t("resend")}
        </Button>
      </div>
    </div>
  );
}
