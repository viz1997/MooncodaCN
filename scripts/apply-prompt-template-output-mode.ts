#!/usr/bin/env -S npx tsx

/**
 * 直接应用 promptTemplate.outputMode 字段。
 *
 * 2026-09-01 起因：db:push 卡 TTY 交互式（见 db-push-interactive-blocker），
 * 管道喂输入无效。绕过：直接用 postgres-js 跑这一条 additive SQL：
 *
 *   ALTER TABLE "prompt_template" ADD COLUMN IF NOT EXISTS "output_mode"
 *     text NOT NULL DEFAULT 'grid';
 *
 * additive + default，老模板一行不动（DB 默认 'grid' 兼容现有行为）。
 * 重复运行 IF NOT EXISTS 兜底。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-schema] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const statements: Array<{ label: string; query: string }> = [
    {
      label: "ADD COLUMN prompt_template.output_mode",
      query: `ALTER TABLE "prompt_template" ADD COLUMN IF NOT EXISTS "output_mode" text NOT NULL DEFAULT 'grid';`,
    },
  ];

  for (const { label, query } of statements) {
    process.stdout.write(`[apply-schema] ${label} ... `);
    try {
      await client.query(query);
      console.log("✓");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗\n[apply-schema] ${label} 失败：${msg}`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log("[apply-schema] 全部语句执行成功");
}

main().catch((err) => {
  console.error("[apply-schema] 未处理错误：", err);
  process.exit(1);
});
