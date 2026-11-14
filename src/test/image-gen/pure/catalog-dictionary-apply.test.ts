import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildCatalogDictionaryFromCodeConstants,
  mergeCatalogDictionary,
  sizeDeltaCentsFor,
} from "@/features/image-gen/lib/catalog-dictionary";
import type {
  CatalogAccessoryRowLike,
  CatalogAccessoryVariantRowLike,
  CatalogDictionaryDbRows,
  CatalogSizeRowLike,
} from "@/features/image-gen/lib/catalog-dictionary";
import {
  applyCatalogDictionaryToProduct,
  buildPriceCatalog,
} from "@/features/storefront/lib/catalog-dictionary-apply";
import { MOCK_PRODUCTS } from "@/features/storefront/lib/mock-catalog";

/**
 * 商品目录字典 → 商城 —— **overlay 那一层**(2026-11-14)
 *
 * 尺寸 / 配件 / 加价搬进 DB 之后,商城这一层是**显示那条路**跟
 * **算钱那条路**共用的那一份。三个要守住的契约:
 *
 * 1. **兜底逐字节相同** —— DB 没播种 / 读失败时,
 *    `buildPriceCatalog(兜底字典)` 必须跟今天 `mock-catalog.ts` 自己
 *    算出来的 `sizes` / `accessoryGroups` **一模一样**。
 *    不一样 = 「改造当天商城上的价就变了」。
 * 2. **位置陷阱** —— 尺寸加价以前是 `idx * 500`(按**位置**算)。
 *    在中间插一档,后面每一档的价会**静默全变**。
 *    DB 里存的是**显式**加价 ⇒ 插一档不许动别的档。
 * 3. **读失败整份退回兜底** —— 不是半份退回,也不是抛。
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

/**
 * 找出仓库里所有带 `"use client"` 的文件(相对仓库根)
 *
 * 服务端模块(`catalog-dictionary-store.ts` import 了 `@/db`)被客户端组件
 * import 时会在构建期炸 —— 所以要全仓扫,不能只盯已知的几个文件。
 */
function walkClientComponents(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
      const src = readFileSync(abs, "utf8");
      if (/^\s*"use client";\s*$/m.test(src)) {
        out.push(relative(ROOT, abs).replace(/\\/g, "/"));
      }
    }
  };
  for (const dir of ["src/features", "src/app", "src/components"]) {
    walk(join(ROOT, dir));
  }
  return out;
}

const APPLY = "src/features/storefront/lib/catalog-dictionary-apply.ts";
const STORE = "src/features/image-gen/lib/catalog-dictionary-store.ts";
const MOCK_CATALOG = "src/features/storefront/lib/mock-catalog.ts";

/** 一份空的 DB 行 —— 「什么都没播种」 */
function emptyRows(): CatalogDictionaryDbRows {
  return {
    sizes: [],
    accessories: [],
    accessoryOptions: [],
    variants: [],
  };
}

/** 一行尺寸 */
function sizeRow(
  productTypeCode: string,
  sizeCode: string,
  priceDeltaCents: number,
  sortOrder: number,
  isActive = true
): CatalogSizeRowLike {
  return { productTypeCode, sizeCode, priceDeltaCents, sortOrder, isActive };
}

/** 一行配件变体 */
function variantRow(
  productTypeCode: string,
  accessoryCode: string,
  variantCode: string,
  priceDeltaCents: number,
  sortOrder: number,
  extra: Partial<CatalogAccessoryVariantRowLike> = {}
): CatalogAccessoryVariantRowLike {
  return {
    productTypeCode,
    accessoryCode,
    variantCode,
    name: variantCode,
    nameEn: variantCode,
    swatch: null,
    priceDeltaCents,
    sortOrder,
    appliesToSizesCm: [],
    isActive: true,
    ...extra,
  };
}

/** 一行配件(全局字典) */
function accessoryRow(
  code: string,
  name: string,
  nameEn: string,
  category: string,
  sortOrder: number,
  isActive = true
): CatalogAccessoryRowLike {
  return { code, name, nameEn, category, sortOrder, isActive };
}

/* -------------------------------------------------------------------------- */
/*  ① 兜底逐字节相同                                                            */
/* -------------------------------------------------------------------------- */

describe("商城 overlay —— 兜底必须跟今天 `mock-catalog.ts` 算出来的逐字节相同", () => {
  const fallback = buildCatalogDictionaryFromCodeConstants();
  const catalog = buildPriceCatalog(fallback);

  it("①-1 每个型号的尺寸档跟 `mock-catalog.ts` 的 `SIZES_BY_TYPE` 完全一样", () => {
    for (const product of MOCK_PRODUCTS) {
      const type = catalog.byType.get(product.productTypeCode);
      expect(type, product.productTypeCode).toBeDefined();
      // ⚠️ 逐条比 —— 尺寸 id(`size_R_4`)、cm、加价、appliesTo 全在里面
      expect(type?.sizes, product.productTypeCode).toEqual(product.sizes);
    }
  });

  it("①-2 每个型号的配件分组跟 `mock-catalog.ts` 的 `buildAccessoryGroups` 完全一样", () => {
    for (const product of MOCK_PRODUCTS) {
      const type = catalog.byType.get(product.productTypeCode);
      expect(type?.accessoryGroups, product.productTypeCode).toEqual(
        product.accessoryGroups
      );
    }
  });

  it("①-3 尺寸加价还是 `idx * 500`(第一档 +0、第二档 +¥5)", () => {
    const rSizes = catalog.byType.get("R")?.sizes ?? [];
    expect(rSizes.map((s) => [s.cm, s.surchargeCents])).toEqual([
      [4, 0],
      [6, 500],
    ]);
    const mSizes = catalog.byType.get("M")?.sizes ?? [];
    expect(mSizes.map((s) => [s.cm, s.surchargeCents])).toEqual([
      [6, 0],
      [8, 500],
      [10, 1000],
      [12, 1500],
      [15, 2000],
    ]);
  });

  it("①-4 配件变体的加价 / 适用尺寸跟代码常量一样(玻璃罩 4/6/8 罩各配各的)", () => {
    const glass = catalog.byType
      .get("M")
      ?.accessoryGroups.find((g) => g.code === "glass_cover");
    expect(glass?.variants.map((v) => [v.code, v.surchargeCents])).toEqual([
      ["glass_4", 1500],
      ["glass_6", 2200],
      ["glass_8", 3000],
    ]);
    expect(glass?.variants.map((v) => v.appliesToSizesCm)).toEqual([
      [4],
      [6],
      [8],
    ]);
  });

  it("①-5 `variantsById` 的键 = `acc_` + variantCode(跟规格里传的那个字符串一样)", () => {
    expect(catalog.variantsById.get("acc_leather_brown")?.code).toBe(
      "leather_brown"
    );
    expect(catalog.variantsById.get("acc_glass_4")?.surchargeCents).toBe(1500);
  });
});

/* -------------------------------------------------------------------------- */
/*  ② 位置陷阱 —— 在中间插一档不许动后面几档                                   */
/* -------------------------------------------------------------------------- */

describe("商城 overlay —— 尺寸加价是**显式**的,不是按位置算的", () => {
  const fallback = buildCatalogDictionaryFromCodeConstants();

  it("②-1 在中间插一档尺寸,后面几档的价**一个都不许变**", () => {
    // 工作室在 M 的 8 和 10 中间插一档「9」(+¥7)
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      sizes: [
        sizeRow("M", "6", 0, 10),
        sizeRow("M", "8", 500, 20),
        sizeRow("M", "9", 700, 25),
        sizeRow("M", "10", 1000, 30),
        sizeRow("M", "12", 1500, 40),
        sizeRow("M", "15", 2000, 50),
      ],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    // 后面几档**保持原值**
    expect(sizeDeltaCentsFor(merged, "M", "10")).toBe(1000);
    expect(sizeDeltaCentsFor(merged, "M", "12")).toBe(1500);
    expect(sizeDeltaCentsFor(merged, "M", "15")).toBe(2000);
    // 新插的那一档用它自己的显式值
    expect(sizeDeltaCentsFor(merged, "M", "9")).toBe(700);

    // 商城那一层也是显式的
    const catalog = buildPriceCatalog(merged);
    const sizes = catalog.byType.get("M")?.sizes ?? [];
    expect(sizes.map((s) => [s.cm, s.surchargeCents])).toEqual([
      [6, 0],
      [8, 500],
      [9, 700],
      [10, 1000],
      [12, 1500],
      [15, 2000],
    ]);
  });

  it("②-2 这个坑是真的:老的「按位置」算法会把后面几档**全顶掉**", () => {
    // 证明 ②-1 守的是真问题 —— 同一份尺寸清单,按 `idx * 500` 算出来是:
    const positional = ["6", "8", "9", "10", "12", "15"].map(
      (code, idx) => [code, idx * 500]
    );
    expect(positional).toEqual([
      ["6", 0],
      ["8", 500],
      ["9", 1000],
      ["10", 1500],
      ["12", 2000],
      ["15", 2500],
    ]);
    // ⇒ 「9」插进去,10 / 12 / 15 三档的价全变了(1000→1500、1500→2000、
    // 2000→2500)。**这就是为什么加价必须存成显式的。**
  });

  it("②-3 改一档的加价**只**改那一档,别的档不动", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      sizes: [
        sizeRow("M", "6", 0, 10),
        sizeRow("M", "8", 500, 20),
        sizeRow("M", "10", 1000, 30),
        sizeRow("M", "12", 1500, 40),
        sizeRow("M", "15", 2000, 50),
      ],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    // 把「12」那一档从 +¥15 改成 +¥18
    const changed: CatalogDictionaryDbRows = {
      ...rows,
      sizes: rows.sizes.map((row) =>
        row.sizeCode === "12" ? { ...row, priceDeltaCents: 1800 } : row
      ),
    };
    const after = mergeCatalogDictionary(changed, fallback);

    expect(sizeDeltaCentsFor(after, "M", "12")).toBe(1800);
    expect(sizeDeltaCentsFor(after, "M", "10")).toBe(1000);
    expect(sizeDeltaCentsFor(after, "M", "15")).toBe(2000);
    // 改之前也是 1500 —— 这一档是**工作室自己**改的,不是被别人顶掉的
    expect(sizeDeltaCentsFor(merged, "M", "12")).toBe(1500);
  });

  it("②-4 没播种的型号照样走兜底(改了 M 不该把 R 也一起改了)", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      sizes: [sizeRow("M", "6", 0, 10), sizeRow("M", "8", 999, 20)],
    };
    const merged = mergeCatalogDictionary(rows, fallback);

    // M 走 DB(显式 999)
    expect(sizeDeltaCentsFor(merged, "M", "8")).toBe(999);
    // R 走兜底(idx * 500)
    expect(sizeDeltaCentsFor(merged, "R", "6")).toBe(500);
  });

  it("②-5 停用一档尺寸 = **从商城里消失**,不是变成 +¥0", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      sizes: [
        sizeRow("M", "6", 0, 10),
        sizeRow("M", "8", 500, 20),
        sizeRow("M", "10", 1000, 30, false),
      ],
    };
    const merged = mergeCatalogDictionary(rows, fallback);
    const catalog = buildPriceCatalog(merged);

    // 停用的那档不出现
    expect(catalog.byType.get("M")?.sizes.map((s) => s.cm)).toEqual([6, 8]);
    // 查不到 = 查不到(不是 0)
    expect(sizeDeltaCentsFor(merged, "M", "10")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  ③ 配件加价走 DB                                                            */
/* -------------------------------------------------------------------------- */

describe("商城 overlay —— 配件加价走 DB", () => {
  const fallback = buildCatalogDictionaryFromCodeConstants();

  it("③-1 变体的加价取自 DB(不是代码常量)", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      variants: [
        variantRow("R", "leather", "leather_brown", 1234, 10, {
          name: "深棕",
          nameEn: "Dark Brown",
          swatch: "#3b2416",
        }),
      ],
    };
    const merged = mergeCatalogDictionary(rows, fallback);
    const catalog = buildPriceCatalog(merged);

    const leather = catalog.byType
      .get("R")
      ?.accessoryGroups.find((g) => g.code === "leather");
    const brown = leather?.variants.find((v) => v.code === "leather_brown");

    expect(brown?.surchargeCents).toBe(1234);
    expect(brown?.name).toBe("深棕");
    expect(brown?.nameEn).toBe("Dark Brown");
    expect(brown?.swatch).toBe("#3b2416");
    // 键还是 `acc_${variantCode}`
    expect(catalog.variantsById.get("acc_leather_brown")?.surchargeCents).toBe(
      1234
    );
  });

  it("③-2 改了配件加价**只**改那一个变体,同组别的还在", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      variants: [variantRow("R", "leather", "leather_brown", 1234, 10)],
    };
    const merged = mergeCatalogDictionary(rows, fallback);
    const catalog = buildPriceCatalog(merged);

    const leather = catalog.byType
      .get("R")
      ?.accessoryGroups.find((g) => g.code === "leather");
    expect(leather?.variants.map((v) => v.code)).toEqual([
      "leather_brown",
      "leather_black",
      "leather_red",
      "leather_white",
      "leather_natural",
    ]);
  });

  it("③-3 后台新增一个变体 ⇒ 商城上能选(这是「自由新增 SKU」的那一半)", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      variants: [
        variantRow("R", "leather", "leather_teal", 800, 60, {
          name: "墨绿",
          nameEn: "Teal",
        }),
      ],
    };
    const merged = mergeCatalogDictionary(rows, fallback);
    const catalog = buildPriceCatalog(merged);

    const leather = catalog.byType
      .get("R")
      ?.accessoryGroups.find((g) => g.code === "leather");
    expect(leather?.variants.map((v) => v.code)).toContain("leather_teal");
    expect(catalog.variantsById.get("acc_leather_teal")?.surchargeCents).toBe(
      800
    );
  });

  it("③-4 配件的名字 / 分类走 DB(改了就跟着变)", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      accessories: [accessoryRow("leather", "真皮套", "Genuine Leather", "material", 10)],
    };
    const merged = mergeCatalogDictionary(rows, fallback);
    const catalog = buildPriceCatalog(merged);

    const leather = catalog.byType
      .get("R")
      ?.accessoryGroups.find((g) => g.code === "leather");
    expect(leather?.name).toBe("真皮套");
    expect(leather?.nameEn).toBe("Genuine Leather");
  });

  it("③-5 停用一个配件 ⇒ 它从**每一个**型号的选项里消失", () => {
    const rows: CatalogDictionaryDbRows = {
      ...emptyRows(),
      accessories: [accessoryRow("leather", "皮套", "Leather", "material", 10, false)],
    };
    const merged = mergeCatalogDictionary(rows, fallback);
    const catalog = buildPriceCatalog(merged);

    for (const type of catalog.byType.values()) {
      expect(type.accessoryGroups.map((g) => g.code)).not.toContain("leather");
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  ④ overlay 盖到商品上                                                       */
/* -------------------------------------------------------------------------- */

describe("商城 overlay —— 盖到商品上只换尺寸 / 配件那两样", () => {
  const fallback = buildCatalogDictionaryFromCodeConstants();

  it("④-1 没有字典 ⇒ 商品原样返回", () => {
    const product = MOCK_PRODUCTS[0];
    if (!product) throw new Error("MOCK_PRODUCTS 空的");
    expect(applyCatalogDictionaryToProduct(product, null)).toEqual(product);
    expect(applyCatalogDictionaryToProduct(product, undefined)).toEqual(
      product
    );
  });

  it("④-2 字典里没有这个型号 ⇒ 商品原样返回", () => {
    const product = MOCK_PRODUCTS[0];
    if (!product) throw new Error("MOCK_PRODUCTS 空的");
    const catalog = buildPriceCatalog(
      mergeCatalogDictionary(
        { ...emptyRows(), sizes: [sizeRow("M", "6", 0, 10)] },
        fallback
      )
    );
    expect(applyCatalogDictionaryToProduct(product, catalog)).toEqual(product);
  });

  it("④-3 换掉尺寸 / 配件,**别的资料一个都不动**", () => {
    const product = MOCK_PRODUCTS[0];
    if (!product) throw new Error("MOCK_PRODUCTS 空的");
    const catalog = buildPriceCatalog(
      mergeCatalogDictionary(
        {
          ...emptyRows(),
          sizes: [sizeRow(product.productTypeCode, "4", 0, 10)],
        },
        fallback
      )
    );
    const applied = applyCatalogDictionaryToProduct(product, catalog);

    expect(applied.sizes.map((s) => s.cm)).toEqual([4]);
    // 基础价 / 名字 / 封面 / 交期 —— 一个字节都不许动
    expect(applied.basePriceCents).toBe(product.basePriceCents);
    expect(applied.title).toBe(product.title);
    expect(applied.titleEn).toBe(product.titleEn);
    expect(applied.thumbnail).toBe(product.thumbnail);
    expect(applied.leadTimeDays).toBe(product.leadTimeDays);
    expect(applied.materials).toEqual(product.materials);
  });

  it("④-4 盖上去的尺寸 id 跟 `mock-catalog.ts` 一个格式(`size_R_4`)", () => {
    const product = MOCK_PRODUCTS.find((p) => p.productTypeCode === "R");
    if (!product) throw new Error("找不到 R 的商品");
    const catalog = buildPriceCatalog(
      mergeCatalogDictionary(
        {
          ...emptyRows(),
          sizes: [sizeRow("R", "4", 0, 10), sizeRow("R", "6", 500, 20)],
        },
        fallback
      )
    );
    const applied = applyCatalogDictionaryToProduct(product, catalog);
    expect(applied.sizes.map((s) => s.id)).toEqual(["size_R_4", "size_R_6"]);
  });
});

/* -------------------------------------------------------------------------- */
/*  ⑤ 读失败整份退回兜底(扫描式守卫)                                          */
/* -------------------------------------------------------------------------- */

describe("读失败整份退回兜底 —— 扫描式守卫", () => {
  it("⑤-1 `catalog-dictionary-store.ts` 读失败 ⇒ 整份退回代码常量,不抛", () => {
    const code = stripComments(read(STORE));

    // 兜底那一份是**代码常量**生成的
    expect(code).toContain("buildCatalogDictionaryFromCodeConstants()");
    // 读失败 ⇒ return fallback(两次:缓存的那条 + 不缓存的那条)
    expect(code.match(/return fallback;/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // 读失败**记一条 error 日志**(不是静默)
    expect(code).toContain("console.error");

    // ⚠️ **DB 读失败不许往外抛** ——
    // 字典读不出来不该让整个页面 500(跟价源一个口径:展示侧降级)。
    //
    // 「往外抛」只允许发生在**静态渲染信号**那一步(`optOutOfStaticRendering`
    // 里那个 `StaticGenBailoutError` 必须往外抛 —— 它就是「这一页别静态」的
    // 信号)。所以断言的范围是:**读库那两个 catch 之后**不许再有 `throw`。
    const readerTail = code.slice(code.indexOf("export async function getCatalogDictionary("));
    expect(readerTail.length).toBeGreaterThan(0);
    expect(readerTail).not.toContain("throw");
  });

  it("⑤-1-2 静态渲染信号**必须**往外抛(少了它加价会被烤进 HTML)", () => {
    const code = stripComments(read(STORE));

    // `connection()` 在「不在请求作用域里」时抛 E251 —— 那一种**吞掉**
    // (脚本 / 单测直接调了它); 构建期预渲染抛的 StaticGenBailoutError
    // **必须往外抛**。
    expect(code).toContain('if (code !== "E251") throw error;');
  });

  it("⑤-2 `catalog-dictionary-store.ts` 调了 `connection()` —— 少了它加价会被烤进 HTML", () => {
    const code = stripComments(read(STORE));

    expect(code).toContain('import { connection } from "next/server"');
    expect(code).toContain("await connection()");
  });

  it("⑤-3 「刚写完就能读到新值」那条路**不缓存**", () => {
    const code = stripComments(read(STORE));

    // 后台改完加价要**立刻**重算 SKU 价 ⇒ 那一步必须读到新值
    expect(code).toContain("getCatalogDictionaryFresh");
    expect(code).toContain("await fetchDictionaryRows()");
  });

  it("⑤-4 服务端那一份**没有客户端组件 import 它**", () => {
    const offenders: string[] = [];
    for (const rel of walkClientComponents()) {
      const src = stripComments(read(rel));
      if (/from\s+"[^"]*\/catalog-dictionary-store"/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("⑤-5 overlay 那一层**零 DB 依赖** —— 客户端可以安全 import", () => {
    const code = stripComments(read(APPLY));

    expect(code).not.toContain("@/db");
    expect(code).not.toContain("next/server");
  });

  it("⑤-6 `mock-catalog.ts` 仍然**不 import `@/db`**(客户端安全的静态目录)", () => {
    expect(stripComments(read(MOCK_CATALOG))).not.toContain("@/db");
  });
});
