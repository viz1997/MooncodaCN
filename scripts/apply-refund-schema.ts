#!/usr/bin/env -S npx tsx

/**
 * 应用「退款」schema(2026-11-14)
 *
 * - `refund_request` —— 退款申请行(买家申请 → 工作室处理 → 平台退钱)
 * - `refund_request_event` —— 退款时间线(每次状态变更留一条)
 *
 * ## 为什么需要这两张表
 *
 * 工作室的反馈就一句:**「用户反馈订单支付后无法申请退款」**。
 *
 * 这个功能**从来没有存在过** —— 买家侧没有入口、后端没有退款能力、而且
 * `payment_status = "refunded"` 只有 Shopify / Sellbase 两个 webhook 会写,
 * 那两条路 2026-11-05 就下线了。⇒ **就算工作室在商家后台手工退了钱,系统
 * 也记不下来。**
 *
 * ## 这个脚本做什么、不做什么
 *
 * **做**:建表 + 建索引。
 *
 * **不做**:
 *
 * - **不播种任何一行** —— 跑完线上行为一个字节都不变(没有申请单的时候,
 *   后台退款管理就是空列表,买家侧就是「没有可申请退款的订单」)。
 * - **不改任何订单表** —— 一行历史订单都不碰,**老订单的金额一个都不变**。
 * - **不加外键到订单表** —— `refund_request.order_id` 可能指
 *   `storefront_order.id` 也可能指 `print_order.id`,加外键只能选一张表,
 *   另一种就挂不上。(时间线那张表指回 `refund_request` 是可以的,所以它有
 *   外键。)
 *
 * ## 部分唯一索引 —— 一个订单同时只能有一条「待处理」的申请
 *
 * `refund_request_pending_uq` 是 **WHERE `status = 'pending'`** 的部分唯一索引
 * ⇒ 被拒之后买家可以再申请一条,但「点两下提交」不会裂成两条。
 *
 * ⚠️ **它只挡 `pending`,不挡 `approved`** —— `approved` 是钱已经在路上了,
 * 那时候再来一条申请就会**退两次钱**。⇒ 那一道闸在应用层
 * (`refund-store.ts` 的 `createRefundRequest` 自己查「进行中」= `pending`
 * **或** `approved`)。
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
 * pnpm tsx scripts/apply-refund-schema.ts --dry-run
 *
 * # 真跑
 * pnpm tsx scripts/apply-refund-schema.ts
 * pnpm migrate:apply-refund
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
    label: "CREATE TABLE refund_request",
    query: `CREATE TABLE IF NOT EXISTS "refund_request" (
      "id" text PRIMARY KEY,
      "order_kind" text NOT NULL,
      "order_id" text NOT NULL,
      "order_no" text NOT NULL,
      "user_id" text NOT NULL,
      "amount_cents" integer NOT NULL,
      "reason" text NOT NULL,
      "status" text NOT NULL DEFAULT 'pending',
      "refunded_cents" integer,
      "payment_channel" text,
      "provider_refund_id" text,
      "provider_refund_status" text,
      "refund_error" text,
      "note" text,
      "reviewed_by" text,
      "reviewed_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
  {
    label: "CREATE TABLE refund_request_event",
    query: `CREATE TABLE IF NOT EXISTS "refund_request_event" (
      "id" text PRIMARY KEY,
      "refund_request_id" text NOT NULL REFERENCES "refund_request" ("id") ON DELETE CASCADE,
      "from_status" text,
      "to_status" text NOT NULL,
      "actor" text NOT NULL,
      "note" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
  {
    label: "CREATE INDEX refund_request_order_idx",
    query: `CREATE INDEX IF NOT EXISTS "refund_request_order_idx"
      ON "refund_request" ("order_kind", "order_id");`,
  },
  {
    label: "CREATE UNIQUE INDEX refund_request_pending_uq",
    query: `CREATE UNIQUE INDEX IF NOT EXISTS "refund_request_pending_uq"
      ON "refund_request" ("order_kind", "order_id")
      WHERE "status" = 'pending';`,
  },
  {
    label: "CREATE INDEX refund_request_status_idx",
    query: `CREATE INDEX IF NOT EXISTS "refund_request_status_idx"
      ON "refund_request" ("status");`,
  },
  {
    label: "CREATE INDEX refund_request_event_request_created_idx",
    query: `CREATE INDEX IF NOT EXISTS "refund_request_event_request_created_idx"
      ON "refund_request_event" ("refund_request_id", "created_at");`,
  },
];

async function main() {
  if (DRY_RUN) {
    console.log("[apply-refund] --dry-run:只打印 SQL,不连库\n");
    for (const { label, query } of STATEMENTS) {
      console.log(`-- ${label}`);
      console.log(`${query}\n`);
    }
    console.log("[apply-refund] dry-run 结束 —— 去掉 --dry-run 才会真的执行");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("[apply-refund] 缺少 DATABASE_URL");
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
    refund_request_table: string;
    refund_request_event_table: string;
    refund_request_columns: string;
    refund_request_event_columns: string;
    refund_request_indexes: string;
    refund_request_event_indexes: string;
    refund_request_rows: string;
    refund_request_event_rows: string;
  }>(
    `SELECT
      (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'refund_request')
        AS refund_request_table,
      (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'refund_request_event')
        AS refund_request_event_table,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'refund_request')
        AS refund_request_columns,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'refund_request_event')
        AS refund_request_event_columns,
      (SELECT count(*)::text FROM pg_indexes
        WHERE tablename = 'refund_request')
        AS refund_request_indexes,
      (SELECT count(*)::text FROM pg_indexes
        WHERE tablename = 'refund_request_event')
        AS refund_request_event_indexes,
      (SELECT count(*)::text FROM "refund_request")
        AS refund_request_rows,
      (SELECT count(*)::text FROM "refund_request_event")
        AS refund_request_event_rows;`
  );

  const row = check.rows[0];
  /** 「在」就是 1 */
  const yes = (v: string | undefined) => (v === "1" ? "✓" : "✗");
  /** 数量对上了就是 ✓ */
  const count = (v: string | undefined, expected: number) =>
    Number(v) === expected ? "✓" : `✗(实际 ${v ?? "?"},期望 ${expected})`;

  console.log("");
  console.log("[apply-refund] 回读:");
  console.log(`  ${yes(row?.refund_request_table)} refund_request 表在`);
  console.log(`  ${yes(row?.refund_request_event_table)} refund_request_event 表在`);
  console.log(
    `  ${count(row?.refund_request_columns, 18)} refund_request 的 18 个列`
  );
  console.log(
    `  ${count(row?.refund_request_event_columns, 7)} refund_request_event 的 7 个列`
  );
  console.log(
    `  ${count(row?.refund_request_indexes, 3)} refund_request 的 3 个索引(含部分唯一索引)`
  );
  console.log(
    `  ${count(row?.refund_request_event_indexes, 1)} refund_request_event 的 1 个索引`
  );
  console.log(
    `  现有 ${row?.refund_request_rows ?? 0} 条申请 / ${row?.refund_request_event_rows ?? 0} 条事件(脚本不播种 —— 买家自己在订单页申请)`
  );

  await client.end();
  console.log("\n[apply-refund] 完成 —— 到 /admin/refunds 处理退款申请");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
