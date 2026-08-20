// @ts-nocheck
"use client";

/**
 * 画布内独立的 i18next 实例（孤岛）
 *
 * 设计动机：
 * - NextDevTpl 主体用 next-intl（messages/{zh,en}.json）
 * - infinite-canvas 用 i18next（react-i18next）
 * - 两套体系共用一个 <html lang> 会互相污染 namespace
 * - 这里初始化一份**仅画布内有效**的 i18next 实例，配 locale 持久化
 *
 * 桥接策略（见 canvas-i18n-provider.tsx）：
 * - 监听 next-intl 的 locale，change 到对应的 i18next 语言（zh ↔ zh-CN, en ↔ en-US）
 * - 用户在画布内切换语言时只更新 localStorage + i18next，不影响 next-intl
 *
 * 护栏：
 * - 此文件顶部必须有 "use client"，且 i18next 实例**不能**被任何 layout.tsx / page.tsx
 *   服务端组件顶层 import（会触发 next-intl namespace tree 报错）。
 * - 项目列表页 / 编辑器页通过 next/dynamic({ ssr: false }) 间接加载，避开 SSR。
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "./locales/en-US";
import zhCN from "./locales/zh-CN";

export type CanvasLocale = "zh-CN" | "en-US";

const LOCALE_STORAGE_KEY = "mooncoda:canvas:locale";

/**
  // 单例：模块顶层 if-guard 防止 React StrictMode / HMR 重复初始化
  */
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      "zh-CN": { translation: zhCN },
      "en-US": { translation: enUS },
    },
    lng:
      (typeof window !== "undefined"
        ? (window.localStorage.getItem(
            LOCALE_STORAGE_KEY
          ) as CanvasLocale | null)
        : null) || "zh-CN",
    fallbackLng: "zh-CN",
    supportedLngs: ["zh-CN", "en-US"],
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

/**
 * 切换画布内语言（持久化到 localStorage）
 */
export function changeCanvasLocale(locale: CanvasLocale): Promise<unknown> {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
  return i18n.changeLanguage(locale);
}

/**
 * infinite-canvas 原本叫 changeAppLocale，迁移后保留旧名作为 alias，
 * 避免把所有 use 站点都改一遍。
 */
export const changeAppLocale = changeCanvasLocale;

export default i18n;
