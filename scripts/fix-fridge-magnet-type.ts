#!/usr/bin/env -S npx tsx
/**
 * 2026-09-14：补 MASK_LB_FRIDGE_MAGNET 与 tpl_fridge_magnet_v1 的 productTypeCode = 'P'。
 *
 * 背景：2026-09-10 sync-from-promptTemplate 时这两行 product_type_code 漏传，
 * 导致 /image-gen demo / /p/[token] 走 fillDefaultsByTemplate 拿到的是字典
 * R 钥匙扣兜底（PRODUCT_TYPES[null] 退到字典头一个），sizes/accessories 全错。
 *
 * 跑完这个脚本后再跑 scripts/set-product-effect-specs.ts --apply，
 * 冰箱贴行才会命中「浮雕冰箱贴 — 4/5/6cm，默认磁铁」规则。
 *
 *   pnpm tsx --env-file=.env.local scripts/fix-fridge-magnet-type.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));

import { Client } from "pg";

async function main() {
  const apply = process.argv.includes("--apply");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const tpl = await client.query(
      `SELECT id, name, product_type_code FROM prompt_template WHERE id = 'tpl_fridge_magnet_v1'`
    );
    const effect = await client.query(
      `SELECT id, name, product_type_code FROM product_effect WHERE id = 'MASK_LB_FRIDGE_MAGNET'`
    );
    console.log("=== BEFORE ===");
    console.log("tpl_fridge_magnet_v1:", tpl.rows[0]);
    console.log("MASK_LB_FRIDGE_MAGNET:", effect.rows[0]);

    if (!apply) {
      console.log("\n--- DRY RUN。加 --apply 真正写库 ---");
      return;
    }

    await client.query("BEGIN");
    try {
      await client.query(
        `UPDATE prompt_template SET product_type_code = 'P', updated_at = NOW() WHERE id = 'tpl_fridge_magnet_v1'`
      );
      await client.query(
        `UPDATE product_effect SET product_type_code = 'P', updated_at = NOW() WHERE id = 'MASK_LB_FRIDGE_MAGNET'`
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }

    const afterTpl = await client.query(
      `SELECT id, name, product_type_code FROM prompt_template WHERE id = 'tpl_fridge_magnet_v1'`
    );
    const afterEffect = await client.query(
      `SELECT id, name, product_type_code FROM product_effect WHERE id = 'MASK_LB_FRIDGE_MAGNET'`
    );
    console.log("\n=== AFTER ===");
    console.log("tpl_fridge_magnet_v1:", afterTpl.rows[0]);
    console.log("MASK_LB_FRIDGE_MAGNET:", afterEffect.rows[0]);
    console.log("\n✓ 两行 product_type_code 都补成 'P'");
    console.log(
      "\n下一步：pnpm tsx --env-file=.env.local scripts/set-product-effect-specs.ts --apply"
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
