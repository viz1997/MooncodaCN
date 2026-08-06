import { OrdersAdminView } from "@/features/gpt-image/admin/components/orders-admin-view";

export const dynamic = "force-dynamic";

/**
 * 订单管理 - 仅展示当前登录用户自己创建的订单
 *
 * - 普通用户：只看到自己创建的订单（后端按 createdBy 过滤）
 * - 管理员：可看全部订单（后端 role=admin 时跳过过滤）
 *
 * 模板管理仍走 /admin/prompt-templates（admin-only）。
 * 订单访问（上传 / 选图 / 取消）走公开 token 链接，不受登录态限制。
 */
export default function PromptOrdersPage() {
  return (
    <div className="space-y-6">
      <OrdersAdminView />
    </div>
  );
}
