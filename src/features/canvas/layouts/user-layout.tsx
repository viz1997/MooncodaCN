// @ts-nocheck
import type { ReactNode } from "react";

import { AppTopNav } from "@/features/canvas/components/layout/app-top-nav";

/**
 * 画布用户布局 —— 顶部 nav + 内容。
 *
 * Plan §15：canvas-agent（MCP 本地代理 + Agent 面板）本期不做，
 * 所以这里不挂载 AgentPanel。AgentPanel 文件保留在
 * src/features/canvas/components/agent/，等二期接 Agent 时再用。
 */
export default function UserLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppTopNav />
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
