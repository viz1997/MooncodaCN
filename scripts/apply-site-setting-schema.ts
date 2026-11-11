#!/usr/bin/env -S npx tsx

/**
 * 应用「站点设置」schema(2026-11-11)
 *
 * - `site_setting` —— 键值对式的站点级设置(`key` / `value` / `updated_at`)
 *
 * ## 为什么需要这张表
 *
 * 工作室 2026-11-11 的要求:**「海外独立站入口 —— 不需要环境变量,在后台设置」**。
 *
 * `NEXT_PUBLIC_*` 是**构建期内联**的 ⇒ 改完环境变量要**重新部署**才生效,
 * 改不了环境变量的人(工作室)就只能每次让开发发一次版。真理源搬到 DB 之后,
 * 改地址在后台点一下就完事。
 *
 * ## 这个脚本做什么、不做什么
 *
 * **做**:建表。
 *
 * **不做**:
 *
 * - **不写任何一行配置** —— 尤其是**不把环境变量那个地址搬进表里**。
 *   搬进去等于把「还在走环境变量兜底」这个状态给盖掉,后台就看不出现在
 *   到底按什么在生效了。跑完脚本,后台 `/admin/site-settings` 会挂一条
 *   「还在走环境变量兜底」的横幅,工作室在那边填地址、点保存。
 * - **不改任何别的表** —— 这张表跟订单 / 商品 / 定价都没有关系。
 *
 * ## 幂等
 *
 * `CREATE TABLE IF NOT EXISTS` —— 跑几遍都安全。
 *
 * ## 为什么手写而不是 `db:generate`
 *
 * 这个仓库的迁移都是手写幂等脚本(见 `scripts/apply-*.ts`),跑几遍都安全,
 * 不会因为跟库里已有状态对不上而要人工调。
 *
 * ## 用法
 *
 * ```bash
 * # 只打印 SQL,不连库
 * pnpm tsx scripts/apply-site-setting-schema.ts --dry-run
 *
 * # 真跑
 * pnpm tsx scripts/apply-site-setting-schema.ts
 * pnpm migrate:apply-site-setting
 * ```
 *
 * **不代跑** —— 工作室的库由工作室自己执行。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

/** `--dry-run` —— 只打印 SQL,不连库 */
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * 每条语句:一个标签 + 一段 SQL
 *
 * 标签会打印出来 —— 工作室跑完脚本能在输出里对一遍「建了什么」。
 */
const STATEMENTS: Array<{ label: string; query: string }> = [
  {
    label: "CREATE TABLE site_setting",
    query: `CREATE TABLE IF NOT EXISTS "site_setting" (
      "key" text PRIMARY KEY,
      "value" text NOT NULL,
      "updated_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
];

async function main() {
  if (DRY_RUN) {
    console.log("[apply-site-setting] --dry-run:只打印 SQL,不连库\n");
    for (const { label, query } of STATEMENTS) {
      console.log(`-- ${label}`);
      console.log(`${query}\n`);
    }
    console.log(
      "[apply-site-setting] dry-run 结束 —— 去掉 --dry-run 才会真的执行"
    );
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("[apply-site-setting] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  for (const { label, query } of STATEMENTS) {
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

  /* ------------------------------------------------------------ 回读验证 --- */

  /**
   * 回读一次 —— 确认表真的在。
   *
   * **行数必须是 0** —— 脚本不播种(见文件头)。要是这里有行,说明有人手动
   * 往表里塞过东西,那得看一眼是不是想要的。
   */
  const check = await client.query<{
    table_exists: string;
    row_count: string;
    has_value_column: string;
    has_updated_at_column: string;
  }>(
    `SELECT
      (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'site_setting')
        AS table_exists,
      (SELECT count(*)::text FROM "site_setting")
        AS row_count,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'site_setting' AND column_name = 'value')
        AS has_value_column,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'site_setting' AND column_name = 'updated_at')
        AS has_updated_at_column;`
  );

  const row = check.rows[0];
  const yes = (v: string | undefined) => (v === "1" ? "✓" : "✗");

  console.log("");
  console.log("[apply-site-setting] 回读:");
  console.log(`  ${yes(row?.table_exists)} site_setting 表在`);
  console.log(`  ${yes(row?.has_value_column)} site_setting.value`);
  console.log(`  ${yes(row?.has_updated_at_column)} site_setting.updated_at`);
  console.log(
    `  现有 ${row?.row_count ?? 0} 行(脚本不播种 —— 工作室自己在后台填)`
  );

  await client.end();
  console.log(
    "\n[apply-site-setting] 完成 —— 到 /admin/site-settings 填海外独立站地址"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
