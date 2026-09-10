/**
 * 应用 prompt_order cursor 联合索引（2026-09-10）
 *
 * 为什么不用 `pnpm db:migrate`：drizzle migrate 会从 0000 开始全量 apply，
 * 但 0000-0004 的 SQL 没有 IF NOT EXISTS 包装，DB 已经手跑过，再跑会撞
 * type "xxx" already exists 之类错误（参考 [[db-push-interactive-blocker]] +
 * [[drizzle-migration-bootstrapping]]）。本项目所有「加列 / 加索引」都走
 * scripts/apply-*.ts 直连 pg，幂等 DDL。
 *
 * 本脚本直接跑 drizzle/0006_prompt_order_cursor_idx.sql（已用
 * CREATE INDEX IF NOT EXISTS 包装，幂等）。同时把 schema.ts 里
 * promptOrder 的索引定义更新成一致形态，避免下次 db:generate 出 diff。
 *
 * 用法：pnpm tsx scripts/apply-prompt-order-cursor-idx.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SQL_PATH = resolve(
  process.cwd(),
  "drizzle/0006_prompt_order_cursor_idx.sql"
);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL 未配置（看 .env.local / .env）");
  }

  // 检测 SSL（Neon/Supabase 远程必开；本地可关）
  const isRemote = url.includes("neon.tech") || url.includes("supabase");
  const finalUrl = url
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]ssl=[^&]*/g, "")
    .replace(/[?&]uselibpqcompat=[^&]*/g, "");

  const sql = readFileSync(SQL_PATH, "utf8");
  console.log(`[apply-cursor-idx] reading SQL: ${SQL_PATH}`);
  console.log(`[apply-cursor-idx] ${sql.split("\n").length} lines`);

  const client = new Client({
    connectionString: finalUrl,
    ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("[apply-cursor-idx] done");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[apply-cursor-idx] failed:", err);
  process.exit(1);
});
