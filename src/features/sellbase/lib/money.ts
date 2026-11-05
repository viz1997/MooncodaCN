/**
 * 金额换算:本仓库的「分」↔ Sellbase 的「最小货币单位」
 *
 * ## 两种「分」不是一回事
 *
 * - 本仓库的金额单位是 **人民币分**(1/100 CNY)
 * - Sellbase 的金额单位是 **店铺 `default_currency` 的最小单位**
 *
 * 店铺币种是 CNY 时两者**恰好是 1:1**(CNY 的最小单位就是分),所以
 * 绝大多数时候这两个函数是恒等函数。换成别的币种时,CNY 的分和目标币种
 * 的最小单位就不是一回事了 —— 比如 USD 的最小单位是 1/100 USD,
 * 比人民币的分值钱。
 *
 * ## 换算公式
 *
 * ```
 * 分 → 目标最小单位:  round(cents × rate)      rate = 1 CNY 值多少目标币种
 * 目标最小单位 → 分:  round(amount ÷ rate)
 * ```
 *
 * CNY 时 rate = 1,两个方向都是恒等。
 *
 * ## 精度
 *
 * 换算会引入取整误差(最多 0.5 个最小单位)。所以**本仓库的订单表里存的是
 * 本仓库口径的原始分**,Sellbase 那边记的是换算后的钱 —— 对不上时以
 * 本仓库的口径为准展示,Sellbase 那边记的是**实际收了多少**。
 */

/** 金额换算错误 —— 币种配错了才会抛 */
export class SellbaseCurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SellbaseCurrencyError";
  }
}

/** 1 CNY = 多少目标币种 */
export interface CurrencyConversion {
  /** 目标币种(小写 iso) */
  currency: string;
  /** 1 CNY 值多少目标币种 */
  rate: number;
}

/**
 * 从 env 读换算配置
 *
 * `SELLBASE_CURRENCY` 决定目标币种,`SELLBASE_FX_RATE` 决定汇率。
 * 币种是 CNY 而汇率不是 1 —— 配置矛盾,直接报错(不然收的钱是错的)。
 */
export function getCurrencyConversion(
  currency: string,
  rate: number
): CurrencyConversion {
  const normalized = currency.toLowerCase();

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new SellbaseCurrencyError(
      `Sellbase 汇率不合法：SELLBASE_FX_RATE=${rate}(必须是正数)`
    );
  }

  if (normalized === "cny" && rate !== 1) {
    throw new SellbaseCurrencyError(
      "Sellbase 币种是 CNY 时汇率必须为 1 —— 现在两个变量对不上，收的钱会错"
    );
  }

  return { currency: normalized, rate };
}

/**
 * 本仓库的分 → Sellbase 最小单位
 */
export function centsToStoreAmount(
  cents: number,
  conversion: CurrencyConversion
): number {
  return Math.round(cents * conversion.rate);
}

/**
 * Sellbase 最小单位 → 本仓库的分
 */
export function storeAmountToCents(
  amount: number,
  conversion: CurrencyConversion
): number {
  return Math.round(amount / conversion.rate);
}

/**
 * 两个金额是否「差在取整误差内」
 *
 * 换算 + 取整之后,两边最多差 1 个最小单位(= 1 分 CNY)。对账时用这个
 * 判断「是不是只是取整问题」,而不是「账对不上」。
 */
export function amountsMatchWithinRounding(
  cents: number,
  storeAmount: number,
  conversion: CurrencyConversion
): boolean {
  return Math.abs(centsToStoreAmount(cents, conversion) - storeAmount) <= 1;
}
