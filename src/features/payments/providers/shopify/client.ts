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
  // **要 await** —— 新模型下 token 是 client credentials grant 换来的
  // (24 小时有效),第一次调用要先去换一次。这个 `await` 在 try 外面 ——
  // 换 token 失败要保留它自己的错误分类(4xx = 没配好,5xx = 这次挂了),
  // 别被下面这个 catch 统统改成「请求没发出去」。
  const token = await getShopifyAdminToken();

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
    const detail = body.slice(0, 500);

    // 401 / 403 = 凭据或权限不对 —— token 被拒、scope 不够、app 没装在店铺上。
    // **重试没用**,得改配置(app 的 scope / 安装状态 / 凭据)。
    // 归错类很重要:归成「这次挂了」的话,界面会一直让用户点「重试」,
    // 而重一百次也是一样的结果。见 `@/features/storefront/lib/payment-issue.ts`。
    if (response.status === 401 || response.status === 403) {
      throw new ShopifyNotConfiguredError(
        `Shopify 拒绝了这次请求(HTTP ${response.status})：${detail}` +
          "—— 检查 app 的 scope(read_orders / write_orders)、" +
          "app 有没有装在店铺上、凭据对不对"
      );
    }

    // 429 / 5xx = Shopify 那边的问题 —— 重试有用
    throw new PaymentProviderError(
      "shopify",
      `Shopify 返回 HTTP ${response.status}`,
      { cause: detail }
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
 * 店铺的币种信息
 *
 * - `currencyCode` —— 店铺的**结算币种**(钱最终落在哪个币种账户里)
 * - `enabledPresentmentCurrencies` —— 店铺**启用的展示币种**(Markets)
 *
 * **为什么要读**:草稿订单的展示币种(`presentmentCurrencyCode`)得从这两
 * 个里挑 —— 挑一个我们能原样送过去的(我们的价是美元)。
 */
export interface ShopCurrencyInfo {
  currencyCode: string;
  enabledPresentmentCurrencies: string[];
}

/**
 * 读店铺的币种信息
 *
 * 读一次缓存住 —— 一个部署的店铺币种不会变(Markets 改了会重启进程,
 * 缓存自然失效)。
 */
let cachedCurrency: ShopCurrencyInfo | null = null;

export async function getShopCurrencyInfo(): Promise<ShopCurrencyInfo> {
  if (cachedCurrency) return cachedCurrency;

  const data = await shopifyGraphql<{
    shop: { currencyCode: string; enabledPresentmentCurrencies: string[] };
  }>(
    `query ShopCurrency {
      shop {
        currencyCode
        enabledPresentmentCurrencies
      }
    }`,
    {}
  );
  cachedCurrency = {
    currencyCode: data.shop.currencyCode.toUpperCase(),
    enabledPresentmentCurrencies: data.shop.enabledPresentmentCurrencies,
  };
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

/**
 * 行项目属性的字段名 —— **看 API 版本**
 *
 * `LineItem.customAttributes` 是新字段(2024-10 起),`LineItem.properties` 是
 * 老字段(2024-10 起被标记弃用,后来被删)。
 *
 * **哪个在不在,取决于实际用的那个 API 版本** —— 选了一个当前版本没有的字段,
 * 整条查询验证不过(跟 `draftOrderCreate` 上 `code` 那个坑一模一样:GraphQL
 * 的验证是全有全无的,一个字段不认,整条查询就不执行)。
 *
 * 所以两份都留着:先用新的,报「字段不存在」就换老的。
 */
export type ShopifyLineItemAttrField = "customAttributes" | "properties";

/** 按字段名拼订单查询 */
export function buildOrderQuery(attrField: ShopifyLineItemAttrField): string {
  const attrs =
    attrField === "customAttributes"
      ? "customAttributes { key value }"
      : "properties { name value }";
  return `
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
            ${attrs}
          }
        }
      }
    }
  }
`;
}

interface OrderQueryResult {
  order: {
    id: string;
    name: string | null;
    note: string | null;
    tags: string[] | string | null;
    financialStatus: string | null;
    lineItems: {
      edges: {
        node: {
          /** 新字段(2024-10+) */
          customAttributes?: { key: string; value: string | null }[] | null;
          /** 老字段(2024-10 之前) */
          properties?: { name: string; value: string | null }[] | null;
        };
      }[];
    };
  } | null;
}

/**
 * 「这个字段当前版本没有」 —— GraphQL 的验证错误
 *
 * Shopify 的话术是 `Field 'customAttributes' doesn't exist on type 'LineItem'`。
 *
 * **只认这一类错误** —— 别的(凭据不对、网络不通、订单不存在)直接往上抛,
 * 别拿老字段再试一遍(那只是白跑一趟，还会把真正的错误盖住）。
 */
export function isUnknownFieldError(error: unknown): boolean {
  if (!(error instanceof PaymentProviderError)) return false;
  return /doesn't exist on type|is not defined by type|Unknown field/i.test(
    error.message
  );
}

/**
 * 「字段形状对不上」—— 验证错误 **或** 变量强制转换错误
 *
 * 这两类错误说明**我们发的字段名或字段类型跟当前 API 版本不匹配**:
 *
 * - `Field 'price' is not defined by type 'DraftOrderLineItemInput'` —— 字段名
 * - `invalid money '{"amount" => "6.99", "currencyCode" => "USD"}'` —— 字段类型
 *
 * 碰到这种错误,重发一份**形状不一样**的 payload 有可能就过了(见
 * `draft-order.ts` 的「写法阶梯」)。
 *
 * **只认这一类** —— 别的(凭据不对、金额对不上)原样往上抛:拿另一种写法再试
 * 一遍只是白跑一趟,还会把真正的错误盖住。
 */
export function isFieldShapeError(error: unknown): boolean {
  if (!(error instanceof PaymentProviderError)) return false;
  return /doesn't exist on type|is not defined by type|Unknown field|invalid money/i.test(
    error.message
  );
}

/**
 * 按订单 id 拉一张订单
 *
 * Shopify 的 `tags` 在 GraphQL 里是 `[String!]`,但 REST 返回的是逗号分隔的
 * 字符串 —— 两种都兜住。
 *
 * 行项目属性走**两个字段名**(见 `buildOrderQuery`):先用 `customAttributes`,
 * 当前 API 版本不认的话换 `properties` 再来一次。
 */
export async function fetchShopifyOrder(
  orderId: string
): Promise<ShopifyOrderSnapshot | null> {
  let data: OrderQueryResult;
  try {
    data = await shopifyGraphql<OrderQueryResult>(
      buildOrderQuery("customAttributes"),
      { id: orderId }
    );
  } catch (error) {
    // 只有「字段不存在」才换写法 —— 别的错误原样往上抛
    if (!isUnknownFieldError(error)) throw error;
    data = await shopifyGraphql<OrderQueryResult>(
      buildOrderQuery("properties"),
      { id: orderId }
    );
  }

  const order = data.order;
  if (!order) return null;

  const tags = Array.isArray(order.tags)
    ? order.tags.join(",")
    : (order.tags ?? "");

  // 两种字段的形状不一样(`{key}` / `{name}`),统一成 `{name, value}`
  const properties: { name: string; value: string }[] = [];
  for (const edge of order.lineItems.edges) {
    const node = edge.node;
    for (const attr of node.customAttributes ?? []) {
      if (attr.key && attr.value != null) {
        properties.push({ name: attr.key, value: attr.value });
      }
    }
    for (const property of node.properties ?? []) {
      if (property.name && property.value != null) {
        properties.push({ name: property.name, value: property.value });
      }
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
