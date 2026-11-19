/**
 * /image-gen —— 登录用户生图 demo
 *
 * 2026-09-09：原公开 demo 形态恢复，但加登录 gate：
 *   - 未登录访问 → redirect("/sign-in?callbackUrl=/image-gen")
 *   - 登录后 → 渲染 PublicImageGenView（产品效果网格 + 一次性生图）
 *
 * 复用：
 *   - GET  /api/public/generate 拿 active productEffect 列表
 *   - POST /api/public/upload    R2 预签名直传
 *   - POST /api/public/generate  发起生图（同步返图或 taskId）
 *   - GET  /api/image/task/[id]  异步任务轮询
 *
 * 2026-09-10：RSC 拿 session.user → 传给 PublicImageGenView，顶栏渲染用户名 +
 * 邮箱 + 「我的订单」入口（链 /image-gen/orders）。
 *
 * 与 workbench 的区别：本页是"一次性体验"——不创建 promptOrder、不扣 credit、
 * 不接订单系统。历史只存浏览器 localStorage（key=mooncoda_public_imagegen_history，
 * 最多 30 条），换浏览器/换账号就丢了；正式下单走 /p/[token] 或工作台 V1。
 *
 * ## 2026-11-13 删掉 → 2026-11-19 搬回来
 *
 * 2026-11-13 工作室的原话是「不想进入这些路由页面」⇒ 这一页连同
 * `public-image-gen-view.tsx` / `orders-view.tsx` 两个组件**整个删掉**
 * (⇒ `/zh/image-gen` 直接 404)。生图这个**能力**没删,它搬进了控制台
 * (`/dashboard/generate` 工作台 + `/dashboard/prompt-orders` 订单)。
 *
 * 2026-11-19 工作室改口:**「原来的/image-gen还是要」** ⇒ **原样搬回来**
 * (路由 + 两个组件都回来了,URL 一个字没变)。
 *
 * ## 为什么住在路由组**外面**(不是 `(marketing-atelier)`)
 *
 * 这一页是**全屏工具页**:自带一条顶栏(logo / 「我的订单」/ 用户名 / 登出),
 * 根节点是 `h-screen flex flex-col`。套上商城头尾会变成「两条头」+ 高度
 * 溢出 ⇒ 所以它**不在** `(marketing-atelier)` 组里,跟 `/p/[token]`(免登录
 * 分享页)同一个待遇 —— **是公开页面,但不是浏览面,自己一套外壳**。
 *
 * ⚠️ 路由组不影响 URL —— 放在组外面,地址照样是 `/{locale}/image-gen`。
 * ⚠️ 别把它也复制进 `(marketing-atelier)` —— 同一个 URL 挂两条路由,
 * Next.js 直接报「路由冲突」。
 *
 * 登录门槛照旧:未登录 → `/sign-in?callbackUrl=/image-gen`(跟账号页那几处
 * 一个口径,不带 locale 前缀 —— next-intl 的 proxy 会补上)。
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PublicImageGenView } from "@/features/image-gen/components/public-image-gen-view";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ImageGenPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/image-gen");
  }

  return (
    <PublicImageGenView
      user={{
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
      }}
    />
  );
}
