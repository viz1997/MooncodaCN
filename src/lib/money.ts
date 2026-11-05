/**
 * 金额格式化 —— 全仓库唯一的「分 → 展示文本」入口
 *
 * ## 为什么不各写各的
 *
 * 仓库里一度有三套:
 * - `print-quote/lib/format.ts` 的 `formatCents`(收「分」)
 * - `mooncada/components/shared.tsx` 的 `formatCurrency`(收「元」)
 * - 商城各组件里手写的 `cents / 100` + `toLocaleString`
 *
 * 三套的单位不一样,混用出来的错(「差 100 倍」)在页面上**看不出来**,
 * 只会在对账时炸。所以统一到这里 —— **所有金额一律先算成整数分,展示
 * 时才除 100**。
 *
 * `mooncada/components/shared.tsx` 的 `formatCurrency` 收「元」,是给
 * 积分包那种**本来就按元存**的地方用的,没有跟着搬 —— 那类值不是分。
 *
 * 2026-11-05:默认币种从写死的 `CNY` 改成 `PRICE_CURRENCY`。**币种只有一
 * 处定义** —— 见 `@/config/currency`(现在是人民币)。
 */

import { PRICE_CURRENCY } from "@/config/currency";

/** 金额格式化选项 */
export interface FormatMoneyOptions {
  /** BCP-47 语言标记,默认 `zh-CN` */
  locale?: string;
  /** ISO 4217 货币码,默认 `PRICE_CURRENCY`(人民币) */
  currency?: string;
  /**
   * 整数金额要不要省掉小数位
   *
   * 默认 true:¥88 显示成「¥88」而不是「¥88.00」——
   * 整钱带两位小数看着像多收了。
   */
  hideTrailingZeros?: boolean;
}

/**
 * 分 → 「¥123.45」
 *
 * @param cents 整数分。**不是元** —— 传元进来会差 100 倍。
 */
export function formatCents(
  cents: number,
  options: FormatMoneyOptions = {}
): string {
  const {
    locale = "zh-CN",
    currency = PRICE_CURRENCY,
    hideTrailingZeros = true,
  } = options;

  const amount = cents / 100;
  const isWhole = Number.isInteger(amount);

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    // 「narrowSymbol」= 只用符号,不加「CN」前缀。zh-CN + CNY 的默认写法
    // 是「CN¥19.90」,给中文访客看人民币带个 CN 纯属多余。
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: hideTrailingZeros && isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * 分 → 「123.45」(不带货币符号)
 *
 * 给「表格里跟别的数字对齐」的场景用 —— 货币符号单独一列时,
 * 数字列应该是纯数字。
 */
export function formatCentsPlain(
  cents: number,
  options: FormatMoneyOptions = {}
): string {
  const { locale = "zh-CN", hideTrailingZeros = true } = options;
  const amount = cents / 100;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits:
      hideTrailingZeros && Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
