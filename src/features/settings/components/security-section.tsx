"use client";

/**
 * 安全设置组件
 *
 * Settings > Security Tab 的主要内容
 * 包含:
 * - 修改密码
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.4）
 * - shadcn Button/Input/Label 切到 antd
 * - 用 antd Alert 显示错误（替代纯文本）
 */

import { Alert, App, Button, Input } from "antd";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { changePassword } from "@/lib/auth/client";

/**
 * 安全设置组件
 */
export function SecuritySection() {
  const t = useTranslations("Settings.security");
  const { message } = App.useApp();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChangePassword = async () => {
    setError(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t("errors.missingFields"));
      return;
    }

    if (newPassword.length < 8) {
      setError(t("errors.passwordTooShort"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("errors.passwordMismatch"));
      return;
    }

    if (currentPassword === newPassword) {
      setError(t("errors.samePassword"));
      return;
    }

    try {
      setIsLoading(true);
      await changePassword(currentPassword, newPassword);
      message.success(t("success"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError(t("errors.wrongPassword"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* 修改密码 */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              {t("changePassword.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("changePassword.description")}
            </p>
          </div>
          <Button
            type="primary"
            size="small"
            disabled={
              isLoading || !currentPassword || !newPassword || !confirmPassword
            }
            loading={isLoading}
            onClick={handleChangePassword}
          >
            {isLoading
              ? t("changePassword.updating")
              : t("changePassword.submit")}
          </Button>
        </div>

        {error && (
          <Alert type="error" message={error} showIcon className="!text-sm" />
        )}

        <div className="max-w-md space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="current-password"
              className="text-sm font-medium leading-none"
            >
              {t("changePassword.currentPassword")}
            </label>
            <Input.Password
              id="current-password"
              placeholder={t("changePassword.currentPasswordPlaceholder")}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="new-password"
              className="text-sm font-medium leading-none"
            >
              {t("changePassword.newPassword")}
            </label>
            <Input.Password
              id="new-password"
              placeholder={t("changePassword.newPasswordPlaceholder")}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="confirm-password"
              className="text-sm font-medium leading-none"
            >
              {t("changePassword.confirmPassword")}
            </label>
            <Input.Password
              id="confirm-password"
              placeholder={t("changePassword.confirmPasswordPlaceholder")}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
