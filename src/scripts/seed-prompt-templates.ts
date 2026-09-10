/**
 * 提示词模板种子脚本（2026-09-10 新建）
 *
 * 为 6 条新 SEED_PRODUCT_EFFECTS 各创建一条 promptTemplate 行，
 * 让 productEffect.promptTemplateId 引用合法（生成时取 promptTemplate.prompt 优先）。
 *
 * 执行顺序：seed-product-lines → seed-prompt-templates → seed-product-effects
 *
 * 运行方式：
 *   pnpm tsx src/scripts/seed-prompt-templates.ts
 *
 * 幂等：
 * - 脚本会先按 id 删除这些 tpl_xxx_v1 行（如果有老数据）
 * - 再插入新行（用固定 id 不用 nanoid，方便 productEffect.promptTemplateId 引用）
 */

import { inArray } from "drizzle-orm";

import { db } from "@/db";
import type { PromptVariable } from "@/db/image-gen-types";
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
  const rows: Array<{
    id: string;
    name: string;
    description: string;
    prompt: string;
    variables: PromptVariable[];
    model: string;
    price: number;
    productTypeCode: string | null;
  }> = [];

  for (const effect of SEED_PRODUCT_EFFECTS) {
    if (!effect.promptTemplateId) {
      console.warn(`↷ ${effect.maskId}: 无 promptTemplateId，跳过`);
      continue;
    }
    rows.push({
      id: effect.promptTemplateId,
      name: `${effect.name} · 模板`,
      description: effect.description,
      prompt: effect.prompt,
      variables: effect.variables,
      model: effect.model,
      price: effect.price,
      productTypeCode: effect.productTypeCode ?? null,
    });
  }

  return rows;
}

async function main() {
  const rows = derivePromptTemplatesFromEffects();
  const ids = rows.map((r) => r.id);

  console.log(`清空 ${ids.length} 条 promptTemplate 行（按 id）...`);
  if (ids.length > 0) {
    await db.delete(promptTemplate).where(inArray(promptTemplate.id, ids));
  }

  console.log(`准备插入 ${rows.length} 条 promptTemplate 行...`);
  for (const row of rows) {
    try {
      await db.insert(promptTemplate).values({
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
      });
      console.log(`✓ ${row.id}: ${row.name}`);
    } catch (error) {
      console.error(`✗ ${row.id}:`, error);
      throw error;
    }
  }

  console.log(`\n完成：写入 ${rows.length} 条 promptTemplate。`);
  process.exit(0);
}

main().catch((error) => {
  console.error("种子脚本失败:", error);
  process.exit(1);
});
