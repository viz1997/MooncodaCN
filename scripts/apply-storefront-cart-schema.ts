#!/usr/bin/env -S npx tsx

/**
 * 应用商城购物车 schema（2026-11-04）
 *
 * - 新表 `cart` / `cart_item`
 *
 * ## 为什么要落库
 *
 * 之前的购物车是 `src/features/storefront/lib/cart-store.ts` 里一个进程内
 * `Map`(`const CARTS = new Map<string, Cart>()`)。三个毛病:
 *
 * 1. 重启即丢 —— 用户加购完刷新一下(或等一次部署)购物车空了
 * 2. 多实例部署各算各的 —— 粘性会话之外,换个实例就读不到
 * 3. 没法在后台看「有谁在买什么」
 *
 * 落库之后这三件事都消失了。存储层的切换被隔离在 `cart-store.ts` 一个文件里,
 * 导出的 7 个函数签名一行没变。
 *
 * ## 为什么不用 drizzle-kit migrate
 *
 * 同 `apply-sellbase-payment-schema.ts` —— 本仓库的迁移历史只到 0001,新表走
 * 手写幂等 apply 脚本。
 *
 * 用法:
 *   pnpm tsx scripts/apply-storefront-cart-schema.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-storefront-cart] 缺少 DATABASE_URL");
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
      label: "CREATE TABLE cart",
      query: `CREATE TABLE IF NOT EXISTS "cart" (
        "id" text PRIMARY KEY,
        "user_id" text REFERENCES "user" ("id") ON DELETE CASCADE,
        "currency_code" text NOT NULL DEFAULT 'CNY',
        "region_id" text NOT NULL DEFAULT 'china',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label: "ADD COLUMN cart.user_id（旧库升级）",
      query: `ALTER TABLE "cart"
        ADD COLUMN IF NOT EXISTS "user_id" text REFERENCES "user" ("id") ON DELETE CASCADE;`,
    },
    {
      label: "ADD COLUMN cart.currency_code（旧库升级）",
      query: `ALTER TABLE "cart"
        ADD COLUMN IF NOT EXISTS "currency_code" text NOT NULL DEFAULT 'CNY';`,
    },
    {
      label: "ADD COLUMN cart.region_id（旧库升级）",
      query: `ALTER TABLE "cart"
        ADD COLUMN IF NOT EXISTS "region_id" text NOT NULL DEFAULT 'china';`,
    },
    {
      label: 'INDEX cart_user_id_idx ON cart("user_id")',
      query: `CREATE INDEX IF NOT EXISTS "cart_user_id_idx"
        ON "cart" ("user_id");`,
    },
    {
      label: "CREATE TABLE cart_item",
      query: `CREATE TABLE IF NOT EXISTS "cart_item" (
        "id" text PRIMARY KEY,
        "cart_id" text NOT NULL REFERENCES "cart" ("id") ON DELETE CASCADE,
        "product_id" text NOT NULL,
        "product_handle" text NOT NULL,
        "product_title" text NOT NULL,
        "product_thumbnail" text,
        "unit_price_cents" integer NOT NULL,
        "quantity" integer NOT NULL,
        "metadata" json NOT NULL,
        "spec_hash" text NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label: "ADD COLUMN cart_item.spec_hash（旧库升级）",
      query: `ALTER TABLE "cart_item"
        ADD COLUMN IF NOT EXISTS "spec_hash" text;`,
    },
    {
      label:
        'UNIQUE INDEX cart_item_cart_spec_uniq_idx ON cart_item("cart_id", "spec_hash")',
      // 同 spec 合并数量靠这个唯一键 —— 撞上就 +quantity,而不是插第二行
      query: `CREATE UNIQUE INDEX IF NOT EXISTS "cart_item_cart_spec_uniq_idx"
        ON "cart_item" ("cart_id", "spec_hash");`,
    },
    {
      label: 'INDEX cart_item_cart_id_idx ON cart_item("cart_id")',
      query: `CREATE INDEX IF NOT EXISTS "cart_item_cart_id_idx"
        ON "cart_item" ("cart_id");`,
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
  console.log("\n[apply-storefront-cart] 完成");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
