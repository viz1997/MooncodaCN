import { redirect } from "next/navigation";

/**
 * 2026-09-07：代理商 portal 原 /agent/orders/new 入口废弃。
 *
 * 历史：2026-09-03 起此路由承载 AgentOrderFormDialog（agent 当 admin 自下单）。
 * 2026-09-07 workbench 上线后，agent 的统一入口改为 /p/agent/{imageGenToken}
 * （先选模板生成效果图 → 再选规格提交）。AgentOrderFormDialog 也失去存在意义。
 *
 * 保留此 page 仅作为 redirect 兜底：避免老链接 / 浏览器书签打 404。实际
 * 落地由 AgentOrdersView 上的"进入 Workbench"按钮负责跳转。
 */
export default function AgentNewOrderPage() {
  // 服务端重定向到订单列表；列表上的"进入 Workbench"按钮会负责后续跳转。
  redirect("/agent/orders");
}
