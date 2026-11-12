"use client";

import { useTranslations } from "next-intl";

import { siteConfig } from "@/config";
import { CookieSettingsDialog } from "@/features/shared";

/**
 * Auth 页面底部组件
 *
 * 包含版权信息和 Cookie 设置入口。
 *
 * 2026-11-12:去掉「隐私政策 / 服务条款」两个链接 —— 它们指向的是**原项目
 * (SaaS 模板)**的法律文档(隐私政策里写的是「生成闪卡」「Anki 包」),
 * 那两份 MDX 已经删了。工作室的原话:「不再展示这些页面，即原项目的页面」。
 *
 * ⚠️ **注册页会收集个人信息**(邮箱 / 称呼 / 电话),按《个人信息保护法》
 * 应当有隐私说明。**那两份文档得按打印业务的实际口径重写** ——
 * 内容能从代码里查出来(收哪些信息、存在哪、留多久),文案得工作室自己拍板。
 * 需要的话我写一版草稿,写完把链接挂回这里。
 *
 * Cookie 设置**留着** —— 它是个弹窗(不是页面),而且是功能,不是模板文案。
 */
export function AuthFooter() {
  const t = useTranslations("Auth.footer");

  return (
    <footer className="border-t bg-background py-6">
      <div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 sm:flex-row">
        <p className="text-sm text-muted-foreground">
          {t("copyright", {
            year: new Date().getFullYear(),
            name: siteConfig.name,
          })}
        </p>
        <nav className="flex gap-6">
          <CookieSettingsDialog>
            <button
              type="button"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("cookies")}
            </button>
          </CookieSettingsDialog>
        </nav>
      </div>
    </footer>
  );
}
