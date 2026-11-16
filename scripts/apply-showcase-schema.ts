#!/usr/bin/env -S npx tsx

/**
 * 应用「真实案例」schema(2026-11-16)
 *
 * - `storefront_case` —— 工作室实拍的成品照片
 *
 * ## 为什么需要这张表
 *
 * 工作室的要求:**「电商平台需要增加案例来展示我们实际打印的效果」**。
 *
 * 商城页面上「真实照片。真实礼物。」那两块(首页 `CraftGallery` / 作品集页
 * `CommunityWall`)以前喂的是**代码常量**(`wjp-store-data.ts` 的
 * `WJP_COMMUNITY_POSTS`)—— 那是 Unsplash 的图库照片和**编出来的**点赞数
 * (1280 / 956 / …),摆在「真实」两个字底下比不摆更糟。
 *
 * ⇒ 这张表是那些照片的**真理源**:工作室自己在后台传真图、排序、上下架。
 *
 * ## 这个脚本做什么、不做什么
 *
 * **做**:建表 + 建索引。
 *
 * **不做**:
 *
 * - **不播种任何一行** —— 跑完线上行为一个字节都不变(没有案例时,前台那两段
 *   整个不渲染 —— **不拿静态数据兜底**,见
 *   `src/features/showcase/lib/showcase-catalog.ts`)。
 * - **不碰任何订单表** —— 一行历史订单都不动。
 * - **不删 `wjp-store-data.ts` 的老数据** —— 那是代码常量,不是库里的东西;
 *   那些常量已经在代码层删掉了(2026-11-16)。
 *
 * ## 幂等
 *
 * `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` —— 跑几遍都安全。
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
 * pnpm tsx scripts/apply-showcase-schema.ts --dry-run
 *
 * # 真跑
 * pnpm tsx scripts/apply-showcase-schema.ts
 * pnpm migrate:apply-showcase
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
    label: "CREATE TABLE storefront_case",
    query: `CREATE TABLE IF NOT EXISTS "storefront_case" (
      "id" text PRIMARY KEY,
      "title" text NOT NULL,
      "title_en" text,
      "description" text,
      "description_en" text,
      "cover_url" text NOT NULL,
      "before_image_url" text,
      "author_name" text NOT NULL DEFAULT '',
      "product_type_code" text,
      "product_handle" text,
      "likes" integer NOT NULL DEFAULT 0,
      "sort_order" integer NOT NULL DEFAULT 0,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
  {
    label: "CREATE INDEX storefront_case_active_sort_idx",
    query: `CREATE INDEX IF NOT EXISTS "storefront_case_active_sort_idx"
      ON "storefront_case" ("is_active", "sort_order");`,
  },
];

async function main() {
  if (DRY_RUN) {
    console.log("[apply-showcase] --dry-run:只打印 SQL,不连库\n");
    for (const { label, query } of STATEMENTS) {
      console.log(`-- ${label}`);
      console.log(`${query}\n`);
    }
    console.log("[apply-showcase] dry-run 结束 —— 去掉 --dry-run 才会真的执行");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("[apply-showcase] 缺少 DATABASE_URL");
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
   * 回读一次 —— 确认表和索引真的在。
   *
   * **行数必须是 0** —— 脚本不播种(见文件头)。要是这里有行,说明有人手动
   * 往表里塞过东西,那得看一眼是不是想要的。
   */
  const check = await client.query<{
    table_name: string;
    columns: string;
    indexes: string;
    rows: string;
  }>(
    `SELECT
      (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'storefront_case')
        AS table_name,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'storefront_case')
        AS columns,
      (SELECT count(*)::text FROM pg_indexes
        WHERE tablename = 'storefront_case')
        AS indexes,
      (SELECT count(*)::text FROM "storefront_case")
        AS rows;`
  );

  const row = check.rows[0];
  /** 「在」就是 1 */
  const yes = (v: string | undefined) => (v === "1" ? "✓" : "✗");
  /** 数量对上了就是 ✓ */
  const count = (v: string | undefined, expected: number) =>
    Number(v) === expected ? "✓" : `✗(实际 ${v ?? "?"},期望 ${expected})`;

  console.log("");
  console.log("[apply-showcase] 回读:");
  console.log(`  ${yes(row?.table_name)} storefront_case 表在`);
  console.log(`  ${count(row?.columns, 15)} storefront_case 的 15 个列`);
  console.log(`  ${count(row?.indexes, 1)} storefront_case 的 1 个索引`);
  console.log(
    `  现有 ${row?.rows ?? 0} 条案例(脚本不播种 —— 工作室自己在 /admin/showcases 上传)`
  );

  await client.end();
  console.log("\n[apply-showcase] 完成 —— 到 /admin/showcases 上传实拍成品");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
