// @ts-nocheck
"use client";

import dynamic from "next/dynamic";

import { AntdProvider } from "@/components/antd-provider";
import { CanvasI18nProvider } from "@/features/canvas/components/canvas-i18n-provider";
import { AppConfigModal } from "@/features/canvas/components/layout/app-config-modal";
import { CanvasQueryProvider } from "@/features/canvas/components/layout/canvas-query-provider";

/**
 * /dashboard/canvas/[projectId] 的客户端壳
 *
 * 作用：
 * 1. next/dynamic ssr:false 屏障 —— 项目编辑器大量依赖 localforage / window，
 *    SSR 渲染必炸；这里把整个 ProjectEditor 移到 dynamic 屏障之后加载。
 * 2. 四层 Provider 包裹：
 *    - CanvasI18nProvider: 画布内独立 i18next 实例（zh-CN / en-US）
 *    - AntdProvider: antd 6 + hashPriority="high" CSS-in-JS 隔离
 *    - CanvasQueryProvider: @tanstack/react-query 的 QueryClient（模块级单例）
 *      —— useInfiniteQuery / useQuery / useQueryClient 都依赖它，否则会报
 *      "No QueryClient set, use QueryClientProvider to set one"
 * 3. 顶层挂载 AppConfigModal：
 *    - handleGenerateNode 在 isAiConfigReady=false 时会 openConfigDialog(true)
 *      切 isConfigOpen=true，但 zustand 没有 UI 监听就是空操作
 *    - 用户站点顶部 nav（UserLayout → AppTopNav）只在 marketing/auth 路由
 *      下挂载；canvas 编辑器用 fixed inset-0 z-50 全屏，不经过那个 layout，
 *      所以必须自己把 AppConfigModal 挂在 CanvasEditorClient 树里
 *
 * 备注：useSearchParams() 在 Next 14+ 协议上要求 Suspense 包裹，但 project-editor.tsx
 * 已对 searchParams 访问加 ?. 防御。dynamic({ssr:false}) 内部自带 Suspense 边界，
 * 再包一层会和 dynamic 选最近 Suspense 时发生渲染状态冲突（实测导致 Maximum update
 * depth），所以这里不另包 Suspense。
 */

const ProjectEditor = dynamic(
  () =>
    import("@/features/canvas/pages/project-editor").then(
      (m) => m.ProjectEditor
    ),
  { ssr: false, loading: () => null }
);

interface CanvasEditorClientProps {
  projectId: string;
}

export function CanvasEditorClient({ projectId }: CanvasEditorClientProps) {
  return (
    <CanvasI18nProvider>
      <AntdProvider>
        <CanvasQueryProvider>
          <ProjectEditor projectId={projectId} />
          <AppConfigModal />
        </CanvasQueryProvider>
      </AntdProvider>
    </CanvasI18nProvider>
  );
}
