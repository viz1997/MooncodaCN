import { OrdersAdminView } from "@/features/gpt-image/admin/components/orders-admin-view";

export const dynamic = "force-dynamic";

/**
 * 订单管理 - 所有登录用户可用
 *
 * 模板管理仍走 /admin/prompt-templates（admin-only）；
 * 订单管理任何登录用户都能创建/查看/删除，因为订单是用户自己创建给匿名收件人用的。
 */
export default function PromptOrdersPage() {
  return (
    <div className="space-y-6">
      <OrdersAdminView />
    </div>
  );
}
