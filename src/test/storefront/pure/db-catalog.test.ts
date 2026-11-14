import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applyCatalogConfig,
  buildCatalogSource,
  CATALOG_STATUS_ACTIVE,
  emptyCatalogSource,
  isCatalogTypeActive,
  sortCatalogItems,
} from "@/features/storefront/lib/catalog-apply";
import type { CatalogTypeRow } from "@/features/storefront/lib/catalog-source-types";
import { MOCK_PRODUCTS } from "@/features/storefront/lib/mock-catalog";
import {
  assertCatalogTypeAvailable,
  PRODUCT_UNAVAILABLE_CODE,
  ProductUnavailableError,
  productUnavailableMessage,
} from "@/features/storefront/lib/product-unavailable";
import type { StorefrontProduct } from "@/features/storefront/types";

/**
 * 「电商产品获取后台配置管理好的产品」—— 目录跟着后台走(2026-11-14)
 *
 * 工作室的要求:后台 `/admin/products` 管着的那些商品,商城要**照着摆**。
 *
 * ## 为什么这个值得测
 *
 * 后台管的是**型号**(6 个:R / A / P / RM / LB / M),商城卖的是**设计**
 * (12 件)。粒度不同 ⇒ 三个地方最容易出错:
 *
 * 1. **粒度** —— 一个型号下架 ⇒ 那一组设计**全部**下架(不是只下一件)
 * 2. **字段映射** —— 型号级的字段(`description` / `coverUrl` / `leadTimeDays`)
 *    盖到设计级上 ⇒ 4 件设计变成同一张图 / 同一段文案 / 同一个工期
 * 3. **排序** —— 系列之间是**代码常量**(`WJP_SERIES`),后台只管系列之内
 *
 * ## 这个文件守住什么
 *
 * - **纯函数** —— 上架判定 / 盖名字 / 排序(直接喂手写的数据)
 * - **下架闸门** —— 加购 / 结算都要拒(不是静默跳过那一行)
 * - **扫描式守卫** —— 服务端模块不许被客户端组件 import;两个写路径都要
 *   有闸门;接口要回 409
 *
 * 全部是文件扫描 + 纯函数 —— 不需要 DB / 网络 / 浏览器。
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
 * `storefront-catalog.ts` import 了 `price-source.ts`(那个 import `@/db`)
 * ⇒ 被客户端组件 import 会在构建期炸。所以要全仓扫。
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

const CATALOG_APPLY = "src/features/storefront/lib/catalog-apply.ts";
const CATALOG_SOURCE_TYPES =
  "src/features/storefront/lib/catalog-source-types.ts";
const STOREFRONT_CATALOG = "src/features/storefront/lib/storefront-catalog.ts";
const PRICE_SOURCE = "src/features/storefront/lib/price-source.ts";
const PRODUCT_UNAVAILABLE =
  "src/features/storefront/lib/product-unavailable.ts";
const CART_STORE = "src/features/storefront/lib/cart-store.ts";
const CHECKOUT = "src/features/storefront/lib/checkout.ts";
const LINE_ITEMS_ROUTE = "src/app/api/store/carts/[id]/line-items/route.ts";
const CHECKOUT_ROUTE = "src/app/api/store/checkout/route.ts";

/* -------------------------------------------------------------------------- */
/*  夹具                                                                       */
/* -------------------------------------------------------------------------- */

/** 一份 DB 行 */
function row(overrides: Partial<CatalogTypeRow> = {}): CatalogTypeRow {
  return {
    code: "R",
    name: "钥匙扣",
    nameEn: "Keychain",
    status: "active",
    sortOrder: 10,
    accent: "#B07A5B",
    ...overrides,
  };
}

/** 一件设计的最小夹具 —— 只填跟这次改动有关的字段 */
function design(
  handle: string,
  productTypeCode: string,
  seriesId: string,
  overrides: Partial<StorefrontProduct> = {}
): StorefrontProduct {
  const base = MOCK_PRODUCTS[0];
  return {
    ...base,
    id: `prod_${handle}`,
    handle,
    productTypeCode: productTypeCode as StorefrontProduct["productTypeCode"],
    seriesId,
    typeLabel: "钥匙扣",
    typeLabelEn: "R",
    accent: "#B07A5B",
    ...overrides,
  } as StorefrontProduct;
}

/* -------------------------------------------------------------------------- */
/*  上架 / 下架                                                                 */
/* -------------------------------------------------------------------------- */

describe("上架判定 —— `isCatalogTypeActive`", () => {
  it("**没有 DB 行 ⇒ 上架**(后台没管过它)", () => {
    const source = buildCatalogSource([]);
    expect(isCatalogTypeActive("R", source)).toBe(true);
  });

  it('有行 + `status === "active"` ⇒ 上架', () => {
    const source = buildCatalogSource([row({ status: "active" })]);
    expect(isCatalogTypeActive("R", source)).toBe(true);
  });

  it("有行 + `status` 是别的 ⇒ **下架**", () => {
    const source = buildCatalogSource([row({ status: "inactive" })]);
    expect(isCatalogTypeActive("R", source)).toBe(false);
  });

  it("认不出来的一律当下架(只有 `active` 才上架)", () => {
    const source = buildCatalogSource([
      row({ status: "whatever" as "active" | "inactive" }),
    ]);
    expect(isCatalogTypeActive("R", source)).toBe(false);
  });

  it("**只管自己那一个型号** —— 下架 R 不影响 A", () => {
    const source = buildCatalogSource([
      row({ code: "R", status: "inactive" }),
      row({ code: "A", status: "active" }),
    ]);
    expect(isCatalogTypeActive("R", source)).toBe(false);
    expect(isCatalogTypeActive("A", source)).toBe(true);
  });

  it("读失败(降级)⇒ **全部上架** —— 不给用户一个空店", () => {
    const source = emptyCatalogSource("连不上库");
    expect(source.degraded).toBe(true);
    expect(isCatalogTypeActive("R", source)).toBe(true);
    expect(isCatalogTypeActive("M", source)).toBe(true);
  });

  it("`CATALOG_STATUS_ACTIVE` 就是 `active` 字面值", () => {
    expect(CATALOG_STATUS_ACTIVE).toBe("active");
  });
});

/* -------------------------------------------------------------------------- */
/*  盖                                                                         */
/* -------------------------------------------------------------------------- */

describe("盖名字 —— `applyCatalogConfig`", () => {
  it("非空 ⇒ 覆盖 `typeLabel` / `typeLabelEn` / `accent`", () => {
    const source = buildCatalogSource([
      row({ name: "挂件", nameEn: "Charm", accent: "#123456" }),
    ]);
    const out = applyCatalogConfig(design("a", "R", "s_keychain"), source);

    expect(out.typeLabel).toBe("挂件");
    expect(out.typeLabelEn).toBe("Charm");
    expect(out.accent).toBe("#123456");
  });

  it("空串 ⇒ **不盖**(用回代码常量)", () => {
    const source = buildCatalogSource([
      row({ name: "", nameEn: "   ", accent: "" }),
    ]);
    const item = design("a", "R", "s_keychain", {
      typeLabel: "钥匙扣",
      typeLabelEn: "R",
      accent: "#B07A5B",
    });
    const out = applyCatalogConfig(item, source);

    expect(out.typeLabel).toBe("钥匙扣");
    expect(out.typeLabelEn).toBe("R");
    expect(out.accent).toBe("#B07A5B");
  });

  it("没有 DB 行 ⇒ 原样返回(同一个引用)", () => {
    const source = buildCatalogSource([]);
    const item = design("a", "R", "s_keychain");
    expect(applyCatalogConfig(item, source)).toBe(item);
  });

  it("⚠️ `description` / `thumbnail` / `leadTimeDays` **不盖** —— 那是型号级的字段", () => {
    const source = buildCatalogSource([
      row({
        name: "挂件",
        nameEn: "Charm",
        accent: "#123456",
      }),
    ]);
    const item = design("a", "R", "s_keychain", {
      description: "这一件自己的文案",
      thumbnail: "https://example.test/a.png",
      leadTimeDays: 5,
    });
    const out = applyCatalogConfig(item, source);

    // 盖的是型号名 + 强调色 —— 别的**一个字节都没动**
    expect(out.description).toBe("这一件自己的文案");
    expect(out.thumbnail).toBe("https://example.test/a.png");
    expect(out.leadTimeDays).toBe(5);
  });

  it("⚠️ `title` / `subtitle` **不盖** —— 设计级资料归代码常量", () => {
    const source = buildCatalogSource([row({ name: "挂件" })]);
    const item = design("a", "R", "s_keychain", {
      title: "萌宠肖像钥匙扣",
      subtitle: "把爱宠挂在书包上",
    });
    const out = applyCatalogConfig(item, source);

    expect(out.title).toBe("萌宠肖像钥匙扣");
    expect(out.subtitle).toBe("把爱宠挂在书包上");
  });
});

/* -------------------------------------------------------------------------- */
/*  排序                                                                       */
/* -------------------------------------------------------------------------- */

describe("排序 —— `sortCatalogItems`", () => {
  it("**系列之间**按 `WJP_SERIES`(代码常量,后台管不了)", () => {
    const source = buildCatalogSource([]);
    const items = [
      design("m", "P", "s_magnet"),
      design("k", "R", "s_keychain"),
      design("f", "M", "s_figure"),
    ];
    const out = sortCatalogItems(items, source);
    expect(out.map((i) => i.seriesId)).toEqual([
      "s_keychain",
      "s_figure",
      "s_magnet",
    ]);
  });

  it("**系列之内**按后台的 `sortOrder` 升序", () => {
    const source = buildCatalogSource([
      row({ code: "R", sortOrder: 99 }),
      row({ code: "A", sortOrder: 1 }),
    ]);
    const items = [
      design("r", "R", "s_keychain"),
      design("a", "A", "s_keychain"),
    ];
    const out = sortCatalogItems(items, source);
    expect(out.map((i) => i.productTypeCode)).toEqual(["A", "R"]);
  });

  it("**没有 DB 行 ⇒ 排最后**(不是排最前)", () => {
    const source = buildCatalogSource([row({ code: "A", sortOrder: 1 })]);
    const items = [
      design("r", "R", "s_keychain"),
      design("a", "A", "s_keychain"),
    ];
    const out = sortCatalogItems(items, source);
    expect(out.map((i) => i.productTypeCode)).toEqual(["A", "R"]);
  });

  it("⚠️ 两个都没有 DB 行 ⇒ 保持**原序**(不能变成 NaN 比较)", () => {
    const source = buildCatalogSource([]);
    const items = [
      design("r1", "R", "s_keychain"),
      design("a1", "A", "s_keychain"),
      design("r2", "R", "s_keychain"),
    ];
    const out = sortCatalogItems(items, source);
    expect(out.map((i) => i.handle)).toEqual(["r1", "a1", "r2"]);
  });

  it("同一个 `sortOrder` ⇒ 保持**原序**(稳定)", () => {
    const source = buildCatalogSource([
      row({ code: "R", sortOrder: 5 }),
      row({ code: "A", sortOrder: 5 }),
    ]);
    const items = [
      design("r1", "R", "s_keychain"),
      design("a1", "A", "s_keychain"),
      design("r2", "R", "s_keychain"),
    ];
    const out = sortCatalogItems(items, source);
    expect(out.map((i) => i.handle)).toEqual(["r1", "a1", "r2"]);
  });

  it("种子数据那个顺序 ⇒ **一个字节都不变**(R=10 A=20 P=30 …)", () => {
    // 种子脚本按 PRODUCT_TYPES 的顺序写 sortOrder —— 商城代码里的顺序
    // 恰好是同一个 ⇒ 接上后台之后网格顺序不变。
    const source = buildCatalogSource([
      row({ code: "R", sortOrder: 10 }),
      row({ code: "A", sortOrder: 20 }),
      row({ code: "P", sortOrder: 30 }),
      row({ code: "RM", sortOrder: 40 }),
      row({ code: "LB", sortOrder: 50 }),
      row({ code: "M", sortOrder: 60 }),
    ]);
    const before = MOCK_PRODUCTS.map((p) => p.handle);
    const after = sortCatalogItems(MOCK_PRODUCTS, source).map((p) => p.handle);
    expect(after).toEqual(before);
  });

  it("不在 `WJP_SERIES` 里的系列排最后(不炸)", () => {
    const source = buildCatalogSource([]);
    const items = [
      design("x", "R", "s_unknown"),
      design("k", "R", "s_keychain"),
    ];
    const out = sortCatalogItems(items, source);
    expect(out.map((i) => i.handle)).toEqual(["k", "x"]);
  });
});

/* -------------------------------------------------------------------------- */
/*  下架闸门                                                                   */
/* -------------------------------------------------------------------------- */

describe("下架闸门 —— `product-unavailable.ts`", () => {
  it("在架上 ⇒ 不抛", () => {
    const source = buildCatalogSource([row({ status: "active" })]);
    expect(() =>
      assertCatalogTypeAvailable({
        typeCode: "R",
        productTitle: "萌宠肖像钥匙扣",
        catalog: source,
      })
    ).not.toThrow();
  });

  it("没有 DB 行 ⇒ 不抛(后台没管过照卖)", () => {
    const source = buildCatalogSource([]);
    expect(() =>
      assertCatalogTypeAvailable({
        typeCode: "R",
        productTitle: "萌宠肖像钥匙扣",
        catalog: source,
      })
    ).not.toThrow();
  });

  it("下架 ⇒ 抛 `ProductUnavailableError`", () => {
    const source = buildCatalogSource([row({ status: "inactive" })]);
    expect(() =>
      assertCatalogTypeAvailable({
        typeCode: "R",
        productTitle: "萌宠肖像钥匙扣",
        catalog: source,
      })
    ).toThrow(ProductUnavailableError);
  });

  it("错误带**稳定的码** + 说是哪一件", () => {
    const source = buildCatalogSource([row({ status: "inactive" })]);
    try {
      assertCatalogTypeAvailable({
        typeCode: "R",
        productTitle: "萌宠肖像钥匙扣",
        catalog: source,
      });
      throw new Error("不该走到这儿");
    } catch (error) {
      expect(error).toBeInstanceOf(ProductUnavailableError);
      const typed = error as ProductUnavailableError;
      expect(typed.code).toBe(PRODUCT_UNAVAILABLE_CODE);
      expect(typed.productTitle).toBe("萌宠肖像钥匙扣");
      expect(typed.productTypeCode).toBe("R");
      expect(typed.message).toContain("萌宠肖像钥匙扣");
    }
  });

  it("文案是**中文硬编码**那一套(商城交易界面不另开 i18n)", () => {
    expect(productUnavailableMessage("萌宠肖像钥匙扣")).toBe(
      "「萌宠肖像钥匙扣」已经下架了,不能购买"
    );
  });

  it("码就叫 `PRODUCT_UNAVAILABLE`", () => {
    expect(PRODUCT_UNAVAILABLE_CODE).toBe("PRODUCT_UNAVAILABLE");
  });
});

/* -------------------------------------------------------------------------- */
/*  扫描式守卫                                                                 */
/* -------------------------------------------------------------------------- */

describe("电商目录读后台 —— 扫描式守卫", () => {
  it("① `catalog-apply.ts` 是**纯函数** —— 不碰 DB", () => {
    const code = stripComments(read(CATALOG_APPLY));
    expect(code).not.toContain("@/db");
    expect(code).not.toContain("server-only");
  });

  it("② `catalog-source-types.ts` 只有类型 —— 不碰 DB", () => {
    const code = stripComments(read(CATALOG_SOURCE_TYPES));
    expect(code).not.toContain("@/db");
  });

  it("③ `price-source.ts` 把目录那几列**一起**读出来(一次 DB 读)", () => {
    const code = stripComments(read(PRICE_SOURCE));

    expect(code).toContain("name: product.name");
    expect(code).toContain("nameEn: product.nameEn");
    expect(code).toContain("status: product.status");
    expect(code).toContain("sortOrder: product.sortOrder");
    expect(code).toContain("accent: product.accent");
    // 两份来源共用同一次读
    expect(code).toContain("buildCatalogSource(productRows)");
  });

  it("④ `price-source.ts` 仍然调 `connection()`(别把价烤进 HTML)", () => {
    const code = stripComments(read(PRICE_SOURCE));
    expect(code).toContain('import { connection } from "next/server"');
    expect(code).toContain("await connection()");
  });

  it("⑤ 全仓扫:没有客户端组件 import 服务端目录模块", () => {
    const offenders: string[] = [];
    for (const rel of walkClientComponents()) {
      const src = stripComments(read(rel));
      if (/from\s+"[^"]*\/storefront-catalog"/.test(src)) offenders.push(rel);
      if (/from\s+"[^"]*\/price-source"/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("⑥ `storefront-catalog.ts` 三处都过滤下架(目录 / 详情 / 相关推荐)", () => {
    const code = stripComments(read(STOREFRONT_CATALOG));

    // 目录
    expect(code).toContain(
      "MOCK_PRODUCTS.filter((item) =>\n      isCatalogTypeActive(item.productTypeCode, catalog)\n    )"
    );
    // 详情 ⇒ null
    expect(code).toContain(
      "if (!isCatalogTypeActive(item.productTypeCode, resolved.catalog)) return null;"
    );
    // 相关推荐 ⇒ 候选集先过滤
    expect(code).toContain("const candidates = activeItems(resolved.catalog);");
  });

  it("⑦ 加购那条路有闸门(`cart-store.ts`)", () => {
    const code = stripComments(read(CART_STORE));

    expect(code).toContain(
      'import { assertCatalogTypeAvailable } from "./product-unavailable"'
    );
    expect(code).toContain("assertCatalogTypeAvailable({");
    expect(code).toContain("typeCode: product.productTypeCode");
  });

  it("⑧ 结算那条路有闸门(`checkout.ts`)", () => {
    const code = stripComments(read(CHECKOUT));

    expect(code).toContain(
      'import { isCatalogTypeActive } from "./catalog-apply"'
    );
    expect(code).toContain("PRODUCT_UNAVAILABLE");
    expect(code).toContain(
      "isCatalogTypeActive(product.productTypeCode, catalog)"
    );
  });

  it("⑨ 结算**不静默跳过**那一行 —— 抛 `CheckoutError`", () => {
    const code = stripComments(read(CHECKOUT));

    expect(code).toContain(
      'throw new CheckoutError(\n      "PRODUCT_UNAVAILABLE",\n      productUnavailableMessage(product.title)\n    )'
    );
  });

  it("⑩ 加购接口回 **409**(不是 500)", () => {
    const code = stripComments(read(LINE_ITEMS_ROUTE));

    expect(code).toContain("ProductUnavailableError");
    expect(code).toContain("PRODUCT_UNAVAILABLE_CODE");
    expect(code).toContain("{ status: 409 }");
  });

  it("⑪ 结算接口把 `PRODUCT_UNAVAILABLE` 映射成 **409**", () => {
    const code = stripComments(read(CHECKOUT_ROUTE));

    expect(code).toMatch(/case "PRODUCT_UNAVAILABLE":\s*\n\s*return 409;/);
  });

  it("⑫ `checkout.ts` 的**收钱硬闸**还在(读不到价 ⇒ 拒绝下单)", () => {
    const code = stripComments(read(CHECKOUT));

    expect(code).toContain("const source = await getPriceSource()");
    expect(code).toContain("if (source.degraded)");
    expect(code).toContain(
      'throw new CheckoutError("PRICING_FAILED", "价格暂时无法确认,请稍后重试")'
    );
  });

  it("⑬ `product-unavailable.ts` 是**纯文件** —— 不碰 DB / 网络", () => {
    const code = stripComments(read(PRODUCT_UNAVAILABLE));

    expect(code).not.toContain("@/db");
    expect(code).not.toContain("server-only");
    expect(code).not.toContain("next/server");
  });
});
