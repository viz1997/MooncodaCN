#!/usr/bin/env -S npx tsx

/**
 * 2026-09-12：诊断 prompt_order 表里所有列，列出 schema.ts 期望但 DB 缺的列
 *
 * 起因：prod 一连串 42703（platform_order_no / leather_color），说明 drizzle/0006+
 * 不是 drizzle-kit 自动生成的，prod 必须手动跑。
 *
 * 用法：
 *   pnpm tsx scripts/inspect-prompt-order-columns.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[inspect] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const cols = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'prompt_order'
       ORDER BY ordinal_position`
    );

  console.log(`[inspect] prompt_order 现有 ${cols.rows.length} 列：\n`);
  console.table(cols.rows);

  // schema.ts 期望的列（不在这里的就是 DB 缺的）
  const expected = [
    "id",
    "order_no",
    "template_id",
    "recipient_name",
    "platform",
    "platform_order_no", // drizzle/0013
    "token",
    "status",
    "uploaded_images",
    "upload_count",
    "images_per_upload",
    "regenerate_limit",
    "candidates",
    "selected_index",
    "selections",
    "error_message",
    "product_type_code",
    "product_size",
    "accessory_code",
    "engraving_text",
    "engraving_exposed",
    "leather_color", // drizzle/0007
    "leather_exposed", // drizzle/0007
    "pvc_protection", // drizzle/0007
    "remarks", // drizzle/0007
    "agent_id",
    "generation_task",
    "uploaded_at",
    "generated_at",
    "selected_at",
    "cancelled_at",
    "created_by",
    "created_at",
    "updated_at",
  ];

  const existing = new Set(cols.rows.map((r) => r.column_name));
  const missing = expected.filter((c) => !existing.has(c));

  console.log(`\n[inspect] schema.ts 期望 ${expected.length} 列，缺：${missing.length}`);
  if (missing.length > 0) {
    console.log("\n⚠️  缺失列（请跑对应 migration）：");
    console.table(missing.map((m) => ({ column: m })));
  } else {
    console.log("✅ 全部列齐");
  }

  await client.end();
}

main().catch((err) => {
  console.error("[inspect] 未处理错误：", err);
  process.exit(1);
});