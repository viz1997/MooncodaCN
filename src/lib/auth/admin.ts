import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/auth/server";
import { ensureDefaultAdmin } from "./bootstrap-admin";

/**
 * Admin 权限检查
 *
 * 用于保护管理员路由
 * 如果用户未登录或不是管理员，重定向到首页
 *
 * 行为：
 * 1. 首次访问 admin 路由时，如果环境变量 DEFAULT_ADMIN_EMAIL/PASSWORD 已配置
 *    且数据库中无 admin 用户，自动创建一个（幂等）
 * 2. 已登录但非 admin → 重定向首页
 * 3. 未登录 → 重定向登录页
 *
 * @returns 当前用户会话 (如果是管理员)
 * @throws Redirect to "/" if not admin
 *
 * @example
 * ```ts
 * // 在 Admin 布局或页面中使用
 * export default async function AdminLayout({ children }) {
 *   await checkAdmin();
 *   return <>{children}</>;
 * }
 * ```
 */
export async function checkAdmin() {
  // 启动时确保默认管理员存在（仅在首次请求时执行，后续命中缓存）
  await ensureDefaultAdmin();

  const session = await getServerSession();

  // 检查用户是否登录
  if (!session || !session.user) {
    redirect("/sign-in");
  }

  // 检查用户是否是管理员
  if (session.user.role !== "admin") {
    redirect("/");
  }

  return session;
}

/**
 * 检查当前用户是否是管理员 (不重定向)
 *
 * 用于需要检查管理员权限但不想重定向的场景
 *
 * @returns 是否是管理员
 */
export async function isAdmin(): Promise<boolean> {
  const session = await getServerSession();

  if (!session || !session.user) {
    return false;
  }

  return session.user.role === "admin";
}
