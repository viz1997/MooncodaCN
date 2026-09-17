"use client";

/**
 * Settings > Security Tab > 手机号 section（2026-09-16）
 *
 * 三种状态：
 *   - 未绑 + 邮箱已验证 → 显示「绑定手机号」按钮 + 解释文案
 *   - 已绑 + 已验证     → 显示已脱敏的手机号 + 绿点 + 「解绑」「改绑」按钮
 *   - 已绑 + 未验证     → 灰点 + 「重新验证」按钮（理论上不该发生：plugin requireVerification: true）
 *
 * 绑定 / 改绑流程复用 BA plugin OTP 端点：
 *   1. sendPhoneOtp(新手机号) → 倒计时 60s
 *   2. verifyPhoneOtp(新手机号, code) → 自动建 session
 *   3. 调 bindPhoneAction / changePhoneAction 写 DB
 *
 * 解绑走 unbindPhoneAction（服务端校验「必须有真实已验证邮箱」防呆）。
 */

import { Alert, App, Button, Modal } from "antd";
import { CheckCircle2, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { AuthErrorAlert } from "@/features/auth/components/auth-error-alert";
import { PhoneInputRow } from "@/features/auth/components/phone-input-row";
import { PhoneOtpInput } from "@/features/auth/components/phone-otp-input";
import {
  bindPhoneAction,
  changePhoneAction,
  unbindPhoneAction,
} from "@/features/settings/actions";
import { maskPhone } from "@/features/sms";
import { sendPhoneOtp, verifyPhoneOtp } from "@/lib/auth/client";

interface PhoneSectionProps {
  user: {
    email: string;
    emailVerified: boolean;
    phoneNumber: string | null;
    phoneNumberVerified: boolean;
  };
}

type ModalState =
  | { kind: "closed" }
  | { kind: "bind"; step: "phone" | "otp" }
  | { kind: "change"; step: "phone" | "otp" }
  | { kind: "unbind" };

export function PhoneSection({ user }: PhoneSectionProps) {
  const t = useTranslations("Settings.security.phone");
  const tPhone = useTranslations("Auth.signIn.phone");
  const { message } = App.useApp();

  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [phoneE164, setPhoneE164] = useState("");
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const emailIsPlaceholder = user.email.includes("@noreply.");

  /**
   * Server actions wired via next-safe-action/useAction
   */
  const { execute: executeBind, isPending: isBinding } = useAction(
    bindPhoneAction,
    {
      onSuccess: () => {
        message.success(t("success.bound"));
        closeModal();
      },
      onError: ({ error }) => {
        setError(error.serverError || t("errors.bindFailed"));
      },
    }
  );

  const { execute: executeChange, isPending: isChanging } = useAction(
    changePhoneAction,
    {
      onSuccess: () => {
        message.success(t("success.changed"));
        closeModal();
      },
      onError: ({ error }) => {
        setError(error.serverError || t("errors.changeFailed"));
      },
    }
  );

  const { execute: executeUnbind, isPending: isUnbinding } = useAction(
    unbindPhoneAction,
    {
      onSuccess: () => {
        message.success(t("success.unbound"));
        closeModal();
      },
      onError: ({ error }) => {
        setError(error.serverError || t("errors.unbindFailed"));
      },
    }
  );

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
   * 发送 OTP —— bind 和 change 流程共用
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
        setError(res.error.message || tPhone("errors.sendOtpFailed"));
        return;
      }
      message.success(tPhone("otpSent"));
      setModal((prev) =>
        prev.kind === "bind" || prev.kind === "change"
          ? { ...prev, step: "otp" }
          : prev
      );
      startResendCooldown();
    } catch {
      setError(tPhone("errors.sendOtpFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * verify + bind/change 提交
   */
  const handleVerifyAndCommit = async () => {
    if (otp.length !== 6) {
      setError(tPhone("errors.invalidOtp"));
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      // 1. verify（plugin.signUpOnVerification 对已登录用户只是 verify 当前 phone）
      const res = await verifyPhoneOtp(phoneE164, otp);
      if (res.error) {
        setError(res.error.message || tPhone("errors.verifyFailed"));
        return;
      }
      // 2. commit 到 DB
      if (modal.kind === "bind") {
        executeBind({ phoneNumber: phoneE164 });
      } else if (modal.kind === "change") {
        executeChange({ newPhoneNumber: phoneE164 });
      }
    } catch {
      setError(tPhone("errors.verifyFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const closeModal = () => {
    setModal({ kind: "closed" });
    setPhoneE164("");
    setOtp("");
    setError(null);
    setResendCooldown(0);
  };

  /**
   * 主显示
   */
  const isBound = Boolean(user.phoneNumber);
  const isVerified = user.phoneNumberVerified;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex gap-2">
          {!isBound && (
            <Button
              type="primary"
              size="small"
              icon={<Phone className="h-4 w-4" />}
              onClick={() => setModal({ kind: "bind", step: "phone" })}
              disabled={emailIsPlaceholder || !user.emailVerified}
            >
              {t("bind")}
            </Button>
          )}
          {isBound && (
            <>
              <Button
                type="default"
                size="small"
                onClick={() => setModal({ kind: "change", step: "phone" })}
              >
                {t("change")}
              </Button>
              <Button
                type="default"
                size="small"
                danger
                onClick={() => setModal({ kind: "unbind" })}
                disabled={emailIsPlaceholder || !user.emailVerified}
              >
                {t("unbind")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 当前状态 */}
      <div className="rounded-md border bg-muted/40 p-4">
        <div className="flex items-center gap-2 text-sm">
          {isBound && isVerified ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="font-medium">
                {maskPhone(user.phoneNumber!)}
              </span>
              <span className="text-muted-foreground">
                · {t("status.verified")}
              </span>
            </>
          ) : isBound ? (
            <>
              <span className="h-2 w-2 rounded-full bg-muted-foreground" />
              <span className="font-medium">{user.phoneNumber}</span>
              <span className="text-muted-foreground">
                · {t("status.unverified")}
              </span>
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-muted-foreground" />
              <span className="text-muted-foreground">
                {t("status.notBound")}
              </span>
            </>
          )}
        </div>
        {!user.emailVerified && (
          <Alert
            type="info"
            message={t("hint.emailRequired")}
            showIcon
            className="!mt-3 !text-xs"
          />
        )}
      </div>

      {/* Bind / Change Modal */}
      <Modal
        open={modal.kind === "bind" || modal.kind === "change"}
        onCancel={closeModal}
        title={
          modal.kind === "change"
            ? t("modal.changeTitle")
            : t("modal.bindTitle")
        }
        footer={null}
        destroyOnHidden
      >
        <div className="space-y-4">
          <AuthErrorAlert message={error} />

          {(modal.kind === "bind" || modal.kind === "change") &&
            modal.step === "phone" && (
              <>
                <div className="space-y-2">
                  <label htmlFor="phone" className="text-sm font-medium">
                    {tPhone("phoneLabel")}
                  </label>
                  <PhoneInputRow
                    phoneE164={phoneE164}
                    setPhoneE164={setPhoneE164}
                    disabled={isLoading}
                    placeholder={tPhone("phonePlaceholder")}
                  />
                </div>
                <Button
                  type="primary"
                  block
                  loading={isLoading}
                  onClick={handleSendOtp}
                  size="large"
                >
                  {tPhone("sendOtp")}
                </Button>
              </>
            )}

          {(modal.kind === "bind" || modal.kind === "change") &&
            modal.step === "otp" && (
              <>
                <PhoneOtpInput
                  value={otp}
                  onChange={setOtp}
                  onResend={handleSendOtp}
                  resendCooldown={resendCooldown}
                  disabled={isLoading}
                />
                <Button
                  type="primary"
                  block
                  loading={isLoading || isBinding || isChanging}
                  disabled={otp.length !== 6}
                  onClick={handleVerifyAndCommit}
                  size="large"
                >
                  {tPhone("verifySubmit")}
                </Button>
              </>
            )}
        </div>
      </Modal>

      {/* Unbind confirm Modal */}
      <Modal
        open={modal.kind === "unbind"}
        onCancel={closeModal}
        title={t("modal.unbindTitle")}
        footer={[
          <Button
            key="cancel"
            type="default"
            onClick={closeModal}
            disabled={isUnbinding}
          >
            {t("modal.cancel")}
          </Button>,
          <Button
            key="confirm"
            type="primary"
            danger
            loading={isUnbinding}
            onClick={() => executeUnbind({})}
          >
            {t("modal.confirmUnbind")}
          </Button>,
        ]}
      >
        <AuthErrorAlert message={error} />
        <Alert
          type="warning"
          message={t("modal.unbindDescription")}
          showIcon
          className="!mb-0"
        />
      </Modal>
    </section>
  );
}
