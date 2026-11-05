#!/usr/bin/env -S npx tsx

/**
 * 应用收货地址 schema（2026-11-04）
 *
 * - 新表 `address`
 *
 * ## 为什么地址簿在本仓库而不是 Sellbase
 *
 * Sellbase 的 `customer.addresses` 是**只读**的 —— 没有创建地址的路由。
 * 在本仓库建了再「同步过去」是死路(没有 API 能写)。所以地址簿整个在本仓库,
 * 下单时把地址**快照**一起发给 Sellbase(它只当一个字段存着,不做地址簿)。
 *
 * 订单里存的是快照而不是外键:地址是订单事实的一部分,用户后来改地址簿
 * 不该改写历史订单的收货地址。
 *
 * 用法:
 *   pnpm tsx scripts/apply-user-address-schema.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-user-address] 缺少 DATABASE_URL");
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
      label: "CREATE TABLE address",
      query: `CREATE TABLE IF NOT EXISTS "address" (
        "id" text PRIMARY KEY,
        "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
        "recipient_name" text NOT NULL,
        "phone" text NOT NULL,
        "province" text NOT NULL,
        "city" text NOT NULL,
        "district" text NOT NULL,
        "detail" text NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label: 'INDEX address_user_id_idx ON address("user_id")',
      query: `CREATE INDEX IF NOT EXISTS "address_user_id_idx"
        ON "address" ("user_id");`,
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
  console.log("\n[apply-user-address] 完成");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
