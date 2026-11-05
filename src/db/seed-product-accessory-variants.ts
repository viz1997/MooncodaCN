/**
 * Seed:product_accessory_variant 表 —— 2026-10-18 v1.6.0
 *
 * 跑法:
 *   pnpm db:push                        # 先把表推到 DB
 *   pnpm tsx src/db/seed-product-accessory-variants.ts
 *
 * 幂等:ON CONFLICT (product_type_code, accessory_code, variant_code) DO NOTHING。
 *
 * 数据来源:`@/features/gpt-image/lib/product-accessory-variants` 的
 * PRODUCT_ACCESSORY_VARIANTS(19 行)。
 *
 * 2026-11-02:数据本体从本脚本抽到 product-accessory-variants.ts —— storefront
 * 定制工作台的配件选择器也要用同一份带加价的变体列表,两边共用一份才不会漂。
 * 本脚本只负责写 DB,行为不变。
 */

// ⚠️ 必须排 import 列表**第一个** —— `src/db/index.ts` 在模块顶层就查
// `DATABASE_URL`,拿不到直接抛错。静态 import 比模块体先跑,所以 .env 得
// 先加载,再让 `@/db` 被求值。顺序反了照样炸(见 scripts/lib/load-env.ts)。
import "../../scripts/lib/load-env";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { productAccessoryVariant } from "@/db/schema";
import { PRODUCT_ACCESSORY_VARIANTS } from "@/features/gpt-image/lib/product-accessory-variants";

async function main(): Promise<void> {
  console.log(
    `[seed-product-accessory-variants] 准备写入 ${PRODUCT_ACCESSORY_VARIANTS.length} 行变体数据...`
  );
  // 幂等写入:依赖 pav_uniq_idx UNIQUE (product_type_code, accessory_code, variant_code)
  const result = await db
    .insert(productAccessoryVariant)
    .values(
      PRODUCT_ACCESSORY_VARIANTS.map((s) => ({
        id: `pav_${s.productTypeCode}_${s.accessoryCode}_${s.variantCode}`,
        productTypeCode: s.productTypeCode,
        accessoryCode: s.accessoryCode,
        variantCode: s.variantCode,
        name: s.name,
        nameEn: s.nameEn,
        swatch: s.swatch,
        priceDeltaCents: s.priceDeltaCents,
        sortOrder: s.sortOrder,
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
