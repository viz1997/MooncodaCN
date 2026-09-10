/**
 * 产品线种子脚本（2026-09-10 新建）
 *
 * 把 src/features/image-gen/lib/seed-lines.ts 中的 6 条产品线写入 product_line 表。
 * 沿用「清空 + 重灌」模式（与 seed-product-effects.ts 一致），
 * 替代 productEffect.product_line_ids JSON 列的应用层关联。
 *
 * 执行顺序：seed-product-lines → seed-prompt-templates → seed-product-effects
 *
 * 运行方式：
 *   pnpm tsx src/scripts/seed-product-lines.ts
 */

import { db } from "@/db";
import { productLine } from "@/db/schema";
import { createLineInDb } from "@/features/image-gen/lib/db-lines";
import { SEED_PRODUCT_LINES } from "@/features/image-gen/lib/seed-lines";

async function main() {
  console.log(
    `清空 product_line 表，准备重灌 ${SEED_PRODUCT_LINES.length} 个新产品线...`
  );
  await db.delete(productLine);

  let created = 0;
  for (const line of SEED_PRODUCT_LINES) {
    try {
      await createLineInDb(line);
      console.log(`✓ ${line.productLineId}: ${line.name}`);
      created++;
    } catch (error) {
      console.error(`✗ ${line.productLineId}:`, error);
      throw error;
    }
  }

  console.log(`\n完成：重灌 ${created} 个产品线。`);
  process.exit(0);
}

main().catch((error) => {
  console.error("种子脚本失败:", error);
  process.exit(1);
});
