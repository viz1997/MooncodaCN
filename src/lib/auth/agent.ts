import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/auth/server";

/**
 * 2026-09-03：代理商权限检查（ToB 业务自下单 / (agent) route group）。
 *
 * 用于保护 /agent/** 路由。
 * - 未登录 → 重定向 /sign-in
 * - 已登录但非代理商（user.agentId 为空）→ 重定向首页
 * - 已登录且是代理商 → 返回 session（layout 渲染）
 *
 * 与 checkAdmin 的区别：
 * - checkAdmin 走 role=admin 判断
 * - checkAgent 走 agentId 非空判断（userRoleEnum 不扩展，靠 agentId 判定）
 *
 * @returns 当前用户会话（如果是代理商）
 * @throws Redirect to "/sign-in" or "/" if not agent
 *
 * @example
 * ```ts
 * // 在 (agent)/layout.tsx 中使用
 * export default async function AgentLayout({ children }) {
 *   await checkAgent();
 *   return <>{children}</>;
 * }
 * ```
 */
export async function checkAgent() {
  const session = await getServerSession();

  if (!session || !session.user) {
    redirect("/sign-in");
  }

  const agentId = (session.user as { agentId?: string | null }).agentId;
  if (typeof agentId !== "string" || agentId.length === 0) {
    // 非代理商账号：跳首页（不让登录的用户看到 404）
    redirect("/");
  }

  return session;
}

/**
 * 检查当前用户是否是代理商（不重定向）。
 *
 * 用于 RSC 内 inline 判断、agentAction 之外的 server-only check。
 *
 * @returns 是否是代理商（user.agentId 非空）
 */
export async function isAgent(): Promise<boolean> {
  const session = await getServerSession();
  if (!session || !session.user) return false;
  const agentId = (session.user as { agentId?: string | null }).agentId;
  return typeof agentId === "string" && agentId.length > 0;
}
