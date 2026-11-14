/**
 * 目录字典 → 商城商品 —— **纯 overlay**
 *
 * ## 这个文件干什么
 *
 * 尺寸 / 配件 / 加价以前住在**代码常量**里(`PRODUCT_TYPES` /
 * `PRODUCT_ACCESSORY_VARIANTS`)。今天它们搬进 DB 了
 * (`src/features/image-gen/lib/catalog-dictionary.ts`)。
 *
 * 这个文件把**字典**翻译成**商城自己的形状**(`Size` / `AccessoryGroup`),
 * 好让:
 *
 * - **显示那条路**(`storefront-catalog.ts`)把它盖到商品上;
 * - **算钱那条路**(`pricing.ts`)从同一份里取尺寸和配件加价。
 *
 * ⇒ 显示的价和收的价**结构上不可能对不上** —— 它们读的是同一个对象。
 *
 * ## 为什么单独一个文件
 *
 * `mock-catalog.ts` 是**客户端安全的静态目录** —— 它**不许** import
 * `@/db`(有测试扫:`db-price.test.ts` 的守卫④)。而字典那一半要连 DB
 * (`catalog-dictionary-store.ts`)。
 *
 * ⇒ 两边分开:这个文件**零 import**(除了纯类型 + 纯常量模块),
 * 服务端那一份负责把字典读出来、把结果传进来。
 *
 * ## 形状必须跟 `mock-catalog.ts` 逐字节一致
 *
 * 兜底那一份字典(`buildCatalogDictionaryFromCodeConstants()`)翻译出来的
 * 结果,必须跟今天 `mock-catalog.ts` 的 `buildSizesForType` /
 * `buildAccessoryGroups` **完全一样** —— 否则「DB 还没播种」的那一刻,
 * 商城页面上显示的尺寸加价会跟以前不一样。
 *
 * 三条口径:
 *
 * 1. **尺寸 id = `size_${typeCode}_${cm}`** —— 跟 `mock-catalog.ts` 一样
 *    (注意是**数字** cm,不是尺寸码原文:尺寸码 `"04"` 也会变成 `size_R_4`)。
 * 2. **空配件分组不渲染** —— 跟 `mock-catalog.ts` 一样(没有变体的配件
 *    分组整个不出现)。
 * 3. **变体排序 = `(sortOrder, variantCode)`** —— `mock-catalog.ts` 只按
 *    `sortOrder` 排(稳定排序)。今天代码常量里同一分组内的 `sortOrder`
 *    互不相同 ⇒ 两个口径**结果一样**;加上 `variantCode` 是为了让
 *    **DB 那条路**也是确定的(后台拖出来的顺序不会飘)。
 */

import {
  accessoryCodesForType,
  accessoryDef,
  accessoryVariantsFor,
  sizeCodesForType,
  sizeDeltaCentsFor,
} from "@/features/image-gen/lib/catalog-dictionary";
import type { CatalogDictionary } from "@/features/image-gen/lib/catalog-dictionary";
import type {
  AccessoryGroup,
  AccessoryVariant,
  ProductTypeCode,
  Size,
  StorefrontProduct,
} from "../types";
import type { PriceCatalog, PriceCatalogType } from "./price-source-types";

/* -------------------------------------------------------------------------- */
/*  内部小工具                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 尺寸码 → 厘米数
 *
 * ⚠️ 尺寸码**必须是数字** —— `Size.cm` 是 `number`,而 `mock-catalog.ts`
 * 也是 `Number(sizeStr)`。认不出来(空串 / 非数字)的**跳过那一档** ——
 * 摆在页面上的尺寸没法渲染。
 */
function cmOfSizeCode(sizeCode: string): number | null {
  const cm = Number(sizeCode);
  return Number.isFinite(cm) ? cm : null;
}

/**
 * 型号 code → `ProductTypeCode`
 *
 * ⚠️ 这是**一次有记录的窄化** —— `ProductTypeCode` 是 6 个字面量的闭集,
 * 而字典里可能有后台新建的型号(它的 code 不在那 6 个里)。
 *
 * 窄化本身是安全的:字典里那个新型号**还没有商城商品**
 * (`StorefrontProduct.productTypeCode` 装不下它),所以这一档压根不会被
 * 显示页 / 结算页读到。真正读到的永远是那 6 个之一。
 */
function asProductTypeCode(typeCode: string): ProductTypeCode {
  return typeCode as ProductTypeCode;
}

/** 变体排序:先 `sortOrder`,同值按 `variantCode` */
function bySortOrderThenVariantCode(
  a: { sortOrder: number; variantCode: string },
  b: { sortOrder: number; variantCode: string }
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.variantCode.localeCompare(b.variantCode);
}

/* -------------------------------------------------------------------------- */
/*  字典 → 商城形状                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 一个型号的尺寸档
 *
 * - 顺序 = 字典顺序(`sortOrder` 排过)
 * - 加价 = **显式值**(DB 里是什么就是什么,不靠下标算)
 * - 加价查不到 ⇒ **跳过那一档**(不当成 0)
 */
function buildSizes(
  dictionary: CatalogDictionary,
  typeCode: string
): Size[] {
  const sizes: Size[] = [];
  const seenIds = new Set<string>();
  for (const sizeCode of sizeCodesForType(dictionary, typeCode)) {
    const cm = cmOfSizeCode(sizeCode);
    if (cm === null) continue;
    const delta = sizeDeltaCentsFor(dictionary, typeCode, sizeCode);
    // 查不到加价 ⇒ 跳过(**不当成 0** —— 那会把某一档的价算错)
    if (delta === null) continue;
    const id = `size_${typeCode}_${cm}`;
    // 尺寸码 `"4"` 和 `"04"` 会撞出同一个 id —— 留第一个
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    sizes.push({
      id,
      cm,
      surchargeCents: delta,
      appliesTo: [asProductTypeCode(typeCode)],
    });
  }
  return sizes;
}

/**
 * 一个型号的配件分组
 *
 * - 分组顺序 = 字典里「这个型号能配哪些配件」的顺序
 * - **没有变体的分组整个不出现**(跟 `mock-catalog.ts` 一个口径)
 * - 变体排序 = `(sortOrder, variantCode)`
 */
function buildAccessoryGroups(
  dictionary: CatalogDictionary,
  typeCode: string
): AccessoryGroup[] {
  const groups: AccessoryGroup[] = [];
  for (const accessoryCode of accessoryCodesForType(dictionary, typeCode)) {
    const variants = [...accessoryVariantsFor(dictionary, typeCode, accessoryCode)]
      .sort(bySortOrderThenVariantCode)
      .map<AccessoryVariant>((variant) => ({
        // ⚠️ 键跟 `spec.accessoryVariantIds` 里那个字符串一模一样
        id: `acc_${variant.variantCode}`,
        code: variant.variantCode,
        name: variant.name,
        nameEn: variant.nameEn,
        swatch: variant.swatch,
        // 显式加价 —— 不是下标算出来的
        surchargeCents: variant.priceDeltaCents,
        appliesToSizesCm: [...variant.appliesToSizesCm],
      }));
    // 空分组不渲染
    if (variants.length === 0) continue;
    const meta = accessoryDef(dictionary, accessoryCode);
    groups.push({
      code: accessoryCode,
      // 认不出来就用 code 顶上(跟 `mock-catalog.ts` 的 `?? accCode` 一个口径)
      name: meta?.name ?? accessoryCode,
      nameEn: meta?.nameEn ?? accessoryCode,
      variants,
    });
  }
  return groups;
}

/**
 * 把整份字典翻译成商城能直接用的目录
 *
 * @param dictionary 合并后的字典(DB 行 × 代码常量兜底)
 */
export function buildPriceCatalog(dictionary: CatalogDictionary): PriceCatalog {
  const byType = new Map<string, PriceCatalogType>();
  const sizesById = new Map<string, Size>();
  const variantsById = new Map<string, AccessoryVariant>();

  for (const typeCode of dictionary.typeOrder) {
    const sizes = buildSizes(dictionary, typeCode);
    const accessoryGroups = buildAccessoryGroups(dictionary, typeCode);
    byType.set(typeCode, { sizes, accessoryGroups });

    for (const size of sizes) {
      // 尺寸 id 带型号(`size_R_4`)⇒ 跨型号不会撞
      sizesById.set(size.id, size);
    }
    for (const group of accessoryGroups) {
      for (const variant of group.variants) {
        // ⚠️ `variantCode` 全局唯一(后台加变体时查重)⇒ 这里不会撞。
        // 万一撞了,**先来的赢**(跟 `findAccessoryVariant` 的口径一致)。
        if (!variantsById.has(variant.id)) variantsById.set(variant.id, variant);
      }
    }
  }

  return { byType, sizesById, variantsById };
}

/* -------------------------------------------------------------------------- */
/*  盖到商品上                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 把字典里的尺寸 / 配件盖到商品上
 *
 * - **没有目录字典** ⇒ 原样返回(退回代码常量那一套)
 * - **字典里没有这个型号** ⇒ 原样返回
 * - 否则 ⇒ 换掉 `sizes` 和 `accessoryGroups`
 *
 * ⚠️ **只换这两样** —— 基础价 / 名称 / 封面 / 交期那些是**型号级 / 设计级**
 * 的资料,归 `applyCatalogConfig` 管,这里不碰(换掉就会把 4 件设计变成同一张图)。
 */
export function applyCatalogDictionaryToProduct(
  item: StorefrontProduct,
  catalog: PriceCatalog | null | undefined
): StorefrontProduct {
  if (!catalog) return item;
  const type = catalog.byType.get(item.productTypeCode);
  if (!type) return item;
  return {
    ...item,
    sizes: [...type.sizes],
    accessoryGroups: [...type.accessoryGroups],
  };
}
