#!/usr/bin/env -S npx tsx

/**
 * 应用 Sellbase 支付相关 schema（2026-11-04）
 *
 * - `product_variant.sellbase_variant_id` —— 载体变体 id(Sellbase 同步时回填)
 * - `print_order` 支付五列 + `shipping_address`
 * - 新表 `storefront_order` / `storefront_order_item`(含 `payment_status`)
 * - `user.medusa_customer_id` → `user.sellbase_customer_id`(改名 + 搬数据)
 *
 * ## 为什么不用 drizzle-kit migrate
 *
 * 本仓库的 drizzle/ 迁移历史只到 0001,后面 `product` / `product_variant` 这些
 * 表都是靠 `db:push` 或本目录的一次性脚本落地的(见
 * `scripts/apply-all-missing-migrations.ts` 的说明:db:push 卡 TTY 交互,
 * migrate 也跑不通那些手写增量)。所以新表沿用老套路 —— 一个幂等的 apply 脚本。
 *
 * 全部 additive + IF NOT EXISTS / DO block 兜底,重复跑安全。
 *
 * 用法:
 *   pnpm tsx scripts/apply-sellbase-payment-schema.ts
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
    console.error("[apply-sellbase-payment] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const statements: Array<{ label: string; query: string }> = [
    // ------------------------------------------------------------------
    // product_variant:载体变体 id
    // ------------------------------------------------------------------
    {
      label: "ADD COLUMN product_variant.sellbase_variant_id",
      query: `ALTER TABLE "product_variant"
        ADD COLUMN IF NOT EXISTS "sellbase_variant_id" text;`,
    },
    {
      label: "INDEX product_variant_sellbase_variant_id_idx",
      // 建单时要按 (product_code, size_code) 找载体变体,顺便按 id 反查
      // 「这行的 Sellbase 变体还在不在」—— 用 id 反查的频率比正查低,但每次
      // 建单都要确认载体没被同步脚本删掉重建。
      query: `CREATE INDEX IF NOT EXISTS "product_variant_sellbase_variant_id_idx"
        ON "product_variant" ("sellbase_variant_id");`,
    },

    // ------------------------------------------------------------------
    // print_order:支付列
    // ------------------------------------------------------------------
    {
      label: "ADD COLUMN print_order.payment_status",
      query: `ALTER TABLE "print_order"
        ADD COLUMN IF NOT EXISTS "payment_status" text NOT NULL DEFAULT 'unpaid';`,
    },
    {
      label: "ADD COLUMN print_order.payment_channel",
      query: `ALTER TABLE "print_order"
        ADD COLUMN IF NOT EXISTS "payment_channel" text;`,
    },
    {
      label: "ADD COLUMN print_order.sellbase_order_id",
      query: `ALTER TABLE "print_order"
        ADD COLUMN IF NOT EXISTS "sellbase_order_id" text;`,
    },
    {
      label: "ADD COLUMN print_order.payment_url",
      query: `ALTER TABLE "print_order"
        ADD COLUMN IF NOT EXISTS "payment_url" text;`,
    },
    {
      label: "ADD COLUMN print_order.paid_at",
      query: `ALTER TABLE "print_order"
        ADD COLUMN IF NOT EXISTS "paid_at" timestamp;`,
    },
    {
      label: "ADD COLUMN print_order.shipping_address",
      query: `ALTER TABLE "print_order"
        ADD COLUMN IF NOT EXISTS "shipping_address" json;`,
    },
    {
      label:
        'UNIQUE INDEX print_order_sellbase_order_id_uniq_idx ON print_order("sellbase_order_id")',
      query: `CREATE UNIQUE INDEX IF NOT EXISTS "print_order_sellbase_order_id_uniq_idx"
        ON "print_order" ("sellbase_order_id");`,
    },

    // ------------------------------------------------------------------
    // storefront_order / storefront_order_item
    // ------------------------------------------------------------------
    {
      label: "CREATE TYPE storefront_order_status",
      query: `DO $$ BEGIN
        CREATE TYPE "storefront_order_status" AS ENUM (
          'unpaid',
          'paid',
          'fulfilled',
          'cancelled'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`,
    },
    {
      label: "CREATE TABLE storefront_order",
      query: `CREATE TABLE IF NOT EXISTS "storefront_order" (
        "id" text PRIMARY KEY,
        "order_no" text NOT NULL,
        "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
        "email" text NOT NULL,
        "status" "storefront_order_status" NOT NULL DEFAULT 'unpaid',
        "payment_status" text NOT NULL DEFAULT 'unpaid',
        "subtotal_cents" integer NOT NULL,
        "discount_cents" integer NOT NULL DEFAULT 0,
        "shipping_cents" integer NOT NULL DEFAULT 0,
        "total_cents" integer NOT NULL,
        "currency" text NOT NULL DEFAULT 'CNY',
        "sellbase_order_id" text,
        "payment_url" text,
        "paid_at" timestamp,
        "shipping_address" json,
        "note" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label: "ADD COLUMN storefront_order.payment_status（旧库升级）",
      query: `ALTER TABLE "storefront_order"
        ADD COLUMN IF NOT EXISTS "payment_status" text NOT NULL DEFAULT 'unpaid';`,
    },
    {
      label: "ADD COLUMN storefront_order.sellbase_order_id（旧库升级）",
      query: `ALTER TABLE "storefront_order"
        ADD COLUMN IF NOT EXISTS "sellbase_order_id" text;`,
    },
    {
      label: "ADD COLUMN storefront_order.payment_url（旧库升级）",
      query: `ALTER TABLE "storefront_order"
        ADD COLUMN IF NOT EXISTS "payment_url" text;`,
    },
    {
      label: "ADD COLUMN storefront_order.paid_at（旧库升级）",
      query: `ALTER TABLE "storefront_order"
        ADD COLUMN IF NOT EXISTS "paid_at" timestamp;`,
    },
    {
      label: "ADD COLUMN storefront_order.shipping_address（旧库升级）",
      query: `ALTER TABLE "storefront_order"
        ADD COLUMN IF NOT EXISTS "shipping_address" json;`,
    },
    {
      label: "ADD COLUMN storefront_order.note（旧库升级）",
      query: `ALTER TABLE "storefront_order"
        ADD COLUMN IF NOT EXISTS "note" text;`,
    },
    {
      label:
        'UNIQUE INDEX storefront_order_no_uniq_idx ON storefront_order("order_no")',
      query: `CREATE UNIQUE INDEX IF NOT EXISTS "storefront_order_no_uniq_idx"
        ON "storefront_order" ("order_no");`,
    },
    {
      label:
        'UNIQUE INDEX storefront_order_sellbase_id_uniq_idx ON storefront_order("sellbase_order_id")',
      query: `CREATE UNIQUE INDEX IF NOT EXISTS "storefront_order_sellbase_id_uniq_idx"
        ON "storefront_order" ("sellbase_order_id");`,
    },
    {
      label: 'INDEX storefront_order_user_idx ON storefront_order("user_id")',
      query: `CREATE INDEX IF NOT EXISTS "storefront_order_user_idx"
        ON "storefront_order" ("user_id");`,
    },
    {
      label: "CREATE TABLE storefront_order_item",
      query: `CREATE TABLE IF NOT EXISTS "storefront_order_item" (
        "id" text PRIMARY KEY,
        "order_id" text NOT NULL REFERENCES "storefront_order" ("id") ON DELETE CASCADE,
        "product_id" text NOT NULL,
        "product_handle" text NOT NULL,
        "product_title" text NOT NULL,
        "product_thumbnail" text,
        "variant_id" text,
        "sku" text,
        "unit_price_cents" integer NOT NULL,
        "discounted_unit_price_cents" integer NOT NULL,
        "quantity" integer NOT NULL,
        "line_total_cents" integer NOT NULL,
        "metadata" json NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label:
        "ADD COLUMN storefront_order_item.discounted_unit_price_cents（旧库升级）",
      query: `ALTER TABLE "storefront_order_item"
        ADD COLUMN IF NOT EXISTS "discounted_unit_price_cents" integer;`,
    },
    {
      label: "BACKFILL storefront_order_item.discounted_unit_price_cents",
      // 旧行(如果脚本重跑时表已存在)没有折后单价 —— 用原单价补上,
      // 免得后面读出来是 null。
      query: `UPDATE "storefront_order_item"
        SET "discounted_unit_price_cents" = "unit_price_cents"
        WHERE "discounted_unit_price_cents" IS NULL;`,
    },
    {
      label: "SET NOT NULL storefront_order_item.discounted_unit_price_cents",
      query: `ALTER TABLE "storefront_order_item"
        ALTER COLUMN "discounted_unit_price_cents" SET NOT NULL;`,
    },
    {
      label:
        'INDEX storefront_order_item_order_idx ON storefront_order_item("order_id")',
      query: `CREATE INDEX IF NOT EXISTS "storefront_order_item_order_idx"
        ON "storefront_order_item" ("order_id");`,
    },

    // ------------------------------------------------------------------
    // user:medusa_customer_id → sellbase_customer_id
    // ------------------------------------------------------------------
    {
      label: "RENAME user.medusa_customer_id → user.sellbase_customer_id",
      // 改名而不是直接删 —— 老的值虽然现在没人读,但搬过去不丢东西。
      // DO block 保证两种初始状态都能收敛到同一个结果:
      //   有旧列没新列 → 加新列、搬数据、删旧列
      //   只有新列     → 什么都不做
      query: `DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'user' AND column_name = 'medusa_customer_id'
        ) THEN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'user' AND column_name = 'sellbase_customer_id'
          ) THEN
            ALTER TABLE "user" ADD COLUMN "sellbase_customer_id" text;
          END IF;
          UPDATE "user"
            SET "sellbase_customer_id" = "medusa_customer_id"
            WHERE "sellbase_customer_id" IS NULL
              AND "medusa_customer_id" IS NOT NULL;
          ALTER TABLE "user" DROP COLUMN "medusa_customer_id";
        END IF;
      END $$;`,
    },
    {
      label: "DROP INDEX user_medusa_customer_id_idx",
      query: `DROP INDEX IF EXISTS "user_medusa_customer_id_idx";`,
    },
    {
      label: "INDEX user_sellbase_customer_id_idx",
      query: `CREATE INDEX IF NOT EXISTS "user_sellbase_customer_id_idx"
        ON "user" ("sellbase_customer_id");`,
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
  console.log("\n[apply-sellbase-payment] 完成");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
