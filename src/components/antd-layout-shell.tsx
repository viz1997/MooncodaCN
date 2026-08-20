"use client";

/**
 * 业务路由组 layout 的 antd 外壳
 *
 * 用途：(dashboard) / (auth) / (admin) 三个 route group 的 layout 都是 Server Component
 * （需要做服务端 auth / 权限检查），不能直接挂 AntdProvider（"use client"）。
 * 用本 client shim 把 children 包进 AntdProvider。
 *
 * 2026-08-20：shadcn → antd 迁移的 Phase 0 基础设施
 */

import type { ReactNode } from "react";

import { AntdProvider } from "@/components/antd-provider";

export function AntdLayoutShell({ children }: { children: ReactNode }) {
  return <AntdProvider>{children}</AntdProvider>;
}
