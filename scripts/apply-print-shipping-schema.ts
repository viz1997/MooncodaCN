#!/usr/bin/env -S npx tsx

/**
 * 应用「打印工单件数 + 配送方式」schema(2026-11-17)
 *
 * - `print_order.quantity` —— 打印件数(整单口径)
 * - `print_order.shipping_option` —— 配送方式(cod / standard / air)
 * - `print_order.shipping_fee_cents` —— 运费(分,按单收)
 * - `print_pricing_config.shipping_cod_cents` / `shipping_standard_cents` /
 *   `shipping_air_cents` —— 三档运费(后台可配)
 *
 * ## 工作室的原话(2026-11-17)
 *
 * > 「配送方式 运费按单收取 顺丰到付…顺丰标快 ¥18…顺丰空运 ¥22」
 * >
 * > 「同一模型打印多件;后处理按件计,不重复收起步价。」
 *
 * ## ⚠️ `shipping_option` **不是** `delivery_tier`
 *
 * 两个**正交的**轴,两列分开:
 *
 * | 列 | 管什么 | 怎么收钱 |
 * |---|---|---|
 * | `delivery_tier` | 多快发货(96 / 72 / 48 小时) | 按小计的**比例**加钱 |
 * | `shipping_option` | 怎么寄(到付 / 标快 / 空运) | **按单收**绝对金额 |
 *
 * 工作室要「48 小时 + 顺丰空运」完全合法 ⇒ 两列都要有值。
 *
 * ## ⚠️ `shipping_fee_cents` **不是** `delivery_fee_cents`
 *
 * 一个是寄件费、一个是加急费。两个不同的概念、两个不同的钱,所以两列分开
 * 存 —— 退款 / 对账时要能分清退的是哪一笔。
 *
 * ## 为什么运费**不乘件数**
 *
 * 工作室原话「运费按单收取」—— 印三件还是一个包裹、运费还是一份。
 * (克重费 / 后处理费 / 支撑加价才是按件乘的。)
 *
 * ## 这个脚本做什么、不做什么
 *
 * **做**:加列 + 回读验证。
 *
 * **不做**:
 *
 * - **不播种任何一行** —— `print_pricing_config` 没有配置行时,代码走
 *   `PRINT_SHIPPING_*_CENTS` 环境变量 / 内置默认值那一档(顺丰到付 ¥0 /
 *   标快 ¥18 / 空运 ¥22)。跑完迁移线上行为一个字节都不变。
 * - **不改任何历史工单** —— 老单 `quantity = 1`、`shipping_option = 'cod'`、
 *   `shipping_fee_cents = 0` ⇒ **老单的应付金额一个字节都不变**。
 * - **不加 CHECK 约束** —— 跟仓库里其它 `text(..., { enum })` 列一致
 *   (Drizzle 的 `text({enum})` 落到 PG 上就是普通 text 列)。
 *
 * ## 幂等
 *
 * `ALTER TABLE … ADD COLUMN IF NOT EXISTS` —— 跑几遍都安全。
 *
 * ## 为什么手写而不是 `db:generate`
 *
 * 这个仓库的迁移都是手写幂等脚本(见 `scripts/apply-*.ts`),跑几遍都安全。
 *
 * ## 用法
 *
 * ```bash
 * # 只打印 SQL,不连库
 * pnpm tsx scripts/apply-print-shipping-schema.ts --dry-run
 *
 * # 真跑
 * pnpm tsx scripts/apply-print-shipping-schema.ts
 * pnpm migrate:apply-print-shipping
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
    label: "ALTER TABLE print_order ADD COLUMN quantity",
    query: `ALTER TABLE "print_order"
      ADD COLUMN IF NOT EXISTS "quantity" integer NOT NULL DEFAULT 1;`,
  },
  {
    label: "ALTER TABLE print_order ADD COLUMN shipping_option",
    query: `ALTER TABLE "print_order"
      ADD COLUMN IF NOT EXISTS "shipping_option" text NOT NULL DEFAULT 'cod';`,
  },
  {
    label: "ALTER TABLE print_order ADD COLUMN shipping_fee_cents",
    query: `ALTER TABLE "print_order"
      ADD COLUMN IF NOT EXISTS "shipping_fee_cents" integer NOT NULL DEFAULT 0;`,
  },
  {
    label: "ALTER TABLE print_pricing_config ADD COLUMN shipping_cod_cents",
    query: `ALTER TABLE "print_pricing_config"
      ADD COLUMN IF NOT EXISTS "shipping_cod_cents" integer NOT NULL DEFAULT 0;`,
  },
  {
    label:
      "ALTER TABLE print_pricing_config ADD COLUMN shipping_standard_cents",
    query: `ALTER TABLE "print_pricing_config"
      ADD COLUMN IF NOT EXISTS "shipping_standard_cents" integer NOT NULL DEFAULT 1800;`,
  },
  {
    label: "ALTER TABLE print_pricing_config ADD COLUMN shipping_air_cents",
    query: `ALTER TABLE "print_pricing_config"
      ADD COLUMN IF NOT EXISTS "shipping_air_cents" integer NOT NULL DEFAULT 2200;`,
  },
];

async function main() {
  if (DRY_RUN) {
    console.log("[apply-print-shipping] --dry-run:只打印 SQL,不连库\n");
    for (const { label, query } of STATEMENTS) {
      console.log(`-- ${label}`);
      console.log(`${query}\n`);
    }
    console.log(
      "[apply-print-shipping] dry-run 结束 —— 去掉 --dry-run 才会真的执行"
    );
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("[apply-print-shipping] 缺少 DATABASE_URL");
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
   * 回读一次 —— 确认列真的在,顺便确认**老单没被动过**。
   */
  const check = await client.query<{
    order_columns: string;
    config_columns: string;
    total_orders: string;
    multi_qty_orders: string;
    shipping_fee_sum: string;
    config_rows: string;
  }>(
    `SELECT
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'print_order'
          AND column_name IN ('quantity', 'shipping_option', 'shipping_fee_cents'))
        AS order_columns,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'print_pricing_config'
          AND column_name IN ('shipping_cod_cents', 'shipping_standard_cents',
                              'shipping_air_cents'))
        AS config_columns,
      (SELECT count(*)::text FROM "print_order")
        AS total_orders,
      (SELECT count(*)::text FROM "print_order" WHERE "quantity" > 1)
        AS multi_qty_orders,
      (SELECT coalesce(sum("shipping_fee_cents"), 0)::text FROM "print_order")
        AS shipping_fee_sum,
      (SELECT count(*)::text FROM "print_pricing_config")
        AS config_rows;`
  );

  const row = check.rows[0];
  /** 「在」就是 1 */
  const yes = (v: string | undefined) => (v === "1" ? "✓" : "✗");

  console.log("");
  console.log("[apply-print-shipping] 回读:");
  console.log(
    `  ${yes(row?.order_columns)} print_order 三列在(件数 / 配送方式 / 运费)`
  );
  console.log(
    `  ${yes(row?.config_columns)} print_pricing_config 三列在(三档运费)`
  );
  console.log(
    `  现有 ${row?.total_orders ?? 0} 张工单,其中 ${row?.multi_qty_orders ?? 0} 张是多件单(老单一律 1 件)`
  );
  console.log(
    `  全部工单的运费合计 ${row?.shipping_fee_sum ?? 0} 分(老单一律 0 —— 应付金额没变)`
  );
  console.log(
    `  print_pricing_config ${row?.config_rows ?? 0} 行(脚本**不播种** —— 没这一行就走环境变量 / 默认值)`
  );

  await client.end();
  console.log(
    "\n[apply-print-shipping] 完成 —— 现在能按件数印多件、按三档配送方式收运费"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
