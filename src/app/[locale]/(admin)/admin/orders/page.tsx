/**
 * /admin/orders 全局订单管理页（2026-09-18）
 *
 * RSC：仅渲染客户端组件 <AdminOrdersView />。
 *
 * RBAC：由父 layout `src/app/[locale]/(admin)/admin/layout.tsx` 的 `checkAdmin()`
 * 守卫；非 admin 自动 redirect 到 `/`。无需在本页重复校验。
 *
 * 设计：
 * - 不用 server action 拉初始数据（keyset cursor + 5 维筛选更适合 client 端交互）
 * - 首屏挂载时 AdminOrdersView 内部 useEffect 触发 adminListAllOrdersAction
 * - 走 admin 全局视角（skipCreatorFilter 默认 false 但 ctx.userId 是 admin，
 *   service 层不带 createdBy 过滤，自动跨用户查所有订单）
 */

import { AdminOrdersView } from "@/features/admin/orders/components/AdminOrdersView";

export default function AdminOrdersPage() {
  return <AdminOrdersView />;
}
