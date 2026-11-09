/**
 * Shopify 草稿订单 —— **这一条通道的核心**
 *
 * ## 干什么
 *
 * 拿我们算好的价,建一张 Shopify 草稿订单,把它的收银台地址给用户跳过去。
 *
 * ## 为什么是草稿订单
 *
 * 「本仓库算价,Sellbase 只做收银台」这条架构的核心是**逐分相等** —— 我们算
 * 出来的每一行单价,必须跟收银台实际收的金额**一分不差**。
 *
 * Shopify 的普通购物车做不到(Storefront 的 `CartLineInput` 没有价格字段、
 * 改价要 Plus 套餐的 Cart Transform、Scripts 已下线)。草稿订单可以:
 *
 * - 行项目是**自定义行**,行价由我们给(`originalUnitPrice`)—— 不依赖商品目录,
 *   不用同步目录
 * - `taxExempt: true` —— 不会在总价上再叠一层税
 * - 运费也是我们自己给的一行 —— 不跟 Shopify 的运费规则走
 *
 * ## 币种:我们不换算,Shopify 换(2026-11-05)
 *
 * 本仓库的价是什么币种(`PRICE_CURRENCY`,现在是人民币)就是什么币种,原样搬
 * 过去 —— **我们的代码里没有汇率**。
 *
 * 草稿订单的行价按**展示币种**(`presentmentCurrencyCode`)给,所以我们把
 * 展示币种设成我们的价,用户付的就是我们算出来的那个数 —— 跟我们在自己
 * 站上算的**一分不差**。结算成别的币种是 Shopify 按它自己的汇率换的事,
 * 不是我们的定价。
 *
 * 口径和前提见 `currency.ts`。
 *
 * ## 落库之前先对一遍账
 *
 * 建完草稿单会把 Shopify 那边算出来的总额(**`presentmentMoney`**,也就是
 * 用户被收的那份)跟我们的总额比一次(`assertSameTotal`)。**对不上就当这次
 * 失败**,不给用户一个会收错钱的链接。
 *
 * 最常见的对不上原因是**自动折扣**:店铺里挂着「满减 / 打折」的活动时,
 * 草稿单也会被打折 —— 那钱就少了,而我们这边记的是没打折的价。
 * (`acceptAutomaticDiscounts: false` 已经先关了一道,但对账是最后一道。)
 *
 * ## 订单号要出现在三个地方
 *
 * 回调里能拿到的关联键只有订单号,而 Shopify 草稿单转正式订单之后,
 * 我们能读到的字段有好几处 —— 全都写上,回调挨个试:
 *
 * 1. 草稿单的 `tags`(`mooncoda:SO-…`)
 * 2. 草稿单的 `note`
 * 3. 行项目的自定义属性(`订单号`)
 *
 * ## 字段名 / 字段类型 **随 API 版本变**(2026-11-05 线上踩过两轮)
 *
 * Shopify 每个季度发一个 API 版本,**每个版本只保一年**。而同一个输入类型
 * 在不同版本上字段不一样 —— 2026-11-05 线上连栽两次:
 *
 * ```text
 * Field 'price' is not defined by type 'DraftOrderLineItemInput'
 * Field 'handle' is not defined by type 'ShippingLineInput'
 * shippingLine.price (invalid money '{"amount" => "6.99", "currencyCode" => "USD"}')
 * ```
 *
 * 也就是说:
 *
 * - 行价不叫 `price` —— 叫 `originalUnitPrice`(`Money` 标量,纯字符串)或者
 *   `priceOverride`(`MoneyInput` 对象,自带币种)
 * - 运费**不带 `handle`** —— 带了会被店铺的运费费率覆盖掉
 * - 运费是 `Money` **标量**(字符串 `"6.99"`),不是 `{amount, currencyCode}`
 *
 * **`shopify.dev` 的文档页在很多网络环境下打不开**,二手信息也可能对不上
 * 版本 —— 所以代码里留了一条**写法阶梯**(`DRAFT_ORDER_FLAVORS`):碰到
 * 「字段形状对不上」就换一种写法重发。要看店铺当前版本的真实字段,跑
 * `pnpm tsx scripts/dump-shopify-input-schema.ts`。
 */

import {
  amountStringToCents,
  centsToAmountString,
} from "@/features/payments/lib/money";
import {
  PaymentProviderError,
  type PaymentRequest,
} from "@/features/payments/lib/types";

import {
  getShopCurrencyInfo,
  isFieldShapeError,
  shopifyGraphql,
} from "./client";
import { PRICE_CURRENCY, resolvePresentmentCurrency } from "./currency";
import { SHOPIFY_ORDER_NO_PROPERTY } from "./order-reference";

/** 我们在 Shopify 侧留下的标记前缀 —— 回调靠它认出「这单是我们的」 */
export const SHOPIFY_ORDER_TAG_PREFIX = "mooncoda:";

/** 默认国家/地区码 —— 地址簿里没存国家,Shopify 的地址需要 */
function getDefaultCountry(): string {
  const raw = process.env.SHOPIFY_DEFAULT_COUNTRY?.trim();
  return (raw || "US").toUpperCase();
}

/**
 * 行价的写法 —— **字段名 + 字段类型**
 *
 * - `originalUnitPriceScalar` —— `originalUnitPrice: "12.50"`(`Money` 标量,
 *   纯字符串)。我们用的是**自定义行**(不挂商品目录里的 variant),这个
 *   字段就是给它用的 —— **当前版本认这个**
 * - `priceOverrideMoneyInput` —— `priceOverride: {amount, currencyCode}`
 *   (`MoneyInput` 对象,自带币种)。`originalUnitPrice` 被删掉之后的版本
 * - `originalUnitPriceMoneyInput` —— `originalUnitPrice: {amount, currencyCode}`
 *   —— 老版本里 `originalUnitPrice` 还是 `MoneyInput` 对象的时候
 *
 * **`price` 这个字段根本不存在** —— 2026-11-05 线上踩过:
 * `Field 'price' is not defined by type 'DraftOrderLineItemInput'`。
 */
export type DraftLinePriceShape =
  | "originalUnitPriceScalar"
  | "priceOverrideMoneyInput"
  | "originalUnitPriceMoneyInput";

/**
 * 运费的写法 —— `ShippingLineInput.price` 的三种可能
 *
 * - `scalar` —— `Money` 标量,纯字符串(`"6.99"`)。**当前版本认这个**
 * - `scalarWithCurrency` —— 带币种的标量(`"6.99 USD"`)
 * - `moneyInput` —— `MoneyInput` 对象(`{amount, currencyCode}`)
 *
 * 传对象给当前版本,Shopify 会回
 * `invalid money '{"amount" => "6.99", "currencyCode" => "USD"}'`。
 */
export type DraftShippingPriceFormat =
  | "scalar"
  | "scalarWithCurrency"
  | "moneyInput";

/** 一份「写法」 —— 行价怎么给 + 运费怎么给 */
export interface DraftOrderFlavor {
  linePrice: DraftLinePriceShape;
  shippingPrice: DraftShippingPriceFormat;
}

/** 行价写法的候选 —— 按「最可能」排 */
const LINE_PRICE_SHAPES: DraftLinePriceShape[] = [
  "originalUnitPriceScalar",
  "priceOverrideMoneyInput",
  "originalUnitPriceMoneyInput",
];

/** 运费写法的候选 —— 按「最可能」排 */
const SHIPPING_FORMATS: DraftShippingPriceFormat[] = [
  "scalar",
  "scalarWithCurrency",
  "moneyInput",
];

/**
 * 写法阶梯 —— 全部组合,按「最可能」排
 *
 * **为什么要阶梯**:Shopify 每个季度发一个 API 版本,**每个版本只保一年**,
 * 而同一个输入类型在不同版本上字段名 / 字段类型会变。文档页常常打不开
 * (本机就被挡),二手信息也可能对不上版本 —— 所以留一条能自动换写法的路。
 *
 * 换写法的**唯一触发条件**是「字段形状对不上」(见 `isFieldShapeError`):
 * 字段名不认、字段类型不对。别的错误(金额对不上、凭据不对)原样往上抛。
 *
 * 变量强制转换失败**不会建出草稿单**,所以重发是安全的 —— 不会建出两张。
 */
export const DRAFT_ORDER_FLAVORS: DraftOrderFlavor[] = [
  { linePrice: "originalUnitPriceScalar", shippingPrice: "scalar" },
  { linePrice: "priceOverrideMoneyInput", shippingPrice: "scalar" },
  { linePrice: "originalUnitPriceMoneyInput", shippingPrice: "scalar" },
  { linePrice: "originalUnitPriceScalar", shippingPrice: "scalarWithCurrency" },
  { linePrice: "priceOverrideMoneyInput", shippingPrice: "scalarWithCurrency" },
  {
    linePrice: "originalUnitPriceMoneyInput",
    shippingPrice: "scalarWithCurrency",
  },
  { linePrice: "originalUnitPriceScalar", shippingPrice: "moneyInput" },
  { linePrice: "priceOverrideMoneyInput", shippingPrice: "moneyInput" },
  { linePrice: "originalUnitPriceMoneyInput", shippingPrice: "moneyInput" },
];

/** 默认写法 —— `buildDraftOrderInput` 不传 flavor 时用它 */
export const DEFAULT_DRAFT_ORDER_FLAVOR: DraftOrderFlavor = {
  linePrice: "originalUnitPriceScalar",
  shippingPrice: "scalar",
};

/** 两份写法是不是同一个 */
function isSameFlavor(a: DraftOrderFlavor, b: DraftOrderFlavor): boolean {
  return a.linePrice === b.linePrice && a.shippingPrice === b.shippingPrice;
}

/**
 * 下一招 —— **按错误指向的那一处换**
 *
 * Shopify 的报错会写清楚是哪一处不对:
 *
 * ```text
 * ... invalid value for `lineItems.0.price` (Field `price` is not defined ...)
 * ... invalid value for `shippingLine.price` (invalid money '{"amount" => ...}')
 * ```
 *
 * 所以:
 *
 * - 提到 `shippingLine` → 运费的字段形状不对 → 换运费写法
 * - 提到 `lineItems` → 行价的字段名 / 类型不对 → 换行价写法
 *
 * 两处都换了还不行 → 按固定顺序找一个没试过的;全试过了 → 返回 null。
 */
export function nextDraftOrderFlavor(params: {
  current: DraftOrderFlavor;
  error: unknown;
  /** 已经试过的 —— 别转圈 */
  tried: readonly DraftOrderFlavor[];
}): DraftOrderFlavor | null {
  const message =
    params.error instanceof Error ? params.error.message : String(params.error);

  const isTried = (flavor: DraftOrderFlavor): boolean =>
    params.tried.some((tried) => isSameFlavor(tried, flavor));

  // 运费那一处 —— 换运费写法,行价先不动
  if (/shippingLine/i.test(message)) {
    for (const format of SHIPPING_FORMATS) {
      const candidate: DraftOrderFlavor = {
        linePrice: params.current.linePrice,
        shippingPrice: format,
      };
      if (!isTried(candidate)) return candidate;
    }
  }

  // 行价那一处 —— 换行价写法,运费先不动
  if (/lineItems|originalUnitPrice|priceOverride/i.test(message)) {
    for (const shape of LINE_PRICE_SHAPES) {
      const candidate: DraftOrderFlavor = {
        linePrice: shape,
        shippingPrice: params.current.shippingPrice,
      };
      if (!isTried(candidate)) return candidate;
    }
  }

  // 兜底 —— 按固定顺序找一个没试过的
  for (const combo of DRAFT_ORDER_FLAVORS) {
    if (!isTried(combo)) return combo;
  }

  return null;
}

/** 一行(自定义行) */
export interface DraftOrderLineInput {
  title: string;
  quantity: number;
  /**
   * 行价 —— `Money` 标量(纯字符串)或 `MoneyInput` 对象
   *
   * **当前版本要标量**(`"12.50"`)—— 传对象 Shopify 会回 `invalid money`。
   */
  originalUnitPrice?: string | { amount: string; currencyCode: string };
  /** 行价 —— `MoneyInput` 对象(自带币种) */
  priceOverride?: { amount: string; currencyCode: string };
  sku?: string;
  customAttributes?: { key: string; value: string }[];
}

/** 草稿单的输入(GraphQL `DraftOrderInput`) */
export interface DraftOrderInput {
  email: string;
  note: string;
  tags: string[];
  taxExempt: boolean;
  /**
   * 展示币种 —— 用户被收的那个币种
   *
   * **行价按这个币种给**。我们把它设成自己的价,行价也就是那个币种的数 ——
   * 原样搬过去,一个字节都不改。
   */
  presentmentCurrencyCode: string;
  /** 关掉店铺的自动折扣 —— 别让 Shopify 自作主张改我们的价 */
  acceptAutomaticDiscounts: boolean;
  lineItems: DraftOrderLineInput[];
  shippingLine?: {
    title: string;
    /**
     * `Money` 标量 —— 字符串(`"6.99"`),**不是** `{amount, currencyCode}`
     *
     * 少数版本要带币种的标量(`"6.99 USD"`),更少数要对象 —— 见
     * `DraftShippingPriceFormat`。
     */
    price: string | { amount: string; currencyCode: string };
  };
  shippingAddress?: {
    firstName: string;
    phone: string;
    address1: string;
    city: string;
    province: string;
    country: string;
  };
}

/**
 * 运费那一行的价 —— 按写法拼
 *
 * `Money` 标量是**纯字符串**,不带币种(`"6.99"`)—— 币种由
 * `presentmentCurrencyCode` 定,这里再带一个反而可能跟它打架。
 */
export function buildShippingPrice(params: {
  amount: string;
  currency: string;
  format: DraftShippingPriceFormat;
}): string | { amount: string; currencyCode: string } {
  if (params.format === "moneyInput") {
    return { amount: params.amount, currencyCode: params.currency };
  }
  if (params.format === "scalarWithCurrency") {
    return `${params.amount} ${params.currency}`;
  }
  return params.amount;
}

/**
 * 把一次支付请求翻译成 Shopify 草稿单输入
 *
 * **纯函数** —— 不碰网络、不碰 env 里的密钥(只有国家码读了 env,给了默认值)。
 *
 * ## 「我们算出来的价」原样搬过去
 *
 * 一个字节都不改 —— **不换算**。展示币种是什么,行价就是那个币种的数。
 *
 * ## 字段名 / 字段类型随 API 版本变
 *
 * `flavor` 决定用哪种写法 —— 见 `DRAFT_ORDER_FLAVORS`。
 */
export function buildDraftOrderInput(params: {
  request: PaymentRequest;
  /** 展示币种 —— 一般就是本仓库的价那个币种 */
  currencyCode: string;
  /** 用哪种写法 —— 默认 `DEFAULT_DRAFT_ORDER_FLAVOR` */
  flavor?: DraftOrderFlavor;
}): DraftOrderInput {
  const { request, currencyCode } = params;
  const flavor = params.flavor ?? DEFAULT_DRAFT_ORDER_FLAVOR;
  const currency = currencyCode.toUpperCase();

  const lineItems: DraftOrderLineInput[] = request.items.map((item) => {
    const amount = centsToAmountString(item.unitPriceCents);

    const attributes: { key: string; value: string }[] = [
      { key: SHOPIFY_ORDER_NO_PROPERTY, value: request.orderNo },
    ];
    if (item.sku) attributes.push({ key: "SKU", value: item.sku });
    for (const [key, value] of Object.entries(item.attributes ?? {})) {
      attributes.push({ key, value });
    }

    const line: DraftOrderLineInput = {
      title: item.title,
      quantity: item.quantity,
      customAttributes: attributes,
    };

    if (flavor.linePrice === "originalUnitPriceScalar") {
      // `Money` 标量 —— 纯字符串,**不带币种**。行价的币种由
      // `presentmentCurrencyCode` 定,这里再带一个反而可能跟它打架。
      line.originalUnitPrice = amount;
    } else if (flavor.linePrice === "originalUnitPriceMoneyInput") {
      line.originalUnitPrice = { amount, currencyCode: currency };
    } else {
      line.priceOverride = { amount, currencyCode: currency };
    }

    if (item.sku) line.sku = item.sku;
    return line;
  });

  const input: DraftOrderInput = {
    email: request.email,
    note: `${SHOPIFY_ORDER_TAG_PREFIX}${request.orderNo}`,
    tags: [`${SHOPIFY_ORDER_TAG_PREFIX}${request.orderNo}`],
    // 税我们自己算过了(本仓库算价),别让 Shopify 再叠一层
    taxExempt: true,
    presentmentCurrencyCode: currency,
    // 店铺里的「满减 / 打折」不许碰我们的价 —— 对账是最后一道,这里先关一道
    acceptAutomaticDiscounts: false,
    lineItems,
  };

  if (request.shippingCents > 0) {
    const amount = centsToAmountString(request.shippingCents);
    input.shippingLine = {
      title: "运费",
      price: buildShippingPrice({
        amount,
        currency,
        format: flavor.shippingPrice,
      }),
      // **不送 `handle`** —— 2026-11-05 线上踩过:
      // `Field 'handle' is not defined by type 'ShippingLineInput'`。
      // 运费是我们自己给的一行(不走店铺的运费规则),不带 handle 才不会
      // 被店铺的运费费率覆盖掉。
    };
  }

  if (request.shippingAddress) {
    const address = request.shippingAddress;
    input.shippingAddress = {
      firstName: address.recipientName,
      phone: address.phone,
      address1: address.detail,
      city: address.city,
      province: address.province,
      country: getDefaultCountry(),
    };
  }

  return input;
}

/** 我们算出来的总额(分) */
export function computeRequestTotalCents(request: PaymentRequest): number {
  const lines = request.items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0
  );
  return lines + request.shippingCents;
}

/**
 * 对账 —— Shopify 那边算出来的总额必须跟我们的**一分不差**
 *
 * 比的是 **`presentmentMoney`**(用户被收的那份),不是 `shopMoney`(结算
 * 那份)。结算那份是 Shopify 按自己的汇率换过的,本来就不该等于我们的数。
 *
 * 对不上就抛错:宁可这次支付失败,也不能给用户一个收了错钱的链接。
 */
export function assertSameTotal(params: {
  orderNo: string;
  /** 我们发过去的总额(分) */
  ourTotalCents: number;
  /** Shopify 算出来的总额(金额字符串,展示币种) */
  shopifyTotalAmount: string;
  /** 币种 —— 只用在错误信息里 */
  currency?: string;
}): void {
  const shopifyCents = amountStringToCents(params.shopifyTotalAmount);
  if (shopifyCents === params.ourTotalCents) return;

  const currency = params.currency ? params.currency.toUpperCase() : "";
  throw new PaymentProviderError(
    "shopify",
    `Shopify 草稿单金额对不上：订单 ${params.orderNo} 我们算的是 ` +
      `${centsToAmountString(params.ourTotalCents)}${currency},Shopify 算的是 ` +
      `${params.shopifyTotalAmount}${currency}` +
      "（店铺的自动折扣 / 税 / 运费规则可能改动了价格）"
  );
}

/** 建出来的草稿单 */
export interface ShopifyDraftOrder {
  /** Shopify 侧的 gid(`gid://shopify/DraftOrder/…`) */
  id: string;
  /** 订单名(`#D1` 之类) */
  name: string | null;
  /** 收银台地址 —— 用户跳过去付款 */
  invoiceUrl: string | null;
  /** 用户被收的总额(展示币种的最小单位) */
  totalCents: number;
}

/**
 * 建草稿单的 GraphQL
 *
 * ## `userErrors` 只选 `field` 和 `message`(**别加 `code`**)
 *
 * 2026-11-05 线上踩过:`Field 'code' doesn't exist on type 'UserError'`。
 *
 * `draftOrderCreate` 的 `userErrors` 在**不同的 API 版本上类型不一样**:
 * 旧版本是基类 `UserError`,新版本是 `DraftOrderUserError`(多了 `code`
 * 之类的字段)。**选 `code` 在旧版本上整条查询都验证不过** —— GraphQL 的
 * 验证是全有全无的,一个字段不认,整条 mutation 直接不执行(草稿单根本没
 * 建出来,报的是这个错,不是 Shopify 的业务报错)。
 *
 * `field` 和 `message` 是 `UserError` **接口上的字段** —— 哪个版本都在,
 * 具体类型是 `UserError` 还是 `DraftOrderUserError` 都能选。
 *
 * 代价:拿不到 `code` 那个机器可读的错误码。但反正是**没被用过的** ——
 * 下面把 `userErrors` 拼成话术时只读 `field` 和 `message`。
 */
export const DRAFT_ORDER_CREATE = `
  mutation MooncodaDraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
          presentmentMoney {
            amount
            currencyCode
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface DraftOrderCreateResult {
  draftOrderCreate: {
    draftOrder: {
      id: string;
      name: string | null;
      invoiceUrl: string | null;
      totalPriceSet: {
        shopMoney: { amount: string; currencyCode: string };
        presentmentMoney: { amount: string; currencyCode: string } | null;
      };
    } | null;
    userErrors: { field: string[] | null; message: string }[];
  };
}

/**
 * 发一次建单请求,顺手把「建对没有」检查掉
 *
 * 对账在这一步里 —— 见 `assertSameTotal`。
 */
async function sendDraftOrder(params: {
  input: DraftOrderInput;
  request: PaymentRequest;
  /** 展示币种 —— 用户被收的那个币种 */
  planCurrency: string;
}): Promise<ShopifyDraftOrder> {
  const { input, request, planCurrency } = params;

  const data = await shopifyGraphql<DraftOrderCreateResult>(
    DRAFT_ORDER_CREATE,
    { input }
  );

  const payload = data.draftOrderCreate;

  if (payload.userErrors.length > 0) {
    throw new PaymentProviderError(
      "shopify",
      payload.userErrors
        .map((error) =>
          `${error.field?.join(".") ?? ""} ${error.message}`.trim()
        )
        .join("; ")
    );
  }

  const draft = payload.draftOrder;
  if (!draft) {
    throw new PaymentProviderError("shopify", "Shopify 没有返回草稿单");
  }

  if (!draft.invoiceUrl) {
    throw new PaymentProviderError(
      "shopify",
      "Shopify 草稿单没有付款地址(invoiceUrl 为空)"
    );
  }

  // 对账比的是 `presentmentMoney` —— 用户被收的那份
  //
  // `shopMoney` 是结算币种的数(Shopify 按自己的汇率换过),本来就不该等于
  // 我们的数,拿它比会误报。
  const totalSet = draft.totalPriceSet;
  const presentment = totalSet.presentmentMoney ?? totalSet.shopMoney;
  const presentmentCurrency = presentment.currencyCode.toUpperCase();

  if (presentmentCurrency !== planCurrency) {
    throw new PaymentProviderError(
      "shopify",
      `币种对不上：我们按 ${planCurrency} 建的单,` +
        `Shopify 那边算出来的总额是 ${presentmentCurrency}`
    );
  }

  assertSameTotal({
    orderNo: request.orderNo,
    ourTotalCents: computeRequestTotalCents(request),
    shopifyTotalAmount: presentment.amount,
    currency: planCurrency,
  });

  return {
    id: draft.id,
    name: draft.name,
    invoiceUrl: draft.invoiceUrl,
    // 用户被收的总额(展示币种的最小单位)
    totalCents: amountStringToCents(presentment.amount),
  };
}

/**
 * 建一张 Shopify 草稿订单
 *
 * 四步:
 *
 * 1. **定展示币种** —— 店铺结算币种就是我们的价,或者 Markets 里启用了
 *    我们的价(见 `currency.ts`)。两条都不满足就**当场报错**,不猜汇率
 * 2. **建单** —— 我们算出来的价原样搬过去(我们的价那个币种)
 * 3. **对账** —— Shopify 算出来的 `presentmentMoney` 跟我们的一分不差
 * 4. **写法对不上就换一种** —— 见下面的写法阶梯
 */
export async function createShopifyDraftOrder(
  request: PaymentRequest
): Promise<ShopifyDraftOrder> {
  // **这条路不支持优惠码**(2026-11-08)
  //
  // 草稿单里没有折扣的概念(`acceptAutomaticDiscounts: false`),一个草稿单
  // 只能设一个总价。带着 `discountCents` 跑 → 我们这边减了折扣、Shopify
  // 按原价建单 ⇒ **对不上账**(收银台收的比订单应付多)。
  //
  // **不要**把折扣摊进各 item 的单价 —— 摊分会引入 `round` 误差,
  // `Σ round(xᵢ)` 跟 `round(Σ xᵢ)` 不一定相等,逐分相等直接被破坏。
  if ((request.discountCents ?? 0) > 0) {
    throw new PaymentProviderError("shopify", "这条通道不支持优惠码");
  }

  // 本仓库的价一律是 `PRICE_CURRENCY` —— 换算由 Shopify 做
  const requestCurrency = request.currency.toUpperCase();
  if (requestCurrency !== PRICE_CURRENCY) {
    throw new PaymentProviderError(
      "shopify",
      `本订单的币种是 ${requestCurrency},但这条通道的价一律是 ${PRICE_CURRENCY}`
    );
  }

  // 展示币种 —— 店铺得能收我们的价那个币种
  const shop = await getShopCurrencyInfo();
  const plan = resolvePresentmentCurrency({
    shopCurrency: shop.currencyCode,
    enabledPresentmentCurrencies: shop.enabledPresentmentCurrencies,
  });

  // 写法阶梯 —— 只有「字段形状对不上」才换一种写法重发
  //
  // 变量强制转换失败**不会建出草稿单**,所以重发是安全的(不会建出两张)。
  const tried: DraftOrderFlavor[] = [];
  let flavor: DraftOrderFlavor = DEFAULT_DRAFT_ORDER_FLAVOR;
  let lastError: unknown = null;

  for (;;) {
    tried.push(flavor);

    const input = buildDraftOrderInput({
      request,
      currencyCode: plan.presentmentCurrency,
      flavor,
    });

    try {
      return await sendDraftOrder({
        input,
        request,
        planCurrency: plan.presentmentCurrency,
      });
    } catch (error) {
      // 别的错误(金额对不上、凭据不对)原样往上抛 —— 换写法救不了那些
      if (!isFieldShapeError(error)) throw error;
      lastError = error;

      // 按错误指向的那一处换写法
      const next = nextDraftOrderFlavor({ current: flavor, error, tried });
      if (!next) break;
      flavor = next;
    }
  }

  throw new PaymentProviderError(
    "shopify",
    `Shopify 草稿单的字段形状跟当前 API 版本对不上` +
      `（试了 ${tried.length} 种写法）：` +
      (lastError instanceof Error ? lastError.message : String(lastError)) +
      "—— 跑 `pnpm tsx scripts/dump-shopify-input-schema.ts` 看店铺当前版本的字段"
  );
}
