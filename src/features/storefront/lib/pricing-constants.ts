/**
 * 定价常量 —— **单独一个无依赖文件**
 *
 * ## 为什么要拆出来
 *
 * 定价常量原本住在 `pricing.ts` 里,那个文件 import 了 `mock-catalog.ts`
 * (800 多行的商品字典)。客户端组件只要一个「刻字费 ¥3」的数字,却因此
 * 把整个商品字典拖进了 bundle。
 *
 * 所以常量搬到这儿,`pricing.ts` 从这里 re-export(老 import 路径继续能用),
 * 客户端组件直接 import 这个文件。
 *
 * ## 这个文件里**不能** import 服务端模块
 *
 * 它会被客户端 bundle 直接引用 —— 一旦引入服务端模块(数据库 / node:fs),
 * 打包就会炸。纯常量 + 纯函数,零依赖。
 *
 * (唯一的例外是 `@/config/currency` —— 那个文件本身也是零依赖的纯常量,
 * 币种只有**一处**定义,两边各写一份必然会漂。)
 */

import { PRICE_CURRENCY, PRICE_REGION_ID } from "@/config/currency";

/* -------------------------------------------------------------------------- */
/*  常量                                                                      */
/* -------------------------------------------------------------------------- */

export const PRICING_CONSTANTS = {
  /** 刻字费用(分),即 ¥3 */
  ENGRAVING_FEE_CENTS: 300,
  /** 刻字最大长度 */
  MAX_ENGRAVING_LENGTH: 30,
  /** 单 line item 最大数量 */
  MAX_QUANTITY: 100,
  /** 加急订单加价(分),¥15 */
  RUSH_ORDER_FEE_CENTS: 1500,
  /** 免运费门槛(分),¥99 */
  FREE_SHIPPING_THRESHOLD_CENTS: 9900,
  /** 默认运费(分),¥8 */
  DEFAULT_SHIPPING_CENTS: 800,
  /** 货币代码 */
  CURRENCY_CODE: PRICE_CURRENCY,
  /** 区域 */
  REGION_ID: PRICE_REGION_ID,
} as const;

/**
 * 数量阶梯折扣
 *
 * 按**行数量**算 —— 不是购物车总额。(Sellbase 自带的折扣阈值是总额级的,
 * 表达不了「这一行买 10 个打九折」,所以折扣留在本仓库算。)
 */
export const QUANTITY_TIERS = [
  { minQty: 50, discountRate: 0.2 },
  { minQty: 10, discountRate: 0.1 },
  { minQty: 1, discountRate: 0 },
] as const;

/** 阶梯的一档 */
export interface QuantityTier {
  minQty: number;
  discountRate: number;
}

/**
 * 按数量取折扣档
 *
 * 数量往上找第一个 `minQty <= quantity` 的档位;找不到就取最小的那档
 * (数量为 0 / 负数时也走这里 —— 上层会先拦掉非法数量)。
 */
export function getQuantityTier(quantity: number): QuantityTier {
  const tier = QUANTITY_TIERS.find((t) => quantity >= t.minQty);
  return tier ?? QUANTITY_TIERS[QUANTITY_TIERS.length - 1]!;
}

/* -------------------------------------------------------------------------- */
/*  运费                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 运费(到达免运费门槛则 0)
 */
export function calculateShippingCents(subtotalCents: number): number {
  return subtotalCents >= PRICING_CONSTANTS.FREE_SHIPPING_THRESHOLD_CENTS
    ? 0
    : PRICING_CONSTANTS.DEFAULT_SHIPPING_CENTS;
}

/**
 * 距离免运费还差多少(用于 cart drawer 进度条)
 */
export function calculateRemainingForFreeShipping(
  subtotalCents: number
): number {
  return Math.max(
    0,
    PRICING_CONSTANTS.FREE_SHIPPING_THRESHOLD_CENTS - subtotalCents
  );
}

/**
 * 这张车的运费 —— **只看目录商品那一部分**(2026-11-08)
 *
 * ## 口径
 *
 * 打印服务跟目录商品**装同一张车**了(工作室的说法:「不要 print-order,
 * 进入商城那个」)。但两者的**钱**还是两套:
 *
 * - **目录商品**有运费:¥8,目录商品那部分小计到 ¥99 免
 * - **打印服务没有运费** —— 打印服务的价**就是报价本身**:购物袋里显示
 *   多少、工单上写多少、收银台收多少,是同一个数(见
 *   `print-quote/lib/payment.ts`:工单的支付金额恒等于 `total_price_cents`)。
 *   到结算时再加一笔运费,用户看到的总价跟实际收的钱就对不上了。
 *
 * 所以运费的**基数是目录商品那部分的折后小计**,打印服务的钱**不计入**
 * (它不产生快递费,也不该替目录商品把 ¥99 的门槛凑满)。
 *
 * ## 车里没有目录商品 → 运费 0
 *
 * 一车全是打印服务时,没有要寄的东西 —— 运费 0。这时候传进来的
 * `catalogSubtotalCents` 就是 0。
 *
 * ## 为什么放在这里
 *
 * 客户端(购物袋页 / 结算页)和服务端(结算)**都要**用这条规则。两处各写
 * 一遍的话,改了一处忘了另一处,就会出现「页面上没有运费、结算时收了一笔」。
 * 所以它跟 `calculateShippingCents()` 放在同一个文件里 —— 运费规则只有
 * 一处定义。
 */
export function shippingCentsForCart(catalogSubtotalCents: number): number {
  // 没有目录商品 → 没有要寄的东西 → 没有运费
  if (catalogSubtotalCents <= 0) return 0;
  return calculateShippingCents(catalogSubtotalCents);
}
