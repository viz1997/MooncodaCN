"use client";

/**
 * Ant Design 6 Provider - 画布 + 业务路由组共享
 *
 * 三层结构（顺序敏感）：
 * 1. StyleProvider（@ant-design/cssinjs）：hashPriority="high" 强制 style 走 cssText，
 *    避免与 Tailwind 4 工具类 hash 撞名（CSS-in-JS 隔离）
 * 2. ConfigProvider（antd）：注入 locale（next-intl）+ theme（中性黑白 + darkAlgorithm）
 * 3. App（antd）：message / modal / notification 等 imperative API 的根节点
 *
 * 挂载点（2026-08-20 起统一挂这三处）：
 * - src/app/[locale]/(dashboard)/layout.tsx
 * - src/app/[locale]/(auth)/layout.tsx
 * - src/app/[locale]/(admin)/admin/layout.tsx
 *
 * 不挂载：
 * - src/app/layout.tsx / src/app/[locale]/layout.tsx
 *   —— 会污染 marketing/blog/docs 页面（marketing 仍用 shadcn/ui，主题不同）
 *
 * 画布（src/app/[locale]/(dashboard)/dashboard/canvas/[projectId]）的兼容性：
 * - 画布内部还会再套一层 CanvasI18nProvider + AppProviders（画布自己的独立 i18next +
 *   ProConfigProvider + ClientRootInit），ConfigProvider 嵌套是 antd 支持的，
 *   内层优先；本 AntdProvider 主题对外层 dashboard / auth / admin 生效。
 *
 * 主题算法：
 * - 主题来源：next-themes 的 useTheme().resolvedTheme
 * - 共享 src/lib/antd/app-theme.ts 的 getAntThemeConfig
 * - locale 来自 next-intl 的 useLocale()：en → enUS，zh → zhCN
 *
 * 不要做的事：
 * - 不要混用 antd 5（v5 是 less，与 cssinjs 行为不同）
 * - 不要在这里挂 QueryClient / ProConfigProvider（这些是画布内部的事）
 */

import { App as AntdApp, ConfigProvider } from "antd";
import enUS from "antd/es/locale/en_US";
import zhCN from "antd/es/locale/zh_CN";
import { useLocale } from "next-intl";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

import { AntdStyleRegistry } from "@/components/antd-style-registry";
import { getAntThemeConfig } from "@/lib/antd/app-theme";

interface AntdProviderProps {
  children: ReactNode;
}

/**
 * 业务路由组的 antd 外壳
 *
 * 三层结构（顺序敏感）：
 * 1. AntdStyleRegistry：cssinjs SSR cache + useServerInsertedHTML flush，
 *    避免 server/client hash className 不一致导致的 hydration mismatch
 * 2. ConfigProvider：注入 locale（next-intl）+ theme（中性黑白 + darkAlgorithm）
 * 3. App（antd）：message / modal / notification 等 imperative API 的根节点
 *
 * 挂载点（2026-08-20 起统一挂这三处）：
 * - src/app/[locale]/(dashboard)/layout.tsx
 * - src/app/[locale]/(auth)/layout.tsx
 * - src/app/[locale]/(admin)/admin/layout.tsx
 *
 * 不挂载：
 * - src/app/layout.tsx / src/app/[locale]/layout.tsx
 *   —— 会污染 marketing/blog/docs 页面（marketing 仍用 shadcn/ui，主题不同）
 *
 * 画布（src/app/[locale]/(dashboard)/dashboard/canvas/[projectId]）的兼容性：
 * - 画布内部还会再套一层 CanvasI18nProvider + AppProviders（画布自己的独立 i18next +
 *   ProConfigProvider + ClientRootInit），ConfigProvider 嵌套是 antd 支持的，
 *   内层优先；本 AntdProvider 主题对外层 dashboard / auth / admin 生效。
 *
 * 主题算法：
 * - 主题来源：next-themes 的 useTheme().resolvedTheme
 * - 共享 src/lib/antd/app-theme.ts 的 getAntThemeConfig
 * - locale 来自 next-intl 的 useLocale()：en → enUS，zh → zhCN
 *
 * 不要做的事：
 * - 不要混用 antd 5（v5 是 less，与 cssinjs 行为不同）
 * - 不要在这里挂 QueryClient / ProConfigProvider（这些是画布内部的事）
 */
export function AntdProvider({ children }: AntdProviderProps) {
  const { resolvedTheme } = useTheme();
  const locale = useLocale();
  const dark = resolvedTheme === "dark";
  const antdLocale = locale === "zh" ? zhCN : enUS;

  return (
    <AntdStyleRegistry>
      <ConfigProvider locale={antdLocale} theme={getAntThemeConfig(dark)}>
        {/* AntdApp 会插入一个 <div>；挂 className="h-full" 让下游 h-full 链不塌 */}
        <AntdApp className="h-full">{children}</AntdApp>
      </ConfigProvider>
    </AntdStyleRegistry>
  );
}
