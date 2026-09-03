"use client";

import { createContext, type ReactNode, useContext } from "react";

import { useSession } from "./client";

/**
 * 会话用户类型
 */
interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null | undefined;
  emailVerified: boolean;
  /**
   * 角色（admin / user）。Better Auth 通过 additionalFields 暴露给客户端，
   * 但 session-context 的窄类型不一定覆盖；如未来扩展更多字段，按需补充。
   */
  role?: string | null | undefined;
  /**
   * 2026-09-03：代理商归属（ToB 自下单）。从 user.agentId 透传。
   * - undefined / null：当前账号不是代理商（普通 ToC 用户或 admin）
   * - 字符串：当前账号属于这个 agent（id），可走 /agent/** portal
   *
   * 判断代理商快捷字段见下方 isAgent（computed）。
   */
  agentId?: string | null | undefined;
}

/**
 * 会话上下文类型
 */
interface SessionContextType {
  /** 当前用户，未登录时为 null */
  user: SessionUser | null;
  /** 是否正在加载会话 */
  isLoading: boolean;
  /** 是否已认证 */
  isAuthenticated: boolean;
  /**
   * 2026-09-03：是否代理商账号 —— user.agentId 存在且非空。
   * 注意 isAdmin 已经在 SessionUser.role === "admin" 处判断；本字段与
   * admin 互斥（一个账号只能属于一个代理商或一个 admin）。
   */
  isAgent: boolean;
}

/**
 * 会话上下文
 */
const SessionContext = createContext<SessionContextType | undefined>(undefined);

/**
 * 会话提供者组件
 *
 * 包裹应用根组件，提供全局会话状态
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { SessionProvider } from "@/lib/auth/session-context";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <SessionProvider>{children}</SessionProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  // 2026-09-03：cast — Better Auth 的 useSession 类型推导不会把 additionalFields
  // 里的 agentId 自动加到 session.user 的窄类型上（typegen 缺失）。手动 cast
  // 到宽类型 SessionUser 后再读 agentId（运行时 Better Auth 会从 cookie-cache
  // 把 agentId 注入到 user 对象）。
  const u = (session?.user ?? null) as SessionUser | null;
  // 2026-09-03：isAgent = 账号绑了某个代理商（agentId 非空）。
  // 用 !! 双重否定把 null / undefined / "" 都归 false，剩下来就是
  // 真正的 agentId 字符串。
  const isAgent = !!u && typeof u.agentId === "string" && u.agentId.length > 0;

  const value: SessionContextType = {
    user: u,
    isLoading: isPending,
    isAuthenticated: !!session?.user,
    isAgent,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

/**
 * 使用会话上下文的 Hook
 *
 * @returns 会话上下文值
 * @throws 如果在 SessionProvider 外部使用
 *
 * @example
 * ```tsx
 * function UserProfile() {
 *   const { user, isLoading, isAuthenticated } = useSessionContext();
 *
 *   if (isLoading) return <Skeleton />;
 *   if (!isAuthenticated) return <LoginButton />;
 *
 *   return <div>Welcome, {user.name}</div>;
 * }
 * ```
 */
export function useSessionContext() {
  const context = useContext(SessionContext);

  if (context === undefined) {
    throw new Error("useSessionContext 必须在 SessionProvider 内部使用");
  }

  return context;
}
