/**
 * Shopify 订单查询 —— **字段名要扛得住 API 版本**
 *
 * ## 为什么单开一个文件
 *
 * 退款回调(`refunds/create`)的报文里只有 `order_id`,得回 Shopify 把那张订单
 * 拉出来 —— 靠订单里的 `tags` / `note` / 行项目属性认出「这单是我们的」。
 * 那条查询要读**行项目属性**,而这个字段有两个名字:
 *
 * - `LineItem.customAttributes` —— 新字段(2024-10 起)
 * - `LineItem.properties` —— 老字段(2024-10 起被标记弃用,后来被删)
 *
 * **哪个在不在,取决于店铺实际用的那个 API 版本。** 选了一个当前版本没有的
 * 字段,GraphQL 的验证是**全有全无**的 —— 整条查询直接不执行,报的是
 * 「Field 'xxx' doesn't exist on type 'LineItem'」。
 *
 * 同一个坑 2026-11-05 在 `draftOrderCreate` 的 `userErrors.code` 上栽过。
 *
 * 纯模块 + 桩 fetch:不碰 DB、不碰真网络。跑在 unit project 里。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ClientModule =
  typeof import("@/features/payments/providers/shopify/client");
type TypesModule = typeof import("@/features/payments/lib/types");

const ENV_KEYS = [
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SHOPIFY_ADMIN_ACCESS_TOKEN",
  "SHOPIFY_API_SECRET",
] as const;

const ORIGINAL_ENV = { ...process.env };

function setEnv(vars: Partial<Record<string, string | undefined>>): void {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) continue;
    process.env[key] = value;
  }
}

beforeEach(() => {
  setEnv({
    SHOPIFY_STORE_DOMAIN: "demo-shop.myshopify.com",
    SHOPIFY_CLIENT_ID: "client-id-123",
    SHOPIFY_CLIENT_SECRET: "client-secret-456",
    // 永久 token —— 免得每个用例都去换一次 grant
    SHOPIFY_ADMIN_ACCESS_TOKEN: "shpat_permanent",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

async function loadClient(): Promise<{
  client: ClientModule;
  types: TypesModule;
}> {
  vi.resetModules();
  const client = await import("@/features/payments/providers/shopify/client");
  const types = await import("@/features/payments/lib/types");
  return { client, types };
}

/** 一次 GraphQL 调用的记录 */
interface Call {
  query: string;
}

interface StubOptions {
  /**
   * 按次序返回的响应
   *
   * 第一个响应里带 `errors` → 模拟 GraphQL 验证错误(Shopify 对验证错误
   * 是 HTTP 200 + 报错数组)。
   */
  responses: Array<
    { kind: "data"; data: unknown } | { kind: "errors"; messages: string[] }
  >;
}

/** 桩 fetch:按次序把响应发出去,并记下每次发了什么 query */
function stubGraphql(options: StubOptions): Call[] {
  const calls: Call[] = [];
  let index = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string };
      calls.push({ query: body.query });

      const response =
        options.responses[Math.min(index, options.responses.length - 1)];
      index += 1;

      if (!response) {
        return new Response(JSON.stringify({ data: null }), { status: 200 });
      }
      if (response.kind === "errors") {
        return new Response(
          JSON.stringify({
            errors: response.messages.map((message) => ({ message })),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ data: response.data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );

  return calls;
}

/** 订单查询的返回体 —— 行项目属性按新字段给 */
function orderDataWithCustomAttributes(): unknown {
  return {
    order: {
      id: "gid://shopify/Order/1",
      name: "#1001",
      note: "mooncoda:SO-20261105-942D88",
      tags: ["mooncoda:SO-20261105-942D88"],
      financialStatus: "REFUNDED",
      lineItems: {
        edges: [
          {
            node: {
              customAttributes: [
                { key: "订单号", value: "SO-20261105-942D88" },
                { key: "SKU", value: "RM-6" },
              ],
            },
          },
        ],
      },
    },
  };
}

/** 订单查询的返回体 —— 行项目属性按老字段给 */
function orderDataWithProperties(): unknown {
  return {
    order: {
      id: "gid://shopify/Order/1",
      name: "#1001",
      note: "mooncoda:SO-20261105-942D88",
      tags: ["mooncoda:SO-20261105-942D88"],
      financialStatus: "REFUNDED",
      lineItems: {
        edges: [
          {
            node: {
              properties: [
                { name: "订单号", value: "SO-20261105-942D88" },
                { name: "SKU", value: "RM-6" },
              ],
            },
          },
        ],
      },
    },
  };
}

describe("buildOrderQuery —— 两个字段名都留着", () => {
  it("新写法问 customAttributes", async () => {
    const { client } = await loadClient();
    const query = client.buildOrderQuery("customAttributes");
    expect(query).toContain("customAttributes { key value }");
    expect(query).not.toContain("properties {");
  });

  it("老写法问 properties", async () => {
    const { client } = await loadClient();
    const query = client.buildOrderQuery("properties");
    expect(query).toContain("properties { name value }");
    expect(query).not.toContain("customAttributes");
  });
});

describe("fetchShopifyOrder —— 新 API 版本", () => {
  it("行项目属性读 customAttributes,统一成 {name, value}", async () => {
    const calls = stubGraphql({
      responses: [{ kind: "data", data: orderDataWithCustomAttributes() }],
    });

    const { client } = await loadClient();
    const order = await client.fetchShopifyOrder("gid://shopify/Order/1");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toContain("customAttributes");
    expect(order?.lineItemProperties).toEqual([
      { name: "订单号", value: "SO-20261105-942D88" },
      { name: "SKU", value: "RM-6" },
    ]);
  });
});

describe("fetchShopifyOrder —— 老 API 版本(没有 customAttributes)", () => {
  it("报「字段不存在」→ 换 properties 再来一次", async () => {
    const calls = stubGraphql({
      responses: [
        {
          kind: "errors",
          messages: [
            "Field 'customAttributes' doesn't exist on type 'LineItem'",
          ],
        },
        { kind: "data", data: orderDataWithProperties() },
      ],
    });

    const { client } = await loadClient();
    const order = await client.fetchShopifyOrder("gid://shopify/Order/1");

    expect(calls).toHaveLength(2);
    expect(calls[0]?.query).toContain("customAttributes");
    expect(calls[1]?.query).toContain("properties { name value }");
    expect(order?.lineItemProperties).toEqual([
      { name: "订单号", value: "SO-20261105-942D88" },
      { name: "SKU", value: "RM-6" },
    ]);
  });

  it("**不是**字段不存在的错误 → 不重试,原样往上抛", async () => {
    const calls = stubGraphql({
      responses: [
        {
          kind: "errors",
          messages: ["Access denied for resource type GraphqlAdminOperation"],
        },
      ],
    });

    const { client, types } = await loadClient();
    await expect(
      client.fetchShopifyOrder("gid://shopify/Order/1")
    ).rejects.toThrow(types.PaymentProviderError);

    // 只发了一次 —— 别拿老字段再试一遍(那只是白跑一趟,还会把真正的错误盖住)
    expect(calls).toHaveLength(1);
  });

  it("换写法之后还是失败 → 那个错才是真的", async () => {
    stubGraphql({
      responses: [
        {
          kind: "errors",
          messages: [
            "Field 'customAttributes' doesn't exist on type 'LineItem'",
          ],
        },
        {
          kind: "errors",
          messages: ["Field 'properties' doesn't exist on type 'LineItem'"],
        },
      ],
    });

    const { client, types } = await loadClient();
    await expect(
      client.fetchShopifyOrder("gid://shopify/Order/1")
    ).rejects.toThrow(types.PaymentProviderError);
  });
});

describe("isUnknownFieldError —— 只认 GraphQL 的验证错误", () => {
  it("「字段不存在」认", async () => {
    const { client, types } = await loadClient();
    expect(
      client.isUnknownFieldError(
        new types.PaymentProviderError(
          "shopify",
          "Field 'customAttributes' doesn't exist on type 'LineItem'"
        )
      )
    ).toBe(true);
  });

  it("别的错不认", async () => {
    const { client, types } = await loadClient();
    expect(
      client.isUnknownFieldError(
        new types.PaymentProviderError("shopify", "Access denied")
      )
    ).toBe(false);
    expect(client.isUnknownFieldError(new Error("boom"))).toBe(false);
  });
});
