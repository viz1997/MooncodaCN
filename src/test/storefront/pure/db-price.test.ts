import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { getProductType } from "@/features/gpt-image/lib/product-catalog";
import {
  recomputeVariantPrices,
  SIZE_STEP_CENTS,
} from "@/features/image-gen/lib/product-variant-sku";
import type { PriceSource } from "@/features/storefront/lib/price-source-types";
import { calculatePricing } from "@/features/storefront/lib/pricing";
import type { CustomizationSpec } from "@/features/storefront/types";

/**
 * 「后台改价能生效」—— 商城网页读 DB 的价(2026-11-08)
 *
 * 工作室看到的 bug:**后台 `/admin/products` 改了价,商城网页没变**
 * (小程序变了 —— 那条链路早就是 DB 优先)。
 *
 * 根因:商城那条链路从头到尾读的是**代码常量**
 * (`mock-catalog.ts` 的 `BASE_PRICE_CENTS`),后台改的是 DB。
 *
 * ## 这个文件守住两件事
 *
 * 1. **扫描式守卫** —— 把「价从哪儿来」这条不变式钉在源码上:
 *    - `pricing.ts` 必须接受 `priceSource` 第二参,且基础价取自它
 *    - `mock-catalog.ts` **不许** import `@/db`(它是客户端安全的静态目录)
 *    - `price-source.ts`(服务端)必须调 `connection()`(别把价烤进 HTML)
 *    - `price-source.ts` **不许**被客户端组件 import
 *    - `checkout.ts` 在 DB 读失败时必须**硬失败**(绝不按旧价收款)
 *    - `apply-currency-schema.ts` 必须默认只读(重定价要显式 `--force-reprice`)
 *    - `bulkUpdateProductVariantsAction` 的 schema **不许**有 `priceCents`
 *    - `generateVariantsForProductInDb` 必须传 DB 的基础价
 * 2. **纯函数** —— `calculatePricing` 的第二参真的生效;
 *    `recomputeVariantPrices` 的算式跟播种时**逐字一致**。
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
 * 找出仓库里所有带 `"use client"` 的 tsx 文件(相对仓库根)
 *
 * 服务端模块(`price-source.ts` import 了 `@/db`)被客户端组件 import 时
 * 会在构建期炸 —— 所以要全仓扫,不能只盯已知的几个文件。
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

const PRICING = "src/features/storefront/lib/pricing.ts";
const PRICE_SOURCE = "src/features/storefront/lib/price-source.ts";
const MOCK_CATALOG = "src/features/storefront/lib/mock-catalog.ts";
const CHECKOUT = "src/features/storefront/lib/checkout.ts";
const CART_STORE = "src/features/storefront/lib/cart-store.ts";
const CURRENCY_MIGRATION = "scripts/apply-currency-schema.ts";
const ADMIN_ACTIONS = "src/features/image-gen/admin/actions.ts";
const DB_PRODUCTS = "src/features/image-gen/lib/db-products.ts";

/* -------------------------------------------------------------------------- */
/*  扫描式守卫                                                                 */
/* -------------------------------------------------------------------------- */

describe("价从 DB 来 —— 扫描式守卫", () => {
  it("① `pricing.ts` 接受 `priceSource` 第二参", () => {
    const code = stripComments(read(PRICING));

    expect(code).toContain("priceSource?: PriceSource");
    expect(code).toContain(
      "export function calculatePricing(\n  spec: CustomizationSpec,\n  priceSource?: PriceSource\n)"
    );
  });

  it("② `price-source.ts` 存在,而且调了 `connection()`", () => {
    const code = stripComments(read(PRICE_SOURCE));

    // 少了这一句,价会在构建期被烤进 HTML —— 「改了不生效」原地复发
    expect(code).toContain('import { connection } from "next/server"');
    expect(code).toContain("await connection()");
  });

  it("③ `calculatePricing` 的基础价取自 `priceSource`", () => {
    const code = stripComments(read(PRICING));

    expect(code).toContain(
      "priceSource?.basePriceCentsByTypeCode.get(spec.productTypeCode) ??\n    product.basePriceCents"
    );
    // 配件加价同理
    expect(code).toContain(
      "priceSource?.accessoryDeltaCentsByVariantId.get(variantId) ??\n      variant.surchargeCents"
    );
  });

  it("④ `mock-catalog.ts` 不 import `@/db` —— 它是客户端安全的静态目录", () => {
    const code = stripComments(read(MOCK_CATALOG));

    expect(code).not.toContain("@/db");
  });

  it("⑤ `price-source.ts` 只被服务端用 —— 没有客户端组件 import 它", () => {
    // 客户端组件的标志:文件头有 "use client"
    const clientFiles = [
      "src/features/marketing/components/storefront/shop-grid.tsx",
      "src/features/marketing/components/storefront/featured-products.tsx",
      "src/features/marketing/components/storefront/store-hero.tsx",
      "src/features/marketing/components/storefront/category-strip.tsx",
      "src/features/marketing/components/storefront/series-showcase.tsx",
      "src/features/storefront/components/customize-entry.tsx",
    ];
    for (const rel of clientFiles) {
      const src = read(rel);
      // 文件头可能有文档注释,所以找那一行 `"use client";` 而不是 startsWith
      expect(src, rel).toMatch(/^\s*"use client";\s*$/m);
      // 客户端组件不许 import 服务端的价格源
      expect(stripComments(src), rel).not.toMatch(
        /from\s+"[^"]*\/price-source"/
      );
    }
  });

  it('⑤-补 全仓扫一遍:没有任何 `"use client"` 文件 import 服务端价格源', () => {
    // 服务端价格源 import 了 `@/db` —— 被客户端组件 import 就会炸构建
    const offenders: string[] = [];
    for (const rel of walkClientComponents()) {
      const src = stripComments(read(rel));
      if (/from\s+"[^"]*\/price-source"/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("⑥-补 购物袋读 DB 的价 —— `cart-store.ts` 走同一个价格源", () => {
    const code = stripComments(read(CART_STORE));

    // 购物袋是给人看的,DB 读失败时降级到代码常量(不抛)
    expect(code).toContain('import { getPriceSource } from "./price-source"');
    expect(code).toContain("const source = await getPriceSource()");
    expect(code).toContain("calculatePricing(");
  });

  it("⑥ `checkout.ts` 在 DB 读失败时**硬失败** —— 绝不按旧价收款", () => {
    const code = stripComments(read(CHECKOUT));

    expect(code).toContain("const source = await getPriceSource()");
    expect(code).toContain("if (source.degraded)");
    expect(code).toContain(
      'throw new CheckoutError("PRICING_FAILED", "价格暂时无法确认,请稍后重试")'
    );
  });

  it("⑦ `apply-currency-schema.ts` 默认只读 —— 重定价要显式 `--force-reprice`", () => {
    const code = stripComments(read(CURRENCY_MIGRATION));

    expect(code).toContain("--force-reprice");
    expect(code).toContain(
      'const FORCE_REPRICE = process.argv.includes("--force-reprice")'
    );
  });

  it("⑧ `bulkUpdateProductVariantsAction` 的 schema **没有** `priceCents`", () => {
    const code = stripComments(read(ADMIN_ACTIONS));

    // 留着就是留了个后门:管理员能把 SKU 价改成跟基础价不一致
    expect(code).toContain("bulkUpdateProductVariantsAction");
    expect(code).not.toContain("priceCents: z.number()");
  });

  it("⑨ `generateVariantsForProductInDb` 传了 DB 的基础价", () => {
    const code = stripComments(read(DB_PRODUCTS));

    // 新生成的 SKU 必须用 DB 里的基础价,不是代码常量
    expect(code).toContain("basePrices: { [code]: productRow.basePriceCents }");
  });
});

/* -------------------------------------------------------------------------- */
/*  纯函数                                                                     */
/* -------------------------------------------------------------------------- */

/** 一份最小的价格源 —— 只覆盖 R 型号的基础价 */
function priceSourceWith(base: Map<string, number>): PriceSource {
  return {
    basePriceCentsByTypeCode: base,
    accessoryDeltaCentsByVariantId: new Map(),
    degraded: false,
    readError: null,
  };
}

/** 一个合法的 R(钥匙扣)规格 —— 尺寸 4cm、树脂、不刻字、不加急、无配件 */
function specForR(): CustomizationSpec {
  return {
    productId: "prod_keychain-pet-portrait",
    productHandle: "keychain-pet-portrait",
    productTypeCode: "R",
    materialId: "mat_resin",
    sizeId: "size_R_4",
    aiStyleId: "ai_original",
    engravingText: "",
    rushOrder: false,
    accessoryVariantIds: [],
    quantity: 1,
    previewImageUrl: "",
    originalImageUrl: "",
  };
}

describe("`calculatePricing` —— 第二参真的生效", () => {
  it("传了 `priceSource` → 基础价用 DB 的", () => {
    const spec = specForR();
    const fallback = calculatePricing(spec);
    const withDb = calculatePricing(
      spec,
      priceSourceWith(new Map([["R", 2500]]))
    );

    expect(fallback.breakdown.baseCents).not.toBe(2500);
    expect(withDb.breakdown.baseCents).toBe(2500);
    // 基础价换了 2000 分,单价也差 2000 分(其它加价项没变)
    expect(withDb.unitPriceCents - fallback.unitPriceCents).toBe(
      2500 - fallback.breakdown.baseCents
    );
  });

  it("没传 `priceSource` → 退回代码常量(纯函数调用不受影响)", () => {
    const spec = specForR();
    const a = calculatePricing(spec);
    const b = calculatePricing(spec);

    expect(a).toEqual(b);
    expect(a.breakdown.baseCents).toBeGreaterThan(0);
  });

  it("`priceSource` 里没有这个型号 → 退回代码常量,不报错", () => {
    const spec = specForR();
    const fallback = calculatePricing(spec);
    const other = calculatePricing(
      spec,
      priceSourceWith(new Map([["M", 19900]]))
    );

    expect(other.breakdown.baseCents).toBe(fallback.breakdown.baseCents);
  });

  it("改一个型号的价**不影响**别的型号", () => {
    const spec = specForR();
    const source = priceSourceWith(
      new Map([
        ["R", 2500],
        ["A", 2400],
      ])
    );
    const priced = calculatePricing(spec, source);

    expect(priced.breakdown.baseCents).toBe(2500);
  });
});

describe("`recomputeVariantPrices` —— SKU 价 = 基础价 + 尺寸阶梯 + 配件加价", () => {
  const productType = getProductType("R");
  if (!productType) throw new Error("R 不在 PRODUCT_TYPES 里 —— 测试夹具坏了");

  const accessoryVariants = [
    {
      accessoryCode: "leather",
      variantCode: "leather_brown",
      priceDeltaCents: 800,
      sortOrder: 0,
    },
  ];

  it("算式跟播种时一致 —— 同一个基础价算出同一个价", () => {
    const rows = [
      {
        id: "v1",
        sizeCode: "4",
        accessoryCode: "N-A",
        variantCode: "N-A",
      },
      {
        id: "v2",
        sizeCode: "6",
        accessoryCode: "N-A",
        variantCode: "N-A",
      },
      {
        id: "v3",
        sizeCode: "4",
        accessoryCode: "leather",
        variantCode: "leather_brown",
      },
    ];

    const out = recomputeVariantPrices({
      basePriceCents: 1900,
      productType,
      accessoryVariants,
      existingRows: rows,
    });

    expect(out).toEqual([
      { id: "v1", priceCents: 1900 },
      { id: "v2", priceCents: 1900 + SIZE_STEP_CENTS },
      { id: "v3", priceCents: 1900 + 800 },
    ]);
  });

  it("尺寸码不在字典里 → **跳过那一行**,不当成 0", () => {
    const out = recomputeVariantPrices({
      basePriceCents: 1900,
      productType,
      accessoryVariants,
      existingRows: [
        { id: "v1", sizeCode: "4", accessoryCode: "N-A", variantCode: "N-A" },
        // 99 不在字典的尺寸里
        { id: "v2", sizeCode: "99", accessoryCode: "N-A", variantCode: "N-A" },
      ],
    });

    // 只有 v1 —— v2 保持原价(宁可不改,也不能改错)
    expect(out.map((r) => r.id)).toEqual(["v1"]);
  });

  it("配件变体查不到加价 → **跳过那一行**,不当成 0", () => {
    const out = recomputeVariantPrices({
      basePriceCents: 1900,
      productType,
      accessoryVariants,
      existingRows: [
        { id: "v1", sizeCode: "4", accessoryCode: "N-A", variantCode: "N-A" },
        // 字典里没有 rope_red 这个变体
        {
          id: "v2",
          sizeCode: "4",
          accessoryCode: "braided_rope",
          variantCode: "rope_red",
        },
      ],
    });

    expect(out.map((r) => r.id)).toEqual(["v1"]);
  });

  it("「配件有码但没有变体行」(`N-A`)不加配件价 —— 跟播种口径一致", () => {
    const out = recomputeVariantPrices({
      basePriceCents: 1900,
      productType,
      accessoryVariants,
      existingRows: [
        {
          id: "v1",
          sizeCode: "4",
          accessoryCode: "leather",
          variantCode: "N-A",
        },
      ],
    });

    expect(out).toEqual([{ id: "v1", priceCents: 1900 }]);
  });
});
