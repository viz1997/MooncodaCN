/**
 * /admin/print-orders 打印订单管理页（2026-11-01）
 *
 * RSC：仅渲染客户端组件 <PrintOrdersAdminView />。
 *
 * RBAC：由父 layout `src/app/[locale]/(admin)/admin/layout.tsx` 的 `checkAdmin()`
 * 守卫；非 admin 自动 redirect 到 `/`。本页不重复校验。
 *
 * 与 `/admin/orders`（商城生图订单）是两套完全独立的数据：
 * - `/admin/orders` → `promptOrder` 表,gpt-image 生图订单
 * - `/admin/print-orders` → `print_order` 表,按克重计价的 3D 打印工单
 */

import { PrintOrdersAdminView } from "@/features/print-quote/admin/components/print-orders-admin-view";

export default function AdminPrintOrdersPage() {
  return <PrintOrdersAdminView />;
}
