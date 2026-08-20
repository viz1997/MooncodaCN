"use client";

/**
 * 画布模块的 React Query Provider —— 模块级单例 QueryClient
 *
 * 为什么单独建一个而不是挂在根 layout：
 * - 画布是客户端孤岛，只在 /dashboard/canvas/** 与 /dashboard/generate-v2 挂载
 * - 根 layout 挂 React Query 会把全局页面（marketing / auth / admin）也卷进来，
 *   与 CLAUDE.md 要求的"不要把画布相关 Provider 挂到根 layout"一致
 *
 * 与 app-providers.tsx 的关系：
 * - app-providers.tsx 里定义了同款 QueryClient + ConfigProvider/ProConfigProvider/App/ClientRootInit
 *   的完整 Provider 栈，但目前没有被 ProjectEditor 引用
 * - 这里只抽出 React Query 部分（最小必要），antd 套壳继续走 AntdProvider（保留 hashPriority="high"）
 *
 * 配置来源：staleTime 30s / retry false / refetchOnWindowFocus false —— 与 app-providers 保持一致
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export function CanvasQueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
