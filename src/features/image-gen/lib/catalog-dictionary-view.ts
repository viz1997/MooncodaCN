/**
 * 目录字典 → 后台表单用的**可序列化视图模型**
 *
 * ## 为什么要有这一层
 *
 * `ProductEffectForm` 是**客户端组件** —— 它自己读不了 DB。而后台新加的尺寸 /
 * 配件必须出现在这个表单里(admin 选得到才谈得上「能配」)⇒ 字典得**从服务端
 * 传下来**。
 *
 * 而 `CatalogDictionary` 里装的是 `ReadonlyMap` —— **不可序列化**,过不了
 * RSC → client 的 props 边界 ⇒ 需要一份「纯数组」的视图模型。
 *
 * ## 数据来源的分工(别搞混)
 *
 * | 字段 | 来源 | 为什么 |
 * |---|---|---|
 * | 型号清单 | **字典** | 后台新加的型号必须出现 |
 * | 尺寸清单 | **字典** | 后台新加的尺寸必须出现 |
 * | 配件清单 | **字典** | 后台新加的配件必须出现 |
 * | 型号名 / 单位 / 能力标记 | **代码常量**(`PRODUCT_TYPES`) | 能力标记**不在**本次范围内(见 plan 的 skip 列表) |
 * | 皮革颜色 | **代码常量**(`LEATHER_COLORS`) | 压根不在字典范围内 |
 *
 * ## ⚠️ 只存在于 DB 的型号
 *
 * 能力标记是**代码常量**那一层的,DB 里没有对应列 ⇒ 一个只存在于 DB 的型号,
 * 能力全 `false`(不显示刻字 / 皮革色 / 保护套那几段)。
 *
 * ⇒ **这不是 bug,是范围**:能力标记留在代码里,后台这一轮只放「尺寸 / 配件 /
 * 配件变体」进 DB(工作室问的是「SKU 无法设置以及价格」)。
 *
 * ## 本文件是**纯函数**(零 DB 依赖)
 *
 * ⇒ 能进 vitest `unit` project 跑单测,客户端组件也能 import 它的**类型**。
 */

import type { ProductCapabilities } from "@/features/gpt-image/lib/product-catalog";
import { PRODUCT_TYPES } from "@/features/gpt-image/lib/product-catalog";
import type { CatalogDictionary } from "./catalog-dictionary";
import {
  accessoryCodesForType,
  sizeCodesForType,
} from "./catalog-dictionary";

/* -------------------------------------------------------------------------- */
/*  形状                                                                       */
/* -------------------------------------------------------------------------- */

/** 一个配件(给表单用) */
export interface CatalogAccessoryView {
  /** 配件 code */
  code: string;
  /** 中文名 */
  name: string;
  /** 英文名 */
  nameEn: string;
}

/** 一个型号(给表单用) */
export interface CatalogTypeView {
  /** 型号 code */
  code: string;
  /** 型号名(DB 里没有这一列 ⇒ 来自代码常量) */
  name: string;
  /** 尺寸单位(代码常量那一层) */
  unit: string;
  /** 该型号可选的尺寸码(字典顺序) */
  sizes: readonly string[];
  /** 该型号可配的配件(字典顺序) */
  accessories: readonly CatalogAccessoryView[];
  /** 能力标记(代码常量那一层) */
  capabilities: ProductCapabilities;
}

/** 整份视图 */
export interface CatalogDictionaryView {
  /** 型号清单(字典顺序 —— DB 里新加的型号接在代码常量那六个后面) */
  types: readonly CatalogTypeView[];
  /** 全部型号的尺寸**并集**(升序)—— 给「按规格定价」那几行用 */
  allSizes: readonly string[];
  /** 全局配件清单(字典顺序)—— 给「按规格定价」的配件那几行用 */
  allAccessories: readonly CatalogAccessoryView[];
}

/* -------------------------------------------------------------------------- */
/*  转换                                                                       */
/* -------------------------------------------------------------------------- */

/** 能力标记的「全关」默认值 —— 给只存在于 DB 的型号用 */
const NO_CAPABILITIES: ProductCapabilities = {
  canEngrave: false,
  canLeatherColor: false,
  canPvcProtection: false,
  canLeatherExposed: false,
  canHaveRemarks: false,
  canPlatform: false,
};

/**
 * 尺寸码排序 —— 数字升序,非数字的排后面再按字典序
 *
 * 尺寸码今天都是 `"4"` / `"6"` / `"11"` 这种数字字符串 ⇒ 按数字排才符合直觉
 * (按字符串排会得到 10 < 4 < 6)。
 */
function compareSizeCodes(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const aIsNum = Number.isFinite(na);
  const bIsNum = Number.isFinite(nb);
  if (aIsNum && bIsNum && na !== nb) return na - nb;
  if (aIsNum !== bIsNum) return aIsNum ? -1 : 1;
  return a.localeCompare(b);
}

/**
 * 字典 → 视图模型
 *
 * ⚠️ **逐型号兜底已经发生在上游**(`mergeCatalogDictionary` 里做完了)——
 * 这一层只负责「把 Map 摊成数组」,不做任何兜底判断。
 */
export function toCatalogDictionaryView(
  dictionary: CatalogDictionary
): CatalogDictionaryView {
  const types: CatalogTypeView[] = [];
  const sizeSet = new Set<string>();

  for (const typeCode of dictionary.typeOrder) {
    const codeType = PRODUCT_TYPES.find((t) => t.code === typeCode);

    const sizes = sizeCodesForType(dictionary, typeCode);
    for (const size of sizes) sizeSet.add(size);

    const accessories: CatalogAccessoryView[] = [];
    for (const accessoryCode of accessoryCodesForType(dictionary, typeCode)) {
      const def = dictionary.accessories.get(accessoryCode);
      accessories.push({
        code: accessoryCode,
        // 字典里没有这个配件(理论上不会 —— 合并时已经滤掉了)⇒ 退化成 code
        name: def?.name ?? accessoryCode,
        nameEn: def?.nameEn ?? accessoryCode,
      });
    }

    types.push({
      code: typeCode,
      name: codeType?.name ?? typeCode,
      unit: codeType?.unit ?? "cm",
      sizes,
      accessories,
      capabilities: codeType?.capabilities ?? NO_CAPABILITIES,
    });
  }

  const allAccessories: CatalogAccessoryView[] = [];
  for (const def of dictionary.accessories.values()) {
    allAccessories.push({
      code: def.code,
      name: def.name,
      nameEn: def.nameEn,
    });
  }

  return {
    types,
    allSizes: [...sizeSet].sort(compareSizeCodes),
    allAccessories,
  };
}
