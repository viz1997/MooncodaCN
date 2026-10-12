/**
 * Bearer Token 认证助手（2026-09-16）
 *
 * 微信小程序作为客户端时，登录返回 `{ token, user }`，小程序端把 token 放
 * `Authorization: Bearer <token>` 请求头。Better Auth 默认 `auth.api.getSession`
 * 只读签名 cookie（HMAC 校验），不识别 Bearer —— 本模块直接查 Drizzle session
 * 表 + 校验过期，等价于 BA `findSession(token)` 的内部路径。
 *
 * 用法：
 *   - 中间件（proxy.ts）：先 Bearer → 再 Cookie
 *   - API route：调 `getSessionFromRequest(request)` 替代 `auth.api.getSession({ headers })`
 *
 * 安全考虑：
 *   - 不引入额外签名：BA session.token 是 nanoid(32)，128 bit 熵足够，
 *     配合 HTTPS + rate limit 已够安全（与 cookie 路径同源策略不同，
 *     但小程序是 BFF 模式下唯一入口）。
 *   - expiresAt 校验：查 session 行时直接 AND expires_at > now()，
 *     避免悬挂过期 token。
 */

import { and, eq, gt as gtOp } from "drizzle-orm";

import { db } from "@/db";
import type { User } from "@/db/schema";
import { session, user } from "@/db/schema";

/**
 * 与 BA `auth.api.getSession` 兼容的返回值形状。
 * 仅挑出小程序 / 中间件需要的字段，不返回 session 表全字段。
 */
export interface BearerSession {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    banned: boolean;
    phoneNumber: string | null;
    phoneNumberVerified: boolean;
    image: string | null;
  };
  session: {
    token: string;
    expiresAt: Date;
    userId: string;
  };
}

/**
 * 用 Bearer token 查 session + user（直查 Drizzle，绕过 BA 签名 cookie 校验）。
 *
 * 返回 null：token 不存在 / 已过期 / 用户不存在。
 */
export async function getBearerSession(
  token: string
): Promise<BearerSession | null> {
  if (!token || token.length < 16 || token.length > 128) return null;

  const rows = await db
    .select({
      // session
      sessionToken: session.token,
      sessionUserId: session.userId,
      sessionExpiresAt: session.expiresAt,
      // user
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      userRole: user.role,
      userBanned: user.banned,
      userImage: user.image,
      userPhoneNumber: user.phoneNumber,
      userPhoneNumberVerified: user.phoneNumberVerified,
    })
    .from(session)
    .innerJoin(user, eq(session.userId, user.id))
    .where(and(eq(session.token, token), gtOp(session.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    user: {
      id: row.userId,
      email: row.userEmail,
      name: row.userName,
      role: row.userRole,
      banned: row.userBanned,
      phoneNumber: row.userPhoneNumber,
      phoneNumberVerified: row.userPhoneNumberVerified,
      image: row.userImage,
    },
    session: {
      token: row.sessionToken,
      expiresAt: row.sessionExpiresAt,
      userId: row.sessionUserId,
    },
  };
}

/**
 * 从 NextRequest 抽取 Bearer token（无则 null）。
 */
export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  return token;
}

// 类型 re-export 方便调用方
export type { User };
