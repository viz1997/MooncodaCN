#!/usr/bin/env -S npx tsx

/**
 * 2026-09-12：清理 dev fake 订单（scripts/seed-fake-orders-for-recon.ts 注入）
 *
 * 用于本轮验证 inspect 脚本完成后清场，避免 dev DB 留下虚假对账数据。
 *
 * 用法：
 *   pnpm tsx scripts/cleanup-fake-orders.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[cleanup-fake] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const res = await client.query(
    `DELETE FROM prompt_order WHERE order_no LIKE 'FAKE-%' RETURNING id`
  );
  console.log(`[cleanup-fake] 已删 ${res.rowCount} 条 fake 订单`);

  await client.end();
}

main().catch((err) => {
  console.error("[cleanup-fake] 失败：", err);
  process.exit(1);
});