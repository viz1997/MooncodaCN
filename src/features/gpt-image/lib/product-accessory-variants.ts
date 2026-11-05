/**
 * 配件变体字典 —— 2026-10-18 v1.6.0 配件矩阵的**代码侧真理源**
 *
 * 为什么要抽出来:这 19 行数据原先只活在 `src/db/seed-product-accessory-variants.ts`
 * 里(DB 写入脚本)。但 storefront 的定制工作台第 3 步(规格)要渲染配件选择器
 * (M 手办的底座 / 玻璃罩,R 钥匙扣的皮套 / 编织绳),需要**带加价**的变体列表 ——
 * 加价不该由前端现编一份,也不该等 DB 往返。
 *
 * 所以:数据抽到本模块,DB 写入脚本 import 它(行为不变,仍然是幂等 upsert),
 * storefront 的 mock 目录也 import 它。两边共用一份,不会漂。
 *
 * 数据来源:
 *  - R + leather  → 5 色(与 LEATHER_COLORS 字典一致)
 *  - R + braided_rope → 8 色(用户原话「钥匙扣配件可选编织绳颜色」)
 *  - M + stand → 3 种(磁性 / 木质 / 透明亚克力)
 *  - M + glass_cover → 3 种(4cm / 6cm / 8cm 罩)
 *
 * 总计 5 + 8 + 3 + 3 = 19 行。
 */

import type { AccessoryCode } from "./product-catalog";

/**
 * 一行配件变体。
 *
 * 字段与 `product_accessory_variant` 表一一对应(swatch 可空 = 非颜色类变体),
 * 外加一个**仅 UI 用**的 `appliesToSizesCm`:限定该变体能配哪些尺寸的主体。
 */
export interface ProductAccessoryVariant {
  productTypeCode: string;
  accessoryCode: AccessoryCode;
  variantCode: string;
  /** 中文名 */
  name: string;
  /** 英文名 */
  nameEn: string;
  /** 颜色 hex(如 "#C0392B");尺寸 / 材质类变体可空 */
  swatch: string | null;
  /** 加价(分);0 = 不加价;正数加价,负数减价 */
  priceDeltaCents: number;
  /** UI 排序;asc */
  sortOrder: number;
  /**
   * 适用的主体尺寸(cm)。空数组 = 不限。
   *
   * 只有玻璃罩需要限定:「8cm 玻璃罩」就是给 8cm 手办配的罩子,4cm 手办配
   * 8cm 罩没有意义(名字和实际也对不上)。底座 / 皮套 / 编织绳不限尺寸。
   */
  appliesToSizesCm: number[];
}

export const PRODUCT_ACCESSORY_VARIANTS: readonly ProductAccessoryVariant[] = [
  // ── R + leather:5 色(棕/黑/红/白/原色)──
  {
    productTypeCode: "R",
    accessoryCode: "leather",
    variantCode: "leather_brown",
    name: "棕色",
    nameEn: "Brown",
    swatch: "#6b4423",
    priceDeltaCents: 0,
    sortOrder: 10,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "R",
    accessoryCode: "leather",
    variantCode: "leather_black",
    name: "黑色",
    nameEn: "Black",
    swatch: "#222222",
    priceDeltaCents: 0,
    sortOrder: 20,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "R",
    accessoryCode: "leather",
    variantCode: "leather_red",
    name: "酒红",
    nameEn: "Wine Red",
    swatch: "#722f37",
    priceDeltaCents: 0,
    sortOrder: 30,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "R",
    accessoryCode: "leather",
    variantCode: "leather_white",
    name: "米白",
    nameEn: "Off-White",
    swatch: "#f5f0e8",
    priceDeltaCents: 0,
    sortOrder: 40,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "R",
    accessoryCode: "leather",
    variantCode: "leather_natural",
    name: "皮革原色",
    nameEn: "Natural",
    swatch: "#c19a6b",
    priceDeltaCents: 0,
    sortOrder: 50,
    appliesToSizesCm: [],
  },

  // ── R + braided_rope:8 色 ──
  {
    productTypeCode: "R",
    accessoryCode: "braided_rope",
    variantCode: "rope_red",
    name: "正红",
    nameEn: "Red",
    swatch: "#C0392B",
    priceDeltaCents: 200, // +¥2/件
    sortOrder: 10,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "R",
    accessoryCode: "braided_rope",
    variantCode: "rope_black",
    name: "墨黑",
    nameEn: "Black",
    swatch: "#1A1A1A",
    priceDeltaCents: 200,
    sortOrder: 20,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "R",
    accessoryCode: "braided_rope",
    variantCode: "rope_blue",
    name: "宝蓝",
    nameEn: "Royal Blue",
    swatch: "#1F4E79",
    priceDeltaCents: 200,
    sortOrder: 30,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "R",
    accessoryCode: "braided_rope",
    variantCode: "rope_green",
    name: "森林绿",
    nameEn: "Forest Green",
    swatch: "#2E5E3A",
    priceDeltaCents: 200,
    sortOrder: 40,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "R",
    accessoryCode: "braided_rope",
    variantCode: "rope_yellow",
    name: "明黄",
    nameEn: "Yellow",
    swatch: "#E8C547",
    priceDeltaCents: 200,
    sortOrder: 50,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "R",
    accessoryCode: "braided_rope",
    variantCode: "rope_purple",
    name: "丁香紫",
    nameEn: "Lilac",
    swatch: "#8B5A9F",
    priceDeltaCents: 200,
    sortOrder: 60,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "R",
    accessoryCode: "braided_rope",
    variantCode: "rope_white",
    name: "米白",
    nameEn: "Off-White",
    swatch: "#F5F0E8",
    priceDeltaCents: 200,
    sortOrder: 70,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "R",
    accessoryCode: "braided_rope",
    variantCode: "rope_brown",
    name: "焦糖棕",
    nameEn: "Caramel",
    swatch: "#A0734A",
    priceDeltaCents: 200,
    sortOrder: 80,
    appliesToSizesCm: [],
  },

  // ── M + stand:3 种 ──
  {
    productTypeCode: "M",
    accessoryCode: "stand",
    variantCode: "stand_magnetic",
    name: "磁性底座",
    nameEn: "Magnetic",
    swatch: null,
    priceDeltaCents: 500, // +¥5
    sortOrder: 10,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "M",
    accessoryCode: "stand",
    variantCode: "stand_wooden",
    name: "木质底座",
    nameEn: "Wooden",
    swatch: "#8B6F47",
    priceDeltaCents: 800, // +¥8
    sortOrder: 20,
    appliesToSizesCm: [],
  },
  {
    productTypeCode: "M",
    accessoryCode: "stand",
    variantCode: "stand_clear",
    name: "透明亚克力底座",
    nameEn: "Clear Acrylic",
    swatch: null,
    priceDeltaCents: 0,
    sortOrder: 30,
    appliesToSizesCm: [],
  },

  // ── M + glass_cover:3 种尺寸(各配同尺寸主体)──
  {
    productTypeCode: "M",
    accessoryCode: "glass_cover",
    variantCode: "glass_4",
    name: "4cm 玻璃罩",
    nameEn: "4cm Glass Cover",
    swatch: null,
    priceDeltaCents: 1500, // +¥15
    sortOrder: 10,
    appliesToSizesCm: [4],
  },
  {
    productTypeCode: "M",
    accessoryCode: "glass_cover",
    variantCode: "glass_6",
    name: "6cm 玻璃罩",
    nameEn: "6cm Glass Cover",
    swatch: null,
    priceDeltaCents: 2200, // +¥22
    sortOrder: 20,
    appliesToSizesCm: [6],
  },
  {
    productTypeCode: "M",
    accessoryCode: "glass_cover",
    variantCode: "glass_8",
    name: "8cm 玻璃罩",
    nameEn: "8cm Glass Cover",
    swatch: null,
    priceDeltaCents: 3000, // +¥30
    sortOrder: 30,
    appliesToSizesCm: [8],
  },
];

/** 取某个产品码 + 配件 code 下的全部变体(按 sortOrder 升序) */
export function getAccessoryVariants(
  productTypeCode: string,
  accessoryCode: AccessoryCode
): ProductAccessoryVariant[] {
  return PRODUCT_ACCESSORY_VARIANTS.filter(
    (v) =>
      v.productTypeCode === productTypeCode && v.accessoryCode === accessoryCode
  ).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** 取某个产品码下全部配件 code(去重,按字典首次出现顺序) */
export function getAccessoryCodes(productTypeCode: string): AccessoryCode[] {
  const out: AccessoryCode[] = [];
  for (const v of PRODUCT_ACCESSORY_VARIANTS) {
    if (v.productTypeCode !== productTypeCode) continue;
    if (!out.includes(v.accessoryCode)) out.push(v.accessoryCode);
  }
  return out;
}
