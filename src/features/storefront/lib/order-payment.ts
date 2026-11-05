/**
 * 商城订单的收款入口
 *
 * ## 「付款入口」不止是链接
 *
 * - **支付宝 / Shopify / 旧路的 Stripe** —— 跳过去的地址(`payment_url`)
 * - **微信 Native** —— 扫的二维码(`payment_qr_code_url`)
 *
 * 所以「重新获取付款入口」返回的不是一个 URL,而是「链接 + 二维码」两个可能
 * 有值的字段 —— 有一个不是 null 就算成功。
 *
 * ## 分两条路
 *
 * | 订单的 `payment_channel` | 走哪条 |
 * |---|---|
 * | `wechat` / `alipay` / `shopify` | 新路:按通道建一次新的支付会话 |
 * | `stripe` / null | 旧路:Sellbase 订单 + Stripe 链接(过渡期并行) |
 *
 * ## 重建时用**存下来的**行,不重算价
 *
 * `storefront_order_item` 里存着下单那一刻的折后单价 —— 重建支付会话时用它
 * 当单价。**不重新定价**:用户下单时看到并同意的是那个价,后来改了定价规则
 * 也不该让他的订单变贵(或者变便宜)。
 *
 * 旧路的 `variantId` 也存下来了 —— Sellbase 的载体变体 id,重建时直接用,
 * 不用再去解析一遍目录。新路不需要载体(价是本仓库自己给的)。
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  type StorefrontOrderItemRow,
  type StorefrontOrderRow,
  storefrontOrder,
} from "@/db/schema";
import {
  getPaymentProvider,
  listAvailablePaymentChannels,
} from "@/features/payments/lib/registry";
import type {
  OnlinePaymentChannel,
  PaymentRequest,
  PaymentRequestItem,
} from "@/features/payments/lib/types";
import { backfillSellbaseCustomerId } from "@/features/sellbase/lib/customer";
import {
  isSellbaseConfigured,
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
} from "./checkout-url";
import { classifyPaymentIssue } from "./payment-issue";

/** 一次「重新获取付款入口」的结果 */
export type StorefrontPaymentLinkResult =
  | {
      ok: true;
      /** 跳转地址(微信是 null —— 微信是扫码) */
      paymentUrl: string | null;
      /** 微信扫码的二维码内容 */
      paymentQrCodeUrl: string | null;
    }
  | {
      ok: false;
      code:
        | "ALREADY_PAID"
        | "ORDER_REFUNDED"
        | "LINK_FAILED"
        | "PAYMENT_NOT_CONFIGURED"
        | "CARRIER_MISSING";
    };

/**
 * 收款通道是不是根本没配好
 *
 * 「没配好」跟「调用失败」要分开报:没配好的时候用户点多少次「重新获取
 * 支付链接」都是同一个结果,提示得让他去找工作室,而不是让他重试。
 *
 * 分类逻辑跟结算那边共用一个(`payment-issue.ts`)—— 两边口径不能不一样。
 */
function isConfigMissing(error: unknown): boolean {
  return classifyPaymentIssue(error) === "PAYMENT_NOT_CONFIGURED";
}

/** 新路的三个通道 */
function isNewChannel(
  channel: string | null | undefined
): channel is OnlinePaymentChannel {
  return channel === "wechat" || channel === "alipay" || channel === "shopify";
}

/**
 * 拿(或者重拿)付款入口
 */
export async function ensureStorefrontOrderPaymentLink(
  order: StorefrontOrderRow,
  items: StorefrontOrderItemRow[]
): Promise<StorefrontPaymentLinkResult> {
  // 已付的、已退款的、已发货的 —— 都不再发入口
  if (order.paymentStatus === "paid" || order.status === "fulfilled") {
    return { ok: false, code: "ALREADY_PAID" };
  }
  if (order.paymentStatus === "refunded") {
    return { ok: false, code: "ORDER_REFUNDED" };
  }

  // 新路(微信 / 支付宝 / Shopify)—— 跟旧路完全分开
  if (isNewChannel(order.paymentChannel)) {
    return ensureNewChannelPaymentLink(order, items);
  }

  // `payment_channel` 是 null 的单 = 建单时压根没定通道(比如建单那一刻
  // 没有可用的线上通道)。这种单按**新路**处理 —— 走第一个「开放了而且配好了」
  // 的通道,别掉回旧路(旧路已经不再接新单了)。
  if (order.paymentChannel === null) {
    const fallback = listAvailablePaymentChannels()[0];
    if (!fallback) {
      return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
    }
    return ensureNewChannelPaymentLink(order, items, fallback.channel);
  }

  // `offline` 的单是**线下**收款(工作室后台手动标的)—— 不给线上入口。
  if (order.paymentChannel === "offline") {
    return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
  }

  // 旧路:Sellbase + Stripe(过渡期并行)
  //
  // 只接**已经建好的旧单** —— 新单不再走它(见 `checkout.ts` 的
  // `resolveCheckoutChannel`)。
  //
  // 收款通道没配好 —— 后面所有调用都会失败,直接说清楚
  if (!isSellbaseConfigured()) {
    return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
  }

  if (order.paymentUrl) {
    return { ok: true, paymentUrl: order.paymentUrl, paymentQrCodeUrl: null };
  }

  // 有 Sellbase 订单 → 换一张链接
  if (order.sellbaseOrderId) {
    try {
      const url = await createSellbasePaymentLink(order.sellbaseOrderId);
      await db
        .update(storefrontOrder)
        .set({ paymentUrl: url, updatedAt: new Date() })
        .where(eq(storefrontOrder.id, order.id));
      return { ok: true, paymentUrl: url, paymentQrCodeUrl: null };
    } catch (error) {
      console.error(`[storefront] ${order.orderNo} 重取支付链接失败`, error);
      if (isConfigMissing(error)) {
        return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
      }
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
    return { ok: true, paymentUrl: created.paymentUrl, paymentQrCodeUrl: null };
  } catch (error) {
    console.error(
      `[storefront] ${order.orderNo} 重建 Sellbase 订单失败`,
      error
    );
    if (isConfigMissing(error)) {
      return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
    }
    return { ok: false, code: "LINK_FAILED" };
  }
}

/**
 * 新路 —— 按订单行重建一次支付会话
 *
 * 用**存下来的**折后单价,不重新定价(理由见文件头)。
 *
 * `channelOverride` —— 订单上没记通道(`payment_channel` 是 null)时用这个
 * 兜底(调用方挑的那个「开放了而且配好了」的通道)。
 */
async function ensureNewChannelPaymentLink(
  order: StorefrontOrderRow,
  items: StorefrontOrderItemRow[],
  channelOverride?: OnlinePaymentChannel
): Promise<StorefrontPaymentLinkResult> {
  const channel = channelOverride ?? order.paymentChannel;
  if (!isNewChannel(channel)) {
    return { ok: false, code: "LINK_FAILED" };
  }

  const provider = getPaymentProvider(channel);
  if (!provider || !provider.isConfigured()) {
    return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
  }

  // 已经有入口了 —— 直接用
  //
  // 微信这一支**只能复用**:`out_trade_no` 在微信侧唯一,同一张单再建第二个
  // Native 会话会被拒(OUT_TRADE_NO_USED),没有「刷新二维码」这条路。
  // 支付宝 / Shopify 的跳转地址重新建一个也不费事,但复用更省一次调用。
  if (order.paymentUrl || order.paymentQrCodeUrl) {
    return {
      ok: true,
      paymentUrl: order.paymentUrl,
      paymentQrCodeUrl: order.paymentQrCodeUrl,
    };
  }

  const requestItems: PaymentRequestItem[] = items.map((item) => ({
    title: item.productTitle,
    quantity: item.quantity,
    unitPriceCents: item.discountedUnitPriceCents,
    sku: item.sku ?? item.productHandle,
    attributes: {},
  }));

  const address = order.shippingAddress;
  const request: PaymentRequest = {
    orderNo: order.orderNo,
    email: order.email,
    items: requestItems,
    shippingCents: order.shippingCents,
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

  try {
    const session = await provider.createSession(request);

    await db
      .update(storefrontOrder)
      .set({
        providerOrderId: session.providerOrderId,
        paymentUrl: session.redirectUrl,
        paymentQrCodeUrl: session.qrCodeUrl,
        // 订单上原本没记通道的(建单那一刻没有可用的线上通道)—— 把这次用的
        // 通道记下来。下次再取入口走的是同一条通道,不会换。
        ...(order.paymentChannel ? {} : { paymentChannel: channel }),
        updatedAt: new Date(),
      })
      .where(eq(storefrontOrder.id, order.id));

    if (!session.redirectUrl && !session.qrCodeUrl) {
      return { ok: false, code: "LINK_FAILED" };
    }
    return {
      ok: true,
      paymentUrl: session.redirectUrl,
      paymentQrCodeUrl: session.qrCodeUrl,
    };
  } catch (error) {
    console.error(
      `[storefront] ${order.orderNo} 重建 ${channel} 支付会话失败`,
      error
    );
    if (isConfigMissing(error)) {
      return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
    }
    return { ok: false, code: "LINK_FAILED" };
  }
}
