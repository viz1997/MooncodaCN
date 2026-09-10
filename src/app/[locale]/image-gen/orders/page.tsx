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
