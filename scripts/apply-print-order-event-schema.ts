#!/usr/bin/env -S npx tsx

/**
 * 应用打印工单「事件表 + locale 列」schema（2026-11-02）
 *
 * - CREATE TYPE print_order_event_actor（user / admin / system）
 * - CREATE TABLE print_order_event（工单时间线,只追加）
 * - ADD COLUMN print_order.locale（这单的邮件通知用哪种语言）
 * - 1 个索引：(order_id, created_at)
 *
 * ## 为什么单独一个脚本,而不是塞进 apply-print-order-schema.ts
 *
 * 那个脚本是「print_order 这张表本身」的落地脚本,已经被别的环境跑过了;
 * 往里加语句意味着老环境重跑它时才会拿到新结构。这里是一个**独立**的、
 * 幂等的增量脚本 —— 跑它就够,跟 print_order 在不在同一个库无关。
 *
 * 全部 additive + IF NOT EXISTS / DO block 兜底,重复跑安全。
 *
 * ## 为什么不用 drizzle-kit migrate
 *
 * 同 `scripts/apply-print-order-schema.ts` 的说明:本仓库的 drizzle/ 迁移历史
 * 只到 0001,`print_order` / `product` 这些表都是靠 db:push 或一次性脚本落地
 * 的（db:push 卡 TTY 交互）。
 *
 * 用法：
 *   pnpm tsx scripts/apply-print-order-event-schema.ts
 *
 * prod 需要把 DATABASE_URL 拷到 .env.local 再跑。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-print-order-event] 缺少 DATABASE_URL");
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
      label: "CREATE TYPE print_order_event_actor",
      query: `DO $$ BEGIN
        CREATE TYPE "print_order_event_actor" AS ENUM (
          'user',
          'admin',
          'system'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`,
    },
    {
      label: "ADD COLUMN print_order.locale",
      // 订单语言 —— 决定这单的通知邮件用中文还是英文。
      // 默认 'zh'（站点默认 locale）,老订单加列后也是中文单。
      query: `ALTER TABLE "print_order"
        ADD COLUMN IF NOT EXISTS "locale" text NOT NULL DEFAULT 'zh';`,
    },
    {
      label: "CREATE TABLE print_order_event",
      query: `CREATE TABLE IF NOT EXISTS "print_order_event" (
        "id" text PRIMARY KEY,
        "order_id" text NOT NULL REFERENCES "print_order" ("id") ON DELETE CASCADE,
        "from_status" "print_order_status",
        "to_status" "print_order_status" NOT NULL,
        "actor" "print_order_event_actor" NOT NULL,
        "note" text,
        "created_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label:
        'INDEX print_order_event_order_created_idx ON print_order_event("order_id", "created_at")',
      query: `CREATE INDEX IF NOT EXISTS "print_order_event_order_created_idx"
        ON "print_order_event" ("order_id", "created_at");`,
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

  await client.end();
  console.log("\n[apply-print-order-event] 完成");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
