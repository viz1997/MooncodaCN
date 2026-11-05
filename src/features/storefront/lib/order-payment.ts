/**
 * 商城订单的收款链接
 *
 * ## 三种情况
 *
 * | 情况 | 做法 |
 * |---|---|
 * | 已付 | 拒绝 —— 付完了还让人付一次是事故 |
 * | 有链接 | 直接用(Stripe 的链接 23 小时内有效,大多数时候够) |
 * | 有 Sellbase 订单但没链接 | `POST /orders/:id/payment-link` 换新的 |
 * | 什么都没有 | 用订单行重建一张 Sellbase 订单(结算时建单失败的那种) |
 *
 * ## 重建时用**存下来的**行,不重算价
 *
 * `storefront_order_item` 里存着下单那一刻的折后单价 —— 重建 Sellbase 订单
 * 时用它当 `unit_price_amount`。**不重新定价**:用户下单时看到并同意的是那个
 * 价,后来改了定价规则也不该让他的订单变贵(或者变便宜)。
 *
 * `variantId` 也存下来了 —— Sellbase 的载体变体 id,重建时直接用,不用再去
 * 解析一遍目录。
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  type StorefrontOrderItemRow,
  type StorefrontOrderRow,
  storefrontOrder,
} from "@/db/schema";
import { backfillSellbaseCustomerId } from "@/features/sellbase/lib/customer";
import {
  SELLBASE_CURRENCY,
  SELLBASE_FX_RATE,
} from "@/features/sellbase/lib/env";
import {
  centsToStoreAmount,
  getCurrencyConversion,
} from "@/features/sellbase/lib/money";
import {
  createSellbaseOrder,
  createSellbasePaymentLink,
} from "@/features/sellbase/lib/orders";

import {
  buildStorefrontSellbaseNote,
  buildStorefrontSuccessUrl,
} from "./checkout";

export type StorefrontPaymentLinkResult =
  | { ok: true; paymentUrl: string }
  | {
      ok: false;
      code:
        | "ALREADY_PAID"
        | "ORDER_REFUNDED"
        | "LINK_FAILED"
        | "SELLBASE_NOT_CONFIGURED"
        | "CARRIER_MISSING";
    };

/**
 * 拿(或者重拿)支付链接
 */
export async function ensureStorefrontOrderPaymentLink(
  order: StorefrontOrderRow,
  items: StorefrontOrderItemRow[]
): Promise<StorefrontPaymentLinkResult> {
  // 已付的、已退款的、已发货的 —— 都不再发链接
  if (order.paymentStatus === "paid" || order.status === "fulfilled") {
    return { ok: false, code: "ALREADY_PAID" };
  }
  if (order.paymentStatus === "refunded") {
    return { ok: false, code: "ORDER_REFUNDED" };
  }

  if (order.paymentUrl) {
    return { ok: true, paymentUrl: order.paymentUrl };
  }

  // 有 Sellbase 订单 → 换一张链接
  if (order.sellbaseOrderId) {
    try {
      const url = await createSellbasePaymentLink(order.sellbaseOrderId);
      await db
        .update(storefrontOrder)
        .set({ paymentUrl: url, updatedAt: new Date() })
        .where(eq(storefrontOrder.id, order.id));
      return { ok: true, paymentUrl: url };
    } catch (error) {
      console.error(`[storefront] ${order.orderNo} 重取支付链接失败`, error);
      return { ok: false, code: "LINK_FAILED" };
    }
  }

  // 什么都没有 → 用订单行重建一张 Sellbase 订单
  const conversion = getCurrencyConversion(SELLBASE_CURRENCY, SELLBASE_FX_RATE);

  const sellbaseItems = items.map((item) => ({
    variantId: item.variantId ?? "",
    quantity: item.quantity,
    unitPriceAmount: centsToStoreAmount(
      item.discountedUnitPriceCents,
      conversion
    ),
  }));

  if (sellbaseItems.some((line) => !line.variantId)) {
    // 建单时载体变体就没解析出来 —— 重建不了
    return { ok: false, code: "CARRIER_MISSING" };
  }

  try {
    const created = await createSellbaseOrder({
      email: order.email,
      items: sellbaseItems,
      shippingAmount: centsToStoreAmount(order.shippingCents, conversion),
      shippingAddress: order.shippingAddress ?? null,
      note: buildStorefrontSellbaseNote({
        orderNo: order.orderNo,
        lines: items.map((item) => ({
          title: item.productTitle,
          quantity: item.quantity,
        })),
      }),
      successUrl: buildStorefrontSuccessUrl(order.orderNo),
      notifyCustomer: true,
    });

    await db
      .update(storefrontOrder)
      .set({
        sellbaseOrderId: created.orderId,
        paymentUrl: created.paymentUrl,
        updatedAt: new Date(),
      })
      .where(eq(storefrontOrder.id, order.id));

    if (created.customerId) {
      await backfillSellbaseCustomerId(order.userId, created.customerId);
    }

    if (!created.paymentUrl) {
      return { ok: false, code: "LINK_FAILED" };
    }
    return { ok: true, paymentUrl: created.paymentUrl };
  } catch (error) {
    console.error(
      `[storefront] ${order.orderNo} 重建 Sellbase 订单失败`,
      error
    );
    return { ok: false, code: "LINK_FAILED" };
  }
}
