/**
 * Shopify 回调报文 —— **纯函数**(零 DB、零网络)
 *
 * 单独一个文件是为了让它能进 `unit` project:跟 webhook 的落库部分分开,
 * 单测直接喂报文,不用连数据库。
 *
 * ## 认订单靠「我们自己的订单号」
 *
 * Shopify 的单号是它自己的(`gid://shopify/Order/123`、订单名 `#1001`),
 * 对不上我们这边的 `SO-…` / `PO-…`。所以订单号在建草稿单的时候就被写进了
 * **三个地方**(tags / note / 行项目属性),回调挨个试 —— 哪个先命中用哪个。
 *
 * 之所以要三个来源:Shopify 在不同环节对这几个字段的处理不完全一致(比如
 * 草稿单转正式订单时有的字段会带过来、有的要看版本),多一个来源多一条命。
 */

/** 我们的订单号 —— `SO-20261105-942D88` / `PO-20261105-942D88` */
const ORDER_NO_PATTERN = /\b(SO|PO)-\d{8}-[0-9A-F]{6}\b/;

/** 行项目属性 / note 的键名 —— 建草稿单时写死的,两边要对得上 */
export const SHOPIFY_ORDER_NO_PROPERTY = "订单号";

/** Shopify 推过来的订单(REST 形状) */
export interface ShopifyWebhookOrder {
  id?: number | string;
  name?: string | null;
  note?: string | null;
  tags?: string | string[] | null;
  financial_status?: string | null;
  line_items?:
    | {
        title?: string;
        quantity?: number;
        price?: string;
        properties?: { name?: string; value?: string }[] | null;
      }[]
    | null;
}

/** 找订单号要看的三个地方 */
export interface ShopifyOrderReference {
  note: string | null;
  tags: string;
  properties: { name: string; value: string }[];
}

/** 从一段文字里找订单号 */
export function findOrderNoInText(
  text: string | null | undefined
): string | null {
  if (!text) return null;
  const match = ORDER_NO_PATTERN.exec(text);
  return match ? match[0] : null;
}

/**
 * 从订单里把我们的订单号挖出来
 *
 * 三个来源挨个试:tags → 行项目属性 → note。
 */
export function extractShopifyOrderNo(
  reference: ShopifyOrderReference
): string | null {
  // 1. tags —— 建单时写的 `mooncoda:SO-…`
  for (const tag of reference.tags.split(",")) {
    const found = findOrderNoInText(tag);
    if (found) return found;
  }

  // 2. 行项目属性 —— 键名是「订单号」
  for (const property of reference.properties) {
    if (property.name === SHOPIFY_ORDER_NO_PROPERTY) {
      const found = findOrderNoInText(property.value);
      if (found) return found;
    }
  }

  // 3. 兜底:任何属性值 / note
  for (const property of reference.properties) {
    const found = findOrderNoInText(property.value);
    if (found) return found;
  }

  return findOrderNoInText(reference.note);
}

/** 把 REST 的订单报文转成「找订单号」要用的形状 */
export function toOrderReference(
  order: ShopifyWebhookOrder
): ShopifyOrderReference {
  const properties: { name: string; value: string }[] = [];
  for (const item of order.line_items ?? []) {
    for (const property of item.properties ?? []) {
      if (property.name && property.value) {
        properties.push({ name: property.name, value: property.value });
      }
    }
  }

  const tags = Array.isArray(order.tags)
    ? order.tags.join(",")
    : (order.tags ?? "");

  return {
    note: order.note ?? null,
    tags,
    properties,
  };
}

/** 回调能触发的动作 */
export type ShopifyWebhookAction =
  | { kind: "mark_paid" }
  | { kind: "mark_refunded" }
  | { kind: "mark_cancelled" }
  | { kind: "ignore"; reason: string };

/**
 * 把 topic 翻成本地动作
 *
 * `orders/paid` 还要看一眼 `financial_status` —— 少数场景下这个 topic 会在
 * 钱还没落定的时候发出来(比如部分付款),那时候不能标已付。
 */
export function classifyShopifyTopic(
  topic: string,
  order: ShopifyWebhookOrder
): ShopifyWebhookAction {
  switch (topic) {
    case "orders/paid": {
      const status = order.financial_status ?? "paid";
      if (status !== "paid" && status !== "partially_paid") {
        return {
          kind: "ignore",
          reason: `financial_status=${status},钱还没到账`,
        };
      }
      return { kind: "mark_paid" };
    }
    case "orders/cancelled":
      return { kind: "mark_cancelled" };
    case "refunds/create":
      return { kind: "mark_refunded" };
    default:
      return { kind: "ignore", reason: `不关心的 topic:${topic}` };
  }
}
