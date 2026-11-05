#!/usr/bin/env -S npx tsx

/**
 * 应用商品目录 schema（2026-11-04）
 *
 * - 新表 `product`（商品资料 + 基础价 + 上下架）
 * - 新表 `product_variant`（真 SKU，绝对价 + 上下架 + Sellbase 载体变体指针）
 *
 * ## 为什么单独一个脚本
 *
 * 这两张表最早是 `db:push` 落地的 —— drizzle-kit push 要 TTY 交互，
 * 在 CI / 脚本环境跑不了，所以补一个幂等的 apply 脚本，跟仓库里其他
 * `scripts/apply-*.ts` 一个路子。
 *
 * 之所以现在才补：`apply-sellbase-payment-schema.ts` 里的第一条语句就是
 * `ALTER TABLE "product_variant" ADD COLUMN "sellbase_variant_id"` ——
 * 表不存在的话整个脚本会在第一条就挂掉。所以建表必须排在它前面。
 *
 * 列的定义跟 `src/db/schema.ts` 一一对应（`product.status` 是 text 而不是
 * pgEnum，schema.ts 里也是 `text("status", { enum: [...] })`）。
 *
 * 用法:
 *   pnpm tsx scripts/apply-product-catalog-schema.ts
 *
 * 落地之后跑种子:
 *   pnpm tsx src/db/seed-products.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-product-catalog] 缺少 DATABASE_URL");
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
    // product:商品主表(主键 = productTypeCode)
    // ------------------------------------------------------------------
    {
      label: "CREATE TABLE product",
      query: `CREATE TABLE IF NOT EXISTS "product" (
        "code" text PRIMARY KEY,
        "name" text NOT NULL,
        "name_en" text NOT NULL DEFAULT '',
        "category" text NOT NULL DEFAULT 'keychain',
        "description" text NOT NULL DEFAULT '',
        "cover_url" text NOT NULL DEFAULT '',
        "base_price_cents" integer NOT NULL DEFAULT 0,
        "lead_time_days" integer NOT NULL DEFAULT 7,
        "accent" text NOT NULL DEFAULT '',
        "status" text NOT NULL DEFAULT 'active',
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label: "INDEX product_status_idx",
      query: `CREATE INDEX IF NOT EXISTS "product_status_idx"
        ON "product" ("status");`,
    },
    // ------------------------------------------------------------------
    // product_variant:可售 SKU(四元组唯一 + sku 全局唯一)
    // ------------------------------------------------------------------
    {
      label: "CREATE TABLE product_variant",
      query: `CREATE TABLE IF NOT EXISTS "product_variant" (
        "id" text PRIMARY KEY,
        "product_code" text NOT NULL,
        "sku" text NOT NULL,
        "size_code" text NOT NULL,
        "accessory_code" text NOT NULL,
        "variant_code" text NOT NULL,
        "price_cents" integer NOT NULL,
        "sellbase_variant_id" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label: "INDEX product_variant_uniq_idx",
      query: `CREATE UNIQUE INDEX IF NOT EXISTS "product_variant_uniq_idx"
        ON "product_variant" ("product_code", "size_code", "accessory_code", "variant_code");`,
    },
    {
      label: "INDEX product_variant_lookup_idx",
      query: `CREATE INDEX IF NOT EXISTS "product_variant_lookup_idx"
        ON "product_variant" ("product_code", "is_active");`,
    },
    {
      label: "INDEX product_variant_sku_uniq_idx",
      query: `CREATE UNIQUE INDEX IF NOT EXISTS "product_variant_sku_uniq_idx"
        ON "product_variant" ("sku");`,
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
  console.log("\n[apply-product-catalog] 完成");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
