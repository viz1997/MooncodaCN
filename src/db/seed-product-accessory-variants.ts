/**
 * Seed:product_accessory_variant 表 —— 2026-10-18 v1.6.0
 *
 * 跑法:
 *   pnpm db:push                        # 先把表推到 DB
 *   pnpm tsx src/db/seed-product-accessory-variants.ts
 *
 * 幂等:ON CONFLICT (product_type_code, accessory_code, variant_code) DO NOTHING。
 *
 * 数据来源:
 *  - R + leather  → 5 色(与 LEATHER_COLORS 字典一致,LB 也用这套色板)
 *  - R + braided_rope → 8 色(用户原话「钥匙扣配件可选编织绳颜色」)
 *  - M + stand → 3 种(磁性 / 木质 / 透明,UI 仅区分材质)
 *  - M + glass_cover → 3 种(4cm / 6cm / 8cm 罩)
 *
 * 总计 5 + 8 + 3 + 3 = 19 行。
 */

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { productAccessoryVariant } from "@/db/schema";

/**
 * Seed 数据。
 *
 * 注意 swatch = null 表示「非颜色类变体」(如玻璃罩 4cm,无 hex)。
 * priceDeltaCents 单位为分,0 = 不加价;正数加价,负数减价。
 */
const SEEDS: Array<{
  productTypeCode: string;
  accessoryCode: string;
  variantCode: string;
  name: string;
  nameEn: string;
  swatch: string | null;
  priceDeltaCents: number;
  sortOrder: number;
}> = [
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
  },
  {
    productTypeCode: "R",
    accessoryCode: "leather",
    variantCode: "leather_black",
    name: "黑色",
    nameEn: "Black",
    swatch: "#1a1a1a",
    priceDeltaCents: 0,
    sortOrder: 20,
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
  },

  // ── M + glass_cover:3 种尺寸 ──
  {
    productTypeCode: "M",
    accessoryCode: "glass_cover",
    variantCode: "glass_4",
    name: "4cm 玻璃罩",
    nameEn: "4cm Glass Cover",
    swatch: null,
    priceDeltaCents: 1500, // +¥15
    sortOrder: 10,
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
  },
];

async function main(): Promise<void> {
  console.log(
    `[seed-product-accessory-variants] 准备写入 ${SEEDS.length} 行变体数据...`
  );
  // 幂等写入:依赖 pav_uniq_idx UNIQUE (product_type_code, accessory_code, variant_code)
  const result = await db
    .insert(productAccessoryVariant)
    .values(
      SEEDS.map((s) => ({
        id: `pav_${s.productTypeCode}_${s.accessoryCode}_${s.variantCode}`,
        ...s,
      }))
    )
    .onConflictDoNothing({
      target: [
        productAccessoryVariant.productTypeCode,
        productAccessoryVariant.accessoryCode,
        productAccessoryVariant.variantCode,
      ],
    })
    .returning({ id: productAccessoryVariant.id });

  console.log(
    `[seed-product-accessory-variants] 实际写入 ${result.length} 行(其余已存在,跳过)`
  );
  console.log("[seed-product-accessory-variants] 完成。");
}

process.exitCode = 0;
main()
  .then(() => {
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("[seed-product-accessory-variants] 失败:", err);
    process.exit(1);
  });

// 让 biome 不报「unused import sql」错(留着供后续 .raw() 用)
void sql;
