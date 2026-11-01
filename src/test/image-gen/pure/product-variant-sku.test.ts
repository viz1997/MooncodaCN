/**
 * SKU 编码与变体生成 —— 纯函数单元测试
 *
 * 2026-10-21：product_variant 表的初始行由 src/db/seed-products.ts 和
 * admin 的「补齐缺失 SKU」共用 product-variant-sku.ts 产出，两条路径必须
 * 生成完全一样的 SKU —— 否则 seed 出来的行和后台补出来的行会撞
 * product_variant_sku_uniq_idx。
 *
 * 覆盖：
 *  1) buildSku —— 段规范化（_ → -，大写）+ 尾部 N-A 截断
 *  2) buildVariantSeeds —— 笛卡尔积展开 + 价格公式
 *     a) 尺寸阶梯 idx × ¥5
 *     b) 配件变体加价叠加
 *     c) 无变体的配件（metal/magnet/bracket）出 N-A 行
 *     d) 无配件的产品（RM）每尺寸出 1 行
 *  3) buildAllVariantSeeds —— 按 productTypeCode 正确分区配件变体
 *  4) id 由 SKU 派生 → 重跑幂等
 *
 * 不走 DB：product-variant-sku.ts 只 import product-catalog 的常量，
 * 没有 @/db 依赖。
 */

import { describe, expect, it } from "vitest";

import { PRODUCT_TYPES } from "@/features/gpt-image/lib/product-catalog";
import {
  buildAllVariantSeeds,
  buildSku,
  buildVariantSeeds,
  NO_SEGMENT,
  SIZE_STEP_CENTS,
  variantIdFromSku,
} from "@/features/image-gen/lib/product-variant-sku";

// ----------------------------------------------------------------------
// Fixture
// ----------------------------------------------------------------------

function productTypeOf(code: string) {
  const pt = PRODUCT_TYPES.find((p) => p.code === code);
  if (!pt) throw new Error(`fixture 缺失: PRODUCT_TYPES 里没有 ${code}`);
  return pt;
}

/** R 钥匙扣：3 尺寸 ×（皮革 2 色 + 金属 1 + 编织绳 1） */
const R_VARIANTS = [
  {
    productTypeCode: "R",
    accessoryCode: "leather",
    variantCode: "leather_brown",
    priceDeltaCents: 0,
    sortOrder: 0,
  },
  {
    productTypeCode: "R",
    accessoryCode: "leather",
    variantCode: "leather_black",
    priceDeltaCents: 100,
    sortOrder: 1,
  },
  {
    productTypeCode: "M",
    accessoryCode: "stand",
    variantCode: "stand_magnetic",
    priceDeltaCents: 800,
    sortOrder: 0,
  },
];

/** M 手办：玻璃罩变体 —— 别名 glass_ ≠ 配件码 glass_cover，用来测「掐不掉」那条分支 */
const M_GLASS_VARIANTS = [
  {
    productTypeCode: "M",
    accessoryCode: "glass_cover",
    variantCode: "glass_4",
    priceDeltaCents: 1200,
    sortOrder: 0,
  },
];

/** R 钥匙扣：编织绳 —— 别名 rope_ 是配件码 braided_rope 的尾词，用来测「掐得掉」那条分支 */
const R_ROPE_VARIANTS = [
  {
    productTypeCode: "R",
    accessoryCode: "braided_rope",
    variantCode: "rope_red",
    priceDeltaCents: 300,
    sortOrder: 0,
  },
];

// ----------------------------------------------------------------------
// buildSku
// ----------------------------------------------------------------------

describe("buildSku", () => {
  it("四段齐全时全拼上，段内 _ 转 - 且大写", () => {
    expect(buildSku("R", "6", "leather", "leather_brown")).toBe(
      "R-6-LEATHER-BROWN"
    );
  });

  it("配件下无变体时截掉尾部 N-A", () => {
    expect(buildSku("R", "6", "metal", "")).toBe("R-6-METAL");
    expect(buildSku("M", "8", "stand", "")).toBe("M-8-STAND");
  });

  it("完全无配件无变体时只留 CODE-SIZE（相框 RM）", () => {
    expect(buildSku("RM", "6", "", "")).toBe("RM-6");
    expect(buildSku("RM", "6", NO_SEGMENT, NO_SEGMENT)).toBe("RM-6");
  });

  it("不截断 CODE-SIZE 两段（产品码和尺寸永远保留）", () => {
    expect(buildSku("R", "4", "", "")).toBe("R-4");
  });

  it("尺寸是裸数字也不补零，SKU 保持可读", () => {
    expect(buildSku("M", "12", "stand", "stand_wood")).toBe("M-12-STAND-WOOD");
  });
});

describe("buildSku —— 掐掉与配件重复的变体头部", () => {
  it("头部等于配件码时掐掉（leather + leather_brown）", () => {
    expect(buildSku("R", "6", "leather", "leather_brown")).toBe(
      "R-6-LEATHER-BROWN"
    );
    expect(buildSku("M", "8", "stand", "stand_magnetic")).toBe(
      "M-8-STAND-MAGNETIC"
    );
  });

  it("头部是配件码的尾词时也掐掉（braided_rope + rope_red）", () => {
    expect(buildSku("R", "4", "braided_rope", "rope_red")).toBe(
      "R-4-BRAIDED-ROPE-RED"
    );
  });

  it("头部对不上配件时原样保留，宁可冗余也不含糊（glass_cover + glass_4）", () => {
    // glass_ ≠ glass_cover 的尾词（尾词是 COVER），所以不掐
    expect(buildSku("M", "6", "glass_cover", "glass_4")).toBe(
      "M-6-GLASS-COVER-GLASS-4"
    );
  });

  it("别名与配件毫无关系时也不动（braided_rope + navy）", () => {
    expect(buildSku("R", "4", "braided_rope", "navy")).toBe(
      "R-4-BRAIDED-ROPE-NAVY"
    );
  });

  it("变体段只有一段时无从掐起，原样拼接", () => {
    expect(buildSku("R", "4", "leather", "brown")).toBe("R-4-LEATHER-BROWN");
  });

  it("无配件（N-A）时不掐，N-A 占位逻辑不受影响", () => {
    expect(buildSku("RM", "6", NO_SEGMENT, "N-A")).toBe("RM-6");
    expect(buildSku("RM", "6", "", "")).toBe("RM-6");
  });
});

describe("variantIdFromSku", () => {
  it("由 SKU 派生小写 id，同 SKU 幂等", () => {
    expect(variantIdFromSku("R-6-LEATHER-BROWN")).toBe(
      "pvar_r-6-leather-brown"
    );
    expect(variantIdFromSku("R-6-LEATHER-BROWN")).toBe(
      variantIdFromSku("R-6-LEATHER-BROWN")
    );
  });
});

// ----------------------------------------------------------------------
// buildVariantSeeds
// ----------------------------------------------------------------------

describe("buildVariantSeeds", () => {
  const ptR = productTypeOf("R");

  it("尺寸阶梯加价 = idx × ¥5", () => {
    const seeds = buildVariantSeeds({
      productCode: "R",
      basePriceCents: 1900,
      productType: ptR,
      accessoryVariants: R_VARIANTS,
    });
    // 第一个尺寸 4cm(idx 0)金属行：1900 + 0 + 0
    const size4Metal = seeds.find((s) => s.sku === "R-4-METAL");
    expect(size4Metal?.priceCents).toBe(1900);
    // 第二个尺寸 5cm(idx 1)：1900 + 500
    const size5Metal = seeds.find((s) => s.sku === "R-5-METAL");
    expect(size5Metal?.priceCents).toBe(1900 + SIZE_STEP_CENTS);
    // 第三个尺寸 6cm(idx 2)：1900 + 1000
    const size6Metal = seeds.find((s) => s.sku === "R-6-METAL");
    expect(size6Metal?.priceCents).toBe(1900 + 2 * SIZE_STEP_CENTS);
  });

  it("配件变体加价叠加在尺寸阶梯之上", () => {
    const seeds = buildVariantSeeds({
      productCode: "R",
      basePriceCents: 1900,
      productType: ptR,
      accessoryVariants: R_VARIANTS,
    });
    // 6cm(idx2) + 黑色皮革(+100)
    const brown = seeds.find((s) => s.sku === "R-6-LEATHER-BROWN");
    const black = seeds.find((s) => s.sku === "R-6-LEATHER-BLACK");
    expect(brown?.priceCents).toBe(1900 + 2 * SIZE_STEP_CENTS + 0);
    expect(black?.priceCents).toBe(1900 + 2 * SIZE_STEP_CENTS + 100);
  });

  it("无变体的配件产出 1 行 N-A", () => {
    const seeds = buildVariantSeeds({
      productCode: "R",
      basePriceCents: 1900,
      productType: ptR,
      accessoryVariants: R_VARIANTS,
    });
    const metal = seeds.filter((s) => s.accessoryCode === "metal");
    // 3 个尺寸各 1 行
    expect(metal).toHaveLength(3);
    expect(metal.every((s) => s.variantCode === NO_SEGMENT)).toBe(true);
  });

  it("无配件的产品每个尺寸出 1 行", () => {
    const seeds = buildVariantSeeds({
      productCode: "RM",
      basePriceCents: 4900,
      productType: productTypeOf("RM"),
      accessoryVariants: [],
    });
    // 相框 3 个尺寸 × 无配件
    expect(seeds).toHaveLength(3);
    expect(seeds.map((s) => s.sku)).toEqual(["RM-6", "RM-8", "RM-11"]);
    expect(seeds.every((s) => s.accessoryCode === NO_SEGMENT)).toBe(true);
    expect(seeds.map((s) => s.priceCents)).toEqual([
      4900,
      4900 + SIZE_STEP_CENTS,
      4900 + 2 * SIZE_STEP_CENTS,
    ]);
  });

  it("basePriceCents 不传时回退 BASE_PRICE_CENTS 字典", () => {
    const seeds = buildVariantSeeds({
      productCode: "P",
      productType: productTypeOf("P"),
      accessoryVariants: [],
    });
    // P = ¥39
    expect(seeds[0]?.priceCents).toBe(3900);
  });

  it("glass_cover 的变体头掐不掉，SKU 冗余但不含糊", () => {
    const seeds = buildVariantSeeds({
      productCode: "M",
      basePriceCents: 19900,
      productType: productTypeOf("M"),
      accessoryVariants: M_GLASS_VARIANTS,
    });
    const glass4 = seeds.find((s) => s.sku.endsWith("-GLASS-COVER-GLASS-4"));
    expect(glass4).toBeDefined();
    // 首尺寸 idx=0 → 无阶梯加价，只有配件变体 +¥12
    expect(glass4?.priceCents).toBe(19900 + 1200);
  });

  it("编织绳变体头被掐掉，accessoryCode / variantCode 列仍存完整值", () => {
    const seeds = buildVariantSeeds({
      productCode: "R",
      basePriceCents: 1900,
      productType: ptR,
      accessoryVariants: R_ROPE_VARIANTS,
    });
    const rope = seeds.find((s) => s.sku === "R-4-BRAIDED-ROPE-RED");
    expect(rope?.accessoryCode).toBe("braided_rope");
    expect(rope?.variantCode).toBe("rope_red");
    expect(rope?.priceCents).toBe(1900 + 300);
  });

  it("sortOrder 连续递增，可从 startSortOrder 接续", () => {
    const seeds = buildVariantSeeds({
      productCode: "R",
      basePriceCents: 1900,
      productType: ptR,
      accessoryVariants: R_VARIANTS,
      startSortOrder: 100,
    });
    const orders = seeds.map((s) => s.sortOrder);
    expect(orders[0]).toBe(100);
    expect(orders).toEqual(orders.map((_, i) => 100 + i));
  });

  it("SKU 全局唯一（product_variant_sku_uniq_idx 依赖这个性质）", () => {
    const seeds = buildVariantSeeds({
      productCode: "R",
      basePriceCents: 1900,
      productType: ptR,
      accessoryVariants: R_VARIANTS,
    });
    expect(new Set(seeds.map((s) => s.sku)).size).toBe(seeds.length);
    expect(new Set(seeds.map((s) => s.id)).size).toBe(seeds.length);
  });
});

// ----------------------------------------------------------------------
// buildAllVariantSeeds
// ----------------------------------------------------------------------

describe("buildAllVariantSeeds", () => {
  it("配件变体按 productTypeCode 正确分区，不串味", () => {
    const all = buildAllVariantSeeds({
      basePrices: { R: 1900, M: 19900 },
      accessoryVariants: R_VARIANTS,
    });
    // R 不能拿到 M 的 stand 变体
    const rSkus = all.filter((s) => s.productCode === "R").map((s) => s.sku);
    expect(rSkus.some((s) => s.includes("STAND"))).toBe(false);
    // M 能拿到自己的 stand 变体
    const mSkus = all.filter((s) => s.productCode === "M").map((s) => s.sku);
    expect(mSkus).toContain("M-4-STAND-MAGNETIC");
    expect(mSkus).toContain("M-8-STAND-MAGNETIC");
  });

  it("全 6 个产品生成，SKU 全局不重复", () => {
    const all = buildAllVariantSeeds({
      accessoryVariants: R_VARIANTS,
    });
    const codes = new Set(all.map((s) => s.productCode));
    // PRODUCT_TYPES 的 6 个型号都要有 SKU —— 连无配件的 RM 也会按尺寸出行
    expect(codes.size).toBe(6);
    expect(new Set(all.map((s) => s.sku)).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((s) => s.priceCents > 0)).toBe(true);
  });

  it("basePrices 覆盖字典价", () => {
    const all = buildAllVariantSeeds({
      basePrices: { RM: 9999 },
      accessoryVariants: [],
    });
    const rm = all.find((s) => s.sku === "RM-6");
    expect(rm?.priceCents).toBe(9999);
  });
});
