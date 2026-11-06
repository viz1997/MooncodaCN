/**
 * /account —— 「账户信息」
 *
 * 电商首页右上角头像下拉里那块「头像 + 姓名 + 邮箱」现在是**可点的菜单项**
 * (2026-11-06)—— 点进来就是这一页。所以这一页得真的能改东西,不然那一下
 * 点击是死胡同。
 *
 * ## 挂在 `(marketing-atelier)` 这一组
 *
 * 因为**入口在那个头里**(头像下拉)。这一组的 layout 挂的是
 * `<WjpStoreHeader />`,从那儿点进来就得长成那个样子 —— 跟 `/cart` /
 * `/checkout` / `/account/orders` 是同一组,同一个道理。
 *
 * ## 鉴权
 *
 * 这一组是**公开组**(匿名访客要能逛首页),layout 里没有会话守卫 ——
 * 鉴权在这一页自己做:`getServerSession()` 查不到就跳登录页。
 *
 * 这里用的是 `next/navigation` 的 `redirect`(不带 locale 前缀):跳到
 * `/sign-in` 之后由 next-intl 中间件补上 `/zh`,再由 proxy 把 `callbackUrl`
 * 补成带前缀的 `/zh/account`。
 *
 * ## 取数
 *
 * 姓名 / 邮箱 / 头像会话里就有,但**验证状态和手机号不在会话里** —— 直接查
 * DB(跟 `/dashboard/settings` 同一口径:不指望 BA session 暴露这两列)。
 */

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db, user } from "@/db";
import { AccountProfileView } from "@/features/account";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/account");
  }

  const me = await db.query.user.findFirst({
    where: eq(user.id, session.user.id),
    columns: {
      name: true,
      email: true,
      image: true,
      emailVerified: true,
      phoneNumber: true,
      phoneNumberVerified: true,
      createdAt: true,
    },
  });

  return (
    <AccountProfileView
      user={{
        id: session.user.id,
        name: me?.name ?? session.user.name ?? "",
        email: me?.email ?? session.user.email ?? "",
        image: me?.image ?? session.user.image ?? null,
        emailVerified: me?.emailVerified ?? false,
        phoneNumber: me?.phoneNumber ?? null,
        phoneNumberVerified: me?.phoneNumberVerified ?? false,
        createdAt: (me?.createdAt ?? new Date()).toISOString(),
      }}
    />
  );
}
