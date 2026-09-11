/**
 * 提示词模板种子脚本（2026-09-11 改 upsert）
 *
 * 历史：
 * - 2026-09-10 初版：先 db.delete(inArray) 再 insert。破坏性 — 用户在 admin
 *   UI 改过的 promptTemplate.prompt 会被覆盖回 seed 占位。
 * - 2026-09-11 改 upsert：保留 DB 中已有行，只更新 seed 里有的字段（id 命中
 *   走 onConflictDoUpdate；id 不命中走 insert）。
 *
 * ⚠️ 注意：upsert 仍会用 seed 文件里的 prompt 覆盖你 admin UI 改过的同名
 * 模板。改 prompt 推荐路径：直接 admin UI 改 promptTemplate 行，**不要**
 * 跑这个脚本（跑一次就回到 seed 值）。
 *
 * 执行顺序：seed-product-lines → seed-prompt-templates → seed-product-effects
 *
 * 运行方式：
 *   pnpm tsx src/scripts/seed-prompt-templates.ts
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { db } from "@/db";
import { promptTemplate } from "@/db/schema";
import { SEED_PRODUCT_EFFECTS } from "@/features/image-gen/lib/seed-effects";

/**
 * 从 SEED_PRODUCT_EFFECTS 派生 6 条 promptTemplate 行：
 * - id = effect.promptTemplateId（必须非空，类型 ProductEffect 允许 null，此处断言）
 * - prompt = effect.prompt
 * - variables = effect.variables
 * - productTypeCode = effect.productTypeCode
 */
function derivePromptTemplatesFromEffects() {
  return SEED_PRODUCT_EFFECTS.flatMap((effect) => {
    if (!effect.promptTemplateId) {
      console.warn(`↷ ${effect.maskId}: 无 promptTemplateId，跳过`);
      return [];
    }
    return [
      {
        id: effect.promptTemplateId,
        name: `${effect.name} · 模板`,
        description: effect.description,
        prompt: effect.prompt,
        variables: effect.variables,
        model: effect.model,
        price: effect.price,
        productTypeCode: effect.productTypeCode ?? null,
      },
    ];
  });
}

async function main() {
  const rows = derivePromptTemplatesFromEffects();

  console.log(`准备 upsert ${rows.length} 条 promptTemplate 行...`);
  for (const row of rows) {
    try {
      await db
        .insert(promptTemplate)
        .values({
          id: row.id,
          name: row.name,
          description: row.description,
          prompt: row.prompt,
          variables: row.variables,
          model: row.model,
          price: row.price,
          productTypeCode: row.productTypeCode,
          // 其它字段走 schema 默认值
          size: "1024x1024",
          candidateCount: 4,
          isActive: true,
          outputMode: "grid",
        })
        .onConflictDoUpdate({
          target: promptTemplate.id,
          set: {
            name: row.name,
            description: row.description,
            prompt: row.prompt,
            variables: row.variables,
            model: row.model,
            price: row.price,
            productTypeCode: row.productTypeCode,
            updatedAt: new Date(),
          },
        });
      console.log(`✓ ${row.id}: ${row.name}`);
    } catch (error) {
      console.error(`✗ ${row.id}:`, error);
      throw error;
    }
  }

  console.log(
    `\n完成：upsert ${rows.length} 条 promptTemplate（保留 id 不变）。`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("种子脚本失败:", error);
  process.exit(1);
});
