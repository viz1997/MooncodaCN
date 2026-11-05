/**
 * Shopify 草稿单 —— 建单那一整条链路
 *
 * ## 为什么单开一个文件
 *
 * `shopify-currency.test.ts` 钉的是**币种判定**(纯函数)。这个文件钉的是
 * **建单**:从「定了展示币种」到「跟 Shopify 对账」中间那几步 —— 那几步里
 * 藏着两个「钱」的问题:
 *
 * 1. **我们发过去的价是不是原样的** —— 美元的价必须**一个字节都不改**
 *    地送过去。不换算是我们的架构决定(见 `currency.ts`),改一个字节就是
 *    「逐分相等」破了
 * 2. **对账要比对的那个币种** —— Shopify 的 `totalPriceSet` 有两份:
 *    `shopMoney`(结算币种)和 `presentmentMoney`(**向用户收钱的那个币种**,
 *    也就是我们发过去的行价的币种)。跟 `shopMoney` 比的话,店铺结算币种跟
 *    展示币种不同时会比错对象
 *
 * ## 还有一个:**字段名 / 字段类型随 API 版本变**
 *
 * 2026-11-05 线上连栽两次(`price` 字段不存在、`handle` 字段不存在、
 * 运费的 `price` 要标量不要对象)。所以这里钉的不只是「发的价对不对」,
 * 还有「**形状对不上时会换一种写法重发**」。
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

/** 建单用的请求 —— $12.50 × 2 + $6.00 运费 = $31.00 */
const REQUEST = {
  orderNo: "SO-20261105-942D88",
  email: "buyer@example.com",
  items: [{ title: "冰箱贴", quantity: 2, unitPriceCents: 1250, sku: "RM-01" }],
  shippingCents: 600,
  shippingAddress: null,
  note: "",
  successUrl: "https://example.com/checkout/success",
  currency: "USD",
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

/** 一次建单尝试的结果 */
type DraftAttempt =
  | {
      kind: "data";
      draft: DraftResponse | null;
      userErrors?: { field: string[] | null; message: string }[];
    }
  /** GraphQL 的 `errors` 数组 —— 验证错误 / 变量强制转换错误走这条路 */
  | { kind: "errors"; messages: string[] };

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
  /** 建草稿单时发过去的 input(最后一次) */
  sentInput: Record<string, unknown> | null;
  /** 建草稿单时发过去的 query 原文 */
  sentQuery: string | null;
  /** 建草稿单发了几次 */
  callCount: number;
  /** 每次建草稿单发过去的 input */
  sentInputs: (Record<string, unknown> | null)[];
}

function stubShopify(params: {
  shopCurrency: string;
  enabledPresentmentCurrencies?: string[];
  draft?: DraftResponse | null;
  userErrors?: { field: string[] | null; message: string }[];
  /** 按次序的建单结果 —— 用来测「写法阶梯」 */
  draftResponses?: DraftAttempt[];
}): StubShopify {
  const json = (data: unknown): Response =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const stub: StubShopify = {
    sentInput: null,
    sentQuery: null,
    callCount: 0,
    sentInputs: [],
  };

  const attempts: DraftAttempt[] = params.draftResponses ?? [
    {
      kind: "data",
      draft: params.draft ?? null,
      userErrors: params.userErrors ?? [],
    },
  ];

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

      const attempt =
        attempts[Math.min(stub.callCount, attempts.length - 1)] ?? attempts[0];
      stub.callCount += 1;
      stub.sentInput = body.variables?.input ?? null;
      stub.sentInputs.push(body.variables?.input ?? null);
      stub.sentQuery = body.query;

      if (!attempt || attempt.kind === "errors") {
        return json({
          errors: (attempt?.kind === "errors"
            ? attempt.messages
            : ["未知错误"]
          ).map((message) => ({ message })),
        });
      }

      return json({
        data: {
          draftOrderCreate: {
            draftOrder: attempt.draft
              ? {
                  id: "gid://shopify/DraftOrder/1",
                  name: "#D1",
                  invoiceUrl: "https://demo-shop.myshopify.com/d/1",
                  totalPriceSet: {
                    shopMoney: {
                      amount: attempt.draft.amount,
                      currencyCode: attempt.draft.currencyCode,
                    },
                    presentmentMoney: {
                      amount:
                        attempt.draft.presentmentAmount ?? attempt.draft.amount,
                      currencyCode:
                        attempt.draft.presentmentCurrencyCode ??
                        attempt.draft.currencyCode,
                    },
                  },
                }
              : null,
            userErrors: attempt.userErrors ?? [],
          },
        },
      });
    });
  vi.stubGlobal("fetch", fetchMock);
  return stub;
}

/** 我们算出来的总额 —— $31.00 */
const EXPECTED_USD = "31.00";

describe("建单用的 GraphQL —— 选择集必须版本无关", () => {
  /**
   * 2026-11-05 线上栽过的坑:`Field 'code' doesn't exist on type 'UserError'`
   *
   * `draftOrderCreate` 的 `userErrors` 在不同 API 版本上类型不一样(基类
   * `UserError` / `DraftOrderUserError`)。GraphQL 的验证是**全有全无**的 ——
   * 选一个当前版本不认的字段,整条 mutation 验证不过,**草稿单根本没建出来**,
   * 报的还是这个验证错误,不是 Shopify 的业务报错。
   *
   * `field` / `message` 是 `UserError` **接口**上的字段 —— 哪个版本都在。
   */
  it("userErrors 只选 field / message(选 code 会炸掉整条查询)", async () => {
    const { draftOrder } = await loadShopify();
    const selection =
      draftOrder.DRAFT_ORDER_CREATE.match(/userErrors\s*\{([^}]*)\}/)?.[1] ??
      "";

    expect(selection).toContain("field");
    expect(selection).toContain("message");
    expect(selection).not.toContain("code");
  });

  it("发出去的就是这条 query —— 别让常量跟实际请求脱节", async () => {
    const stub = stubShopify({
      shopCurrency: "USD",
      draft: { amount: EXPECTED_USD, currencyCode: "USD" },
    });

    const { draftOrder } = await loadShopify();
    await draftOrder.createShopifyDraftOrder(REQUEST);

    expect(stub.sentQuery).toBe(draftOrder.DRAFT_ORDER_CREATE);
    // 发出去的那份也不能多问 `code`
    const sentSelection =
      stub.sentQuery?.match(/userErrors\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(sentSelection).not.toContain("code");
  });
});

describe("buildDraftOrderInput —— 字段名 / 字段类型得对得上", () => {
  /**
   * 2026-11-05 线上栽过的三个坑:
   *
   * ```text
   * Field 'price' is not defined by type 'DraftOrderLineItemInput'
   * Field 'handle' is not defined by type 'ShippingLineInput'
   * shippingLine.price (invalid money '{"amount" => "6.99", "currencyCode" => "USD"}')
   * ```
   *
   * 也就是:行价不叫 `price`、运费不带 `handle`、运费的 `price` 是
   * **`Money` 标量**(字符串)而不是对象。
   */
  it("行价叫 originalUnitPrice(不是不存在的 price)", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "USD",
    });

    expect(input.lineItems[0]?.originalUnitPrice).toBe("12.50");
    expect(input.lineItems[0]?.quantity).toBe(2);
    // **`price` 这个字段压根不存在** —— 送过去整条 mutation 验证不过
    expect(input.lineItems[0]).not.toHaveProperty("price");
  });

  it("运费是 Money 标量(纯字符串),不是 {amount, currencyCode}", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "USD",
    });

    expect(input.shippingLine?.price).toBe("6.00");
    expect(typeof input.shippingLine?.price).toBe("string");
  });

  it("运费不带 handle —— 带了会被店铺的运费费率覆盖掉", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "USD",
    });

    expect(input.shippingLine).not.toHaveProperty("handle");
  });

  it("价原样搬过去 —— 一个字节都不改", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "USD",
    });

    // $12.50 —— 不是 $12.5,也不是 1250
    expect(input.lineItems[0]?.originalUnitPrice).toBe("12.50");
    expect(input.shippingLine?.price).toBe("6.00");
  });

  it("带上展示币种 —— 用户被收的那个币种", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "USD",
    });

    expect(input.presentmentCurrencyCode).toBe("USD");
  });

  it("关掉自动折扣 —— 别让 Shopify 自作主张改我们的价", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "USD",
    });

    expect(input.acceptAutomaticDiscounts).toBe(false);
    expect(input.taxExempt).toBe(true);
  });

  it("订单号写在三个地方(回调挨个试)", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "USD",
    });

    expect(input.tags).toContain("mooncoda:SO-20261105-942D88");
    expect(input.note).toContain("SO-20261105-942D88");
    expect(input.lineItems[0]?.customAttributes).toContainEqual({
      key: "订单号",
      value: "SO-20261105-942D88",
    });
  });

  it("换成 priceOverride 写法 —— 行价是带币种的对象", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "USD",
      flavor: {
        linePrice: "priceOverrideMoneyInput",
        shippingPrice: "scalar",
      },
    });

    expect(input.lineItems[0]?.priceOverride).toEqual({
      amount: "12.50",
      currencyCode: "USD",
    });
    expect(input.lineItems[0]).not.toHaveProperty("originalUnitPrice");
  });

  it("老版本里 originalUnitPrice 是对象 —— 那种写法也留着", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "USD",
      flavor: {
        linePrice: "originalUnitPriceMoneyInput",
        shippingPrice: "scalar",
      },
    });

    expect(input.lineItems[0]?.originalUnitPrice).toEqual({
      amount: "12.50",
      currencyCode: "USD",
    });
  });

  it("运费标量里带币种 —— 少数版本要这种写法", async () => {
    const { draftOrder } = await loadShopify();
    const input = draftOrder.buildDraftOrderInput({
      request: REQUEST,
      currencyCode: "USD",
      flavor: {
        linePrice: "originalUnitPriceScalar",
        shippingPrice: "scalarWithCurrency",
      },
    });

    expect(input.shippingLine?.price).toBe("6.00 USD");
  });
});

describe("computeRequestTotalCents —— 我们自己的总额", () => {
  it("行价 × 数量 + 运费", async () => {
    const { draftOrder } = await loadShopify();
    expect(draftOrder.computeRequestTotalCents(REQUEST)).toBe(3100);
  });
});

describe("createShopifyDraftOrder —— 展示币种定不下来就拒绝建单", () => {
  it("店铺结算人民币、Markets 里没有美元 → 报错(重试没用,得改配置)", async () => {
    stubShopify({
      shopCurrency: "CNY",
      enabledPresentmentCurrencies: ["EUR"],
      draft: null,
    });

    const { draftOrder, errors } = await loadShopify();
    await expect(draftOrder.createShopifyDraftOrder(REQUEST)).rejects.toThrow(
      errors.ShopifyNotConfiguredError
    );
  });

  it("订单本身的币种不是美元 → 报错", async () => {
    stubShopify({ shopCurrency: "USD", draft: null });

    const { draftOrder, types } = await loadShopify();
    await expect(
      draftOrder.createShopifyDraftOrder({ ...REQUEST, currency: "CNY" })
    ).rejects.toThrow(types.PaymentProviderError);
  });
});

describe("createShopifyDraftOrder —— 建单", () => {
  it("店铺结算就是美元 → 建单成功", async () => {
    stubShopify({
      shopCurrency: "USD",
      draft: { amount: EXPECTED_USD, currencyCode: "USD" },
    });

    const { draftOrder } = await loadShopify();
    const draft = await draftOrder.createShopifyDraftOrder(REQUEST);
    expect(draft.invoiceUrl).toBe("https://demo-shop.myshopify.com/d/1");
    // 用户被收的总额 —— 美元分,跟我们算的一分不差
    expect(draft.totalCents).toBe(3100);
  });

  it("店铺结算人民币、Markets 里有美元 → 也建单成功(展示币种是美元)", async () => {
    stubShopify({
      shopCurrency: "CNY",
      enabledPresentmentCurrencies: ["USD", "EUR"],
      draft: {
        // 结算那份是人民币(Shopify 按自己的汇率换的),展示那份是美元
        amount: "223.20",
        currencyCode: "CNY",
        presentmentAmount: EXPECTED_USD,
        presentmentCurrencyCode: "USD",
      },
    });

    const { draftOrder } = await loadShopify();
    const draft = await draftOrder.createShopifyDraftOrder(REQUEST);
    expect(draft.totalCents).toBe(3100);
  });

  it("发过去的行价是美元(不换算)", async () => {
    const stub = stubShopify({
      shopCurrency: "CNY",
      enabledPresentmentCurrencies: ["USD"],
      draft: {
        amount: "223.20",
        currencyCode: "CNY",
        presentmentAmount: EXPECTED_USD,
        presentmentCurrencyCode: "USD",
      },
    });

    const { draftOrder } = await loadShopify();
    await draftOrder.createShopifyDraftOrder(REQUEST);

    // 真正发出去的那份 input —— 不是我们以为发出去的那份
    const input = stub.sentInput as {
      presentmentCurrencyCode: string;
      lineItems: { originalUnitPrice?: string }[];
    };
    expect(input.presentmentCurrencyCode).toBe("USD");
    expect(input.lineItems[0]?.originalUnitPrice).toBe("12.50");
  });

  it("Shopify 报了 userErrors → 报错(原文带出去)", async () => {
    stubShopify({
      shopCurrency: "USD",
      draft: null,
      userErrors: [{ field: ["lineItems"], message: "价格不合法" }],
    });

    const { draftOrder, types } = await loadShopify();
    await expect(draftOrder.createShopifyDraftOrder(REQUEST)).rejects.toThrow(
      types.PaymentProviderError
    );
  });
});

describe("写法阶梯 —— 字段形状对不上就换一种写法", () => {
  /**
   * Shopify 的**同一个输入类型在不同 API 版本上字段不一样**,而文档页常常
   * 打不开、二手信息也可能对不上版本 —— 所以代码里留了一条自动换写法的路。
   *
   * 换写法的**唯一触发条件**是「字段形状对不上」(字段名不认 / 字段类型不对)。
   */
  it("字段名不认 → 换一种写法重发,第二次成了", async () => {
    const stub = stubShopify({
      shopCurrency: "USD",
      draftResponses: [
        {
          kind: "errors",
          messages: [
            "Variable `$input` of type `DraftOrderInput!` was provided invalid " +
              "value for `lineItems.0.originalUnitPrice` (Field " +
              "`originalUnitPrice` is not defined by type " +
              "`DraftOrderLineItemInput`)",
          ],
        },
        { kind: "data", draft: { amount: EXPECTED_USD, currencyCode: "USD" } },
      ],
    });

    const { draftOrder } = await loadShopify();
    const draft = await draftOrder.createShopifyDraftOrder(REQUEST);

    expect(draft.totalCents).toBe(3100);
    expect(stub.callCount).toBe(2);

    const first = stub.sentInputs[0] as {
      lineItems: Record<string, unknown>[];
    };
    const second = stub.sentInputs[1] as {
      lineItems: Record<string, unknown>[];
    };
    // 第一次用 originalUnitPrice,第二次换成了 priceOverride
    expect(first.lineItems[0]?.originalUnitPrice).toBe("12.50");
    expect(second.lineItems[0]?.priceOverride).toEqual({
      amount: "12.50",
      currencyCode: "USD",
    });
  });

  it("字段类型不对(invalid money)→ 换一种写法重发", async () => {
    const stub = stubShopify({
      shopCurrency: "USD",
      draftResponses: [
        {
          kind: "errors",
          messages: [
            "Variable `$input` of type `DraftOrderInput!` was provided invalid " +
              "value for `shippingLine.price` (invalid money " +
              '\'{"amount" => "6.00", "currencyCode" => "USD"}\')',
          ],
        },
        { kind: "data", draft: { amount: EXPECTED_USD, currencyCode: "USD" } },
      ],
    });

    const { draftOrder } = await loadShopify();
    const draft = await draftOrder.createShopifyDraftOrder(REQUEST);

    expect(draft.totalCents).toBe(3100);
    expect(stub.callCount).toBe(2);
    // 第二次运费标量里带上了币种
    const second = stub.sentInputs[1] as { shippingLine?: { price: unknown } };
    expect(second.shippingLine?.price).toBe("6.00 USD");
  });

  it("**不是**字段形状问题 → 不重试(一次就抛,别把真正的错误盖住)", async () => {
    const stub = stubShopify({
      shopCurrency: "USD",
      draftResponses: [
        {
          kind: "errors",
          messages: ["Access denied for resource type GraphqlAdminOperation"],
        },
      ],
    });

    const { draftOrder, types } = await loadShopify();
    await expect(draftOrder.createShopifyDraftOrder(REQUEST)).rejects.toThrow(
      types.PaymentProviderError
    );

    expect(stub.callCount).toBe(1);
  });

  it("金额对不上 → 不重试(换写法救不了对账)", async () => {
    const stub = stubShopify({
      shopCurrency: "USD",
      draft: { amount: "30.99", currencyCode: "USD" },
    });

    const { draftOrder, types } = await loadShopify();
    await expect(draftOrder.createShopifyDraftOrder(REQUEST)).rejects.toThrow(
      types.PaymentProviderError
    );

    expect(stub.callCount).toBe(1);
  });

  it("所有写法都不行 → 报错里说清试了几种 + 最后一次的原文", async () => {
    const stub = stubShopify({
      shopCurrency: "USD",
      draftResponses: [
        {
          kind: "errors",
          messages: [
            "Field 'originalUnitPrice' is not defined by type 'DraftOrderLineItemInput'",
          ],
        },
      ],
    });

    const { draftOrder, types } = await loadShopify();
    await expect(draftOrder.createShopifyDraftOrder(REQUEST)).rejects.toThrow(
      types.PaymentProviderError
    );

    // 每种写法都试过了
    expect(stub.callCount).toBe(draftOrder.DRAFT_ORDER_FLAVORS.length);

    await expect(draftOrder.createShopifyDraftOrder(REQUEST)).rejects.toThrow(
      /试了 \d+ 种写法/
    );
  });
});

describe("nextDraftOrderFlavor —— 按错误指向的那一处换写法", () => {
  it("提到 shippingLine → 换运费写法,行价不动", async () => {
    const { draftOrder } = await loadShopify();
    const next = draftOrder.nextDraftOrderFlavor({
      current: {
        linePrice: "originalUnitPriceScalar",
        shippingPrice: "scalar",
      },
      error: new Error(
        "Variable `$input` ... invalid value for `shippingLine.price` " +
          '(invalid money \'{"amount" => "6.00"}\')'
      ),
      tried: [
        { linePrice: "originalUnitPriceScalar", shippingPrice: "scalar" },
      ],
    });

    expect(next).toEqual({
      linePrice: "originalUnitPriceScalar",
      shippingPrice: "scalarWithCurrency",
    });
  });

  it("提到 lineItems → 换行价写法,运费不动", async () => {
    const { draftOrder } = await loadShopify();
    const next = draftOrder.nextDraftOrderFlavor({
      current: {
        linePrice: "originalUnitPriceScalar",
        shippingPrice: "scalar",
      },
      error: new Error(
        "Variable `$input` ... invalid value for `lineItems.0.originalUnitPrice` " +
          "(Field `originalUnitPrice` is not defined by type `DraftOrderLineItemInput`)"
      ),
      tried: [
        { linePrice: "originalUnitPriceScalar", shippingPrice: "scalar" },
      ],
    });

    expect(next).toEqual({
      linePrice: "priceOverrideMoneyInput",
      shippingPrice: "scalar",
    });
  });

  it("全试过了 → 没有下一招(返回 null,别转圈)", async () => {
    const { draftOrder } = await loadShopify();
    const next = draftOrder.nextDraftOrderFlavor({
      current: {
        linePrice: "priceOverrideMoneyInput",
        shippingPrice: "moneyInput",
      },
      error: new Error(
        "Variable `$input` ... invalid value for `lineItems.0.price`"
      ),
      tried: [...draftOrder.DRAFT_ORDER_FLAVORS],
    });

    expect(next).toBeNull();
  });
});

describe("buildShippingPrice —— 三种写法", () => {
  it("scalar —— 纯字符串,不带币种", async () => {
    const { draftOrder } = await loadShopify();
    expect(
      draftOrder.buildShippingPrice({
        amount: "6.00",
        currency: "USD",
        format: "scalar",
      })
    ).toBe("6.00");
  });

  it("scalarWithCurrency —— 带币种", async () => {
    const { draftOrder } = await loadShopify();
    expect(
      draftOrder.buildShippingPrice({
        amount: "6.00",
        currency: "USD",
        format: "scalarWithCurrency",
      })
    ).toBe("6.00 USD");
  });

  it("moneyInput —— 对象", async () => {
    const { draftOrder } = await loadShopify();
    expect(
      draftOrder.buildShippingPrice({
        amount: "6.00",
        currency: "USD",
        format: "moneyInput",
      })
    ).toEqual({ amount: "6.00", currencyCode: "USD" });
  });
});

describe("createShopifyDraftOrder —— 对账", () => {
  it("Shopify 算的总额跟我们发过去的**一分不差** → 通过", async () => {
    stubShopify({
      shopCurrency: "USD",
      draft: { amount: EXPECTED_USD, currencyCode: "USD" },
    });

    const { draftOrder } = await loadShopify();
    await expect(
      draftOrder.createShopifyDraftOrder(REQUEST)
    ).resolves.toBeDefined();
  });

  it("差一分 → 报错(宁可这次失败,也不能给一个收了错钱的链接)", async () => {
    stubShopify({
      shopCurrency: "USD",
      draft: { amount: "30.99", currencyCode: "USD" },
    });

    const { draftOrder, types } = await loadShopify();
    await expect(draftOrder.createShopifyDraftOrder(REQUEST)).rejects.toThrow(
      types.PaymentProviderError
    );
  });

  it("对账比的是 **presentmentMoney**(用户被收的那个币种)", async () => {
    // 店铺结算币种是人民币、向用户收的是美元 —— 比 shopMoney 会误报
    stubShopify({
      shopCurrency: "CNY",
      enabledPresentmentCurrencies: ["USD"],
      draft: {
        amount: "223.20",
        currencyCode: "CNY",
        presentmentAmount: EXPECTED_USD,
        presentmentCurrencyCode: "USD",
      },
    });

    const { draftOrder } = await loadShopify();
    await expect(
      draftOrder.createShopifyDraftOrder(REQUEST)
    ).resolves.toBeDefined();
  });

  it("Shopify 说总额是别的币种 → 报错", async () => {
    stubShopify({
      shopCurrency: "USD",
      draft: {
        amount: EXPECTED_USD,
        currencyCode: "USD",
        presentmentAmount: EXPECTED_USD,
        presentmentCurrencyCode: "EUR",
      },
    });

    const { draftOrder, types } = await loadShopify();
    await expect(draftOrder.createShopifyDraftOrder(REQUEST)).rejects.toThrow(
      types.PaymentProviderError
    );
  });
});
