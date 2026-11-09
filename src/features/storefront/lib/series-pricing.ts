/**
 * 品类「起售价」—— 从**商品**算出来,不是写死的
 *
 * ## 为什么要有这个文件
 *
 * 商城首页摆的「钥匙扣 ¥19 起 / 冰箱贴 ¥39 起 / Q 版手办 ¥199 起」原先是
 * **两处写死的字符串**:
 *
 * - `wjp-store-data.ts` 的 `WJP_SERIES[].fromPriceCents`
 * - `store-hero.tsx` 里那三行价格锚点文案(直接写「¥19」「¥39」「¥199」)
 *
 * 后台 `/admin/products` 改了基础价,这两处**不会跟着变** ⇒ 工作室看到的是
 * 「卡片上的价变了、首页上的价没变」—— 又是「改了不生效」。
 *
 * ## 口径:起售价 = 该品类里**最便宜**那件的基础价
 *
 * 文案上写的是「起」,所以取 **min**,不是第一件、也不是平均值。
 * 一个品类里的几件商品基础价通常一样(同型号),但配件 / 尺寸加价不同 ——
 * 基础价取 min 才是「起」。
 *
 * ## 纯函数 —— 零 import
 *
 * 不引 `@/db`、不引 React —— 客户端组件能安全 import,单测也能直接跑。
 */

/** 只要有这两个字段就够算起售价 */
export interface PriceableProduct {
  readonly seriesId: string;
  readonly basePriceCents: number;
}

/** 静态品类定义(`WJP_SERIES` 的形状)—— `fromPriceCents` 是**兜底值** */
export interface SeriesLike {
  readonly id: string;
  readonly fromPriceCents: number;
}

/**
 * 每个品类的起售价 —— **只算商品里有的**
 *
 * 返回的 Map 里**没有**那些一件商品都没有的品类(调用方自己决定退回什么)。
 */
export function computeSeriesFromPriceCents(
  products: readonly PriceableProduct[],
  seriesIds: readonly string[]
): Map<string, number> {
  const wanted = new Set(seriesIds);
  const result = new Map<string, number>();

  for (const product of products) {
    if (!wanted.has(product.seriesId)) continue;
    const current = result.get(product.seriesId);
    if (current === undefined || product.basePriceCents < current) {
      result.set(product.seriesId, product.basePriceCents);
    }
  }

  return result;
}

/**
 * 每个品类的起售价 —— **商品的价优先**,查不到退回静态常量
 *
 * 「查不到」= 这个品类一件商品都没有(DB 里没播种 / 目录被换过)。
 * 那种情况下退回 `WJP_SERIES[].fromPriceCents` —— 静态常量降级成兜底,
 * 不再是真理源。
 */
export function resolveSeriesFromPrices(
  products: readonly PriceableProduct[],
  series: readonly SeriesLike[]
): Map<string, number> {
  const computed = computeSeriesFromPriceCents(
    products,
    series.map((s) => s.id)
  );
  const result = new Map<string, number>();
  for (const item of series) {
    result.set(item.id, computed.get(item.id) ?? item.fromPriceCents);
  }
  return result;
}

/**
 * 按 handle 挑商品 —— **保住 handles 的顺序**,挑不到的跳过
 *
 * 首屏拼贴 / 品类预览都要「按这个顺序摆这几件」,所以不能简单 filter。
 */
export function pickByHandle<T extends { handle: string }>(
  products: readonly T[],
  handles: readonly string[]
): T[] {
  const byHandle = new Map(
    products.map((product) => [product.handle, product])
  );
  const picked: T[] = [];
  for (const handle of handles) {
    const found = byHandle.get(handle);
    if (found) picked.push(found);
  }
  return picked;
}
