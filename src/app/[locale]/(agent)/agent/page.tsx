import { redirect } from "next/navigation";

/**
 * 2026-09-03：代理商 portal 默认落地页。
 *
 * /agent 没有 dashboard，访问 /agent 直接重定向到 /agent/orders。
 * （与 admin 的 /admin dashboard 区分：代理商不需要"今日新增订单数"
 * 这种管理视图，只关心自己的订单列表）
 */
export default function AgentIndexPage() {
  redirect("/agent/orders");
}
