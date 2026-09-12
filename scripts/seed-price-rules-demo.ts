#!/usr/bin/env -S npx tsx

/**
 * 2026-09-12：seed 一行 prompt_template_price 验证 dev DB schema + inspect 脚本。
 *
 * 选 basePrice=129 的 LB 皮革徽章模板（典型 ToC 价格档位），加 4 条规则：
 *   size:6               +30  (6cm 比 4cm 加 30)
 *   accessory:leather    +20
 *   leather_color:black  +15  (黑色定制色)
 *   protection:pvc       +10
 *
 * 总扣预览：129 + 30 + 20 + 15 + 10 = 204 积分。
 *
 * 用法：
 *   pnpm tsx scripts/seed-price-rules-demo.ts
 *
 * 幂等：先删这 4 个 specKey 再插（不删其他规则）。
 * 仅 dev 用，prod 别跑。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";
import { customAlphabet } from "nanoid";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  21
);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[seed] 缺少 DATABASE_URL");
    process.exit(1);
  }

  // 用 pg 客户端避免 import src/db/index.ts（其顶层读 DATABASE_URL
  // 与 ESM import hoist 时机冲突）。
  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 找 basePrice=129 的 LB 模板
  const tmplRes = await client.query<{
    id: string;
    name: string;
    price: number;
  }>(
    `SELECT id, name, price FROM prompt_template
     WHERE "product_type_code" = 'LB' AND price = 129
     LIMIT 1`
  );
  const tmpl = tmplRes.rows[0];
  if (!tmpl) {
    console.error("[seed] 没找到 basePrice=129 的 LB 模板，跳过");
    await client.end();
    process.exit(0);
  }
  console.log(
    `[seed] 目标模板：${tmpl.id} (${tmpl.name}, basePrice=${tmpl.price})`
  );

  const seedRules: Array<{ specKey: string; priceDelta: number; label: string }> =
    [
      { specKey: "size:6", priceDelta: 30, label: "6cm +30" },
      { specKey: "accessory:leather", priceDelta: 20, label: "皮套 +20" },
      { specKey: "leather_color:black", priceDelta: 15, label: "黑色 +15" },
      { specKey: "protection:pvc", priceDelta: 10, label: "PVC 保护 +10" },
    ];

  // 幂等：先删这 4 个 specKey
  for (const r of seedRules) {
    await client.query(
      `DELETE FROM prompt_template_price
       WHERE template_id = $1 AND spec_key = $2`,
      [tmpl.id, r.specKey]
    );
  }

  // 插新
  for (const r of seedRules) {
    await client.query(
      `INSERT INTO prompt_template_price
         (id, template_id, spec_key, price_delta, label, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())`,
      [nanoid(), tmpl.id, r.specKey, r.priceDelta, r.label]
    );
  }

  console.log(`[seed] 已写入 ${seedRules.length} 条规则到 ${tmpl.id}`);
  console.log(
    "[seed] 验证总扣：basePrice 129 + 6cm 30 + 皮套 20 + 黑色 15 + PVC 10 = 204 积分"
  );

  // 反向查一下
  const verify = await client.query<{
    spec_key: string;
    price_delta: number;
    label: string;
  }>(
    `SELECT spec_key, price_delta, label FROM prompt_template_price
     WHERE template_id = $1 ORDER BY spec_key`,
    [tmpl.id]
  );
  console.log(`[seed] DB 校验：模板 ${tmpl.name} 共 ${verify.rows.length} 条规则`);
  for (const r of verify.rows) {
    console.log(`  - ${r.spec_key} = ${r.price_delta} (${r.label})`);
  }

  // 顺便确认 productEffect 的价格（演示用旧字段，与新 promptTemplatePrice 独立）
  const effect = await client.query<{
    id: string;
    name: string;
    price: number;
  }>(
    `SELECT id, name, price FROM product_effect
     WHERE prompt_template_id = $1 LIMIT 1`,
    [tmpl.id]
  );
  const e = effect.rows[0];
  if (e) {
    console.log(
      `[seed] productEffect ${e.id} (${e.name}) price=${e.price}（演示用旧字段，与新 promptTemplatePrice 独立）`
    );
  }

  await client.end();
}

main().catch((err) => {
  console.error("[seed] 失败：", err);
  process.exit(1);
});