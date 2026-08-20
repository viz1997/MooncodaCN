// @ts-nocheck
"use client";

/**
 * Canvas i18n Provider - 桥接 next-intl 与 i18next
 *
 * 工作机制：
 * - 包裹在 [projectId]/page.tsx 内的 client tree 上层
 * - useLocale() 读 next-intl 当前 locale（zh / en）
 * - 通过 useEffect 同步到画布内 i18next 实例（zh-CN / en-US）
 * - 反向不必要：用户切 next-intl 语言时，画布内 useTranslation() 自动跟
 *
 * 边界保护：
 * - 此组件为 client component；其上层 [projectId]/page.tsx 服务端 import 是 OK 的
 *   （RSC 可以 import client component，但反过来不行）
 * - 不放进根 [locale]/layout.tsx——会触发 i18next 在所有页面初始化，浪费开销
 */

import { useLocale } from "next-intl";
import { type ReactNode, useEffect } from "react";
import { I18nextProvider } from "react-i18next";

import i18n, { changeCanvasLocale } from "@/features/canvas/i18n";

const NEXT_INTL_TO_I18NEXT: Record<string, "zh-CN" | "en-US"> = {
  zh: "zh-CN",
  en: "en-US",
};

interface CanvasI18nProviderProps {
  children: ReactNode;
}

export function CanvasI18nProvider({ children }: CanvasI18nProviderProps) {
  const nextIntlLocale = useLocale();

  useEffect(() => {
    const target = NEXT_INTL_TO_I18NEXT[nextIntlLocale] ?? "zh-CN";
    if (i18n.language !== target) {
      // 同步 localStorage + i18next，但不触发 useEffect 循环（依赖 nextIntlLocale）
      void changeCanvasLocale(target);
    }
  }, [nextIntlLocale]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
