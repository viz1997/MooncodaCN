/**
 * 把后台配置**盖到**商城目录上 —— 纯函数(零 DB 依赖)
 *
 * ## 这份文件干什么
 *
 * 后台 `/admin/products` 管的是 DB 的 `product` 表(**6 个型号**),
 * 商城目录是代码里的 **12 件设计**。工作室 2026-11-14 的要求:
 * 「电商产品获取后台配置管理好的产品」⇒ 目录要**跟着后台走**:
 *
 * - 某个型号**下架** ⇒ 那几件设计从商城消失
 * - 改了**型号名** ⇒ 商品页上的型号标签跟着改
 * - 改了**排序** ⇒ 商城网格里的先后跟着改
 *
 * 纯函数那一半在这里(能被单测直接喂一份手写的数据),
 * 「读 DB」那一半在 `price-source.ts`。
 *
 * ## ⚠️ 粒度:后台管的是**型号**,商城卖的是**设计**
 *
 * | 粒度 | 数量 | 例子 |
 * |---|---|---|
 * | 型号(后台管的) | 6 | R / A / P / RM / LB / M |
 * | 设计(商城卖的) | 12 | 4 钥匙扣 + 4 手办 + 4 冰箱贴 |
 *
 * ⇒ **一个型号下架 ⇒ 那一组设计全部下架**。
 *
 * ## 系列顺序 = `WJP_SERIES` 代码常量(后台管不了)
 *
 * 「系列」(钥匙扣 / 手办 / 冰箱贴)是**营销资产** —— 首页色带 / 系列 chip /
 * 作品集 showcase 都摆 `WJP_SERIES.map(...)`,系列**之间**的顺序因此是
 * **代码常量**决定的。
 *
 * 后台的 `sortOrder` 只管**系列之内**哪个型号排前面。
 * 两条规则不打架:系列不动,系列内按后台排。
 *
 * ## 排序不会改变今天的样子
 *
 * 种子脚本按 `PRODUCT_TYPES` 的顺序写 `sortOrder`(R=10 / A=20 / P=30 /
 * RM=40 / LB=50 / M=60),而商城代码里的顺序恰好是同一个 ⇒
 * **接上后台之后,网格顺序一个字节都不变**(工作室改 `sortOrder` 才变)。
 */

import { WJP_SERIES } from "@/features/marketing/components/storefront/wjp-store-data";

import type { StorefrontProduct } from "../types";
import type {
  CatalogSource,
  CatalogTypeConfig,
  CatalogTypeRow,
} from "./catalog-source-types";

/** 「上架」那个字面值 —— DB 里只有它算上架 */
export const CATALOG_STATUS_ACTIVE = "active";

/* -------------------------------------------------------------------------- */
/*  造一份目录来源                                                             */
/* -------------------------------------------------------------------------- */

/** 空串 ⇒ `null`(=「没配」,用代码常量兜底) */
function normalizeText(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text ? text : null;
}

/**
 * 从 DB 的行造一份目录来源
 *
 * **纯函数** —— 不知道 DB 在哪儿,只吃行。
 */
export function buildCatalogSource(
  rows: readonly CatalogTypeRow[],
  degraded = false,
  readError: string | null = null
): CatalogSource {
  const types = new Map<string, CatalogTypeConfig>();
  for (const row of rows) {
    types.set(row.code, {
      code: row.code,
      name: normalizeText(row.name),
      nameEn: normalizeText(row.nameEn),
      status: row.status,
      sortOrder: row.sortOrder,
      accent: normalizeText(row.accent),
    });
  }
  return { types, degraded, readError };
}

/** 空目录(读失败时的兜底)—— 一切都按代码常量走 */
export function emptyCatalogSource(readError: string | null): CatalogSource {
  return buildCatalogSource([], true, readError);
}

/* -------------------------------------------------------------------------- */
/*  上架 / 下架                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 这个型号**在不在架上**
 *
 * 三态(跟小程序那条链路 `image-gen/lib/product-capability.ts` 一个口径):
 *
 * | DB 里 | 结果 |
 * |---|---|
 * | **没有这一行** | **上架** —— 回退代码默认(后台没管过它) |
 * | 有这一行,`status === "active"` | 上架 |
 * | 有这一行,`status` 是别的 | **下架** |
 *
 * ⚠️ **只有 `status === "active"` 才上架** —— 认不出来的一律当下架。
 * 那是小程序那条链路的口径(不是我们的),两边必须一样,否则同一件商品
 * 在小程序上买得到、在商城上买不到。
 *
 * ⚠️ **「没有行 ⇒ 上架」是刻意的** —— DB 读失败 / 后台还没播种过这一项时,
 * 商城要照常显示 12 件设计(而不是空店)。真要下架,后台存一行
 * `status = inactive` 就行。
 */
export function isCatalogTypeActive(
  typeCode: string,
  source: CatalogSource
): boolean {
  const config = source.types.get(typeCode);
  if (!config) return true;
  return config.status === CATALOG_STATUS_ACTIVE;
}

/* -------------------------------------------------------------------------- */
/*  盖                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 把后台配的**型号名 / 强调色**盖到一件设计上
 *
 * 盖的是 `typeLabel` / `typeLabelEn`(**型号名**,不是设计标题)跟 `accent`。
 *
 * **没配(空串)就不盖** —— 用回代码常量。
 *
 * ⚠️ **`description` / `coverUrl` / `leadTimeDays` 不盖** —— 那是**型号级**
 * 的字段,盖到**设计级**的字段上会把 4 件设计变成同一张图 / 同一段文案 /
 * 同一个工期。理由见 CLAUDE.md「电商产品读后台配置」那一节。
 */
export function applyCatalogConfig(
  item: StorefrontProduct,
  source: CatalogSource
): StorefrontProduct {
  const config = source.types.get(item.productTypeCode);
  if (!config) return item;

  const typeLabel = config.name ?? item.typeLabel;
  const typeLabelEn = config.nameEn ?? item.typeLabelEn;
  const accent = config.accent ?? item.accent;

  if (
    typeLabel === item.typeLabel &&
    typeLabelEn === item.typeLabelEn &&
    accent === item.accent
  ) {
    return item;
  }
  return { ...item, typeLabel, typeLabelEn, accent };
}

/* -------------------------------------------------------------------------- */
/*  排序                                                                       */
/* -------------------------------------------------------------------------- */

/** 系列 → 序号 —— `WJP_SERIES` 的顺序就是系列之间的顺序 */
const SERIES_RANK = new Map<string, number>(
  WJP_SERIES.map((series, index) => [series.id, index])
);

/** 不在 `WJP_SERIES` 里的系列排最后 */
function seriesRank(seriesId: string): number {
  return SERIES_RANK.get(seriesId) ?? WJP_SERIES.length;
}

/**
 * 这个设计的排序权重 —— 后台配的 `sortOrder`
 *
 * **没有 DB 行 ⇒ 排最后**(`Number.MAX_SAFE_INTEGER`)。
 *
 * ⚠️ **不能用 `Infinity`** —— 两个都没有 DB 行的设计一比就是
 * `Infinity - Infinity = NaN` ⇒ 比较函数返回 `NaN` ⇒ 排序行为未定义
 * (V8 容忍,但别的引擎不一定)。`MAX_SAFE_INTEGER` 相减是 `0`,稳。
 */
function sortWeight(item: StorefrontProduct, source: CatalogSource): number {
  const config = source.types.get(item.productTypeCode);
  return config ? config.sortOrder : Number.MAX_SAFE_INTEGER;
}

/**
 * 目录排序 —— **系列之间**按 `WJP_SERIES`,**系列之内**按后台的 `sortOrder`
 *
 * 同一个 `sortOrder` ⇒ 保持代码里的原序(用原下标兜底)。
 */
export function sortCatalogItems(
  items: readonly StorefrontProduct[],
  source: CatalogSource
): StorefrontProduct[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rank = seriesRank(a.item.seriesId) - seriesRank(b.item.seriesId);
      if (rank !== 0) return rank;
      const weight = sortWeight(a.item, source) - sortWeight(b.item, source);
      if (weight !== 0) return weight;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}
