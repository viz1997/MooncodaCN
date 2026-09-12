#!/usr/bin/env -S npx tsx

/**
 * 2026-09-12：直接给 prompt_order 加 platform_order_no 列
 *
 * 起因：/image-gen demo 下单 submit-image-gen-demo.ts 写 promptOrder 时
 * 引用了 platform_order_no 列，但 production DB 缺这列（PG 42703）。
 *
 * SQL 出处：drizzle/0013_prompt_order_platform_order_no.sql
 *   ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "platform_order_no" text;
 *
 * additive + nullable（null = 用户未选 platform / 渠道订单号不知道），
 * 老订单一行不动。IF NOT EXISTS 幂等，重复跑安全。
 *
 * 为什么不用 drizzle-kit migrate / push：
 *   - 历史 0008/0009/0010 等都是手写 SQL 增量，不是 drizzle-kit 生成的 migration
 *     （见 [[drizzle-migration-bootstrapping]]）
 *   - db:push 卡 TTY 交互式（见 [[db-push-interactive-blocker]]）
 *   - 直接 psql 等价物最快
 *
 * 用法：
 *   pnpm tsx scripts/apply-prompt-order-platform-order-no.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 先查一下当前列状态，输出有意义的诊断
  const before = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'prompt_order' AND column_name = 'platform_order_no'`
    );

  if (before.rows.length > 0) {
    console.log("[apply] ✅ prompt_order.platform_order_no 列已存在，无需 apply");
    console.table(before.rows);
    await client.end();
    return;
  }

  const statements: Array<{ label: string; query: string }> = [
    {
      label: "ADD COLUMN prompt_order.platform_order_no",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "platform_order_no" text;`,
    },
  ];

  for (const { label, query } of statements) {
    process.stdout.write(`[apply] ${label} ... `);
    try {
      await client.query(query);
      console.log("✓");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗\n[apply] ${label} 失败：${msg}`);
      await client.end();
      process.exit(1);
    }
  }

  // 验证
  const after = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'prompt_order' AND column_name = 'platform_order_no'`
    );
  console.log("\n[apply] 验证：");
  console.table(after.rows);

  await client.end();
  console.log("[apply] 全部语句执行成功");
}

main().catch((err) => {
  console.error("[apply] 未处理错误：", err);
  process.exit(1);
});