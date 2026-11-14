/**
 * /account/orders/[orderNo] —— 商城订单详情页(2026-11-13 新建)
 *
 * ## 为什么这一页是**新建**的
 *
 * 商城订单的买家侧以前**只有列表**(`/account/orders`),没有详情页。
 * 收货地址快照落了库、买家侧**一次都没渲染过**;物流更是无处可摆。
 *
 * 工作室要在后台「发货台」填运单号 —— 买家总得有个地方看得到,否则「寄出去了」
 * 这件事工作室知道、买家不知道。
 *
 * ## 归属校验在数据层
 *
 * `getUserStorefrontOrderByOrderNo(userId, orderNo)` 的 WHERE 里带了 `user_id`
 * —— 别人的单查出来就是 null ⇒ 404,**不是 403**(403 等于告诉别人「这个订单号
 * 存在」,而订单号是可以被枚举的)。
 *
 * **不存在与不是你的,给同一个答案** —— 404。
 *
 * ## 物流单独查一次
 *
 * 物流是**独立的表**,不塞进订单行里(一个订单可以拆多个包裹)。查的是
 * `listShipmentsForOrder("storefront", order.id)` —— 跟打印工单那边**同一个
 * 函数**,两处口径不会漂。
 *
 * ## 鉴权
 *
 * `(marketing-atelier)` 是**公开组**(匿名访客要能逛首页)⇒ layout 没有会话守卫
 * ⇒ 这里自己查。查不到就跳登录页,`callbackUrl` 指回这一页。
 */

import { notFound, redirect } from "next/navigation";

import {
  getLatestRefundRequestForOrder,
  toRefundView,
} from "@/features/refund/lib/refund-store";
import {
  listShipmentsForOrder,
  toShipmentView,
} from "@/features/shipment/lib/shipment-store";
import { StoreOrderDetailView } from "@/features/storefront/components/store-order-detail-view";
import type {
  StoreOrderDetailItem,
  StoreOrderDetailOrder,
} from "@/features/storefront/lib/order-detail-types";
import { getUserStorefrontOrderByOrderNo } from "@/features/storefront/lib/orders";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function AccountOrderDetailPage({
  params,
}: {
  params: Promise<{ orderNo: string }>;
}) {
  const { orderNo } = await params;

  const session = await getServerSession();
  if (!session?.user) {
    redirect(
      `/sign-in?callbackUrl=${encodeURIComponent(`/account/orders/${orderNo}`)}`
    );
  }

  const result = await getUserStorefrontOrderByOrderNo(
    session.user.id,
    orderNo
  );
  if (!result) notFound();

  const { order, items } = result;

  // 物流 —— 一个订单可能有多个包裹(补发 / 分开发)
  const shipmentRows = await listShipmentsForOrder("storefront", order.id);

  // 退款申请(2026-11-14)—— **最新那一条**;没有就是 null
  //
  // 「最新」而不是「唯一」:被拒之后买家可以再申请一条 ⇒ 一个订单可能有多条。
  // 买家侧只该看见**当前那一条**。
  const refundRow = await getLatestRefundRequestForOrder("storefront", order.id);

  /**
   * 订单视图模型
   *
   * **金额那一栏照搬恒等式**:`total_cents = subtotal − discount − coupon_discount
   * + shipping`。前端**一个加法都不做** —— 每行都是服务端算好的数,只做呈现。
   */
  const detailOrder: StoreOrderDetailOrder = {
    orderNo: order.orderNo,
    status: order.status,
    paymentStatus: order.paymentStatus,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    couponDiscountCents: order.couponDiscountCents,
    couponCode: order.couponCode,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    paymentUrl: order.paymentUrl,
    paymentQrCodeUrl: order.paymentQrCodeUrl,
    paymentChannel: order.paymentChannel,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    note: order.note,
    shippingAddress: order.shippingAddress,
  };

  const detailItems: StoreOrderDetailItem[] = items.map((item) => ({
    id: item.id,
    title: item.productTitle,
    thumbnail: item.productThumbnail,
    sku: item.sku,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    discountedUnitPriceCents: item.discountedUnitPriceCents,
    lineTotalCents: item.lineTotalCents,
  }));

  return (
    <StoreOrderDetailView
      order={detailOrder}
      items={detailItems}
      shipments={shipmentRows.map(toShipmentView)}
      refund={refundRow ? toRefundView(refundRow) : null}
    />
  );
}
