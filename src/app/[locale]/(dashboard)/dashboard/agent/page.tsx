import { AgentModule } from "@/features/mooncada/components/modules/agent";

/**
 * 代理商中心 - 角色中心
 *
 * 仿 mooncada-source/modules/agent.tsx 设计：
 * - 4 张佣金统计卡片
 * - 推广信息 + 二维码
 * - 提现记录表格 + 申请提现对话框
 *
 * 数据使用前端 mock，后续接入 Drizzle 表 + Better Auth 角色（代理商）
 */
export default function AgentDashboardPage() {
  return <AgentModule />;
}
