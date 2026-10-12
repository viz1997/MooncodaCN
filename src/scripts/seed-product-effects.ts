/**
 * 产品效果种子脚本（2026-09-11 改 upsert）
 *
 * 历史：
 * - 2026-09-10 初版：先 db.delete(productEffect) 再 insert。破坏性 — 用户
 *   在 admin UI（/admin/product-effects）改过的 prompt / 描述等业务字段会
 *   被覆盖回 seed 占位文案。
 * - 2026-09-11 改 upsert：保留 DB 中已有行，只更新 seed 里有的字段（id 命中
 *   走 onConflictDoUpdate 全字段覆盖；id 不命中走 insert）。
 *
 * ⚠️ 注意：upsert 仍会用 seed 文件里的 prompt / description 覆盖你 admin UI
 * 改过的同名 mask。如果你已经改了某条 mask 的 prompt 又想保留它，**先**
 * 备份：`psql -c "UPDATE product_effect SET prompt='...' WHERE id='...'"`
 * 再跑 seed；或者跳过这条 mask（脚本不会触碰没在 SEED_PRODUCT_EFFECTS 里的行）。
 *
 * 执行顺序：seed-product-lines → seed-prompt-template → seed-product-effects
 *
 * 运行方式：
 *   pnpm tsx src/scripts/seed-product-effects.ts
 */

import { config } from "dotenv";

config({ path: ".env.local" });

import { db, type ProductEffectRow } from "@/db";
import { productEffect } from "@/db/schema";
import { SEED_PRODUCT_EFFECTS } from "@/features/image-gen/lib/seed-effects";

async function main() {
  let upserted = 0;
  for (const effect of SEED_PRODUCT_EFFECTS) {
    try {
      // 2026-09-11：upsert 全字段 —— 同 id 命中则覆盖（用 seed 最新值），
      // 不命中则插入。保留 id 不变（避免破坏 prompt_order.templateId 引用）。
      await db
        .insert(productEffect)
        .values({
          id: effect.maskId,
          name: effect.name,
          category: effect.category,
          description: effect.description,
          previewUrl: effect.previewUrl,
          prompt: effect.prompt,
          variables: effect.variables,
          model: effect.model,
          config: effect.config as ProductEffectRow["config"],
          scene: effect.scene,
          versions: effect.versions,
          price: effect.price,
          status: effect.status,
          usageCount: effect.usageCount,
          successRate: effect.successRate,
          avgDuration: effect.avgDuration,
          author: effect.author,
          productLineIds: effect.productLineIds,
          productTypeCode: effect.productTypeCode ?? null,
          allowedSizes: effect.allowedSizes
            ? JSON.stringify(effect.allowedSizes)
            : null,
          allowedAccessories: effect.allowedAccessories
            ? JSON.stringify(effect.allowedAccessories)
            : null,
          allowedCapabilities: effect.allowedCapabilities
            ? JSON.stringify(effect.allowedCapabilities)
            : null,
          allowedColors: effect.allowedColors
            ? JSON.stringify(effect.allowedColors)
            : null,
          promptTemplateId: effect.promptTemplateId ?? null,
        })
        .onConflictDoUpdate({
          target: productEffect.id,
          set: {
            name: effect.name,
            category: effect.category,
            description: effect.description,
            previewUrl: effect.previewUrl,
            prompt: effect.prompt,
            variables: effect.variables,
            model: effect.model,
            config: effect.config as ProductEffectRow["config"],
            scene: effect.scene,
            versions: effect.versions,
            price: effect.price,
            status: effect.status,
            productLineIds: effect.productLineIds,
            productTypeCode: effect.productTypeCode ?? null,
            allowedSizes: effect.allowedSizes
              ? JSON.stringify(effect.allowedSizes)
              : null,
            allowedAccessories: effect.allowedAccessories
              ? JSON.stringify(effect.allowedAccessories)
              : null,
            allowedCapabilities: effect.allowedCapabilities
              ? JSON.stringify(effect.allowedCapabilities)
              : null,
            allowedColors: effect.allowedColors
              ? JSON.stringify(effect.allowedColors)
              : null,
            promptTemplateId: effect.promptTemplateId ?? null,
            updatedAt: new Date(),
          },
        });
      console.log(`✓ ${effect.maskId}: ${effect.name}`);
      upserted++;
    } catch (error) {
      console.error(`✗ ${effect.maskId}:`, error);
      throw error;
    }
  }

  console.log(`\n完成：upsert ${upserted} 个产品效果（保留 id 不变）。`);
  process.exit(0);
}

main().catch((error) => {
  console.error("种子脚本失败:", error);
  process.exit(1);
});
