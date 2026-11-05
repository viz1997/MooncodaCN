/**
 * 应用 prompt_order admin 全局 cursor 联合索引（2026-09-18）
 *
 * 给 /admin/orders 无限滚动用：planner 走 (status, created_at DESC, id DESC)
 * 或 (created_at DESC, id DESC) 索引直接 reverse-scan 到 cursor 行，
 * 无需 filesort。
 *
 * 沿用 [[drizzle-migration-bootstrapping]] 模式：手跑 SQL，不用 drizzle migrate。
 * CREATE INDEX IF NOT EXISTS 幂等包装，可重复执行。
 *
 * 用法：pnpm tsx scripts/apply-admin-prompt-order-indexes.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const SQL_PATH = resolveSqlPath("0043_admin_prompt_order_indexes.sql");

/**
 * 找迁移 SQL —— `drizzle/` 里只剩 0000/0001,其余的都在 `drizzle-archive/`
 *
 * 两处都找一遍:先按老路径(`drizzle/`),找不到再翻归档。归档目录名带日期
 * (`20261013_231944`),是那批手写增量迁移的归档位置。
 */
function resolveSqlPath(fileName: string): string {
  const candidates = [
    resolve(process.cwd(), "drizzle", fileName),
    resolve(process.cwd(), "drizzle-archive/20261013_231944", fileName),
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) {
    throw new Error(`找不到 ${fileName}(试过:${candidates.join(", ")})`);
  }
  return hit;
}

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
  console.log(`[apply-admin-idx] reading SQL: ${SQL_PATH}`);
  console.log(`[apply-admin-idx] ${sql.split("\n").length} lines`);

  const client = new Client({
    connectionString: finalUrl,
    ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log("[apply-admin-idx] done");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[apply-admin-idx] failed:", err);
  process.exit(1);
});
