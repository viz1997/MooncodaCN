#!/usr/bin/env -S npx tsx

/**
 * 应用「打印单」schema(2026-11-06)
 *
 * - `cart.kind` —— 车的性质(`storefront` 商城购物袋 / `print` 打印单)
 * - `cart_kind_idx` —— 按性质找车的索引
 *
 * ## 为什么加这一列
 *
 * 打印服务**不再走商城购物袋**(工作室的说法:「模型打印是不走商城正常的
 * 购物车的,而是走打印下单」)。两种车在同一张 `cart` 表里,靠 `kind` 区分 ——
 * 判在数据层(`storefront/lib/cart-store.ts` 的 `addLineItem()`),
 * 绕过界面的直接调 API 也进不去。
 *
 * ## 存量数据怎么办
 *
 * **一行不动**。老购物车(2026-11-06 之前建的)默认就是商城购物袋
 * (`storefront`)—— 跟它们当时的事实一致。老购物车里可能混着打印服务行
 * (那是 2026-11-05 「打印服务进商城购物车」那版留下的),那些行**读购物车
 * 时会被滤掉**(见 `cart-store.ts` 的 `toCart()`)—— 它们还在库里,不影响
 * 账,只是不再出现在商城购物袋里。想彻底清掉的话:
 *
 * ```sql
 * DELETE FROM cart_item WHERE metadata->>'printSpec' IS NOT NULL;
 * ```
 *
 * ## 为什么手写而不是 `db:generate`
 *
 * `db:generate` 生成的迁移文件会**顺着整张 schema 的历史**走一遍,跟库里
 * 已有状态对不上的时候要人工调。这个仓库的迁移都是手写幂等脚本
 * (`ADD COLUMN IF NOT EXISTS`),跑几遍都安全。
 *
 * 用法:
 *   pnpm tsx scripts/apply-print-cart-schema.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-print-cart] 缺少 DATABASE_URL");
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
      label: "ALTER TABLE cart ADD COLUMN kind",
      query: `ALTER TABLE "cart"
        ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'storefront';`,
    },
    {
      label: "CREATE INDEX cart_kind_idx",
      query: `CREATE INDEX IF NOT EXISTS "cart_kind_idx" ON "cart" ("kind");`,
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
    kind_default: string | null;
    kind_count: string;
  }>(
    `SELECT
       (SELECT column_default FROM information_schema.columns
         WHERE table_name = 'cart' AND column_name = 'kind')
         AS kind_default,
       (SELECT count(*)::text FROM "cart" WHERE "kind" = 'print')
         AS kind_count;`
  );
  console.log(
    `[apply-print-cart] kind 默认值 = ${check.rows[0]?.kind_default}, ` +
      `已有的打印单 = ${check.rows[0]?.kind_count ?? 0} 张`
  );

  await client.end();
  console.log("\n[apply-print-cart] 完成");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
