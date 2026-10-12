import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SystemLogsAdminView } from "@/features/image-gen/admin/components/system-logs-admin-view";
import { auth } from "@/lib/auth";

/**
 * 系统日志 - Admin 路由
 *
 * 仿 mooncada-source/modules/platform.tsx SysLogsModule 设计：
 * - 4 张级别统计卡（Debug / Info / Warn / Error）
 * - 搜索 + 级别 + 类型筛选
 * - 日志列表（图标 + 级别 + 类型 + ID + 时间 + 用户/IP/details）
 *
 * 数据使用前端 mock（MOCK_SYS_LOGS），后续接入 Pino/Axiom 日志流
 */
export default async function SystemLogsAdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <div className="space-y-6">
      <SystemLogsAdminView />
    </div>
  );
}
