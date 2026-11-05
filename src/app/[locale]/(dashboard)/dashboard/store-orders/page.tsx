/**
 * /dashboard/store-orders —— 「我的商城订单」
 *
 * 商城订单挂在账号名下(`storefront_order.user_id`),所以这里按 `user_id`
 * 查 —— 用户只看得到自己下的单。
 *
 * 鉴权由 `(dashboard)/layout.tsx` 兜住(那边是真的查库校验 session),这里
 * 再判一次是为了把类型收窄 —— 万一哪天这个页面被挪出 dashboard 布局,也
 * 不会变成一个谁都能看的页面。
 */

import { redirect } from "next/navigation";

import {
  StoreOrderList,
  type StoreOrderListItem,
} from "@/features/storefront/components/store-order-list";
import { listUserStorefrontOrders } from "@/features/storefront/lib/orders";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function StoreOrdersPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/dashboard/store-orders");
  }

  const rows = await listUserStorefrontOrders(session.user.id, 50);

  const orders: StoreOrderListItem[] = rows.map(({ order, items }) => ({
    orderNo: order.orderNo,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalCents: order.totalCents,
    createdAt: order.createdAt.toISOString(),
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    titles: items.slice(0, 2).map((item) => item.productTitle),
    thumbnail: items[0]?.productThumbnail ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl">我的订单</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          成品商城的订单。付款完成才开始制作,进度会在这里更新。
        </p>
      </div>
      <StoreOrderList orders={orders} />
    </div>
  );
}
