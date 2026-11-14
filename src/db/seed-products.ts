/**
 * Seed:product + product_variant 表 —— 2026-10-21
 *
 * 跑法:
 *   pnpm db:push                        # 先把表推到 DB
 *   pnpm tsx src/db/seed-products.ts
 *
 * 幂等:product 按 code DO NOTHING;product_variant 按四元组 + sku DO NOTHING。
 *
 * ⚠️ 不会覆盖已有数据:
 *   运营在 /admin/products 改过的价 / 下架状态，重跑本脚本不会动它们
 *   （ON CONFLICT DO NOTHING）。想回到字典价请先手动清表：
 *     DELETE FROM product_variant; DELETE FROM product;
 *   然后重跑。
 *
 * 数据来源:
 *  - 商品资料 ← product-catalog.ts 的 PRODUCT_META(名称/描述/分类)
 *  - 基础价   ← BASE_PRICE_CENTS(R=1900 / A=2400 / P=3900 / RM=4900 / LB=5900 / M=19900)
 *  - SKU 矩阵 ← **字典**(catalog-dictionary.ts:DB 优先,代码常量兜底)
 *               的 sizesByType[code] × accessoryOptionsByType[code]
 *               × product_accessory_variant 行
 *
 * 初始价 = basePriceCents + **尺寸的显式加价** + 配件变体加价，与改造前
 * 前端「base + 各维度 priceDeltaCents」的拼价结果一致，所以 seed 当天
 * 线上展示价零漂移。
 *
 * ⚠️ 尺寸加价现在是**字典里的显式值**（不再是 `idx × ¥5`）—— DB 没播种
 * 那一列时走代码常量兜底（兜底那份仍然是 `idx × ¥5`）⇒ 行为零漂移。
 *
 * 变体行数预估(随字典变化):
 *   R  3 尺寸 ×(皮革5 + 金属1 + 编织绳8) = 42
 *   A  2 尺寸 ×(支架1)                 =  2
 *   P  4 尺寸 ×(磁铁1)                 =  4
 *   RM 3 尺寸 ×(无配件1)               =  3
 *   LB 2 尺寸 ×(皮革5 + 金属1)         = 12
 *   M  8 尺寸 ×(底座3 + 玻璃罩3)       = 48
 *   合计约 111 行
 */

// ⚠️ 必须排 import 列表**第一个** —— `src/db/index.ts` 在模块顶层就查
// `DATABASE_URL`,拿不到直接抛错。静态 import 比模块体先跑,所以 .env 得
// 先加载,再让 `@/db` 被求值。顺序反了照样炸(见 scripts/lib/load-env.ts)。
import "../../scripts/lib/load-env";
import { db } from "@/db";
import type { NewProductRow, NewProductVariantRow } from "@/db/schema";
import { product, productAccessoryVariant, productVariant } from "@/db/schema";
import {
  BASE_PRICE_CENTS,
  PRODUCT_META,
  PRODUCT_TYPES,
} from "@/features/gpt-image/lib/product-catalog";
import {
  getCatalogDictionary,
  getFallbackCatalogDictionary,
} from "@/features/image-gen/lib/catalog-dictionary-store";
import { buildAllVariantSeeds } from "@/features/image-gen/lib/product-variant-sku";

async function main(): Promise<void> {
  const now = new Date();

  // ── 1. product 主表 ─────────────────────────────────────────────────────
  const productRows: NewProductRow[] = PRODUCT_TYPES.map((pt, idx) => {
    const meta = PRODUCT_META[pt.code];
    return {
      code: pt.code,
      name: meta?.displayName.zh ?? pt.name,
      nameEn: meta?.displayName.en ?? "",
      category: meta?.category ?? "keychain",
      description: meta?.description.zh ?? "",
      // 封面先留空 —— 装配层会回退到首个 AI 模板的封面，运营可在
      // /admin/products/[code] 填自己的图覆盖
      coverUrl: "",
      basePriceCents: BASE_PRICE_CENTS[pt.code] ?? 0,
      leadTimeDays: 7,
      accent: "",
      status: "active",
      sortOrder: (idx + 1) * 10,
      createdAt: now,
      updatedAt: now,
    };
  });

  const insertedProducts = await db
    .insert(product)
    .values(productRows)
    .onConflictDoNothing({ target: product.code })
    .returning({ code: product.code });

  console.log(
    `[seed-products] 商品:写入 ${insertedProducts.length} / ${productRows.length} 行(其余已存在,跳过)`
  );

  // ── 2. product_variant SKU 矩阵 ─────────────────────────────────────────
  // 变体价要用 DB 里(可能已被 admin 改过)的 basePriceCents，不是字典值
  const currentProducts = await db.select().from(product);
  const basePrices: Record<string, number> = {};
  for (const p of currentProducts) basePrices[p.code] = p.basePriceCents;

  const accVariants = await db.select().from(productAccessoryVariant);
  console.log(
    `[seed-products] 读到 ${accVariants.length} 行配件变体(来自 product_accessory_variant)`
  );

  // 尺寸 / 配件清单 ← **字典**
  //
  // DB 有行 ⇒ 用后台配的(**显式**加价);DB 没播种 / 读失败 ⇒ 退回代码常量
  // 兜底(尺寸加价 = idx × ¥5)⇒ 行为跟今天一个字节都不变。
  const dictionary = await getCatalogDictionary()
    .catch(() => getFallbackCatalogDictionary());
  console.log(
    `[seed-products] 字典:型号 ${dictionary.typeOrder.length} 个 ` +
      `(R ${dictionary.sizesByType.get("R")?.length ?? 0} 尺寸 / ` +
      `A ${dictionary.sizesByType.get("A")?.length ?? 0} / ` +
      `P ${dictionary.sizesByType.get("P")?.length ?? 0} / ` +
      `RM ${dictionary.sizesByType.get("RM")?.length ?? 0} / ` +
      `LB ${dictionary.sizesByType.get("LB")?.length ?? 0} / ` +
      `M ${dictionary.sizesByType.get("M")?.length ?? 0})`
  );

  const seeds = buildAllVariantSeeds({
    basePrices,
    accessoryVariants: accVariants.map((r) => ({
      productTypeCode: r.productTypeCode,
      accessoryCode: r.accessoryCode,
      variantCode: r.variantCode,
      priceDeltaCents: r.priceDeltaCents,
      sortOrder: r.sortOrder,
    })),
    // 尺寸 / 配件清单 ← **字典**(DB 优先,代码常量兜底)
    dictionary,
  });

  const variantRows: NewProductVariantRow[] = seeds.map((s) => ({
    ...s,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));

  const insertedVariants = await db
    .insert(productVariant)
    .values(variantRows)
    .onConflictDoNothing()
    .returning({ productCode: productVariant.productCode });

  const byProduct = new Map<string, number>();
  for (const v of insertedVariants) {
    byProduct.set(v.productCode, (byProduct.get(v.productCode) ?? 0) + 1);
  }
  for (const pt of PRODUCT_TYPES) {
    console.log(
      `[seed-products]   ${pt.code}:新增 ${byProduct.get(pt.code) ?? 0} 个 SKU`
    );
  }
  console.log(
    `[seed-products] SKU:写入 ${insertedVariants.length} / ${variantRows.length} 行(其余已存在,跳过)`
  );

  // ── 3. 自检:列出未上架 / 缺 SKU 的商品,避免上线后才发现漏 seed ────────
  const allVariants = await db.select().from(productVariant);
  const activeSkusByCode = new Map<string, number>();
  for (const v of allVariants) {
    if (!v.isActive) continue;
    activeSkusByCode.set(
      v.productCode,
      (activeSkusByCode.get(v.productCode) ?? 0) + 1
    );
  }
  const noSku = currentProducts
    .filter((p) => p.status === "active" && !activeSkusByCode.has(p.code))
    .map((p) => p.code);
  if (noSku.length > 0) {
    console.warn(
      `[seed-products] ⚠️ 以下上架商品没有可用 SKU,小程序将退回旧的拼价逻辑: ${noSku.join(", ")}`
    );
  }

  console.log("[seed-products] 完成。");
}

process.exitCode = 0;
main()
  .then(() => {
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("[seed-products] 失败:", err);
    process.exit(1);
  });
