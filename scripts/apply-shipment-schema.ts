#!/usr/bin/env -S npx tsx

/**
 * 应用「物流」schema(2026-11-13)
 *
 * - `shipment` —— 物流行(快递公司 / 运单号 / 物流状态)
 * - `shipment_event` —— 物流时间线(每次状态变更留一条)
 *
 * ## 为什么需要这两张表
 *
 * 工作室的诉求就一句:**「东西寄出去了,买家知道」**。全库此前**零运单号列**
 * —— 商城订单和打印工单都落了收货地址快照,但买家侧一处都没渲染过,后台也
 * 没有任何地方能填「顺丰 SF1234」。
 *
 * 物流**独立成表**而不是在订单表上堆 `shipping_company` / `tracking_number`:
 *
 * - 一个订单可以拆多个包裹(补发 / 分开发)—— 订单表上表达不了
 * - 物流状态跟订单状态是**正交的两个维度**(退过款的单照样发货、没付钱的单
 *   已经寄出)—— 跟仓库已有的 `status` / `payment_status` 分列是同一个道理
 *
 * ## 这个脚本做什么、不做什么
 *
 * **做**:建表 + 建索引。
 *
 * **不做**:
 *
 * - **不播种任何一行** —— 跑完线上行为一个字节都不变(没有物流单的时候,
 *   发货台就是空列表,买家侧就是「还没发货」)。
 * - **不改任何订单表** —— 一行历史订单都不碰。
 * - **不加外键到订单表** —— `shipment.order_id` 可能指 `storefront_order.id`
 *   也可能指 `print_order.id`,加外键只能选一张表,另一种就挂不上。
 *   (时间线那张表指回 `shipment` 是可以的,所以它有外键。)
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
 * pnpm tsx scripts/apply-shipment-schema.ts --dry-run
 *
 * # 真跑
 * pnpm tsx scripts/apply-shipment-schema.ts
 * pnpm migrate:apply-shipment
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
    label: "CREATE TABLE shipment",
    query: `CREATE TABLE IF NOT EXISTS "shipment" (
      "id" text PRIMARY KEY,
      "order_kind" text NOT NULL,
      "order_id" text NOT NULL,
      "package_index" integer NOT NULL DEFAULT 1,
      "status" text NOT NULL,
      "shipping_company" text NOT NULL,
      "shipping_company_label" text,
      "tracking_number" text NOT NULL,
      "note" text,
      "shipped_at" timestamp NOT NULL DEFAULT now(),
      "delivered_at" timestamp,
      "returned_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
  {
    label: "CREATE TABLE shipment_event",
    query: `CREATE TABLE IF NOT EXISTS "shipment_event" (
      "id" text PRIMARY KEY,
      "shipment_id" text NOT NULL REFERENCES "shipment" ("id") ON DELETE CASCADE,
      "from_status" text,
      "to_status" text NOT NULL,
      "actor" text NOT NULL,
      "note" text,
      "created_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
  {
    label: "CREATE INDEX shipment_order_idx",
    query: `CREATE INDEX IF NOT EXISTS "shipment_order_idx"
      ON "shipment" ("order_kind", "order_id");`,
  },
  {
    label: "CREATE UNIQUE INDEX shipment_order_package_uq",
    query: `CREATE UNIQUE INDEX IF NOT EXISTS "shipment_order_package_uq"
      ON "shipment" ("order_kind", "order_id", "package_index");`,
  },
  {
    label: "CREATE INDEX shipment_status_idx",
    query: `CREATE INDEX IF NOT EXISTS "shipment_status_idx"
      ON "shipment" ("status");`,
  },
  {
    label: "CREATE INDEX shipment_event_shipment_created_idx",
    query: `CREATE INDEX IF NOT EXISTS "shipment_event_shipment_created_idx"
      ON "shipment_event" ("shipment_id", "created_at");`,
  },
];

async function main() {
  if (DRY_RUN) {
    console.log("[apply-shipment] --dry-run:只打印 SQL,不连库\n");
    for (const { label, query } of STATEMENTS) {
      console.log(`-- ${label}`);
      console.log(`${query}\n`);
    }
    console.log("[apply-shipment] dry-run 结束 —— 去掉 --dry-run 才会真的执行");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("[apply-shipment] 缺少 DATABASE_URL");
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
    shipment_table: string;
    shipment_event_table: string;
    shipment_columns: string;
    shipment_event_columns: string;
    shipment_indexes: string;
    shipment_event_indexes: string;
    shipment_rows: string;
    shipment_event_rows: string;
  }>(
    `SELECT
      (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'shipment')
        AS shipment_table,
      (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'shipment_event')
        AS shipment_event_table,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'shipment')
        AS shipment_columns,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'shipment_event')
        AS shipment_event_columns,
      (SELECT count(*)::text FROM pg_indexes
        WHERE tablename = 'shipment')
        AS shipment_indexes,
      (SELECT count(*)::text FROM pg_indexes
        WHERE tablename = 'shipment_event')
        AS shipment_event_indexes,
      (SELECT count(*)::text FROM "shipment")
        AS shipment_rows,
      (SELECT count(*)::text FROM "shipment_event")
        AS shipment_event_rows;`
  );

  const row = check.rows[0];
  /** 「在」就是 1 */
  const yes = (v: string | undefined) => (v === "1" ? "✓" : "✗");
  /** 数量对上了就是 ✓ */
  const count = (v: string | undefined, expected: number) =>
    Number(v) === expected ? "✓" : `✗(实际 ${v ?? "?"},期望 ${expected})`;

  console.log("");
  console.log("[apply-shipment] 回读:");
  console.log(`  ${yes(row?.shipment_table)} shipment 表在`);
  console.log(`  ${yes(row?.shipment_event_table)} shipment_event 表在`);
  console.log(`  ${count(row?.shipment_columns, 14)} shipment 的 14 个列`);
  console.log(
    `  ${count(row?.shipment_event_columns, 7)} shipment_event 的 7 个列`
  );
  console.log(
    `  ${count(row?.shipment_indexes, 3)} shipment 的 3 个索引(含唯一索引)`
  );
  console.log(
    `  ${count(row?.shipment_event_indexes, 1)} shipment_event 的 1 个索引`
  );
  console.log(
    `  现有 ${row?.shipment_rows ?? 0} 条物流 / ${row?.shipment_event_rows ?? 0} 条事件(脚本不播种 —— 工作室自己在后台发货)`
  );

  await client.end();
  console.log("\n[apply-shipment] 完成 —— 到 /admin/shipments 发货");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
