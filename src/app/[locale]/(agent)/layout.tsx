import { AntdLayoutShell } from "@/components/antd-layout-shell";
import { AgentSidebar } from "@/features/agent/components/agent-sidebar";
import { checkAgent } from "@/lib/auth/agent";

/**
 * 2026-09-03：代理商 portal 布局（ToB 业务自下单）。
 *
 * 仿 (admin) 的形态：RBAC 守卫（checkAgent()） + AntdLayoutShell + 紫主题侧边栏。
 * 区别：
 * - 不需要 SidebarProvider（agent 业务暂时只两个一级菜单 + 一个按钮，
 *   不做可调侧边栏宽度这种交互）。
 * - 顶栏只展示标题"代理商门户"，不展示用户操作（用户操作走侧边栏底部
 *   Popover 复用 admin-sidebar 的视觉）。
 *
 * 路由守卫顺序：
 * 1. proxy.ts 检查 cookie 中有 session token（粗筛，未登录跳 /sign-in）
 * 2. 本 layout 用 checkAgent() 走 Better Auth 真实验证 + agentId 非空
 *    （细筛，非代理商跳 /）
 */
export default async function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await checkAgent();

  return (
    <AntdLayoutShell>
      <div className="min-h-screen bg-violet-50/40 dark:bg-slate-950">
        <AgentSidebar />
        <div className="pl-64">
          <header className="sticky top-0 z-30 flex h-14 items-center border-b bg-white/80 px-6 backdrop-blur dark:bg-slate-900/80">
            <h1 className="text-lg font-semibold text-violet-50 dark:text-violet-300">
              代理商门户
            </h1>
            <span className="ml-3 rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              ToB 自下单
            </span>
          </header>
          <main className="p-6">{children}</main>
        </div>
      </div>
    </AntdLayoutShell>
  );
}
