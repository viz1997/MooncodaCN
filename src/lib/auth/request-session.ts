/**
 * API 路由的会话解析 —— **Bearer 优先,cookie 兜底**
 *
 * ## 两条认证路径
 *
 * | 调用方 | 怎么带凭据 | 走哪条路 |
 * |---|---|---|
 * | 浏览器 | Better Auth 的签名 cookie | `auth.api.getSession({ headers })` |
 * | 微信小程序 | `Authorization: Bearer <token>` | `getBearerSession(token)`(直查 session 表) |
 *
 * Better Auth 的 `getSession` 只认签名 cookie —— 小程序拿不到 cookie,只有
 * 登录时返回的那个 token。所以**同一个路由要同时认两种**,不然小程序就得
 * 改代码才能用。
 *
 * ## 为什么放在单独一个文件
 *
 * `bearer.ts` 被 `src/proxy.ts`(Edge runtime)import。把 `better-auth` 拖进
 * 那个 bundle 既臃肿又可能炸,所以两条路径的合流放在这里 —— 只有 Node 路由
 * 会 import 到它。
 *
 * ## 带了 Bearer 但 token 无效 → 直接 null,**不**退回 cookie
 *
 * 理由:请求方既然表明自己是 Bearer 身份,悄悄换成 cookie 身份,就把
 * 「token 过期」变成了「换个身份照样能过」—— 那是在放宽授权边界。
 */

import { extractBearerToken, getBearerSession } from "./bearer";
import { auth } from "./index";

/**
 * 会话里的用户 —— 两条路径都有的字段
 *
 * 只列公共的那几个:调用方(结算 / 查订单 / 地址簿)要的就是 id / email /
 * 名字 / 角色,不需要 BA session 的全部字段。
 */
export interface RequestSessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

/** 会话 —— 形状跟 `auth.api.getSession()` 的返回值兼容(都有 `user.id`) */
export interface RequestSession {
  user: RequestSessionUser;
}

/**
 * 从请求里解析会话
 *
 * 返回 null = 没登录 / 凭据无效。
 */
export async function getSessionFromRequest(
  request: Request
): Promise<RequestSession | null> {
  const token = extractBearerToken(request);

  if (token) {
    const bearer = await getBearerSession(token);
    if (!bearer) return null;
    return {
      user: {
        id: bearer.user.id,
        email: bearer.user.email,
        name: bearer.user.name,
        role: bearer.user.role,
      },
    };
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? "",
      role: session.user.role ?? "user",
    },
  };
}
