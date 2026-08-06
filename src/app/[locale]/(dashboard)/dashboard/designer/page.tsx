import { DesignerModule } from "@/features/mooncada/components/modules/designer";

/**
 * 设计师中心 - 角色中心
 *
 * 仿 mooncada-source/modules/designer.tsx 设计：
 * - 8 张统计卡片（收入 4 张 + 任务 4 张）
 * - 我的任务 + 提现历史 双 Tab
 *
 * 数据使用前端 mock，后续接入 Drizzle 表 + Better Auth 角色（设计师）
 */
export default function DesignerDashboardPage() {
  return <DesignerModule />;
}
