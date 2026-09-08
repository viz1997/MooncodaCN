import { notFound } from "next/navigation";
import { requireAgentByToken } from "@/features/agent/lib/auth-agent-token";
import { listAgentWorkbenchAction } from "@/features/agent-workbench/actions/workbench";
import { AgentWorkbenchView } from "@/features/agent-workbench/components/agent-workbench-view";

export const dynamic = "force-dynamic";

/**
 * 代理商 workbench 入口（2026-09-07）
 *
 * 路由：/p/agent/[token]
 *
 * 流程：
 * 1. requireAgentByToken 校验登录 + session.user.agentId === agent.id
 * 2. 一次性 list templates + draftOrder
 * 3. 渲染 <AgentWorkbenchView>，按 draftOrder.status 状态机驱动步骤
 *
 * 与 /p/[token] 的区别：
 * - /p/[token] 匿名免登录（ToC 入口）
 * - /p/agent/[token] 必须登录且账号绑了对应 agent（ToB workbench）
 */
export default async function AgentWorkbenchPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // 1. auth gate（agent_id ↔ token 绑定校验；不符合就 redirect 到 /sign-in 或 /agent）
  await requireAgentByToken(token, { redirectTo: true });

  // 2. 拉 workbench 数据
  const res = await listAgentWorkbenchAction({ token });
  if (!res?.data) {
    notFound();
  }
  const { agent: a, templates, draftOrder } = res.data;

  return (
    <AgentWorkbenchView
      token={token}
      agent={a}
      templates={templates}
      draftOrder={draftOrder}
    />
  );
}
