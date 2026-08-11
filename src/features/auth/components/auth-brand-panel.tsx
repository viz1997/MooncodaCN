"use client";

import { useTranslations } from "next-intl";

import { siteConfig } from "@/config";
import { AuthLogo } from "@/features/auth/components/auth-logo";

/**
 * Auth 页面品牌面板
 *
 * 用于登录/注册页左侧的深色品牌分屏。文案走 i18n（Auth.brand.*），
 * 不要在此写死字符串——业务文案统一从 messages/{zh,en}.json 维护。
 */
export function AuthBrandPanel() {
  const t = useTranslations("Auth.brand");

  return (
    <div className="relative hidden flex-col justify-between bg-slate-900 p-10 text-slate-100 lg:flex">
      <div className="z-10">
        <AuthLogo />
      </div>

      <div className="z-10 max-w-md space-y-4">
        <h2 className="text-3xl font-bold tracking-tight text-balance">
          {t("headline")}
        </h2>
        <p className="text-slate-400">{t("sub")}</p>
        <ul className="space-y-2 text-sm text-slate-400">
          <li className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t("points.onePiece")}
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t("points.fullColor")}
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t("points.shipping")}
          </li>
      
        </ul>
      </div>

      <div className="z-10 flex items-end justify-between gap-4 text-xs text-slate-500">
        <span>
          © {new Date().getFullYear()} {siteConfig.name}. {t("rights")}
        </span>
       
      </div>

      {/* 装饰背景 */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-slate-950" />
    </div>
  );
}