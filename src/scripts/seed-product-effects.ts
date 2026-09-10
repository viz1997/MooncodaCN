/**
 * 产品效果种子脚本（2026-09-10 重写）
 *
 * 重写逻辑：
 * - 清空 product_effect 表（删旧 10 条 MASK_xxx 数据）
 * - 重灌 SEED_PRODUCT_EFFECTS（6 条 MASK_LB_xxx 业务化数据）
 *
 * 执行顺序：seed-product-lines → seed-prompt-templates → seed-product-effects
 *   （effect 引用 productLine + promptTemplate 行，应用层校验）
 *
 * 运行方式：
 *   pnpm tsx src/scripts/seed-product-effects.ts
 */

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { productEffect } from "@/db/schema";
import { createEffectInDb } from "@/features/image-gen/lib/db-effects";
import { SEED_PRODUCT_EFFECTS } from "@/features/image-gen/lib/seed-effects";

async function main() {
  console.log(
    `清空 product_effect 表，准备重灌 ${SEED_PRODUCT_EFFECTS.length} 个新效果...`
  );
  await db.delete(productEffect);
  // 同步重置序列（如有 SERIAL，本项目 product_effect.id 是 text，无序列）
  await sql`SELECT 1`;

  let created = 0;
  for (const effect of SEED_PRODUCT_EFFECTS) {
    try {
      await createEffectInDb(effect);
      console.log(`✓ ${effect.maskId}: ${effect.name}`);
      created++;
    } catch (error) {
      console.error(`✗ ${effect.maskId}:`, error);
      throw error;
    }
  }

  console.log(`\n完成：重灌 ${created} 个产品效果。`);
  process.exit(0);
}

main().catch((error) => {
  console.error("种子脚本失败:", error);
  process.exit(1);
});
