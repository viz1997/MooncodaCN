/**
 * 2026-09-12：一键 sync —— 把 product_effect 里 prompt_template_id IS NULL
 *            的行同步进 prompt_template，再让 product_effect.prompt_template_id 指向自己。
 *
 * 为什么：
 *   submit-image-gen-demo.ts:111 直接用 productEffect.id（maskId）查 prompt_template 表。
 *   admin 手工录入的 productEffect 行（promptTemplateId=null）在 prompt_template 表里
 *   没有对应 id → server action 撞「模板不存在或已停用」。
 *
 *   修法：把 productEffect 行 INSERT 到 prompt_template（id 保持一致），让两端 id 对齐；
 *   再把 product_effect.prompt_template_id 设成自己 = 应用层引用关系闭环。
 *
 *   配合 [[prompt-template-id-required-on-product-effect]] 的 admin form 强制必填改动，
 *   后续新录入不会再有这个问题，本脚本只处理存量。
 *
 * 用法：
 *   pnpm tsx scripts/sync-product-effect-to-prompt-template.ts --dry-run   # 预览
 *   pnpm tsx scripts/sync-product-effect-to-prompt-template.ts             # 实际跑
 *
 * 回滚 SQL（脚本结尾打印）：
 *   DELETE FROM prompt_template WHERE id IN (
 *     SELECT id FROM product_effect WHERE prompt_template_id = id
 *   );
 *   UPDATE product_effect SET prompt_template_id = NULL WHERE prompt_template_id = id;
 */

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

// 与 scripts/list-effects-without-template.ts 一致：先 .env.local 再 .env
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 未设置 —— 检查 .env.local");
}

const isRemote =
  process.env.DATABASE_URL.includes("neon.tech") ||
  process.env.DATABASE_URL.includes("supabase");
const finalUrl = process.env.DATABASE_URL
  .replace(/[?&]sslmode=[^&]*/g, "")
  .replace(/[?&]ssl=[^&]*/g, "")
  .replace(/[?&]uselibpqcompat=[^&]*/g, "");

const isDryRun = process.argv.includes("--dry-run");

// ============================================
// SQL：INSERT product_effect → prompt_template
// ============================================
const INSERT_SQL = `
INSERT INTO prompt_template (
  id,
  name,
  description,
  prompt,
  variables,
  model,
  price,
  size,
  candidate_count,
  cover_url,
  is_active,
  output_mode,
  product_type_code,
  allowed_sizes,
  allowed_accessories
)
SELECT
  pe.id,
  pe.name,
  COALESCE(pe.description, ''),
  pe.prompt,
  COALESCE(pe.variables, '[]'::jsonb),
  COALESCE(pe.model, 'qwen'),
  COALESCE(pe.price, 0),
  '1024x1024',
  1,
  pe.preview_url,
  TRUE,
  'grid',
  pe.product_type_code,
  pe.allowed_sizes,
  pe.allowed_accessories
FROM product_effect pe
WHERE (pe.prompt_template_id IS NULL OR pe.prompt_template_id = '')
  AND pe.status = 'active'
ON CONFLICT (id) DO NOTHING
RETURNING id, name
`;

// ============================================
// SQL：UPDATE product_effect.prompt_template_id = id
// ============================================
const UPDATE_SQL = `
UPDATE product_effect
SET prompt_template_id = id
WHERE (prompt_template_id IS NULL OR prompt_template_id = '')
  AND status = 'active'
RETURNING id, name
`;

async function main() {
  const client = new Client({
    connectionString: finalUrl,
    ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();

  try {
    // 1) 看现状
    const before = await client.query<{
      id: string;
      name: string;
      status: string;
      product_type_code: string | null;
    }>(
      `SELECT id, name, status, product_type_code
       FROM product_effect
       WHERE prompt_template_id IS NULL OR prompt_template_id = ''
       ORDER BY created_at`
    );

    console.log(`\n=== 待 sync 行（prompt_template_id IS NULL） ===`);
    if (before.rows.length === 0) {
      console.log("✅ 没有待 sync 的行，存量已全部绑好");
      return;
    }
    console.table(
      before.rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        productType: r.product_type_code ?? "(空)",
      }))
    );

    if (isDryRun) {
      console.log(`\n[--dry-run] 将要 INSERT ${before.rows.length} 行到 prompt_template`);
      console.log(`[--dry-run] 将要 UPDATE ${before.rows.length} 行 product_effect.prompt_template_id`);
      console.log("\n去掉 --dry-run 实际跑：");
      console.log("  pnpm tsx scripts/sync-product-effect-to-prompt-template.ts");
      return;
    }

    // 2) 实际执行（包事务：任一步失败就全 ROLLBACK）
    console.log("\n=== 开始 sync ===");
    await client.query("BEGIN");
    try {
      const inserted = await client.query<{ id: string; name: string }>(
        INSERT_SQL
      );
      console.log(`INSERT prompt_template: ${inserted.rows.length} 行`);
      if (inserted.rows.length > 0) {
        console.table(inserted.rows);
      }

      const updated = await client.query<{ id: string; name: string }>(
        UPDATE_SQL
      );
      console.log(`UPDATE product_effect.prompt_template_id: ${updated.rows.length} 行`);
      if (updated.rows.length > 0) {
        console.table(updated.rows);
      }

      await client.query("COMMIT");
      console.log("\n✅ COMMIT 成功");

      // 3) 验证
      const after = await client.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM product_effect
         WHERE prompt_template_id IS NULL OR prompt_template_id = ''`
      );
      console.log(`\n验证：未绑行剩余 ${after.rows[0]?.cnt ?? "?"} 行（期望 0）`);

      // 4) 提示回滚 SQL
      console.log("\n=== 回滚 SQL（如果效果不对，跑这段） ===");
      console.log(`DELETE FROM prompt_template`);
      console.log(`  WHERE id IN (`);
      console.log(`    SELECT id FROM product_effect WHERE prompt_template_id = id`);
      console.log(`  );`);
      console.log(`UPDATE product_effect SET prompt_template_id = NULL WHERE prompt_template_id = id;`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("\n❌ ROLLBACK：sync 失败", err);
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[sync] 失败：", e);
  process.exit(1);
});