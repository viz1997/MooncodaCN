"use client";

/**
 * V1 工作台客户端壳 —— 给 /dashboard/generate 包 antd + canvas i18n + react-query 三个 Provider
 *
 * 为什么需要这层壳：
 * - V2 (image-workbench-client) 早已用这三层，因为 PromptSelectDialog / AssetPickerModal
 *   都依赖 antd App context、react-i18next 实例、@tanstack/react-query 的 QueryClient
 * - V1 的 page.tsx 是 RSC（要 await getActivePromptTemplates），所以 Provider 必须挂在
 *   client 子树里
 *
 * 不挂到根 layout 的原因（与 V2 image-workbench-client 保持一致）：
 * - AntdProvider 会触发 antd 6 的 CSS-in-JS 注入；marketing / auth / admin 页面不需要
 * - CanvasI18nProvider 会拉起 canvas i18n 单例，canvas 之外的页面用不到
 *
 * 与 V2 的差异：
 * - V2 用 next/dynamic ssr:false 完全屏障 SSR，因为 image-workbench 强依赖 localforage/window
 * - V1 工作台本身已经是 'use client'，没有 window-only API，可以直接渲染
 */

import { AntdProvider } from "@/components/antd-provider";
import { CanvasI18nProvider } from "@/features/canvas/components/canvas-i18n-provider";
import { CanvasQueryProvider } from "@/features/canvas/components/layout/canvas-query-provider";
import type { PromptTemplateView } from "@/features/gpt-image/lib/types";
import { GenerateWorkbenchView } from "@/features/image-gen/components/generate-workbench-view";

interface Props {
  templates: PromptTemplateView[];
}

export function ImageWorkbenchV1Client({ templates }: Props) {
  return (
    <CanvasI18nProvider>
      <AntdProvider>
        <CanvasQueryProvider>
          <GenerateWorkbenchView templates={templates} />
        </CanvasQueryProvider>
      </AntdProvider>
    </CanvasI18nProvider>
  );
}
