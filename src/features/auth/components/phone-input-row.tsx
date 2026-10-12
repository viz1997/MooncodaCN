"use client";

import { Input, Select } from "antd";
import { useTranslations } from "next-intl";

import { DEFAULT_COUNTRY_CODE, PHONE_COUNTRIES, toE164 } from "@/features/sms";

/**
 * 区号 Select + 手机号 Input 行（2026-09-16）
 *
 * 复用：sign-in / sign-up / settings-bind-phone / forgot-password 都用这同一份。
 * 内置 E.164 归一化（toE164）—— 调用方只需要读 phoneE164 + setPhoneE164 即可，
 * 不用关心区号选择 + 拼接的细节。
 *
 * 选区号：antd Select + 自定义 label 渲染（flag emoji + code + 中文名）。
 * 用法：value 传 E.164（如 "+8613800138000"），组件自动拆区号 + body。
 */
export function PhoneInputRow({
  phoneE164,
  setPhoneE164,
  disabled = false,
  autoFocus = false,
  placeholder,
  inputTestId = "phone-input",
}: {
  phoneE164: string;
  setPhoneE164: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  inputTestId?: string;
}) {
  const t = useTranslations("Auth.common");

  /**
   * 把 E.164 拆回 (countryCode, body)：
   *   "+8613800138000" → "+86", "13800138000"
   *   "+15551234567"  → "+1",   "5551234567"
   * 不匹配则 countryCode = E.164 整体，body = ""。
   */
  const splitE164 = (e164: string): { cc: string; body: string } => {
    const match = e164.match(/^(\+\d{1,3})(\d{4,15})$/);
    if (!match || !match[1] || !match[2])
      return { cc: DEFAULT_COUNTRY_CODE, body: "" };
    return { cc: match[1], body: match[2] };
  };

  const { cc: currentCc, body: currentBody } = splitE164(phoneE164);

  /**
   * 区号变化：保留 body 重新拼接。
   * body 为空就只更新 cc（避免被校验打回）。
   */
  const handleCountryChange = (nextCc: string) => {
    if (!currentBody) return;
    setPhoneE164(toE164(nextCc, currentBody));
  };

  /**
   * body 变化：按当前 cc 拼成 E.164。
   * 允许用户输入 0xx 国内格式（toE164 会替换）。
   */
  const handleBodyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhoneE164(toE164(currentCc, e.target.value));
  };

  // antd Select 用 string value；options 的 value 显式 string，下拉项渲染走 optionRender
  const countryOptions = PHONE_COUNTRIES.map((c) => ({
    value: c.code,
    label: `${c.flag} ${c.code}`,
  }));

  return (
    <div className="flex gap-2">
      <Select
        value={currentCc}
        onChange={handleCountryChange}
        disabled={disabled}
        size="large"
        style={{ width: 120 }}
        options={countryOptions}
        optionRender={(option) => {
          const code = String(option.value);
          const c = PHONE_COUNTRIES.find((x) => x.code === code);
          if (!c) return option.label;
          return (
            <span>
              {c.flag} {c.code} {c.nameZh}
            </span>
          );
        }}
        aria-label={t("countryCode")}
      />
      <Input
        type="tel"
        inputMode="numeric"
        value={currentBody}
        onChange={handleBodyChange}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="tel-national"
        placeholder={placeholder ?? t("phonePlaceholder")}
        size="large"
        data-testid={inputTestId}
        className="flex-1"
      />
    </div>
  );
}
