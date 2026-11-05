#!/usr/bin/env -S npx tsx

/**
 * 应用打印工单交期档位 schema(2026-11-05)
 *
 * - `print_order.delivery_tier` —— 交期档位(standard / express / urgent)
 * - `print_order.delivery_fee_cents` —— 交期加价(分)
 *
 * ## 加价为什么落成两列
 *
 * 加价是**按比例**算出来的(见
 * `src/features/print-quote/lib/delivery-tier.ts`),但落库要落**当时的绝对
 * 金额** —— 比例以后可能改(环境变量),工单上写的价不能跟着变。
 *
 * `delivery_tier` + `delivery_fee_cents` 两列一起存:
 * 前者告诉工作室「这单要 48 小时内出」,后者是「为此多收了多少钱」。
 * 只存金额的话,工作室看到 ¥20.65 不知道是多急;只存档位的话,账对不上。
 *
 * ## 为什么手写而不是 `db:generate`
 *
 * `db:generate` 生成的迁移文件会**顺着整张 schema 的历史**走一遍,跟库里
 * 已有状态对不上的时候要人工调。这个仓库的迁移都是手写幂等脚本
 * (`ADD COLUMN IF NOT EXISTS`),跑几遍都安全。
 *
 * 用法:
 *   pnpm tsx scripts/apply-print-order-delivery-tier-schema.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-print-order-delivery-tier] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const statements: Array<{ label: string; query: string }> = [
    {
      label: "ALTER TABLE print_order ADD COLUMN delivery_tier",
      query: `ALTER TABLE "print_order"
        ADD COLUMN IF NOT EXISTS "delivery_tier" text NOT NULL DEFAULT 'standard';`,
    },
    {
      label: "ALTER TABLE print_order ADD COLUMN delivery_fee_cents",
      query: `ALTER TABLE "print_order"
        ADD COLUMN IF NOT EXISTS "delivery_fee_cents" integer NOT NULL DEFAULT 0;`,
    },
  ];

  for (const { label, query } of statements) {
    try {
      await client.query(query);
      console.log(`✓ ${label}`);
    } catch (error) {
      console.error(`✗ ${label}`);
      console.error(error instanceof Error ? error.message : error);
      await client.end();
      process.exit(1);
    }
  }

  // 回读一次 —— 确认列真的在,而不是语句被静默跳过
  const check = await client.query<{
    delivery_tier: string;
    delivery_fee: number;
  }>(
    `SELECT
       (SELECT column_default FROM information_schema.columns
         WHERE table_name = 'print_order' AND column_name = 'delivery_tier')
         AS delivery_tier,
       (SELECT column_default FROM information_schema.columns
         WHERE table_name = 'print_order' AND column_name = 'delivery_fee_cents')
         AS delivery_fee;`
  );
  console.log(
    `[apply-print-order-delivery-tier] delivery_tier 默认值 = ${check.rows[0]?.delivery_tier}, ` +
      `delivery_fee_cents 默认值 = ${check.rows[0]?.delivery_fee}`
  );

  await client.end();
  console.log("\n[apply-print-order-delivery-tier] 完成");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
