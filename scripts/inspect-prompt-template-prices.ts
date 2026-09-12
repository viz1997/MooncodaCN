#!/usr/bin/env -S npx tsx

/**
 * 2026-09-12：诊断 prompt_template + product_effect 两张表的 price 列
 *
 * 起源：用户报「下单扣 125 积分」问来源。从代码看 submit-image-gen-demo.ts:
 *   const price = template.price ?? 0;  // promptTemplate.price
 *   consumeCredits({ amount: price }); // amount 是积分单位
 *
 * 所以 prompt_template.price 列存的数字 = 实际扣减积分数。
 * 注释里说「单位元」「单位分」都对不上号，列就是积分。
 *
 * 用法：
 *   pnpm tsx scripts/inspect-prompt-template-prices.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[inspect] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const tmpls = await client.query<{
      id: string;
      name: string;
      price: number;
      is_active: boolean;
      product_type_code: string | null;
    }>(
      `SELECT id, name, price, is_active, product_type_code
       FROM prompt_template
       ORDER BY price DESC, id`
    );

  console.log(`\n[inspect] prompt_template 共 ${tmpls.rows.length} 行：\n`);
  console.table(tmpls.rows);

  const effects = await client.query<{
      id: string;
      name: string;
      price: number;
      status: string;
      prompt_template_id: string | null;
    }>(
      `SELECT id, name, price, status, prompt_template_id
       FROM product_effect
       ORDER BY price DESC, id`
    );

  console.log(`\n[inspect] product_effect 共 ${effects.rows.length} 行：\n`);
  console.table(effects.rows);

  await client.end();
}

main().catch((err) => {
  console.error("[inspect] 未处理错误：", err);
  process.exit(1);
});