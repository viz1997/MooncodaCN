/**
 * Shopify webhook → 本地订单状态
 *
 * ## 三种 topic
 *
 * | topic | 干什么 |
 * |---|---|
 * | `orders/paid` | 草稿单被付了 → 标已付 |
 * | `orders/cancelled` | 订单被取消 → 标取消 |
 * | `refunds/create` | 退款 → **只**改支付状态(订单状态不动) |
 *
 * ## 退款回调要多走一步
 *
 * `refunds/create` 的报文是**退款单**,里面没有我们的订单号 —— 只有
 * `order_id`。所以要回 Admin API 把那张订单拉出来,再从它的 note / tags /
 * 行项目属性里找订单号。
 *
 * ## 认订单号的纯函数在另一个文件
 *
 * `order-reference.ts`(零 DB、零网络)—— 这样它能进 `unit` project,单测直接
 * 喂报文。
 */

import { settleByOrderNo } from "@/features/payments/lib/settle";

import { fetchShopifyOrder } from "./client";
import {
  classifyShopifyTopic,
  extractShopifyOrderNo,
  type ShopifyWebhookOrder,
  toOrderReference,
} from "./order-reference";

/** Shopify 推过来的退款(REST 形状) */
export interface ShopifyWebhookRefund {
  id?: number | string;
  order_id?: number | string;
  note?: string | null;
}

/** 处理结果 */
export interface ShopifyWebhookResult {
  ok: boolean;
  changed: boolean;
  orderNo: string | null;
  reason?: string;
}

/**
 * 处理一条 Shopify webhook
 *
 * 认不出来的一律当无事发生(`ok: true, changed: false`)—— 回 4xx 的话
 * Shopify 会一直重投,把这个端点打成噪音源。
 */
export async function handleShopifyWebhook(params: {
  topic: string;
  payload: unknown;
}): Promise<ShopifyWebhookResult> {
  const { topic, payload } = params;

  if (topic === "refunds/create") {
    return handleRefund(payload as ShopifyWebhookRefund);
  }

  const order = payload as ShopifyWebhookOrder;
  const action = classifyShopifyTopic(topic, order);
  if (action.kind === "ignore") {
    return { ok: true, changed: false, orderNo: null, reason: action.reason };
  }

  const orderNo = extractShopifyOrderNo(toOrderReference(order));
  if (!orderNo) {
    return {
      ok: true,
      changed: false,
      orderNo: null,
      reason: "Shopify 回调里找不到我们的订单号",
    };
  }

  const result = await settleByOrderNo({
    orderNo,
    action: action.kind,
    channel: "shopify",
    providerOrderId: order.id != null ? String(order.id) : null,
  });

  return {
    ok: result.ok,
    changed: result.changed,
    orderNo: result.orderNo,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

/**
 * 退款回调 —— 报文里只有 `order_id`,得回 Shopify 把那张订单拉出来
 */
async function handleRefund(
  refund: ShopifyWebhookRefund
): Promise<ShopifyWebhookResult> {
  const orderId = refund.order_id;
  if (orderId == null) {
    return {
      ok: true,
      changed: false,
      orderNo: null,
      reason: "退款报文里没有 order_id",
    };
  }

  const order = await fetchShopifyOrder(String(orderId));
  if (!order) {
    return {
      ok: true,
      changed: false,
      orderNo: null,
      reason: `Shopify 上没有订单 ${orderId}`,
    };
  }

  const orderNo = extractShopifyOrderNo({
    note: order.note,
    tags: order.tags,
    properties: order.lineItemProperties,
  });
  if (!orderNo) {
    return {
      ok: true,
      changed: false,
      orderNo: null,
      reason: `订单 ${orderId} 里找不到我们的订单号`,
    };
  }

  const result = await settleByOrderNo({
    orderNo,
    action: "mark_refunded",
    channel: "shopify",
    providerOrderId: order.id,
  });

  return {
    ok: result.ok,
    changed: result.changed,
    orderNo: result.orderNo,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}
