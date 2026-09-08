/**
 * 2026-09-07：代理商 workbench 入口 token 认证。
 *
 * 用于保护 /p/agent/[token] 路由 + /api/agent-workbench/* 路由。
 *
 * 校验流程：
 * 1. 未登录 → redirect /sign-in?callbackUrl=/p/agent/{token}
 *    （API 路由场景下返回 401，由调用方处理）
 * 2. 已登录但 user.agentId 为空 → redirect /agent
 * 3. 已登录 user.agentId 不匹配 token 对应的 agent → redirect /agent
 * 4. 通过 → 返回 { session, agent }
 *
 * 与现有 checkAgent 的区别：
 * - checkAgent 只看 user.agentId 是否非空（保护 (agent) route group）
 * - 本函数额外校验 agentId ↔ token 的对应关系（保护 workbench URL）
 */
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { db } from "@/db";
import { type Agent, agent } from "@/db/schema";
import { auth } from "@/lib/auth";

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

export type RequireAgentByTokenResult = {
  session: NonNullable<Session>;
  agent: Agent;
};

/**
 * 校验当前 session + token 对应关系，全部通过才返回。
 *
 * @param token - URL 中的 imageGenToken
 * @param options.redirectTo - 是否走 redirect（默认 true；RSC / page 用）
 *                             API route 调用时应传 false 自己处理 401/403
 * @returns { session, agent }
 * @throws redirect / notFound（当 redirectTo=true 时）
 */
export async function requireAgentByToken(
  token: string,
  options: { redirectTo?: boolean } = {}
): Promise<RequireAgentByTokenResult> {
  const redirectTo = options.redirectTo ?? true;
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    if (redirectTo) {
      const callbackUrl = encodeURIComponent(`/p/agent/${token}`);
      redirect(`/sign-in?callbackUrl=${callbackUrl}`);
    } else {
      throw new Error("UNAUTHENTICATED");
    }
  }

  const a = await db.query.agent.findFirst({
    where: eq(agent.imageGenToken, token),
  });
  if (!a) {
    if (redirectTo) notFound();
    else throw new Error("AGENT_NOT_FOUND");
  }

  const sessionAgentId = (session.user as { agentId?: string | null }).agentId;
  if (sessionAgentId !== a.id) {
    if (redirectTo) redirect("/agent");
    else throw new Error("FORBIDDEN");
  }

  return { session, agent: a };
}
