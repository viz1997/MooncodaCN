import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SIZE_STEP_CENTS,
  accessoryCodesForType,
  accessoryDef,
  accessoryVariantDef,
  accessoryVariantsFor,
  buildCatalogDictionaryFromCodeConstants,
  mergeCatalogDictionary,
  normalizeAccessoryCategory,
  sizeCodesForType,
  sizeDefFor,
  sizeDeltaCentsFor,
  typeCodes,
} from "@/features/image-gen/lib/catalog-dictionary";
import type {
  CatalogAccessoryRowLike,
  CatalogAccessoryVariantRowLike,
  CatalogDictionaryDbRows,
  CatalogSizeRowLike,
} from "@/features/image-gen/lib/catalog-dictionary";
import {
  ACCESSORIES,
  ACCESSORY_META,
  PRODUCT_TYPES,
} from "@/features/gpt-image/lib/product-catalog";
import { PRODUCT_ACCESSORY_VARIANTS } from "@/features/gpt-image/lib/product-accessory-variants";

/**
 * 商品目录字典 —— 纯函数层(2026-11-14)
 *
 * 尺寸 / 配件 / 加价原先全在**代码常量**里 ⇒ 工作室在后台改不了、
 * 也加不出新的 SKU。这一层把它们搬进 DB,代码常量退成**兜底**。
 *
 * ## 这个文件守住三件事
 *
 * 1. **兜底逐字节相同** —— `buildCatalogDictionaryFromCodeConstants()` 生成的
 *    字典,必须跟今天那四处各算一遍的 `idx * 500` **一模一样**。
 *    DB 没播种 / 读失败 ⇒ 行为一个字节都不变。
 * 2. **逐型号兜底** —— DB 里只有 R 的尺寸行,M 照样走兜底。
 *    **不是整份兜底**(整份兜底会让工作室改了 R,把 M 也一起改回去)。
 * 3. **四个应用点共用一个查法** —— `sizeDeltaCentsFor()` 全仓只许有一份。
 *    散在四个地方各算一遍 = 改一处忘三处,尺寸加价会静默对不上。
 *
 * 全部是纯函数 + 文件扫描 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前读常量」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/** 一份空的 DB 行 —— 「什么都没播种」 */
function emptyRows(): CatalogDictionaryDbRows {
  return {
    sizes: [],
    accessories: [],
    accessoryOptions: [],
    variants: [],
  };
}

/* -------------------------------------------------------------------------- */
/*  兜底字典                                                                   */
/* -------------------------------------------------------------------------- */

describe("兜底字典 —— 代码常量生成的必须跟今天的行为逐字节相同", () => {
  const fallback = buildCatalogDictionaryFromCodeConstants();

  it("① 型号顺序 = `PRODUCT_TYPES` 的顺序(R / A / P / RM / LB / M)", () => {
    expect(typeCodes(fallback)).toEqual(PRODUCT_TYPES.map((t) => t.code));
  });

  it("② 尺寸加价 = `idx * 500`、排序 = `(idx + 1) * 10`", () => {
    for (const type of PRODUCT_TYPES) {
      const sizes = fallback.sizesByType.get(type.code) ?? [];
      expect(sizes).toEqual(
        type.sizes.map((code, idx) => ({
          code,
          priceDeltaCents: idx * SIZE_STEP_CENTS,
          sortOrder: (idx + 1) * 10,
        }))
      );
    }
    // 第一档 +0、第二档 +¥5、第三档 +¥10 —— 跟今天一模一样
    expect(sizeDeltaCentsFor(fallback, "M", "6")).toBe(0);
    expect(sizeDeltaCentsFor(fallback, "M", "8")).toBe(SIZE_STEP_CENTS);
    expect(sizeDeltaCentsFor(fallback, "M", "10")).toBe(SIZE_STEP_CENTS * 2);
  });

  it("③ 配件的名字 / 分类 / 排序跟 `ACCESSORY_META` 一个口径", () => {
    // ⚠️ `ACCESSORIES` 和 `ACCESSORY_META` 的 `name` **不一样**
    //(`metal`:前者「金属」、后者「金属扣」)—— 兜底用的是后者。
    //(`ACCESSORIES` 是**数组**,得按 code 找,不能写 `ACCESSORIES.metal`)
    expect(ACCESSORIES.find((a) => a.code === "metal")?.name).not.toBe(
      ACCESSORY_META.metal.name.zh
    );

    const codes = [...fallback.accessories.keys()];
    expect(codes).toEqual(ACCESSORIES.map((a) => a.code));

    for (const [idx, accessory] of ACCESSORIES.entries()) {
      const meta = ACCESSORY_META[accessory.code];
      expect(fallback.accessories.get(accessory.code)).toEqual({
        code: accessory.code,
        name: meta.name.zh,
        nameEn: meta.name.en,
        category: meta.category,
        sortOrder: (idx + 1) * 10,
      });
    }
  });

  it("④「哪个型号能配哪些配件」= `PRODUCT_TYPES[].accessories`", () => {
    for (const type of PRODUCT_TYPES) {
      const options = fallback.accessoryOptionsByType.get(type.code) ?? [];
      expect(options).toEqual(
        type.accessories.map((accessoryCode, idx) => ({
          accessoryCode,
          sortOrder: (idx + 1) * 10,
        }))
      );
      expect(accessoryCodesForType(fallback, type.code)).toEqual(
        type.accessories
      );
    }
  });

  it("⑤ 配件变体 = `PRODUCT_ACCESSORY_VARIANTS`,`appliesToSizesCm` 一字不差", () => {
    for (const type of PRODUCT_TYPES) {
      const expected = PRODUCT_ACCESSORY_VARIANTS.filter(
        (v) => v.productTypeCode === type.code
      );
      const actual = fallback.variantsByType.get(type.code) ?? [];
      expect(actual).toHaveLength(expected.length);
      for (const [idx, variant] of expected.entries()) {
        expect(actual[idx]).toEqual({
          productTypeCode: variant.productTypeCode,
          accessoryCode: variant.accessoryCode,
          variantCode: variant.variantCode,
          name: variant.name,
          nameEn: variant.nameEn,
          swatch: variant.swatch,
          priceDeltaCents: variant.priceDeltaCents,
          sortOrder: variant.sortOrder,
          appliesToSizesCm: [...variant.appliesToSizesCm],
        });
      }
    }
    // 玻璃罩那三个变体的「适用尺寸」是这三条
    expect(
      accessoryVariantDef(fallback, "M", "glass_cover", "glass_4")
        ?.appliesToSizesCm
    ).toEqual([4]);
    expect(
      accessoryVariantDef(fallback, "M", "glass_cover", "glass_8")
        ?.appliesToSizesCm
    ).toEqual([8]);
  });

  it("⑥ 查不到的那一档返 `null`,**不是 0**", () => {
    // ⚠️ `null` ≠ `0` —— 当成 0 就是静默把某一档的价算错
    expect(sizeDeltaCentsFor(fallback, "R", "99")).toBeNull();
    expect(sizeDeltaCentsFor(fallback, "ZZ", "4")).toBeNull();
    expect(sizeDefFor(fallback, "R", "99")).toBeNull();
    expect(accessoryDef(fallback, "not_a_real_accessory")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  合并:DB 行 × 兜底                                                          */
/* -------------------------------------------------------------------------- */

describe("合并 —— DB 行 × 兜底(逐型号,不是整份)", () => {
  const fallback = buildCatalogDictionaryFromCodeConstants();

  function sizeRow(
    productTypeCode: string,
    sizeCode: string,
    priceDeltaCents: number,
    sortOrder: number,
    isActive = true
  ): CatalogSizeRowLike {
    return { productTypeCode, sizeCode, priceDeltaCents, sortOrder, isActive };
  }

  it("① DB 的**显式**加价被尊重(不是按位置算)", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      sizes: [sizeRow("R", "4", 0, 10), sizeRow("R", "6", 999, 20)],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    expect(sizeDeltaCentsFor(merged, "R", "4")).toBe(0);
    expect(sizeDeltaCentsFor(merged, "R", "6")).toBe(999);
  });

  it("② **逐型号兜底** —— DB 有 R 没有 M ⇒ M 走兜底", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      sizes: [sizeRow("R", "4", 123, 10), sizeRow("R", "6", 456, 20)],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    // R 归 DB
    expect(sizeCodesForType(merged, "R")).toEqual(["4", "6"]);
    expect(sizeDeltaCentsFor(merged, "R", "6")).toBe(456);

    // M 归兜底 —— 跟今天一模一样
    expect(sizeCodesForType(merged, "M")).toEqual(
      sizeCodesForType(fallback, "M")
    );
    expect(sizeDeltaCentsFor(merged, "M", "10")).toBe(
      sizeDeltaCentsFor(fallback, "M", "10")
    );
  });

  it("③ **在中间插一档尺寸不会改后面几档的价**(位置陷阱)", () => {
    // 今天是 `idx * 500` —— 在中间插一档,后面每一档的价会静默全变。
    // 字典里存的是**显式**加价 ⇒ 后面的行一个字节都不动。
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      sizes: [
        sizeRow("M", "6", 0, 10),
        sizeRow("M", "8", 500, 20), // ← 插进来的这一档
        sizeRow("M", "10", 1000, 30),
        sizeRow("M", "12", 1500, 40),
        sizeRow("M", "15", 2000, 50),
      ],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    expect(sizeCodesForType(merged, "M")).toEqual(["6", "8", "10", "12", "15"]);
    expect(sizeDeltaCentsFor(merged, "M", "8")).toBe(500);
    // ⚠️ 后面这几档**没有**被顶掉 —— 它们的加价是显式写的
    expect(sizeDeltaCentsFor(merged, "M", "10")).toBe(1000);
    expect(sizeDeltaCentsFor(merged, "M", "12")).toBe(1500);
    expect(sizeDeltaCentsFor(merged, "M", "15")).toBe(2000);
  });

  it("④ 停用一档尺寸 ⇒ 那一档**查不到**(null),不是 0", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      sizes: [
        sizeRow("R", "4", 0, 10),
        sizeRow("R", "6", 500, 20, false), // ← 停用
      ],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    expect(sizeCodesForType(merged, "R")).toEqual(["4"]);
    expect(sizeDeltaCentsFor(merged, "R", "6")).toBeNull();
  });

  it("⑤ 停用一个配件 ⇒ 它从**每一个**型号的配件清单里消失", () => {
    const accessoryRow: CatalogAccessoryRowLike = {
      code: "metal",
      name: "金属扣",
      nameEn: "Metal Clasp",
      category: "material",
      sortOrder: 40,
      isActive: false,
    };
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      accessories: [accessoryRow],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    expect(accessoryDef(merged, "metal")).toBeNull();
    // R 的配件清单里没有 metal 了
    expect(accessoryCodesForType(merged, "R")).not.toContain("metal");
    // 别的型号本来就没有 metal ⇒ 也不受影响
    expect(accessoryCodesForType(merged, "A")).not.toContain("metal");
  });

  it("⑥ 停用「型号 ↔ 配件」⇒ 那个型号不再配它,别的型号不受影响", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      accessoryOptions: [
        {
          productTypeCode: "R",
          accessoryCode: "metal",
          sortOrder: 30,
          isActive: false,
        },
      ],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    expect(accessoryCodesForType(merged, "R")).not.toContain("metal");
    expect(accessoryCodesForType(merged, "R")).toContain("leather");
  });

  it("⑦ DB 里新增的型号接在型号顺序后面", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      sizes: [sizeRow("XX", "4", 0, 10)],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    expect(typeCodes(merged)).toEqual([
      ...PRODUCT_TYPES.map((t) => t.code),
      "XX",
    ]);
    // 新型号的尺寸走 DB
    expect(sizeCodesForType(merged, "XX")).toEqual(["4"]);
    expect(sizeDeltaCentsFor(merged, "XX", "4")).toBe(0);
  });

  it("⑧ DB 里新增的配件变体接在兜底那批后面", () => {
    const variantRow: CatalogAccessoryVariantRowLike = {
      productTypeCode: "R",
      accessoryCode: "leather",
      variantCode: "leather_teal",
      name: "墨绿",
      nameEn: "Teal",
      swatch: "#0f5c5c",
      priceDeltaCents: 800,
      sortOrder: 999,
      appliesToSizesCm: [],
      isActive: true,
    };
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      variants: [variantRow],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    const variants = accessoryVariantsFor(merged, "R", "leather");
    // 兜底那 5 色还在,新增的接在后面
    expect(variants).toHaveLength(6);
    expect(variants[variants.length - 1]?.variantCode).toBe("leather_teal");
    expect(
      accessoryVariantDef(merged, "R", "leather", "leather_teal")
        ?.priceDeltaCents
    ).toBe(800);
  });

  it("⑧-2 加一个变体**不许**把同组别的变体挤掉(整组替换那个坑)", () => {
    // ⚠️ 「这一组在 DB 里有行 ⇒ 整组用 DB 的」是个静默丢数据的坑:
    // 后台给 R 的皮套加一个「墨绿」⇒ 兜底那 5 色整个消失,商城上那个
    // 配件只剩 1 个选项 —— **而且不报错**。
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      variants: [
        {
          productTypeCode: "R",
          accessoryCode: "leather",
          variantCode: "leather_teal",
          name: "墨绿",
          nameEn: "Teal",
          swatch: "#0f5c5c",
          priceDeltaCents: 800,
          sortOrder: 999,
          appliesToSizesCm: [],
          isActive: true,
        },
      ],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    const variants = accessoryVariantsFor(merged, "R", "leather");
    // 兜底那 5 色**一个都没少**,新增的接在最后 ⇒ 共 6 个
    expect(variants.map((v) => v.variantCode)).toEqual([
      "leather_brown",
      "leather_black",
      "leather_red",
      "leather_white",
      "leather_natural",
      "leather_teal",
    ]);
    // 别的型号不受影响(R 的编织绳那 8 色还在)
    expect(accessoryVariantsFor(merged, "R", "braided_rope")).toHaveLength(8);
  });

  it("⑧-3 同码的 DB 行**就地替换**(位置不变,值变成 DB 的)", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      variants: [
        {
          productTypeCode: "R",
          accessoryCode: "leather",
          variantCode: "leather_red",
          name: "大红",
          nameEn: "Bright Red",
          swatch: "#ff0000",
          priceDeltaCents: 1234,
          sortOrder: 999,
          appliesToSizesCm: [],
          isActive: true,
        },
      ],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    const variants = accessoryVariantsFor(merged, "R", "leather");
    expect(variants).toHaveLength(5); // 就地替换,**不是**追加
    // 位置不变(第 3 个)
    expect(variants[2]?.variantCode).toBe("leather_red");
    expect(variants[2]?.priceDeltaCents).toBe(1234);
    expect(variants[2]?.nameEn).toBe("Bright Red");
  });

  it("⑧-4 停用一个变体 = **只拿掉那一码**,同组别的还在", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      variants: [
        {
          productTypeCode: "R",
          accessoryCode: "leather",
          variantCode: "leather_red",
          name: "红",
          nameEn: "Red",
          swatch: null,
          priceDeltaCents: 0,
          sortOrder: 999,
          appliesToSizesCm: [],
          isActive: false,
        },
      ],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    const variants = accessoryVariantsFor(merged, "R", "leather");
    expect(variants.map((v) => v.variantCode)).toEqual([
      "leather_brown",
      "leather_black",
      "leather_white",
      "leather_natural",
    ]);
    expect(accessoryVariantDef(merged, "R", "leather", "leather_red")).toBeNull();
  });

  it("⑨ 认不出来的分类退回 `decor`", () => {
    expect(normalizeAccessoryCategory("material")).toBe("material");
    expect(normalizeAccessoryCategory("protection")).toBe("protection");
    expect(normalizeAccessoryCategory("mount")).toBe("mount");
    expect(normalizeAccessoryCategory("decor")).toBe("decor");
    expect(normalizeAccessoryCategory("something-else")).toBe("decor");
    expect(normalizeAccessoryCategory(null)).toBe("decor");
    expect(normalizeAccessoryCategory(undefined)).toBe("decor");
  });

  it("⑩ 认不出来的分类不会把配件整个弄丢", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      accessories: [
        {
          code: "metal",
          name: "金属扣",
          nameEn: "Metal Clasp",
          category: "not-a-real-category",
          sortOrder: 40,
          isActive: true,
        },
      ],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    expect(accessoryDef(merged, "metal")?.category).toBe("decor");
    expect(accessoryDef(merged, "metal")?.name).toBe("金属扣");
  });
});

/* -------------------------------------------------------------------------- */
/*  扫描式守卫:四处查加价共用一个函数                                            */
/* -------------------------------------------------------------------------- */

describe("四个应用点共用一个查法 —— 扫描式守卫", () => {
  const DICTIONARY = "src/features/image-gen/lib/catalog-dictionary.ts";
  const VARIANT_SKU = "src/features/image-gen/lib/product-variant-sku.ts";
  const CAPABILITY = "src/features/image-gen/lib/product-capability.ts";
  const APPLY = "src/features/storefront/lib/catalog-dictionary-apply.ts";

  it("① `sizeDeltaCentsFor` 全仓只定义一次", () => {
    const code = stripComments(read(DICTIONARY));
    const definitions = code.match(
      /export function sizeDeltaCentsFor\s*\(/g
    );
    expect(definitions).toHaveLength(1);
  });

  it("② 三个调用点都走这一份查法", () => {
    // ① SKU 生成 / 重算 ② 对外商品接口 ③ 商城 overlay
    expect(stripComments(read(VARIANT_SKU))).toContain(
      "sizeDeltaCentsFor(dictionary, productCode, row.sizeCode)"
    );
    expect(stripComments(read(CAPABILITY))).toContain(
      "sizeDeltaCentsFor(dictionary, code, sizeCode)"
    );
    expect(stripComments(read(APPLY))).toContain(
      "sizeDeltaCentsFor(dictionary, typeCode, sizeCode)"
    );
  });

  it("③ SKU 那条路里**没有第二份** `idx * 500` 算式", () => {
    const code = stripComments(read(VARIANT_SKU));
    // 尺寸加价只能从字典来 —— 散在别处算一遍 = 改一处忘三处
    expect(code).not.toMatch(/\*\s*500/);
    expect(code).not.toMatch(/\*\s*SIZE_STEP_CENTS/);
  });

  it("④ 对外商品接口里只剩「没传字典」那一条兜底分支", () => {
    const code = stripComments(read(CAPABILITY));
    const hits = code.match(/\*\s*SIZE_STEP_CENTS/g) ?? [];
    expect(hits).toHaveLength(1);
    // 那一条必须是「字典缺席」时的老口径
    expect(code).toContain("dictionary\n        ? (sizeDeltaCentsFor(dictionary, code, sizeCode) ?? 0)\n        : idx * SIZE_STEP_CENTS");
  });

  it("⑤ `SIZE_STEP_CENTS` 只有一个出处", () => {
    // 定义在 `catalog-dictionary.ts` —— 别在别处再写一份 500
    const code = stripComments(read(DICTIONARY));
    expect(code).toContain("export const SIZE_STEP_CENTS = 500;");
  });
});
