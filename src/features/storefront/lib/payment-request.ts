/**
 * 商城订单 → `PaymentRequest` 的**唯一**转换口
 *
 * ## 为什么单独抽一个文件
 *
 * 「这笔订单要收多少钱」这件事有**两个**消费方:
 *
 * 1. `order-payment.ts` —— 建支付会话 / 「重新获取付款入口」
 * 2. `payment-reconcile.ts` —— 主动查单时核对「支付宝记的实付 == 订单应付」
 *
 * 两处**必须算出同一个数** —— 不然会出现「查单说金额对不上、订单永远不标已付」。
 * ⇒ 抽成一份,两处 import 它。
 *
 * ## 为什么不放在 `order-payment.ts` 里
 *
 * `order-payment.ts` 要 import `payment-reconcile.ts`(查单前先看一眼是不是
 * 已经付过了),而 `payment-reconcile.ts` 又要用这份转换 ⇒ **循环依赖**。
 * 把这份转换抽到**谁都不依赖它**的第三份文件里,环就没了。
 *
 * ## 重建时用**存下来的**行,不重算价
 *
 * `storefront_order_item` 里存着下单那一刻的折后单价 —— 重建支付会话时用它
 * 当单价。**不重新定价**:用户下单时看到并同意的是那个价,后来改了定价规则
 * 也不该让他的订单变贵(或者变便宜)。
 */

import type { StorefrontOrderItemRow, StorefrontOrderRow } from "@/db/schema";
import type {
  PaymentRequest,
  PaymentRequestItem,
} from "@/features/payments/lib/types";

import { buildStorefrontSuccessUrl } from "./checkout-url";

/**
 * 按订单 + 订单行拼出一份 `PaymentRequest`
 *
 * 逐分相等靠的就是它 —— 收银台那边实际收的金额 = `computeTotalCents(request)`,
 * 跟 `storefront_order.total_cents` 是同一个数(优惠额带上、运费带上、
 * 折后单价带上)。
 */
export function buildStorefrontPaymentRequest(
  order: StorefrontOrderRow,
  items: StorefrontOrderItemRow[]
): PaymentRequest {
  const requestItems: PaymentRequestItem[] = items.map((item) => ({
    title: item.productTitle,
    quantity: item.quantity,
    unitPriceCents: item.discountedUnitPriceCents,
    sku: item.sku ?? item.productHandle,
    attributes: {},
  }));

  const address = order.shippingAddress;

  return {
    orderNo: order.orderNo,
    email: order.email,
    items: requestItems,
    shippingCents: order.shippingCents,
    // **订单级优惠必须带上**(2026-11-08)
    //
    // 少了它,重建出来的总额 = Σ(折后单价 × 数量) + 运费 —— **比订单应付多出
    // 优惠码减免的那一份** ⇒ 用户点一下「重新获取付款入口」就被多收钱。
    //
    // 优惠额是订单上**存下来的**那个数,不是现算的 —— 用户下单时同意的就是
    // 那个价。
    discountCents: order.couponDiscountCents ?? 0,
    shippingAddress: address
      ? {
          recipientName: address.recipientName,
          phone: address.phone,
          province: address.province,
          city: address.city,
          district: address.district,
          detail: address.detail,
        }
      : null,
    note: order.note ?? "",
    successUrl: buildStorefrontSuccessUrl(order.orderNo),
    currency: order.currency,
  };
}
