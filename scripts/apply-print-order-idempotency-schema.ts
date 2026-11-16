#!/usr/bin/env -S npx tsx

/**
 * 应用「打印工单建单幂等」schema(2026-11-16)
 *
 * - `print_order.idempotency_key` —— 建单幂等键(可空)
 * - `print_order_idempotency_key_uniq_idx` —— 唯一索引(复合:`user_id` + 键)
 *
 * ## 要防的是哪一件事
 *
 * 「提交打印订单」这个按钮**没有**服务端幂等 —— 同一份请求发两次,就会建出
 * **两张工单**,两张工单各有各的付款入口 ⇒ **用户可能付两次钱**。
 *
 * 客户端那道软闸(提交中禁用按钮 + 限流 3 次/分钟)**挡不住**:网络卡了重试 /
 * 手抖双击 / 提交完没看到跳转又点一次。
 *
 * ⇒ 服务端按 **(用户, 幂等键)** 认单。键 = 「下单意图」的**内容哈希**
 * (见 `src/features/print-quote/lib/idempotency.ts`)。
 *
 * ## 为什么这一列**可空**
 *
 * - **老单没有这一列** —— 迁移跑之前建的单,不可能有键
 * - **Postgres 的唯一索引里 NULL 互不相同** ⇒ 老单(`idempotency_key IS NULL`)
 *   **不会**跟任何新单冲突,也不需要回填
 *
 * ⇒ 回填是**多余的**,而且回填还会把「不同的老单」算成同一把键(它们的意图
 * 本来就不同)⇒ **不播种任何一行**。
 *
 * ## 为什么索引是**复合**的
 *
 * 键是**内容哈希** ⇒ **两个不同的用户**算出同一份意图会得到**同一把键**。
 * 只索引键本身 ⇒ A 用户的单会把 B 用户同内容的单顶掉(用户 B 直接建不出单)。
 *
 * ⇒ `(user_id, idempotency_key)`。
 *
 * ## 这个脚本做什么、不做什么
 *
 * **做**:加一列 + 建一个唯一索引。
 *
 * **不做**:
 *
 * - **不播种任何一行** —— 跑完线上行为一个字节都不变(没有键的老单照旧能查)
 * - **不改任何历史工单** —— 一行都不动
 * - **不改金额** —— 幂等键跟钱无关
 *
 * ## 幂等
 *
 * `ALTER TABLE … ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`
 * —— 跑几遍都安全。
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
 * pnpm tsx scripts/apply-print-order-idempotency-schema.ts --dry-run
 *
 * # 真跑
 * pnpm tsx scripts/apply-print-order-idempotency-schema.ts
 * pnpm migrate:apply-print-order-idempotency
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
    label: "ALTER TABLE print_order ADD COLUMN idempotency_key",
    query: `ALTER TABLE "print_order"
      ADD COLUMN IF NOT EXISTS "idempotency_key" text;`,
  },
  {
    label: "CREATE UNIQUE INDEX print_order_idempotency_key_uniq_idx",
    query: `CREATE UNIQUE INDEX IF NOT EXISTS "print_order_idempotency_key_uniq_idx"
      ON "print_order" ("user_id", "idempotency_key");`,
  },
];

async function main() {
  if (DRY_RUN) {
    console.log(
      "[apply-print-order-idempotency] --dry-run:只打印 SQL,不连库\n"
    );
    for (const { label, query } of STATEMENTS) {
      console.log(`-- ${label}`);
      console.log(`${query}\n`);
    }
    console.log(
      "[apply-print-order-idempotency] dry-run 结束 —— 去掉 --dry-run 才会真的执行"
    );
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("[apply-print-order-idempotency] 缺少 DATABASE_URL");
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
   * 回读一次 —— 确认列和索引真的在。
   *
   * ⚠️ **老单一个字节都不动** —— 老单的 `idempotency_key` 是 NULL。
   */
  const check = await client.query<{
    column_present: string;
    index_present: string;
    total_orders: string;
    orders_with_key: string;
  }>(
    `SELECT
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'print_order' AND column_name = 'idempotency_key')
        AS column_present,
      (SELECT count(*)::text FROM pg_indexes
        WHERE tablename = 'print_order'
          AND indexname = 'print_order_idempotency_key_uniq_idx')
        AS index_present,
      (SELECT count(*)::text FROM "print_order")
        AS total_orders,
      (SELECT count(*)::text FROM "print_order"
        WHERE "idempotency_key" IS NOT NULL)
        AS orders_with_key;`
  );

  const row = check.rows[0];
  /** 「在」就是 1 */
  const yes = (v: string | undefined) => (v === "1" ? "✓" : "✗");

  console.log("");
  console.log("[apply-print-order-idempotency] 回读:");
  console.log(`  ${yes(row?.column_present)} idempotency_key 列在`);
  console.log(
    `  ${yes(row?.index_present)} 唯一索引在(user_id + idempotency_key)`
  );
  console.log(
    `  现有 ${row?.total_orders ?? 0} 张工单,其中 ${row?.orders_with_key ?? 0} 张带幂等键(老单不带 —— 脚本不回填)`
  );

  await client.end();
  console.log(
    "\n[apply-print-order-idempotency] 完成 —— 重复提交现在只会建出一张工单"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
