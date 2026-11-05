/**
 * Shopify 通道的币种策略
 *
 * ## 我们**不换算** —— 让 Shopify 换
 *
 * 本仓库的价**一律是人民币**(`PRICE_CURRENCY`)。草稿订单的行价是**我们算出来
 * 的那个数**,原样搬过去 —— 我们的代码里**没有汇率**。
 *
 * ## Shopify 那边有两本账
 *
 * | 字段 | 是什么 |
 * |---|---|
 * | `presentmentMoney` | **用户被收的钱**(展示币种 = `presentmentCurrencyCode`) |
 * | `shopMoney` | **店铺结算的钱**(结算币种) |
 *
 * 草稿订单的**行价是按展示币种给的**(`DraftOrderLineItemInput.price` 的
 * 文档原话:"The price in presentment currency")。所以:
 *
 * ```text
 * presentmentCurrencyCode = CNY
 * 行价 = 我们算出来的 ¥12.50
 *   → 用户付 ¥27.00(12.50 × 2 + 6.00 运费)—— 跟我们自己站上算的**一分不差**
 *   → 结算成美元是 Shopify 的事(它按自己的汇率换),不是我们的定价
 * ```
 *
 * **「逐分相等」在展示币种上成立** —— 我们对账时比的就是
 * `presentmentMoney`,它必须跟我们发过去的数**一分不差**
 * (`draft-order.ts` 的 `assertSameTotal`)。
 *
 * ## 前提:店铺得能收人民币
 *
 * 两种配置任选其一:
 *
 * 1. **店铺结算币种就是人民币** —— 最省事,不用碰 Markets
 * 2. **Markets 里把人民币加成展示币种** —— 结算币种还是美元,用户在人民币
 *    这一层付钱(工作室 2026-11-05 的店铺是美元,走这条)
 *
 * 两条都不满足 → **建不了单**(Shopify 会拒)。我们**当场报错**并说清楚怎么改,
 * 绝不拿一个猜的汇率去收钱 —— 那正是 2026-11-05 线上那单栽的坑。
 *
 * ## 为什么不用「后端乘一个固定汇率」
 *
 * 早先的写法是:本仓库算人民币的价 → 后端乘一个写死的 `SHOPIFY_FX_RATE` →
 * 推成美元给 Shopify。那条路的问题不是「算错了」,而是**汇率是一个全局静态
 * 值**:涨了跌了都不知道,而且没有任何一方对「用户看到的数」负责。
 *
 * 现在定价权在 Shopify 那边:**它按自己的汇率换,而且在草稿单创建那一刻就把
 * 汇率锁死** —— 用户看到的价格、我们收到的钱,用的是同一个数。
 */

import { ShopifyNotConfiguredError } from "./errors";

/**
 * 本仓库的价是什么币种
 *
 * 一律人民币 —— 商品价、分、订单表的 `currency` 列全是 CNY。
 */
export const PRICE_CURRENCY = "CNY";

/**
 * 「用户被收的钱」的币种怎么定
 *
 * - `presentmentCurrency` —— 草稿订单的展示币种(用户被收的币种)
 * - `mode` —— 靠哪条路达成的(只用在日志和错误信息里)
 */
export interface PresentmentPlan {
  presentmentCurrency: string;
  mode: "shop_currency" | "markets";
}

/**
 * 定出这一单用哪个展示币种
 *
 * **纯函数** —— 不碰网络、不碰 env。参数都是查出来的,判定是纯计算。
 *
 * ## 两条路
 *
 * 1. **店铺结算币种就是我们的价**(`shopCurrency === priceCurrency`)→
 *    展示币种就是它,不需要 Markets,也不需要任何换算
 * 2. **Markets 里启用了我们的价**(`enabledPresentmentCurrencies` 里有它)→
 *    展示币种就是它,结算走 Shopify 自己的汇率
 *
 * ## 两条都不满足 → 报错
 *
 * **不猜汇率。** 报错信息里直接给出两条可执行的修法(改 Markets / 改店铺
 * 结算币种),工作室照着做就行。这类错是「没配好」——重试没用。
 */
export function resolvePresentmentCurrency(params: {
  /** 店铺的结算币种(`shop { currencyCode }`) */
  shopCurrency: string;
  /** 店铺启用的展示币种(`shop { enabledPresentmentCurrencies }`) */
  enabledPresentmentCurrencies: readonly string[];
  /** 本仓库的价是什么币种 —— 默认人民币 */
  priceCurrency?: string;
}): PresentmentPlan {
  const priceCurrency = (params.priceCurrency ?? PRICE_CURRENCY).toUpperCase();
  const shopCurrency = params.shopCurrency.toUpperCase();

  // 路 1:店铺结算币种就是人民币 —— 不用配 Markets
  if (shopCurrency === priceCurrency) {
    return { presentmentCurrency: priceCurrency, mode: "shop_currency" };
  }

  // 路 2:Markets 里人民币是启用状态
  const enabled = params.enabledPresentmentCurrencies.map((code) =>
    code.toUpperCase()
  );
  if (enabled.includes(priceCurrency)) {
    return { presentmentCurrency: priceCurrency, mode: "markets" };
  }

  // 两条都不满足 —— 说清楚怎么改
  throw new ShopifyNotConfiguredError(
    `Shopify 那边收不了人民币：店铺结算币种是 ${shopCurrency},` +
      `已启用的展示币种是 ${enabled.length > 0 ? enabled.join(" / ") : "(一个都没有)"}。` +
      `两条修法任选其一：① 在 Shopify 后台「设置 → 市场」里把 ${priceCurrency} ` +
      `加成展示币种(Markets);② 把店铺的结算币种改成 ${priceCurrency}。` +
      "改完不用改代码 —— 我们不换算,直接把人民币的价原样送过去。"
  );
}
