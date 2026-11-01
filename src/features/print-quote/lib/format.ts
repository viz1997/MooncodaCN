/**
 * 打印服务报价的格式化helper
 *
 * ## 为什么不复用商城的 `formatPriceCNY`
 *
 * 商城那个收「元」(float),这里一律收「分」(integer)。两边单位不同,
 * 硬复用会出「差 100 倍」这种错 —— 而且这类错在页面上看不出来,
 * 只会在对账时炸。所以这里单开一个收「分」的。
 */

/** 分 → 「¥123.45」 */
export function formatCents(cents: number, locale = "zh-CN"): string {
  const yuan = cents / 100;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: Number.isInteger(yuan) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(yuan);
}

/** 克重 → 「43 g」 */
export function formatGrams(grams: number): string {
  const rounded = Math.round(grams * 10) / 10;
  return `${rounded.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} g`;
}

/** 尺寸 → 「120.0 × 60.0 × 34.3 mm」 */
export function formatDims(
  dims: readonly [number, number, number],
  locale = "zh-CN"
): string {
  const fmt = (v: number) =>
    v.toLocaleString(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  return `${fmt(dims[0])} × ${fmt(dims[1])} × ${fmt(dims[2])} mm`;
}
