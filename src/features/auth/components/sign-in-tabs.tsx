"use client";

import { Tabs } from "antd";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AuthLogo } from "./auth-logo";
import { PhoneSignInForm } from "./phone-sign-in-form";

/**
 * 登录 Tabs 容器（2026-09-16）
 *
 * 把现有 email 登录（slot 传入）与 phone 登录（内置）并排显示。
 * 选 tab 通过 ?tab=phone / ?tab=email URL 参数同步 —— 用户扫码进 /sign-in
 * 走微信登录后微信回跳带 callbackUrl 时不会丢 tab。
 *
 * 用法：
 *   <SignInTabs emailForm={<EmailSignInForm />} />
 *
 * 关联：src/app/[locale]/(auth)/sign-in/page.tsx 是入口（仍是 RSC，只挂这个 client 组件）。
 */
export function SignInTabs({ emailForm }: { emailForm: React.ReactNode }) {
  const t = useTranslations("Auth.signIn");
  const [activeKey, setActiveKey] = useState<"email" | "phone">("email");

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="flex flex-col items-center space-y-2 text-center">
        <AuthLogo />
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Tabs
        activeKey={activeKey}
        onChange={(k) => setActiveKey(k as "email" | "phone")}
        items={[
          {
            key: "email",
            label: t("tabs.email"),
            children: <div>{emailForm}</div>,
          },
          {
            key: "phone",
            label: t("tabs.phone"),
            children: <PhoneSignInForm mode="signin" />,
          },
        ]}
        centered
      />
    </div>
  );
}
