/**
 * /account/orders —— 「我的商城订单」
 *
 * 2026-11-06 从 `/dashboard/store-orders` 搬过来。
 *
 * ## 为什么搬出控制台
 *
 * 工作室的原话:「打印订单、购物订单、地址管理不放在控制台里面,而是电商首页
 * 的用户头像那里。」这三样是**买家的东西**(我的单、我的地址),不是**工具用户的
 * 东西**(积分、画布、生图)。摆在控制台侧边栏里,买家得先知道「控制台」是
 * 什么、登录进去才找得到自己的单。
 *
 * 入口在电商首页右上角的头像下拉里 —— 跟「控制台」并排,一个给买家,一个给
 * 工具用户。
 *
 * ## 为什么它挂在 `(marketing-atelier)` 这一组
 *
 * 因为**入口在那个头里**。这一组的 layout 挂的是 `<WjpStoreHeader />`(头像
 * 下拉就在那儿),页面从那儿点进来,就得长成那个样子 —— 换一套头会让人以为
 * 跳到了另一个站。跟 `/cart` / `/checkout` 是同一组,同一个道理。
 *
 * ## 鉴权
 *
 * 这一组是**公开组**(匿名访客要能逛首页),所以 `(marketing-atelier)/layout.tsx`
 * 没有会话守卫 —— 鉴权在这里自己做:`getServerSession()` 查不到就跳登录页。
 *
 * 注意这里用的是 `next/navigation` 的 `redirect`(不带 locale 前缀):跳到
 * `/sign-in` 之后由 next-intl 中间件补上 `/zh`,再由 proxy 把 `callbackUrl`
 * 补成带前缀的 `/zh/account/orders`。
 *
 * 订单挂在账号名下(`storefront_order.user_id`),所以这里按 `user_id` 查 ——
 * 用户只看得到自己下的单。
 */

import { redirect } from "next/navigation";

import {
  StoreOrderList,
  type StoreOrderListItem,
} from "@/features/storefront/components/store-order-list";
import { listUserStorefrontOrders } from "@/features/storefront/lib/orders";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function AccountOrdersPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/account/orders");
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
    paymentChannel: order.paymentChannel,
  }));

  // 版式(页面留白 / 标题 / 列表 / 空状态)在组件里 —— 商城那边也是组件自己
  // 掌版(`CartPageView` 就是),页面只管鉴权和取数。
  return <StoreOrderList orders={orders} />;
}
