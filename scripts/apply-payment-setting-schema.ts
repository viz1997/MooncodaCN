#!/usr/bin/env -S npx tsx

/**
 * 应用「支付设置」schema(2026-11-13)
 *
 * - `payment_setting` —— 键值对式的支付设置(`key` / `value` / `updated_at`)
 *
 * ## 为什么需要这张表
 *
 * 工作室 2026-11-13 的要求:**「支付宝、微信支付先用沙盒测试验证」** + 补一句
 * **「可以后台配置」**。
 *
 * 商户号 / 应用还在走开通流程 ⇒ 正式环境一笔真单都下不了 ⇒ 得先在两个平台
 * 自己的**沙箱**里把整条链路跑通。而沙箱的**开关、端点、凭据**都要能在后台
 * 改 —— 跟 2026-11-11 把海外独立站地址从 `NEXT_PUBLIC_*` 搬进 `site_setting`
 * 表是同一个理由(`NEXT_PUBLIC_*` 是构建期内联的,改一次要重新部署,工作室
 * 改不动)。
 *
 * ## 这个脚本做什么、不做什么
 *
 * **做**:建表。
 *
 * **不做**:
 *
 * - **不写任何一行配置** —— 尤其**不把任何环境变量搬进表里**,也**不预置
 *   「沙箱开关 = 开」**。搬进去等于把「还在走正式通道」这个状态给盖掉,
 *   线上行为会静默变掉(有人会以为部署完就自动跑沙箱了 —— 而沙箱是**收不到
 *   真钱**的)。
 * - **不改任何别的表** —— 这一张表跟订单 / 商品 / 定价都没有关系。
 * - **不碰任何一行历史订单**。
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
 * pnpm tsx scripts/apply-payment-setting-schema.ts --dry-run
 *
 * # 真跑
 * pnpm tsx scripts/apply-payment-setting-schema.ts
 * pnpm migrate:apply-payment-setting
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
    label: "CREATE TABLE payment_setting",
    query: `CREATE TABLE IF NOT EXISTS "payment_setting" (
      "key" text PRIMARY KEY,
      "value" text NOT NULL,
      "updated_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
];

async function main() {
  if (DRY_RUN) {
    console.log("[apply-payment-setting] --dry-run:只打印 SQL,不连库\n");
    for (const { label, query } of STATEMENTS) {
      console.log(`-- ${label}`);
      console.log(`${query}\n`);
    }
    console.log(
      "[apply-payment-setting] dry-run 结束 —— 去掉 --dry-run 才会真的执行"
    );
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("[apply-payment-setting] 缺少 DATABASE_URL");
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
   * 往表里塞过东西(或者这个表以前就有),那得看一眼是不是想要的。
   */
  const check = await client.query<{
    table_exists: string;
    row_count: string;
    has_value_column: string;
    has_updated_at_column: string;
  }>(
    `SELECT
      (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'payment_setting')
        AS table_exists,
      (SELECT count(*)::text FROM "payment_setting")
        AS row_count,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'payment_setting' AND column_name = 'value')
        AS has_value_column,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'payment_setting' AND column_name = 'updated_at')
        AS has_updated_at_column;`
  );

  const row = check.rows[0];
  const yes = (v: string | undefined) => (v === "1" ? "✓" : "✗");

  console.log("");
  console.log("[apply-payment-setting] 回读:");
  console.log(`  ${yes(row?.table_exists)} payment_setting 表在`);
  console.log(`  ${yes(row?.has_value_column)} payment_setting.value`);
  console.log(
    `  ${yes(row?.has_updated_at_column)} payment_setting.updated_at`
  );
  console.log(
    `  现有 ${row?.row_count ?? 0} 行(脚本不播种 —— 工作室自己在后台填)`
  );

  await client.end();
  console.log(
    "\n[apply-payment-setting] 完成 —— 到 /admin/payment-settings 填沙箱凭据、拨开关"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
