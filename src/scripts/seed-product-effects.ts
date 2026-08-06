/**
 * 产品效果种子脚本
 *
 * 将 src/features/image-gen/lib/seed-effects.ts 中的数据写入 product_effect 表。
 * 幂等：已存在的 maskId 会跳过。
 *
 * 运行方式：
 *   pnpm tsx src/scripts/seed-product-effects.ts
 */

import { createEffectInDb } from "@/features/image-gen/lib/db-effects";
import { SEED_PRODUCT_EFFECTS } from "@/features/image-gen/lib/seed-effects";

async function main() {
  console.log(`开始写入 ${SEED_PRODUCT_EFFECTS.length} 个产品效果...`);

  let created = 0;
  let skipped = 0;

  for (const effect of SEED_PRODUCT_EFFECTS) {
    try {
      await createEffectInDb(effect);
      console.log(`✓ ${effect.maskId}: ${effect.name}`);
      created++;
    } catch (error) {
      // onConflictDoNothing 不会抛错，这里主要捕获其他异常
      if (error instanceof Error && error.message.includes("duplicate key")) {
        console.log(`↷ ${effect.maskId}: 已存在，跳过`);
        skipped++;
      } else {
        console.error(`✗ ${effect.maskId}:`, error);
        throw error;
      }
    }
  }

  console.log(`\n完成：新增 ${created} 个，跳过 ${skipped} 个。`);
  process.exit(0);
}

main().catch((error) => {
  console.error("种子脚本失败:", error);
  process.exit(1);
});
