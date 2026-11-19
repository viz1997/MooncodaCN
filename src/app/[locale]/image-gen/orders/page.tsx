/**
 * /image-gen/orders —— 「我的订单」独立页面
 *
 * 2026-09-10：从 /image-gen 顶栏 Link 跳进来。登录用户在 RSC 层校验 session，
 * 未登录跳 /sign-in?callbackUrl=/image-gen/orders。客户端逻辑全部在
 * OrdersView（搜索 + 状态过滤 + 列表 + 同页 inline 详情），不跳 /p/[token]、
 * 不进 /dashboard/prompt-orders。
 *
 * 与 /image-gen 的差异：
 * - 全屏布局（无侧栏 / 无顶部 demo 步骤）
 * - 左右双栏：左 380px 列表 + 状态过滤 chips + 搜索框；右 flex-1 详情
 * - 详情复用 OrderDetailView（从原抽屉抽出，搬到 feature 内共享）
 *
 * 复用：
 *   - listUserOrdersAction（status / search / limit 服务端过滤）
 *   - productCatalog（productType + ACCESSORIES 显示中文名）
 *
 * ## 2026-11-13 删掉 → 2026-11-19 搬回来
 *
 * 跟 `/image-gen` 是同一件事的两条腿(2026-11-13 两个路由连同两个组件一起
 * 删掉,2026-11-19 工作室改口「原来的/image-gen还是要」⇒ **原样搬回来**)。
 *
 * 住在路由组**外面**(`src/app/[locale]/image-gen/`,不是 `(marketing-atelier)`)
 * —— 全屏工具页,自己一条顶栏,跟 `/p/[token]` 同一个待遇。路由组不影响 URL,
 * 地址照样是 `/{locale}/image-gen/orders`。
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { OrdersView } from "@/features/image-gen/components/orders-view";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ImageGenOrdersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/image-gen/orders");
  }

  return (
    <OrdersView
      user={{
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
      }}
    />
  );
}
