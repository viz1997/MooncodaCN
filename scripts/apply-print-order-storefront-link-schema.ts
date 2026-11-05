#!/usr/bin/env -S npx tsx

/**
 * 应用打印工单 ↔ 商城订单关联 schema(2026-11-05)
 *
 * - `print_order.storefront_order_id` —— 这张工单属于哪张商城订单
 * - `print_order_storefront_order_id_idx` —— 反查用
 *
 * ## 为什么不能复用 `sellbase_order_id`
 *
 * 整张购物车共用**一张** Sellbase 订单(收银台模式:一次结算一个支付链接),
 * 而 `print_order.sellbase_order_id` 是**唯一索引** —— 一张 Sellbase 订单
 * 只能挂一张工单。购物车里有两个打印服务行时,第二张工单就挂不上。
 *
 * 所以工单改挂 `storefront_order_id`:一张商城订单可以包含**多张**工单,
 * 一张工单也只属于一张商城订单。webhook 标 paid 的时候按这一列反查,把所有
 * 关联工单一起标上(见 `features/sellbase/lib/storefront-transition.ts` 的
 * `syncLinkedPrintOrders()`)。
 *
 * ## 为什么不走 `db:generate`
 *
 * 这个仓库的迁移都是手写幂等脚本(`ADD COLUMN IF NOT EXISTS` + `CREATE
 * INDEX IF NOT EXISTS`),跑几遍都安全。`db:generate` 生成的迁移会顺着整张
 * schema 的历史走一遍,跟库里已有状态对不上时要人工调。
 *
 * 用法:
 *   pnpm tsx scripts/apply-print-order-storefront-link-schema.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-print-order-storefront-link] 缺少 DATABASE_URL");
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
      label: "ALTER TABLE print_order ADD COLUMN storefront_order_id",
      query: `ALTER TABLE "print_order"
        ADD COLUMN IF NOT EXISTS "storefront_order_id" text;`,
    },
    {
      label: "CREATE INDEX print_order_storefront_order_id_idx",
      query: `CREATE INDEX IF NOT EXISTS "print_order_storefront_order_id_idx"
        ON "print_order" ("storefront_order_id");`,
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

  // 回读一次 —— 确认列和索引真的在,而不是语句被静默跳过
  const check = await client.query<{
    column: string | null;
    index: string | null;
  }>(
    `SELECT
       (SELECT column_name FROM information_schema.columns
         WHERE table_name = 'print_order' AND column_name = 'storefront_order_id')
         AS column,
       (SELECT indexname FROM pg_indexes
         WHERE tablename = 'print_order' AND indexname = 'print_order_storefront_order_id_idx')
         AS index;`
  );
  console.log(
    `[apply-print-order-storefront-link] 列 = ${check.rows[0]?.column ?? "(缺)"}, ` +
      `索引 = ${check.rows[0]?.index ?? "(缺)"}`
  );

  await client.end();
  console.log("\n[apply-print-order-storefront-link] 完成");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
