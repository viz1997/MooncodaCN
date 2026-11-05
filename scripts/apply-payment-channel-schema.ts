#!/usr/bin/env -S npx tsx

/**
 * 应用「多支付通道」schema(2026-11-05)
 *
 * 微信 / 支付宝 / Shopify 三个新通道要用的列:
 *
 * | 表 | 列 | 干什么 |
 * |---|---|---|
 * | `storefront_order` | `payment_channel` | 这单走的是哪个通道(`wechat` / `alipay` / `shopify` / `stripe` / `offline`) |
 * | `storefront_order` | `provider_order_id` | 支付平台侧的单号(回调反查用) |
 * | `storefront_order` | `payment_qr_code_url` | 微信扫码的 `code_url` |
 * | `print_order` | `provider_order_id` | 同上 |
 * | `print_order` | `payment_qr_code_url` | 同上 |
 *
 * `print_order.payment_channel` 早就有(旧路用),不用加。
 *
 * ## 为什么 `payment_channel` 是 text 不是 PG enum
 *
 * Drizzle 的 `text({ enum: [...] })` 是**编译期**的类型约束,落到 PG 上就是
 * 一个普通 text 列。所以加值不用改列类型 —— 加一个 `wechat` 只是多一个字符串。
 * (真要用 PG enum,加值要 `ALTER TYPE ... ADD VALUE`,而且不能回滚。)
 *
 * ## 为什么不走 `db:generate`
 *
 * 这个仓库的迁移都是手写幂等脚本(`ADD COLUMN IF NOT EXISTS` + `CREATE
 * INDEX IF NOT EXISTS`),跑几遍都安全。`db:generate` 生成的迁移会顺着整张
 * schema 的历史走一遍,跟库里已有状态对不上时要人工调。
 *
 * 用法:
 *   pnpm tsx scripts/apply-payment-channel-schema.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-payment-channel] 缺少 DATABASE_URL");
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
      label: "ALTER TABLE storefront_order ADD COLUMN payment_channel",
      query: `ALTER TABLE "storefront_order"
        ADD COLUMN IF NOT EXISTS "payment_channel" text;`,
    },
    {
      label: "ALTER TABLE storefront_order ADD COLUMN provider_order_id",
      query: `ALTER TABLE "storefront_order"
        ADD COLUMN IF NOT EXISTS "provider_order_id" text;`,
    },
    {
      label: "ALTER TABLE storefront_order ADD COLUMN payment_qr_code_url",
      query: `ALTER TABLE "storefront_order"
        ADD COLUMN IF NOT EXISTS "payment_qr_code_url" text;`,
    },
    {
      label: "CREATE INDEX storefront_order_provider_order_id_idx",
      query: `CREATE INDEX IF NOT EXISTS "storefront_order_provider_order_id_idx"
        ON "storefront_order" ("provider_order_id");`,
    },
    {
      label: "ALTER TABLE print_order ADD COLUMN provider_order_id",
      query: `ALTER TABLE "print_order"
        ADD COLUMN IF NOT EXISTS "provider_order_id" text;`,
    },
    {
      label: "ALTER TABLE print_order ADD COLUMN payment_qr_code_url",
      query: `ALTER TABLE "print_order"
        ADD COLUMN IF NOT EXISTS "payment_qr_code_url" text;`,
    },
    {
      label: "CREATE INDEX print_order_provider_order_id_idx",
      query: `CREATE INDEX IF NOT EXISTS "print_order_provider_order_id_idx"
        ON "print_order" ("provider_order_id");`,
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
    store_channel: string | null;
    store_provider: string | null;
    store_qr: string | null;
    print_provider: string | null;
    print_qr: string | null;
    store_index: string | null;
    print_index: string | null;
  }>(
    `SELECT
       (SELECT column_name FROM information_schema.columns
         WHERE table_name = 'storefront_order' AND column_name = 'payment_channel')
         AS store_channel,
       (SELECT column_name FROM information_schema.columns
         WHERE table_name = 'storefront_order' AND column_name = 'provider_order_id')
         AS store_provider,
       (SELECT column_name FROM information_schema.columns
         WHERE table_name = 'storefront_order' AND column_name = 'payment_qr_code_url')
         AS store_qr,
       (SELECT column_name FROM information_schema.columns
         WHERE table_name = 'print_order' AND column_name = 'provider_order_id')
         AS print_provider,
       (SELECT column_name FROM information_schema.columns
         WHERE table_name = 'print_order' AND column_name = 'payment_qr_code_url')
         AS print_qr,
       (SELECT indexname FROM pg_indexes
         WHERE tablename = 'storefront_order' AND indexname = 'storefront_order_provider_order_id_idx')
         AS store_index,
       (SELECT indexname FROM pg_indexes
         WHERE tablename = 'print_order' AND indexname = 'print_order_provider_order_id_idx')
         AS print_index;`
  );

  const row = check.rows[0];
  console.log(
    `[apply-payment-channel] storefront_order: channel=${row?.store_channel ?? "(缺)"} ` +
      `provider=${row?.store_provider ?? "(缺)"} qr=${row?.store_qr ?? "(缺)"} ` +
      `索引=${row?.store_index ?? "(缺)"}`
  );
  console.log(
    `[apply-payment-channel] print_order: provider=${row?.print_provider ?? "(缺)"} ` +
      `qr=${row?.print_qr ?? "(缺)"} 索引=${row?.print_index ?? "(缺)"}`
  );

  await client.end();
  console.log("\n[apply-payment-channel] 完成");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
