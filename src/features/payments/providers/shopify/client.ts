/**
 * Shopify Admin GraphQL 客户端
 *
 * 只用 **Admin API** —— Storefront API 那套(购物车 / Checkout)本仓库用不上,
 * 原因见 `env.ts` 的文件头(逐分相等那条硬约束)。
 *
 * ## 三条纪律
 *
 * 1. **token 只在服务端读** —— 绝不进客户端 bundle。
 * 2. **失败要能分清「没配好」和「这次挂了」** —— 前者抛
 *    `PaymentNotConfiguredError`,后者抛 `PaymentProviderError`。用户看到的
 *    话术不一样(见 `@/features/storefront/lib/payment-issue.ts`)。
 * 3. **Shopify 报错了要带原文** —— `userErrors` 里的 `message` 往往是唯一
 *    能看出「自动折扣把价改了」这种线索的地方,不能吞掉。
 */

import { PaymentProviderError } from "@/features/payments/lib/types";

import {
  getShopifyAdminToken,
  getShopifyGraphqlUrl,
  ShopifyNotConfiguredError,
} from "./env";

/** GraphQL 返回体 */
interface GraphqlEnvelope<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * 发一次 GraphQL 请求
 *
 * `variables` 原样传 JSON —— GraphQL 的变量类型在查询里声明,这里不校验。
 */
export async function shopifyGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const url = getShopifyGraphqlUrl();
  const token = getShopifyAdminToken();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
  } catch (error) {
    throw new PaymentProviderError("shopify", "Shopify 请求没发出去", {
      cause: error,
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new PaymentProviderError(
      "shopify",
      `Shopify 返回 HTTP ${response.status}`,
      { cause: body.slice(0, 500) }
    );
  }

  const envelope = (await response.json()) as GraphqlEnvelope<T>;

  if (envelope.errors && envelope.errors.length > 0) {
    throw new PaymentProviderError(
      "shopify",
      envelope.errors.map((e) => e.message).join("; ")
    );
  }

  if (!envelope.data) {
    throw new PaymentProviderError("shopify", "Shopify 没有返回 data");
  }

  return envelope.data;
}

/**
 * 读店铺的结算币种
 *
 * **为什么要读**:草稿订单的金额是按店铺币种算的。我们的订单也是按店铺币种
 * 算的 —— 两者必须一致,否则「逐分相等」直接破了(¥100 的单子被当成 $100
 * 收,数字对得上但钱不对)。
 *
 * 读一次缓存住 —— 一个部署的店铺币种不会变。
 */
let cachedCurrency: string | null = null;

export async function getShopCurrency(): Promise<string> {
  if (cachedCurrency) return cachedCurrency;

  const data = await shopifyGraphql<{ shop: { currencyCode: string } }>(
    "query ShopCurrency { shop { currencyCode } }",
    {}
  );
  cachedCurrency = data.shop.currencyCode.toUpperCase();
  return cachedCurrency;
}

/** 从 Shopify 拉一张订单(退款回调时用 —— 退款报文里没有我们的订单号) */
export interface ShopifyOrderSnapshot {
  id: string;
  name: string | null;
  note: string | null;
  tags: string;
  financialStatus: string | null;
  /** 行项目上的自定义属性 —— 我们的订单号也写在了这里 */
  lineItemProperties: { name: string; value: string }[];
}

const ORDER_QUERY = `
  query MooncodaOrder($id: ID!) {
    order(id: $id) {
      id
      name
      note
      tags
      financialStatus
      lineItems(first: 100) {
        edges {
          node {
            properties {
              name
              value
            }
          }
        }
      }
    }
  }
`;

interface OrderQueryResult {
  order: {
    id: string;
    name: string | null;
    note: string | null;
    tags: string[] | string | null;
    financialStatus: string | null;
    lineItems: {
      edges: {
        node: { properties: { name: string; value: string }[] };
      }[];
    };
  } | null;
}

/**
 * 按订单 id 拉一张订单
 *
 * Shopify 的 `tags` 在 GraphQL 里是 `[String!]`,但 REST 返回的是逗号分隔的
 * 字符串 —— 两种都兜住。
 */
export async function fetchShopifyOrder(
  orderId: string
): Promise<ShopifyOrderSnapshot | null> {
  const data = await shopifyGraphql<OrderQueryResult>(ORDER_QUERY, {
    id: orderId,
  });
  const order = data.order;
  if (!order) return null;

  const tags = Array.isArray(order.tags)
    ? order.tags.join(",")
    : (order.tags ?? "");

  const properties: { name: string; value: string }[] = [];
  for (const edge of order.lineItems.edges) {
    for (const property of edge.node.properties) {
      properties.push(property);
    }
  }

  return {
    id: order.id,
    name: order.name,
    note: order.note,
    tags,
    financialStatus: order.financialStatus,
    lineItemProperties: properties,
  };
}

/**
 * 把 Shopify 的报错翻成「没配好」
 *
 * Shopify 这边只有配置类错误(缺 token、缺域名);上游 5xx / 网络问题一律是
 * 「这次挂了」。
 */
export function asNotConfigured(
  error: unknown
): ShopifyNotConfiguredError | null {
  if (error instanceof ShopifyNotConfiguredError) return error;
  return null;
}
