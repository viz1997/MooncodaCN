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
 * - 行项目是**自定义行**,`price` 由我们给 —— 不依赖商品目录,不用同步目录
 * - `taxExempt: true` —— 不会在总价上再叠一层税
 * - 运费也是我们自己给的一行 —— 不跟 Shopify 的运费规则走
 *
 * ## 币种:我们不换算,Shopify 换(2026-11-05)
 *
 * 本仓库的价**一律是人民币**,原样搬过去 —— **我们的代码里没有汇率**。
 *
 * 草稿订单的行价按**展示币种**(`presentmentCurrencyCode`)给,所以我们把
 * 展示币种设成人民币,用户付的就是 ¥27.00 —— 跟我们在自己站上算的**一分
 * 不差**。结算成美元是 Shopify 按它自己的汇率换的事,不是我们的定价。
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
 */

import {
  amountStringToCents,
  centsToAmountString,
} from "@/features/payments/lib/money";
import {
  PaymentProviderError,
  type PaymentRequest,
} from "@/features/payments/lib/types";

import { getShopCurrencyInfo, shopifyGraphql } from "./client";
import { PRICE_CURRENCY, resolvePresentmentCurrency } from "./currency";
import { SHOPIFY_ORDER_NO_PROPERTY } from "./order-reference";

/** 我们在 Shopify 侧留下的标记前缀 —— 回调靠它认出「这单是我们的」 */
export const SHOPIFY_ORDER_TAG_PREFIX = "mooncoda:";

/** 默认国家/地区码 —— 地址簿里没存国家,Shopify 的地址需要 */
function getDefaultCountry(): string {
  const raw = process.env.SHOPIFY_DEFAULT_COUNTRY?.trim();
  return (raw || "CN").toUpperCase();
}

/** 一行(自定义行) */
export interface DraftOrderLineInput {
  title: string;
  quantity: number;
  price: { amount: string; currencyCode: string };
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
   * **行价按这个币种给**(`DraftOrderLineItemInput.price` 的文档原话:
   * "The price in presentment currency")。我们把它设成人民币,行价也就是
   * 人民币 —— 原样搬过去,一个字节都不改。
   */
  presentmentCurrencyCode: string;
  /** 关掉店铺的自动折扣 —— 别让 Shopify 自作主张改我们的价 */
  acceptAutomaticDiscounts: boolean;
  lineItems: DraftOrderLineInput[];
  shippingLine?: {
    title: string;
    handle: string;
    price: { amount: string; currencyCode: string };
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
 * 把一次支付请求翻译成 Shopify 草稿单输入
 *
 * **纯函数** —— 不碰网络、不碰 env 里的密钥(只有国家码读了 env,给了默认值)。
 *
 * ## 「我们算出来的价」原样搬过去
 *
 * 一个字节都不改 —— **不换算**。展示币种是什么,行价就是那个币种的数。
 */
export function buildDraftOrderInput(params: {
  request: PaymentRequest;
  /** 展示币种 —— 一般就是人民币 */
  currencyCode: string;
}): DraftOrderInput {
  const { request, currencyCode } = params;
  const currency = currencyCode.toUpperCase();

  const lineItems: DraftOrderLineInput[] = request.items.map((item) => {
    const price = {
      amount: centsToAmountString(item.unitPriceCents),
      currencyCode: currency,
    };

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
      price,
      customAttributes: attributes,
    };
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
    input.shippingLine = {
      title: "运费",
      handle: "shipping",
      price: {
        amount: centsToAmountString(request.shippingCents),
        currencyCode: currency,
      },
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

/** 我们算出来的总额(分,人民币) */
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

const DRAFT_ORDER_CREATE = `
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
        code
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
 * 建一张 Shopify 草稿订单
 *
 * 四步:
 *
 * 1. **定展示币种** —— 店铺结算币种是人民币,或者 Markets 里启用了人民币
 *    (见 `currency.ts`)。两条都不满足就**当场报错**,不猜汇率
 * 2. **建单** —— 我们算出来的价原样搬过去(人民币)
 * 3. **对账** —— Shopify 算出来的 `presentmentMoney` 跟我们的一分不差
 */
export async function createShopifyDraftOrder(
  request: PaymentRequest
): Promise<ShopifyDraftOrder> {
  // 本仓库的价一律是人民币 —— 换算由 Shopify 做
  const requestCurrency = request.currency.toUpperCase();
  if (requestCurrency !== PRICE_CURRENCY) {
    throw new PaymentProviderError(
      "shopify",
      `本订单的币种是 ${requestCurrency},但这条通道的价一律是 ${PRICE_CURRENCY}`
    );
  }

  // 展示币种 —— 店铺得能收人民币
  const shop = await getShopCurrencyInfo();
  const plan = resolvePresentmentCurrency({
    shopCurrency: shop.currencyCode,
    enabledPresentmentCurrencies: shop.enabledPresentmentCurrencies,
  });

  const input = buildDraftOrderInput({
    request,
    currencyCode: plan.presentmentCurrency,
  });

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

  if (presentmentCurrency !== plan.presentmentCurrency) {
    throw new PaymentProviderError(
      "shopify",
      `币种对不上：我们按 ${plan.presentmentCurrency} 建的单,` +
        `Shopify 那边算出来的总额是 ${presentmentCurrency}`
    );
  }

  assertSameTotal({
    orderNo: request.orderNo,
    ourTotalCents: computeRequestTotalCents(request),
    shopifyTotalAmount: presentment.amount,
    currency: plan.presentmentCurrency,
  });

  return {
    id: draft.id,
    name: draft.name,
    invoiceUrl: draft.invoiceUrl,
    // 用户被收的总额(展示币种的最小单位)
    totalCents: amountStringToCents(presentment.amount),
  };
}
