/**
 * Sellbase webhook 事件 → 本地动作
 *
 * Sellbase 的事件白名单(`WEBHOOK_EVENTS`,sellbase-webhooks/index.js:49499):
 * `order.created` / `order.paid` / `order.deposit_paid` / `order.cancelled` /
 * `payment.succeeded` / `refund.created` / `fulfillment.shipped` /
 * `booking.rescheduled` / `booking.cancelled` / `product.created` /
 * `product.updated` / `product.archived` / `inventory.oversold`
 *
 * 本仓库只关心跟**收款**有关的 4 个。其余的一律忽略 —— 而且**必须回
 * 200**:回 4xx 的话 Sellbase 会一直重投,把这个端点打成噪音源。
 *
 * 这里是纯函数(不碰 DB),单测直接喂事件。
 */

/** 本仓库订阅的事件 */
export const SELLBASE_SUBSCRIBED_EVENTS = [
  "order.paid",
  "payment.succeeded",
  "order.cancelled",
  "refund.created",
] as const;

export type SellbaseSubscribedEvent =
  (typeof SELLBASE_SUBSCRIBED_EVENTS)[number];

/** Sellbase 投递的 webhook 体 */
export interface SellbaseWebhookPayload {
  /** 事件 id(Sellbase 侧的幂等键) */
  id: string;
  /** 事件类型 */
  type: string;
  /** 事件创建时间(ISO) */
  created_at?: string;
  /** 店铺 id */
  store_id?: string;
  data?: {
    /** 实体类型:order / product / booking */
    entity?: string;
    /** 实体 id(订单就是订单 id) */
    entity_id?: string | null;
    /** 事件细节 */
    details?: unknown;
    /** 订单实体(order 类事件才有) */
    order?: {
      id?: string;
      number?: number;
      email?: string;
      status?: string;
      payment_status?: string;
      total_amount?: number;
      amount_paid?: number;
      amount_refunded?: number;
      currency?: string;
      [key: string]: unknown;
    } | null;
  } | null;
}

/** 本地要做的动作 */
export type SellbasePaymentAction =
  /** 订单已收款 —— 本地标成 paid */
  | { kind: "mark_paid"; amountPaid: number | null; currency: string | null }
  /** 订单被取消 */
  | { kind: "mark_cancelled" }
  /** 退款 */
  | { kind: "mark_refunded"; amountRefunded: number | null }
  /** 不关心的 / 认不出来的 */
  | { kind: "ignore"; reason: string };

/**
 * 把事件类型翻译成本地动作
 *
 * `order.paid` 和 `payment.succeeded` 都映射成 `mark_paid` —— 两边都会
 * 发,靠本地状态机幂等(已经是 paid 就 no-op)。
 */
export function classifySellbaseEvent(
  type: string,
  payload?: SellbaseWebhookPayload
): SellbasePaymentAction {
  const order = payload?.data?.order;

  switch (type) {
    case "order.paid":
    case "payment.succeeded": {
      const amountPaid =
        typeof order?.amount_paid === "number"
          ? order.amount_paid
          : typeof order?.total_amount === "number"
            ? order.total_amount
            : null;
      return {
        kind: "mark_paid",
        amountPaid,
        currency: typeof order?.currency === "string" ? order.currency : null,
      };
    }

    case "order.cancelled":
      return { kind: "mark_cancelled" };

    case "refund.created": {
      const amountRefunded =
        typeof order?.amount_refunded === "number"
          ? order.amount_refunded
          : null;
      return { kind: "mark_refunded", amountRefunded };
    }

    default:
      return {
        kind: "ignore",
        reason: `不关心的事件类型:${type}`,
      };
  }
}

/**
 * 从事件里取出 Sellbase 订单 id
 *
 * 本地订单表存了 `sellbase_order_id`,webhook 靠它反查。取不到就返回
 * null —— 调用方回 200 忽略(总比回 500 让 Sellbase 一直重投强)。
 */
export function extractSellbaseOrderId(
  payload: SellbaseWebhookPayload | null | undefined
): string | null {
  const fromOrder = payload?.data?.order?.id;
  if (typeof fromOrder === "string" && fromOrder) return fromOrder;

  const fromEntity = payload?.data?.entity_id;
  if (typeof fromEntity === "string" && fromEntity) return fromEntity;

  return null;
}
