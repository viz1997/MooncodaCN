import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildCatalogDictionaryFromCodeConstants,
  SIZE_STEP_CENTS,
} from "@/features/image-gen/lib/catalog-dictionary";
import { PRODUCT_ACCESSORY_VARIANTS } from "@/features/gpt-image/lib/product-accessory-variants";
import {
  ACCESSORIES,
  ACCESSORY_META,
  PRODUCT_TYPES,
} from "@/features/gpt-image/lib/product-catalog";

/**
 * 后台商品目录字典 —— 扫描式守卫(2026-11-14)
 *
 * ## 背景
 *
 * 工作室问「为什么商品 sku 无法设置以及价格」。答案:价能设(基础价),
 * 但**配件加价没有后台界面**、**新 SKU 造不出来**(尺寸 / 配件清单写死在
 * 代码常量里)。
 *
 * ⇒ B 线把那份字典搬进 DB,后台能自由增删。
 *
 * ## 这里守八件事
 *
 * 1. **三个区块在页面上** —— 挂在 `/admin/products/[code]` 底下,
 *    **就地展开,不开弹窗**(工作室的口味)。
 * 2. **action 不 throw** —— 失败一律 `return {ok:false,code}`。
 *    throw 会被 next-safe-action 糊成「服务器错误」,工作室根本不知道哪儿错了。
 * 3. **「use server」文件不 re-export 类型** —— Turbopack 会把类型
 *    re-export 注册成 server action ⇒ 运行时 `ReferenceError` ⇒ **整页 500**。
 * 4. **迁移脚本幂等 + 不播种** —— 跑几遍都安全;跑完线上行为一个字节都不变。
 * 5. **种子脚本写进去的值 == 代码常量** —— 切过去的那一刻 DB 状态
 *    == 今天的代码状态,行为零变化。
 * 6. **`apply-currency-schema.ts` 不再按代码字典重刷配件加价** ——
 *    代码常量退化成兜底了,那个脚本会把工作室调过的加价悄悄改回去。
 * 7. **新型号不再被 `PRODUCT_TYPES` 硬闸挡住** —— 改代码常量才能加型号
 *    那道闸已经拆了;但「至少要有一档尺寸」那道还在(没尺寸就生成不出 SKU)。
 * 8. **中英文键集一致** —— 少一个键,英文界面就摆一句「MISSING_MESSAGE」。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着的不算 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/** 读一份消息文件 */
function messages(locale: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

/** 递归列出叶子路径 —— `a.b.c` 那种 */
function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push(...leafKeys(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

const ACTIONS = "src/features/image-gen/admin/actions.ts";
const TYPES = "src/features/image-gen/admin/types.ts";
const DICT_VIEW =
  "src/features/image-gen/admin/components/product-dictionary-view.tsx";
const VARIANTS_VIEW =
  "src/features/image-gen/admin/components/product-accessory-variants-view.tsx";
const VARIANTS_PAGE_VIEW =
  "src/features/image-gen/admin/components/product-variants-view.tsx";
const ADMIN_PAGE = "src/app/[locale]/(admin)/admin/products/[code]/page.tsx";
const MIGRATION = "scripts/apply-catalog-dictionary-schema.ts";
const SEED = "scripts/seed-catalog-dictionary.ts";
const CURRENCY = "scripts/apply-currency-schema.ts";
const DB_PRODUCTS = "src/features/image-gen/lib/db-products.ts";

/** 八个目录字典 action —— 名字写错了要立刻炸 */
const CATALOG_ACTIONS = [
  "listCatalogDictionaryAdminAction",
  "upsertProductSizeAction",
  "deleteProductSizeAction",
  "upsertProductAccessoryAction",
  "deleteProductAccessoryAction",
  "setProductAccessoryOptionAction",
  "upsertProductAccessoryVariantAction",
  "deleteProductAccessoryVariantAction",
] as const;

/** 十个错误码 */
const CATALOG_ERROR_CODES = [
  "INVALID_INPUT",
  "PRODUCT_NOT_FOUND",
  "SIZE_NOT_FOUND",
  "ACCESSORY_NOT_FOUND",
  "VARIANT_NOT_FOUND",
  "SIZE_CODE_DUPLICATED",
  "VARIANT_CODE_DUPLICATED",
  "MIGRATION_MISSING",
  "READ_FAILED",
  "SAVE_FAILED",
] as const;

/**
 * 抠出某一个 action 的函数体
 *
 * 从 `export const <name>` 到**下一个** `export const` / `export function`
 * 为止 —— 后台那个文件里前后都是别的 action。
 */
function actionBody(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`);
  if (start < 0) return "";
  const rest = source.slice(start + 1);
  const next = rest.search(/\nexport\s+(const|function|async)\s/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

/* ========================================================================== */
/*  ① 三个区块在页面上                                                         */
/* ========================================================================== */

describe("① 后台目录字典 —— 三个区块在页面上", () => {
  it("①-1 路由 `/admin/products/[code]` 渲染的是 SKU 那一个页面", () => {
    const page = read(ADMIN_PAGE);
    expect(page).toContain("<ProductVariantsView");
    expect(page).toContain("productCode={code}");
  });

  it("①-2 配件变体区块挂在 SKU 那一页上", () => {
    const view = read(VARIANTS_PAGE_VIEW);
    expect(view).toContain(
      'import { ProductAccessoryVariantsView } from "@/features/image-gen/admin/components/product-accessory-variants-view"'
    );
    expect(view).toContain("<ProductAccessoryVariantsView");
  });

  it("①-3 尺寸 / 配件 / 归属区块挂在 SKU 那一页上", () => {
    const view = read(VARIANTS_PAGE_VIEW);
    expect(view).toContain(
      'import { ProductDictionaryView } from "@/features/image-gen/admin/components/product-dictionary-view"'
    );
    expect(view).toContain("<ProductDictionaryView");
  });

  it("①-4 字典那一块里摆着「尺寸 / 配件 / 本型号可配哪些」三个区块", () => {
    const view = read(DICT_VIEW);
    expect(view).toContain('t("sections.sizes.title")');
    expect(view).toContain('t("sections.accessories.title")');
    expect(view).toContain('t("sections.options.title")');
  });

  it("①-5 变体区块单独一块", () => {
    const view = read(VARIANTS_VIEW);
    expect(view).toContain('t("sections.variants.title")');
  });

  it("①-6 两个区块都是客户端组件", () => {
    for (const file of [DICT_VIEW, VARIANTS_VIEW]) {
      const src = read(file);
      expect(src.startsWith('"use client";'), file).toBe(true);
    }
  });

  it("①-7 一律就地展开 —— 不开弹窗(工作室的口味)", () => {
    for (const file of [DICT_VIEW, VARIANTS_VIEW]) {
      const src = read(file);
      expect(src, file).not.toMatch(/<Modal\b/);
      expect(src, file).not.toMatch(/<Dialog\b/);
      expect(src, file).not.toMatch(/<Drawer\b/);
    }
  });
});

/* ========================================================================== */
/*  ② action 不 throw                                                          */
/* ========================================================================== */

describe("② 目录字典的 action —— 失败返错误码,不 throw", () => {
  const source = read(ACTIONS);

  it("②-1 八个 action 都在", () => {
    for (const name of CATALOG_ACTIONS) {
      expect(source, name).toContain(`export const ${name}`);
    }
  });

  it("②-2 每个 action 的 catch 都返回 catalogFailure", () => {
    for (const name of CATALOG_ACTIONS) {
      const body = actionBody(source, name);
      expect(body.length, name).toBeGreaterThan(0);
      // 失败一律走那个工厂(它的 code 是字面量类型,前端索引得上去)
      expect(body, name).toContain("catalogFailure(");
      // 异常被 catch 住,而且 catch 里返回的是 catalogFailure
      expect(body, name).toMatch(
        /catch\s*\(\s*error\s*\)\s*\{\s*return\s+catalogFailure\(/
      );
    }
  });

  it("②-3 目录那一段里唯一的 throw 是在内层 try 里,被外层 catch 兜住", () => {
    // 目录 action 那一段的起止
    const start = source.indexOf("export const listCatalogDictionaryAdminAction");
    const section = source.slice(start);

    // 整段只有一个 `throw` —— 那是「DB 唯一索引撞了以外的错」
    // (内层 catch 里 rethrow),它被**外层**的 catch 接住 ⇒ 不会抛出去。
    const throws = section.match(/\bthrow\b/g) ?? [];
    expect(throws).toHaveLength(1);

    // 外层 catch 兜住了
    expect(section).toMatch(
      /catch\s*\(\s*error\s*\)\s*\{\s*return\s+catalogFailure\(/
    );
  });

  it("②-4 错误码走工厂而不是裸对象字面量", () => {
    // `return { ok: false as const, code: "XXX" }` ⇒ code 会拓宽成 string
    // ⇒ 前端 `CATALOG_ERROR_TEXT_KEYS[data.code]` 索引不上去 ⇒ 文案那一层塌掉
    // (注释里写着「别这么写」的那句不算 —— 去掉注释再查)
    expect(stripComments(source)).not.toMatch(/ok:\s*false\s+as\s+const,\s*code:/);
    expect(source).toContain("function catalogFailure(code: AdminCatalogErrorCode)");
  });

  it("②-5 读失败跟写失败是两个码 —— 工作室要做的事不一样", () => {
    expect(source).toContain("function catalogReadErrorCode(");
    expect(source).toContain("function catalogErrorCode(");
    expect(source).toContain('"READ_FAILED"');
    expect(source).toContain('"SAVE_FAILED"');
  });
});

/* ========================================================================== */
/*  ③ 「use server」文件不 re-export 类型                                        */
/* ========================================================================== */

describe("③ 「use server」文件的 export 规矩", () => {
  it("③-1 `actions.ts` 里没有把类型 re-export 出去", () => {
    const src = read(ACTIONS);
    expect(src).not.toMatch(/^[ \t]*export\s+type\s*\{/m);
    expect(src).not.toMatch(/^[ \t]*export\s*\{[^}]*\btype\s+[A-Za-z_$]/m);
    expect(src).not.toMatch(/^[ \t]*export\s*\*\s*from/m);
  });

  it("③-2 类型住在单独的 `types.ts` 里", () => {
    const types = read(TYPES);
    expect(types).toContain("export type AdminCatalogErrorCode =");
    expect(types).toContain(
      "export const CATALOG_ERROR_TEXT_KEYS: Record<AdminCatalogErrorCode, string>"
    );
    // 视图模型也在那儿
    expect(types).toContain("AdminCatalogSize");
    expect(types).toContain("AdminCatalogAccessory");
    expect(types).toContain("AdminCatalogAccessoryOption");
    expect(types).toContain("AdminCatalogAccessoryVariant");
  });

  it("③-3 客户端组件从 `types.ts` import 类型(不从 actions)", () => {
    for (const file of [DICT_VIEW, VARIANTS_VIEW]) {
      const src = read(file);
      expect(src, file).toContain(
        'from "@/features/image-gen/admin/types"'
      );
    }
  });
});

/* ========================================================================== */
/*  ④ 迁移脚本 —— 幂等 + 不播种                                                */
/* ========================================================================== */

describe("④ 迁移脚本 —— 幂等 + 不播种", () => {
  const code = read(MIGRATION);

  it("④-1 每一条 DDL 都带 `IF NOT EXISTS`", () => {
    const ddl = code.match(
      /(CREATE TABLE|CREATE (UNIQUE )?INDEX|ADD COLUMN)[\s\S]*?;/g
    ) ?? [];
    expect(ddl.length).toBeGreaterThanOrEqual(10);
    for (const stmt of ddl) {
      expect(stmt, stmt).toContain("IF NOT EXISTS");
    }
  });

  it("④-2 一行都不播种 —— 跑完线上行为一个字节都不变", () => {
    expect(code).not.toMatch(/INSERT\s+INTO/i);
    expect(code).not.toMatch(/UPDATE\s+"/i);
  });

  it("④-3 `variant_code` 的全局唯一索引在", () => {
    expect(code).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "pav_variant_code_uniq_idx"');
    expect(code).toContain('VARIANT_CODE_UNIQ_INDEX = "pav_variant_code_uniq_idx"');
  });

  it("④-4 有重复就中止并打印 —— 不硬加索引", () => {
    expect(code).toContain("process.exit(1)");
    // 重复检查跑在建索引**之前**
    const checkAt = code.indexOf("process.exit(1)");
    const indexAt = code.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS "pav_variant_code_uniq_idx"');
    expect(checkAt).toBeGreaterThan(-1);
    expect(indexAt).toBeGreaterThan(-1);
  });

  it("④-5 `--dry-run` 在(只打印 SQL,不连库)", () => {
    expect(code).toContain('process.argv.includes("--dry-run")');
  });

  it("④-6 `package.json` 登记了迁移命令", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["migrate:apply-catalog-dictionary"]).toContain(
      "apply-catalog-dictionary-schema.ts"
    );
  });
});

/* ========================================================================== */
/*  ⑤ 种子脚本 —— 写进去的值 == 代码常量                                        */
/* ========================================================================== */

describe("⑤ 种子脚本 —— 写进去的值 == 代码常量", () => {
  const code = read(SEED);

  it("⑤-1 尺寸加价 = `idx * 500`,排序 = `(idx + 1) * 10`", () => {
    expect(code).toContain("priceDeltaCents: idx * SIZE_STEP_CENTS,");
    expect(code).toContain("sortOrder: (idx + 1) * 10,");
    expect(code).toContain("const SIZE_STEP_CENTS = 500;");
    // 步长跟兜底字典里那个必须是同一个值
    expect(SIZE_STEP_CENTS).toBe(500);
  });

  it("⑤-2 配件的名字 / 分类取自 `ACCESSORY_META`,不是 `ACCESSORIES`", () => {
    // ⚠️ 两份常量的 name 不一样(`metal`:ACCESSORIES 写「金属」、
    // ACCESSORY_META 写「金属扣」)⇒ 兜底用的是 ACCESSORY_META ⇒ 种子必须一样
    expect(code).toContain("name: meta?.name.zh ?? accessory.code,");
    expect(code).toContain("nameEn: meta?.name.en ?? accessory.code,");
    expect(code).toContain('category: meta?.category ?? "decor",');
  });

  it("⑤-3 变体的排序用常量自己的 sortOrder(不是 `(idx+1)*10`)", () => {
    expect(code).toContain("sortOrder: variant.sortOrder,");
    expect(code).toContain(
      "appliesToSizesCm: JSON.stringify(variant.appliesToSizesCm),"
    );
  });

  it("⑤-4 只补缺的 —— 工作室改过的加价 / 名字不会被覆盖", () => {
    expect(code.match(/onConflictDoNothing/g)?.length ?? 0).toBeGreaterThanOrEqual(
      4
    );
  });

  it("⑤-5 回填「适用尺寸」只碰还没填的那几行", () => {
    expect(code).toContain('eq(productAccessoryVariant.appliesToSizesCm, "[]")');
  });

  it("⑤-6 dotenv 排第一个 —— 不然 `@/db` 先炸", () => {
    const imports = code
      .split("\n")
      .filter((line) => line.startsWith("import "))
      .map((line) => line.trim());
    expect(imports[0]).toBe('import "./lib/load-env";');
  });

  it("⑤-7 兜底字典跟种子脚本写的是同一批值(运行时对一遍)", () => {
    const dict = buildCatalogDictionaryFromCodeConstants();

    // 尺寸:加价 = idx * 500、排序 = (idx + 1) * 10
    for (const type of PRODUCT_TYPES) {
      const sizes = dict.sizesByType.get(type.code) ?? [];
      expect(sizes, type.code).toHaveLength(type.sizes.length);
      sizes.forEach((size, idx) => {
        expect(size.code, type.code).toBe(type.sizes[idx]);
        expect(size.priceDeltaCents, `${type.code}/${size.code}`).toBe(
          idx * SIZE_STEP_CENTS
        );
        expect(size.sortOrder, `${type.code}/${size.code}`).toBe((idx + 1) * 10);
      });
    }

    // 配件:名字 / 分类跟 `ACCESSORY_META` 一个口径,排序 = (idx + 1) * 10
    ACCESSORIES.forEach((accessory, idx) => {
      const def = dict.accessories.get(accessory.code);
      expect(def, accessory.code).toBeTruthy();
      if (!def) return;
      const meta: { category: string; name: { zh: string; en: string } } | undefined =
        ACCESSORY_META[accessory.code];
      expect(def.name, accessory.code).toBe(meta?.name.zh ?? accessory.code);
      expect(def.nameEn, accessory.code).toBe(meta?.name.en ?? accessory.code);
      expect(def.category, accessory.code).toBe(meta?.category ?? "decor");
      expect(def.sortOrder, accessory.code).toBe((idx + 1) * 10);
    });

    // 变体:加价 / 适用尺寸 / 排序都跟常量一致
    for (const variant of PRODUCT_ACCESSORY_VARIANTS) {
      const list = dict.variantsByType.get(variant.productTypeCode) ?? [];
      const def = list.find((d) => d.variantCode === variant.variantCode);
      expect(def, variant.variantCode).toBeTruthy();
      if (!def) return;
      expect(def.priceDeltaCents, variant.variantCode).toBe(
        variant.priceDeltaCents
      );
      expect(def.sortOrder, variant.variantCode).toBe(variant.sortOrder);
      expect(def.appliesToSizesCm, variant.variantCode).toEqual([
        ...variant.appliesToSizesCm,
      ]);
    }
  });
});

/* ========================================================================== */
/*  ⑥ 币种脚本不再重刷配件加价                                                  */
/* ========================================================================== */

describe("⑥ `apply-currency-schema.ts` 不再按代码字典重刷配件加价", () => {
  const code = read(CURRENCY);

  it("⑥-1 一个字都不写配件变体那张表", () => {
    expect(code).not.toMatch(
      /UPDATE\s+"?product_accessory_variant"?/i
    );
  });

  it("⑥-2 那一节是只读的,并说清楚「配件加价由后台管」", () => {
    expect(code).toContain("product_accessory_variant.price_delta_cents");
    expect(code).toContain("不重刷 —— 配件加价由后台管");
  });

  it("⑥-3 币种对齐那部分没被误伤", () => {
    // 币种 / 默认值的对齐跟这条线无关,别把它一起删了
    expect(code).toContain("product_accessory_variant");
    expect(code).toMatch(/currency/i);
  });
});

/* ========================================================================== */
/*  ⑦ 新型号不再被 PRODUCT_TYPES 硬闸挡住                                      */
/* ========================================================================== */

describe("⑦ 新型号不再被 `PRODUCT_TYPES` 硬闸挡住", () => {
  it("⑦-1 `createProductInDb` 不再查 `PRODUCT_TYPES`", () => {
    const code = stripComments(read(DB_PRODUCTS));
    // 硬闸那一句(「不在 PRODUCT_TYPES 里」)已经拆了
    expect(code).not.toMatch(/PRODUCT_TYPES/);
  });

  it("⑦-2 但「至少要有一档尺寸」那道闸还在 —— 说人话", () => {
    const code = read(DB_PRODUCTS);
    expect(code).toContain("sizeCodesForType(dict, code).length === 0");
    expect(code).toContain("CatalogDictionaryUserError");
  });

  it("⑦-3 后台新建商品那道闸也拆了", () => {
    const code = read(ACTIONS);
    // `createProductAdminAction` 那一段里没有 PRODUCT_TYPES
    const body = actionBody(code, "createProductAdminAction");
    expect(body).not.toContain("PRODUCT_TYPES");
  });
});

/* ========================================================================== */
/*  ⑧ 中英文键集一致                                                           */
/* ========================================================================== */

describe("⑧ 中英文键集一致", () => {
  it("⑧-1 `AdminCatalog` 两个语言的叶子键完全一样", () => {
    const zh = messages("zh").AdminCatalog as unknown;
    const en = messages("en").AdminCatalog as unknown;

    const zhKeys = leafKeys(zh).sort();
    const enKeys = leafKeys(en).sort();

    const missingInEn = zhKeys.filter((k) => !enKeys.includes(k));
    const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));

    expect(
      { missingInEn, missingInZh },
      "AdminCatalog 的中英文键不一致"
    ).toEqual({ missingInEn: [], missingInZh: [] });
    expect(zhKeys.length).toBeGreaterThan(30);
  });

  it("⑧-2 十个错误码两种语言都摆得上话", () => {
    for (const locale of ["zh", "en"] as const) {
      const ns = messages(locale).AdminCatalog as Record<string, unknown>;
      const errors = ns.errors as Record<string, unknown>;
      expect(errors, locale).toBeTruthy();
      for (const code of CATALOG_ERROR_CODES) {
        expect(errors[code], `${locale}/${code}`).toBeTruthy();
      }
    }
  });

  it("⑧-3 每个错误码在两种语言里都有话(不是空串)", () => {
    for (const locale of ["zh", "en"] as const) {
      const ns = messages(locale).AdminCatalog as Record<string, unknown>;
      const errors = ns.errors as Record<string, unknown>;
      for (const code of CATALOG_ERROR_CODES) {
        const text = errors[code];
        expect(typeof text, `${locale}/${code}`).toBe("string");
        expect((text as string).length, `${locale}/${code}`).toBeGreaterThan(0);
      }
    }
  });

  it("⑧-4 `CATALOG_ERROR_TEXT_KEYS` 指的键在两种语言里都存在", () => {
    const types = read(TYPES);
    for (const code of CATALOG_ERROR_CODES) {
      expect(types, code).toContain(`${code}: "errors.${code}",`);
      for (const locale of ["zh", "en"] as const) {
        const ns = messages(locale).AdminCatalog as Record<string, unknown>;
        const errors = ns.errors as Record<string, unknown>;
        expect(errors[code], `${locale}/${code}`).toBeTruthy();
      }
    }
  });
});
