#!/usr/bin/env -S npx tsx
/**
 * 2026-09-14：批量给指定 productEffect 写规格子集。
 *
 * 用户原话：
 * - 头部浮雕冰箱贴：sizes 4/5/6cm，默认配件磁铁（背面挖磁铁槽）
 * - 头部浮雕支架：  sizes 仅 4cm， 默认配件支架
 *
 * 工作原理：
 * - productEffect.allowedSizes / allowedAccessories 是 JSON 字符串列。
 *   填入后 /image-gen demo / /p/[token] 走 fillDefaultsByTemplate 时会
 *   自动把字典默认替换成这里的子集 —— first element 即为默认值。
 *
 * 匹配策略：按 productLine.name 模糊匹配「头部浮雕」+ productTypeCode，
 * 不命中则 dry-run 列出供你调整。要换匹配规则直接改 EFFECT_RULES。
 *
 * 执行：
 *   pnpm tsx --env-file=.env.local scripts/set-product-effect-specs.ts
 *   pnpm tsx --env-file=.env.local scripts/set-product-effect-specs.ts --apply
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));

import { Client } from "pg";

interface Rule {
  /** productLine.name LIKE 匹配（大小写不敏感） */
  productLinePattern: string;
  productTypeCode: string;
  allowedSizes: string[];
  allowedAccessories: string[];
  description: string;
}

const EFFECT_RULES: Rule[] = [
  {
    // 2026-09-14：DB 里现存的「浮雕冰箱贴」产品线（不是「头部浮雕冰箱贴」——
    // 用户原话用「头部浮雕」是泛指头部区域浮雕，实际产品线名更窄）。
    productLinePattern: "%浮雕%",
    productTypeCode: "P", // 冰箱贴
    allowedSizes: ["4", "5", "6"],
    allowedAccessories: ["magnet"],
    description: "浮雕冰箱贴 — 4/5/6cm，默认磁铁",
  },
  {
    // 「宠物头部半面浮雕」产品线下的 type=A 钥匙扣即「头部浮雕支架」。
    productLinePattern: "%浮雕%",
    productTypeCode: "A", // 异性钥匙扣（自带 bracket 配件）
    allowedSizes: ["4"],
    allowedAccessories: ["bracket"],
    description: "头部浮雕支架 — 仅 4cm，默认支架",
  },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const matched: Array<{
      id: string;
      name: string;
      line: string;
      rule: Rule;
    }> = [];
    for (const rule of EFFECT_RULES) {
      const r = await client.query(
        `SELECT e.id, e.name, l.name AS line_name
         FROM product_effect e
         CROSS JOIN LATERAL json_array_elements_text(
           COALESCE(e.product_line_ids, '[]'::json)
         ) AS pl_id(text)
         INNER JOIN product_line l ON l.product_line_id = pl_id.text
         WHERE e.product_type_code = $1
           AND l.name ILIKE $2
           AND e.status = 'active'`,
        [rule.productTypeCode, rule.productLinePattern]
      );
      for (const row of r.rows) {
        matched.push({ id: row.id, name: row.name, line: row.line_name, rule });
      }
    }

    if (matched.length === 0) {
      console.log("⚠️  没匹配到任何 productEffect。请检查：");
      console.log("   1) productLine.name 是否包含「头部浮雕」");
      console.log("   2) productEffect.product_type_code 是不是 P / A");
      console.log(
        "   3) productEffect.product_line_ids 是否包含该 productLine.id"
      );
      console.log("\n=== 当前所有 active productEffect + 所属产品线 ===");
      const all = await client.query(
        `SELECT e.id, e.name, e.product_type_code, l.name AS line_name
         FROM product_effect e
         LEFT JOIN LATERAL (
           SELECT name FROM product_line
           WHERE product_line_id = ANY(
             SELECT json_array_elements_text(COALESCE(e.product_line_ids, '[]'::json))
           )
           LIMIT 1
         ) l ON TRUE
         WHERE e.status = 'active'
         ORDER BY e.name`
      );
      for (const row of all.rows) {
        console.log(
          `  ${row.id} · ${row.name} · type=${row.product_type_code ?? "—"} · line=${row.line_name ?? "—"}`
        );
      }
      return;
    }

    console.log(`=== 匹配到 ${matched.length} 个 productEffect ===`);
    for (const m of matched) {
      const before = await client.query(
        `SELECT allowed_sizes, allowed_accessories FROM product_effect WHERE id=$1`,
        [m.id]
      );
      const beforeSizes = before.rows[0]?.allowed_sizes;
      const beforeAcc = before.rows[0]?.allowed_accessories;
      console.log(
        `\n[${m.id}] ${m.name} (line=${m.line}) — ${m.rule.description}`
      );
      console.log(
        `  before: allowedSizes=${beforeSizes ?? "(null)"}, allowedAccessories=${beforeAcc ?? "(null)"}`
      );
      console.log(
        `  after:  allowedSizes=${JSON.stringify(m.rule.allowedSizes)}, allowedAccessories=${JSON.stringify(m.rule.allowedAccessories)}`
      );

      if (apply) {
        await client.query(
          `UPDATE product_effect
           SET allowed_sizes = $1::jsonb,
               allowed_accessories = $2::jsonb,
               updated_at = NOW()
           WHERE id = $3`,
          [
            JSON.stringify(m.rule.allowedSizes),
            JSON.stringify(m.rule.allowedAccessories),
            m.id,
          ]
        );
        console.log(`  ✓ updated`);
      }
    }

    if (!apply) {
      console.log("\n--- DRY RUN。加 --apply 真正写库 ---");
    } else {
      console.log("\n=== 写库完成 ===");
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
