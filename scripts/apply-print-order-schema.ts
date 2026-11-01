#!/usr/bin/env -S npx tsx

/**
 * 应用打印服务订单 schema（2026-11-01）
 *
 * - CREATE TYPE print_order_status（6 态）
 * - CREATE TABLE print_order
 * - 3 个索引：order_no 唯一 / status / created_at
 *
 * ## 为什么不用 drizzle-kit migrate
 *
 * 本仓库的 drizzle/ 迁移历史只到 0001，后面 `product` / `product_variant` 这些
 * 表都是靠 `db:push` 或本目录的一次性脚本落地的（见
 * `scripts/apply-all-missing-migrations.ts` 的说明：db:push 卡 TTY 交互，
 * migrate 也跑不通那些手写增量）。所以新表沿用老套路 —— 一个幂等的
 * apply 脚本。
 *
 * 全部 additive + IF NOT EXISTS / DO block 兜底，重复跑安全。
 *
 * 用法：
 *   pnpm tsx scripts/apply-print-order-schema.ts
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
    console.error("[apply-print-order] 缺少 DATABASE_URL");
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
      label: "CREATE TYPE print_order_status",
      query: `DO $$ BEGIN
        CREATE TYPE "print_order_status" AS ENUM (
          'PENDING',
          'CONFIRMED',
          'IN_PRODUCTION',
          'SHIPPED',
          'COMPLETED',
          'CANCELLED'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`,
    },
    {
      label: "CREATE TABLE print_order",
      query: `CREATE TABLE IF NOT EXISTS "print_order" (
        "id" text PRIMARY KEY,
        "order_no" text NOT NULL,
        "access_token" text NOT NULL,
        "status" "print_order_status" NOT NULL DEFAULT 'PENDING',
        "model_file_name" text NOT NULL,
        "model_url" text NOT NULL,
        "model_size_bytes" integer,
        "volume_cm3" numeric(12,4) NOT NULL,
        "surface_area_cm2" numeric(12,4) NOT NULL,
        "dim_x" numeric(12,3) NOT NULL,
        "dim_y" numeric(12,3) NOT NULL,
        "dim_z" numeric(12,3) NOT NULL,
        "material_weight_g" numeric(12,3) NOT NULL,
        "support_weight_g" numeric(12,3),
        "material_density" numeric(8,4) NOT NULL,
        "unit_price_cents_per_gram" integer NOT NULL,
        "weight_fee_cents" integer NOT NULL,
        "varnish_fee_cents" integer NOT NULL,
        "support_fee_cents" integer NOT NULL,
        "total_price_cents" integer NOT NULL,
        "contact_name" text NOT NULL,
        "contact_email" text NOT NULL,
        "contact_phone" text,
        "note" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label: 'UNIQUE INDEX print_order_no_uniq_idx ON print_order("order_no")',
      query: `CREATE UNIQUE INDEX IF NOT EXISTS "print_order_no_uniq_idx"
        ON "print_order" ("order_no");`,
    },
    {
      label: 'INDEX print_order_status_idx ON print_order("status")',
      query: `CREATE INDEX IF NOT EXISTS "print_order_status_idx"
        ON "print_order" ("status");`,
    },
    {
      label: 'INDEX print_order_created_at_idx ON print_order("created_at")',
      query: `CREATE INDEX IF NOT EXISTS "print_order_created_at_idx"
        ON "print_order" ("created_at");`,
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
  console.log("\n[apply-print-order] 完成");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
