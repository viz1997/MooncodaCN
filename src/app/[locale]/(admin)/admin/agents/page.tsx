import { AgentsAdminView } from "@/features/agent/components/agents-admin-view";

/**
 * 代理商管理 - Admin 路由
 *
 * 仿 /admin/external-api-keys 模式：
 * - page.tsx 是 server component，仅做 view 挂载
 * - 所有数据加载 / 操作在 AgentsAdminView 内部用 client action
 *
 * 权限由 (admin) layout 的 checkAdmin() 守卫，这里不用再检。
 */
export default function AdminAgentsPage() {
  return (
    <div className="space-y-6">
      <AgentsAdminView />
    </div>
  );
}
