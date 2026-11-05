/**
 * Shopify 草稿单 —— 建单那一整条链路
 *
 * ## 为什么单开一个文件
 *
 * `shopify-currency.test.ts` 钉的是**币种判定**(纯函数)。这个文件钉的是
 * **建单**:从「定了展示币种」到「跟 Shopify 对账」中间那几步 —— 那几步里
 * 藏着两个「钱」的问题:
 *
 * 1. **我们发过去的价是不是原样的** —— 人民币的价必须**一个字节都不改**
 *    地送过去。不换算是我们的架构决定(见 `currency.ts`),改一个字节就是
 *    「逐分相等」破了
 * 2. **对账要比对的那个币种** —— Shopify 的 `totalPriceSet` 有两份:
 *    `shopMoney`(结算币种)和 `presentmentMoney`(**向用户收钱的那个币种**,
 *    也就是我们发过去的行价的币种)。跟 `shopMoney` 比的话,店铺结算币种跟
 *    展示币种不同时会比错对象
 *
 * ## 不碰真网络
 *
 * `fetch` 是桩。纯模块:不碰 DB。跑在 unit project 里。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DraftOrderModule =
  typeof import("@/features/payments/providers/shopify/draft-order");
type CurrencyModule =
  typeof import("@/features/payments/providers/shopify/currency");
type ErrorsModule =
  typeof import("@/features/payments/providers/shopify/errors");
type TypesModule = typeof import("@/features/payments/lib/types");

/**
 * 重新加载模块
 *
 * **必须重新加载** —— `client.ts` 里缓存着店铺币种(`cachedCurrency`),
 * 不清掉的话上一个用例的币种会漏进下一个用例。
 *
 * 错误类也要用这里返回的那份 —— 静态 import 的那份是另一个类对象,
 * `instanceof` 不成立。
 */
async function loadShopify(): Promise<{
  draftOrder: DraftOrderModule;
  currency: CurrencyModule;
  errors: ErrorsModule;
  types: TypesModule;
}> {
  vi.resetModules();
  const draftOrder = await import(
    "@/features/payments/providers/shopify/draft-order"
  );
  const currency = await import(
    "@/features/payments/providers/shopify/currency"
  );
  const errors = await import("@/features/payments/providers/shopify/errors");
  const types = await import("@/features/payments/lib/types");
  return { draftOrder, currency, errors, types };
}

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

/** 建单用的请求 —— ¥12.50 × 2 + ¥6.00 运费 = ¥31.00 */
const REQUEST = {
  orderNo: "SO-20261105-942D88",
  email: "buyer@example.com",
  items: [{ title: "冰箱贴", quantity: 2, unitPriceCents: 1250, sku: "RM-01" }],
  shippingCents: 600,
  shippingAddress: null,
  note: "",
  successUrl: "https://example.com/checkout/success",
  currency: "CNY",
};

/** Shopify 那边算出来的总额(presentment / shop 两份) */
interface DraftResponse {
  /** 结算币种的总额 */
  amount: string;
  currencyCode: string;
  /** 展示币种的总额(用户被收的那份) */
  presentmentAmount?: string;
  presentmentCurrencyCode?: string;
}

/**
 * 桩 fetch:按 GraphQL 查询里的关键字分派
 *
 * - 查店铺币种 → 回 `shop { currencyCode enabledPresentmentCurrencies }`
 * - 建草稿单 → 回 `draftOrderCreate`
 *
 * **顺带把建单那份 input 记下来** —— 「我们发过去的价到底是不是原样的」
 * 要看的是真正发出去的东西,不是我们以为发出去的东西。
 */
interface StubShopify {
  /** 建草稿单时发过去的 input */
  sentInput: Record<string, unknown> | null;
}

function stubShopify(params: {
  shopCurrency: string;
  enabledPresentmentCurrencies?: string[];
  draft: DraftResponse | null;
  userErrors?: { field: string[] | null; message: string }[];
}): StubShopify {
  const json = (data: unknown): Response =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const stub: StubShopify = { sentInput: null };

  const fetchMock = vi
    .fn()
    .mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        query: string;
        variables?: { input?: Record<string, unknown> };
      };
      if (body.query.includes("ShopCurrency")) {
        return json({
          data: {
            shop: {
              currencyCode: params.shopCurrency,
              enabledPresentmentCurrencies:
                params.enabledPresentmentCurrencies ?? [],
            },
          },
        });
      }
      stub.sentInput = body.variables?.input ?? null;
      return json({
        data: {
          draftOrderCreate: {
            draftOrder: params.draft
              ? {
                  id: "gid://shopify/DraftOrder/1",
                  name: "#D1",
                  invoiceUrl: "https://demo-shop.myshopify.com/d/1",
                  totalPriceSet: {
                    shopMoney: {
                      amount: params.draft.amount,
                      currencyCode: params.draft.currencyCode,
                    },
                    presentmentMoney: {
                      amount:
                        params.draft.presentmentAmount ?? params.draft.amount,
                      currencyCode:
                        params.draft.presentmentCurrencyCode ??
                        params.draft.currencyCode,
                    },
                  },
                }
              : null,
            userErrors: params.userErrors ?? [],
          },
        },
      });
    });
  vi.stubGlobal("fetch", fetchMock);
  return stub;
}

/** 我们算出来的总额 —— ¥31.00 */
const EXPECTED_CNY = "31.00";

describe("buildDraftOrderInput —— 价原样搬过去", () => {
  it("行价就是我们算出来的数,一个字节都不改", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "CNY",
    });

    expect(input.lineItems[0]?.price).toEqual({
      amount: "12.50",
      currencyCode: "CNY",
    });
    expect(input.lineItems[0]?.quantity).toBe(2);
  });

  it("运费也是我们给的数", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "CNY",
    });

    expect(input.shippingLine?.price).toEqual({
      amount: "6.00",
      currencyCode: "CNY",
    });
  });

  it("带上展示币种 —— 用户被收的那个币种", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "CNY",
    });

    expect(input.presentmentCurrencyCode).toBe("CNY");
  });

  it("关掉自动折扣 —— 别让 Shopify 自作主张改我们的价", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "CNY",
    });

    expect(input.acceptAutomaticDiscounts).toBe(false);
    expect(input.taxExempt).toBe(true);
  });

  it("订单号写在三个地方(回调挨个试)", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "CNY",
    });

    expect(input.tags).toContain("mooncoda:SO-20261105-942D88");
    expect(input.note).toContain("SO-20261105-942D88");
    expect(input.lineItems[0]?.customAttributes).toContainEqual({
      key: "订单号",
      value: "SO-20261105-942D88",
    });
  });
});

describe("computeRequestTotalCents —— 我们自己的总额", () => {
  it("行价 × 数量 + 运费", async () => {
    const { draftOrder } = await loadShopify();
    expect(draftOrder.computeRequestTotalCents(REQUEST)).toBe(3100);
  });
});

describe("createShopifyDraftOrder —— 展示币种定不下来就拒绝建单", () => {
  it("店铺结算美元、Markets 里没有人民币 → 报错(重试没用,得改配置)", async () => {
    stubShopify({
      shopCurrency: "USD",
      enabledPresentmentCurrencies: ["EUR"],
      draft: null,
    });

    const { draftOrder, errors } = await loadShopify();
    await expect(draftOrder.createShopifyDraftOrder(REQUEST)).rejects.toThrow(
      errors.ShopifyNotConfiguredError
    );
  });

  it("订单本身的币种不是人民币 → 报错", async () => {
    stubShopify({ shopCurrency: "CNY", draft: null });

    const { draftOrder, types } = await loadShopify();
    await expect(
      draftOrder.createShopifyDraftOrder({ ...REQUEST, currency: "USD" })
    ).rejects.toThrow(types.PaymentProviderError);
  });
});

describe("createShopifyDraftOrder —— 建单", () => {
  it("店铺结算就是人民币 → 建单成功", async () => {
    stubShopify({
      shopCurrency: "CNY",
      draft: { amount: EXPECTED_CNY, currencyCode: "CNY" },
    });

    const { draftOrder } = await loadShopify();
    const draft = await draftOrder.createShopifyDraftOrder(REQUEST);
    expect(draft.invoiceUrl).toBe("https://demo-shop.myshopify.com/d/1");
    // 用户被收的总额 —— 人民币分,跟我们算的一分不差
    expect(draft.totalCents).toBe(3100);
  });

  it("店铺结算美元、Markets 里有人民币 → 也建单成功(展示币种是人民币)", async () => {
    stubShopify({
      shopCurrency: "USD",
      enabledPresentmentCurrencies: ["CNY", "EUR"],
      draft: {
        // 结算那份是美元(Shopify 按自己的汇率换的),展示那份是人民币
        amount: "4.31",
        currencyCode: "USD",
        presentmentAmount: EXPECTED_CNY,
        presentmentCurrencyCode: "CNY",
      },
    });

    const { draftOrder } = await loadShopify();
    const draft = await draftOrder.createShopifyDraftOrder(REQUEST);
    expect(draft.totalCents).toBe(3100);
  });

  it("发过去的行价是人民币(不换算)", async () => {
    const stub = stubShopify({
      shopCurrency: "USD",
      enabledPresentmentCurrencies: ["CNY"],
      draft: {
        amount: "4.31",
        currencyCode: "USD",
        presentmentAmount: EXPECTED_CNY,
        presentmentCurrencyCode: "CNY",
      },
    });

    const { draftOrder } = await loadShopify();
    await draftOrder.createShopifyDraftOrder(REQUEST);

    // 真正发出去的那份 input —— 不是我们以为发出去的那份
    const input = stub.sentInput as {
      presentmentCurrencyCode: string;
      lineItems: { price: unknown }[];
    };
    expect(input.presentmentCurrencyCode).toBe("CNY");
    expect(input.lineItems[0]?.price).toEqual({
      amount: "12.50",
      currencyCode: "CNY",
    });
  });

  it("Shopify 报了 userErrors → 报错(原文带出去)", async () => {
    stubShopify({
      shopCurrency: "CNY",
      draft: null,
      userErrors: [{ field: ["lineItems"], message: "价格不合法" }],
    });

    const { draftOrder, types } = await loadShopify();
    await expect(draftOrder.createShopifyDraftOrder(REQUEST)).rejects.toThrow(
      types.PaymentProviderError
    );
  });
});

describe("createShopifyDraftOrder —— 对账", () => {
  it("Shopify 算的总额跟我们发过去的**一分不差** → 通过", async () => {
    stubShopify({
      shopCurrency: "CNY",
      draft: { amount: EXPECTED_CNY, currencyCode: "CNY" },
    });

    const { draftOrder } = await loadShopify();
    await expect(
      draftOrder.createShopifyDraftOrder(REQUEST)
    ).resolves.toBeDefined();
  });

  it("差一分 → 报错(宁可这次失败,也不能给一个收了错钱的链接)", async () => {
    stubShopify({
      shopCurrency: "CNY",
      draft: { amount: "30.99", currencyCode: "CNY" },
    });

    const { draftOrder, types } = await loadShopify();
    await expect(draftOrder.createShopifyDraftOrder(REQUEST)).rejects.toThrow(
      types.PaymentProviderError
    );
  });

  it("对账比的是 **presentmentMoney**(用户被收的那个币种)", async () => {
    // 店铺结算币种是美元、向用户收的是人民币 —— 比 shopMoney 会误报
    stubShopify({
      shopCurrency: "USD",
      enabledPresentmentCurrencies: ["CNY"],
      draft: {
        amount: "4.31",
        currencyCode: "USD",
        presentmentAmount: EXPECTED_CNY,
        presentmentCurrencyCode: "CNY",
      },
    });

    const { draftOrder } = await loadShopify();
    await expect(
      draftOrder.createShopifyDraftOrder(REQUEST)
    ).resolves.toBeDefined();
  });

  it("Shopify 说总额是别的币种 → 报错", async () => {
    stubShopify({
      shopCurrency: "CNY",
      draft: {
        amount: EXPECTED_CNY,
        currencyCode: "CNY",
        presentmentAmount: EXPECTED_CNY,
        presentmentCurrencyCode: "EUR",
      },
    });

    const { draftOrder, types } = await loadShopify();
    await expect(draftOrder.createShopifyDraftOrder(REQUEST)).rejects.toThrow(
      types.PaymentProviderError
    );
  });
});
