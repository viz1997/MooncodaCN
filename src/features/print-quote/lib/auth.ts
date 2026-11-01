/**
 * 打印服务的登录校验
 *
 * 2026-11-01 起打印服务是**登录后下单** —— 报价页、报价接口、下单接口、
 * 上传签发接口全部要登录态。
 *
 * 为什么单独一个文件:仓库里 API 路由的鉴权没有共享 helper,每个路由自己调
 * `auth.api.getSession`。打印服务有四个端点要走同一套判断,抄四遍迟早抄漏
 * 一个 —— 漏掉的那个就是没登录也能下单的口子。
 *
 * 注意:这里的判断是**真的查库**校验 session(不像 proxy 只看 cookie 在不在),
 * 所以 API 层可以单独信任它。
 */

import { headers } from "next/headers";

import { auth } from "@/lib/auth";

/** 通过校验后拿到的用户信息 */
export type PrintOrderUser = {
  id: string;
  email: string;
  name: string;
};

/**
 * 取当前登录用户 —— 没登录返回 null
 *
 * 调用方负责转 401。
 */
export async function getPrintOrderUser(): Promise<PrintOrderUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user;
  if (!user?.id) return null;

  return {
    id: user.id,
    // 联系邮箱以账号邮箱为准 —— 订单已经归属账号,邮箱没理由让客户端随便填
    email: user.email ?? "",
    name: user.name ?? "",
  };
}
