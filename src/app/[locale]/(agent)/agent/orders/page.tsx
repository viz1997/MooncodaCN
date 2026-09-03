import { AgentOrdersView } from "@/features/agent/components/agent-orders-view";

/**
 * 2026-09-03：代理商 portal 订单列表页（ToB 自下单）。
 *
 * 直接挂 AgentOrdersView 客户端组件，所有数据加载都在 client 里做
 * （fetch /api/orders + agentListTemplatesAction）。
 *
 * 不做 RSC 预拉数据：与 /admin/prompt-orders 的做法一致（让 client fetch
 * 用 revalidateTag 失效缓存）。
 */
export default function AgentOrdersPage() {
  return <AgentOrdersView />;
}
