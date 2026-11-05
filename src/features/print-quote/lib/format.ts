/**
 * 打印服务报价的格式化helper
 *
 * ## 为什么不复用商城那个 `formatPrice`
 *
 * 商城以前有个收「元」(float)的 `formatPriceCNY`,这里一律收「分」(integer)。
 * 两边单位不同,硬复用会出「差 100 倍」这种错 —— 而且这类错在页面上
 * 看不出来,只会在对账时炸。所以这里单开一个收「分」的。
 *
 * 2026-11-05:商城那个 `formatPriceCNY` 删了,两边都用 `@/lib/money` 的
 * `formatCents`(收分)—— 一份格式化函数,不再有「元 / 分」两套。
 *
 * 2026-11-04:`formatCents` 的实现搬到了 `@/lib/money` —— 商城结算页
 * 也要用同一套「分 → 展示」,留在 feature 里就得复制一份。签名不变。
 */

import { formatCents as formatCentsShared } from "@/lib/money";

/** 分 → 「¥123.45」 */
export function formatCents(cents: number, locale = "zh-CN"): string {
  return formatCentsShared(cents, { locale });
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
