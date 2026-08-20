// @ts-nocheck
"use client";

import dynamic from "next/dynamic";

import { AntdProvider } from "@/components/antd-provider";
import { CanvasI18nProvider } from "@/features/canvas/components/canvas-i18n-provider";
import { CanvasQueryProvider } from "@/features/canvas/components/layout/canvas-query-provider";

/**
 * /dashboard/generate-v2 的客户端壳
 *
 * 1. next/dynamic ssr:false 屏障 —— image workbench 大量依赖 localforage / window，
 *    SSR 渲染必炸
 * 2. 四层 Provider 包裹（同 canvas-editor-client）：
 *    - CanvasI18nProvider: 画布内独立 i18next 实例（zh-CN / en-US）
 *    - AntdProvider: antd 6 + hashPriority="high" CSS-in-JS 隔离
 *    - CanvasQueryProvider: @tanstack/react-query 的 QueryClient（模块级单例）
 *      —— PromptSelectDialog → usePromptList → useInfiniteQuery 会用到
 *
 * 与画布编辑器 (canvas-editor-client) 的差异：
 * - 画布编辑器挂载 ProjectEditor（含完整画布状态机）
 * - 本壳只挂 ImageWorkbench（独立 store / 独立子页面）
 *
 * 共享 store/services：
 * - use-config-store（AiConfig / baseUrl / 模型选择）
 * - use-asset-store（资产库）
 * - use-workbench-agent-store（被 Agent 桥接）
 * - image-storage / image.ts（直连上游，待 Phase 3 接代理）
 */

const ImageWorkbench = dynamic(
  () =>
    import("@/features/canvas/pages/image-workbench").then(
      (m) => m.ImageWorkbench
    ),
  { ssr: false, loading: () => null }
);

export function ImageWorkbenchClient() {
  return (
    <CanvasI18nProvider>
      <AntdProvider>
        <CanvasQueryProvider>
          <ImageWorkbench />
        </CanvasQueryProvider>
      </AntdProvider>
    </CanvasI18nProvider>
  );
}
