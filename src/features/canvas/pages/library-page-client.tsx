"use client";

import dynamic from "next/dynamic";
import { AntdProvider } from "@/components/antd-provider";
import { CanvasI18nProvider } from "@/features/canvas/components/canvas-i18n-provider";
import { CanvasQueryProvider } from "@/features/canvas/components/layout/canvas-query-provider";

/**
 * 提示词库 / 我的资产 等"独立成页"的画布功能统一壳：
 *
 * 1. next/dynamic ssr:false —— 页面用到的 store / hook 依赖 localforage / window，
 *    SSR 必炸（参考 image-workbench-client 的同款屏障）
 * 2. 三层 Provider 套娃（与 canvas-editor / image-workbench 一致）：
 *    - CanvasI18nProvider：独立 i18next 实例
 *    - AntdProvider：antd 6 + hashPriority="high" 隔离
 *    - CanvasQueryProvider：@tanstack/react-query 单例
 *
 * 使用方式：page.tsx 是 RSC，做 auth gate；真正渲染走这个壳 dynamic import。
 */

const DynamicPromptLibrary = dynamic(
  () =>
    import("@/features/canvas/components/prompts/prompt-library-view").then(
      (m) => m.PromptLibraryView
    ),
  { ssr: false, loading: () => null }
);

const DynamicAssetLibrary = dynamic(
  () =>
    import("@/features/canvas/components/canvas/asset-library-view").then(
      (m) => m.AssetLibraryView
    ),
  { ssr: false, loading: () => null }
);

function withLibraryProviders() {
  return function LibraryProviders({
    children,
  }: {
    children: React.ReactNode;
  }) {
    return (
      <CanvasI18nProvider>
        <AntdProvider>
          <CanvasQueryProvider>{children}</CanvasQueryProvider>
        </AntdProvider>
      </CanvasI18nProvider>
    );
  };
}

const Providers = withLibraryProviders();

export function PromptLibraryPageClient() {
  return (
    <Providers>
      <DynamicPromptLibrary />
    </Providers>
  );
}

export function AssetLibraryPageClient() {
  return (
    <Providers>
      <DynamicAssetLibrary />
    </Providers>
  );
}
