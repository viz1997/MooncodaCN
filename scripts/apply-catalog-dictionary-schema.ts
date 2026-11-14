#!/usr/bin/env -S npx tsx

/**
 * 应用「商品目录字典」schema(2026-11-14)
 *
 * - `product_size` —— 尺寸字典(**显式加价**,不再靠下标算)
 * - `product_accessory` —— 配件字典(取代代码常量 `ACCESSORY_META`)
 * - `product_accessory_option` —— 「哪个型号能配哪些配件」
 * - `product_accessory_variant.applies_to_sizes_cm` —— 新增一列
 * - `variant_code` **全局唯一索引**
 *
 * ## 为什么需要这三张表
 *
 * 尺寸清单、配件清单、配件归属、配件变体的「适用尺寸」原先全在**代码常量**
 * 里(`PRODUCT_TYPES` / `ACCESSORY_META` / `PRODUCT_ACCESSORY_VARIANTS`)
 * ⇒ 工作室在后台**改不了**、也**加不了新 SKU** ⇒ 「为什么商品 sku 无法设置
 * 以及价格」。
 *
 * ## 尺寸加价为什么必须**显式存**
 *
 * 今天的尺寸加价是**位置算**出来的:`idx * 500`(第一档 +0、第二档 +¥5 …),
 * 而且散在**四个地方**各算一遍:
 * - `src/features/storefront/lib/mock-catalog.ts`(商城显示)
 * - `src/features/image-gen/lib/product-variant-sku.ts` ×2(生成 / 重算)
 * - `src/features/image-gen/lib/product-capability.ts`(对外商品接口)
 *
 * ⇒ **在尺寸数组中间插一档,后面每一档的价会静默全变**。
 * ⇒ DB 里存**显式的 `price_delta_cents`**,四个地方统一读它。
 *
 * ## 这个脚本做什么、不做什么
 *
 * **做**:建表 + 建索引 + 加一列。
 *
 * **不做**:
 *
 * - **不播种任何一行** —— 跑完线上行为一个字节都不变(字典读不出来 ⇒ 整份
 *   退回代码常量兜底 ⇒ 尺寸加价还是 `idx * 500`,配件加价还是代码常量)。
 *   播种是**另一个脚本**(`scripts/seed-catalog-dictionary.ts`),工作室自己挑
 *   时间跑 —— 跑不跑都不影响线上行为。
 * - **不改任何已有 SKU 的价** —— `product_variant.price_cents` 一个字节都不
 *   动。只有工作室在后台明确改了加价,才会重算。
 *
 * ## ⚠️ `variant_code` 全局唯一索引 —— 有重复就**中止**,不硬加
 *
 * 商城是拿 `acc_${variantCode}` 当键的(`price-source.ts` / `mock-catalog.ts`)
 * ⇒ **同一个 `variantCode` 出现在两个型号下,加价就变成「取到哪个算哪个」**
 * —— 而且**不报错**,只在对账时炸。
 *
 * ⇒ 加索引之前先查一遍有没有重复。**有重复就打印出来并中止** ——
 * 硬加索引会失败(`CREATE UNIQUE INDEX` 报 duplicate key),把「迁移脚本失败」
 * 变成一句人话比让它崩在 PG 报错里强。
 *
 * ## 幂等
 *
 * `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` +
 * `ALTER TABLE … ADD COLUMN IF NOT EXISTS` —— 跑几遍都安全。
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
 * pnpm tsx scripts/apply-catalog-dictionary-schema.ts --dry-run
 *
 * # 真跑
 * pnpm tsx scripts/apply-catalog-dictionary-schema.ts
 * pnpm migrate:apply-catalog-dictionary
 *
 * # 之后(工作室自己挑时间)把代码常量播种进 DB
 * pnpm seed:catalog-dictionary
 * ```
 *
 * **不代跑** —— 工作室的库由工作室自己执行。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";
import { Client } from "pg";

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
    label: "CREATE TABLE product_size",
    query: `CREATE TABLE IF NOT EXISTS "product_size" (
      "id" text PRIMARY KEY,
      "product_type_code" text NOT NULL,
      "size_code" text NOT NULL,
      "price_delta_cents" integer NOT NULL DEFAULT 0,
      "sort_order" integer NOT NULL DEFAULT 0,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
  {
    label: "CREATE TABLE product_accessory",
    query: `CREATE TABLE IF NOT EXISTS "product_accessory" (
      "code" text PRIMARY KEY,
      "name" text NOT NULL,
      "name_en" text NOT NULL DEFAULT '',
      "category" text NOT NULL DEFAULT 'material',
      "sort_order" integer NOT NULL DEFAULT 0,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
  {
    label: "CREATE TABLE product_accessory_option",
    query: `CREATE TABLE IF NOT EXISTS "product_accessory_option" (
      "id" text PRIMARY KEY,
      "product_type_code" text NOT NULL,
      "accessory_code" text NOT NULL,
      "sort_order" integer NOT NULL DEFAULT 0,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
  {
    // 保险 —— 这张表以前是 `pnpm db:push` 建的(没有手写迁移脚本)。
    // 工作室的库里应该已经在,但 `IF NOT EXISTS` 让这个脚本**独立可跑**。
    label: "CREATE TABLE product_accessory_variant",
    query: `CREATE TABLE IF NOT EXISTS "product_accessory_variant" (
      "id" text PRIMARY KEY,
      "product_type_code" text NOT NULL,
      "accessory_code" text NOT NULL,
      "variant_code" text NOT NULL,
      "name" text NOT NULL,
      "name_en" text NOT NULL,
      "swatch" text,
      "price_delta_cents" integer NOT NULL DEFAULT 0,
      "applies_to_sizes_cm" text NOT NULL DEFAULT '[]',
      "sort_order" integer NOT NULL DEFAULT 0,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
  {
    label: "ADD COLUMN product_accessory_variant.applies_to_sizes_cm",
    query: `ALTER TABLE "product_accessory_variant"
      ADD COLUMN IF NOT EXISTS "applies_to_sizes_cm" text NOT NULL DEFAULT '[]';`,
  },
  {
    label: "INDEX product_size_uniq_idx",
    query: `CREATE UNIQUE INDEX IF NOT EXISTS "product_size_uniq_idx"
      ON "product_size" ("product_type_code", "size_code");`,
  },
  {
    label: "INDEX product_size_lookup_idx",
    query: `CREATE INDEX IF NOT EXISTS "product_size_lookup_idx"
      ON "product_size" ("product_type_code", "is_active", "sort_order");`,
  },
  {
    label: "INDEX product_accessory_lookup_idx",
    query: `CREATE INDEX IF NOT EXISTS "product_accessory_lookup_idx"
      ON "product_accessory" ("is_active", "sort_order");`,
  },
  {
    label: "INDEX product_accessory_option_uniq_idx",
    query: `CREATE UNIQUE INDEX IF NOT EXISTS "product_accessory_option_uniq_idx"
      ON "product_accessory_option" ("product_type_code", "accessory_code");`,
  },
  {
    label: "INDEX product_accessory_option_lookup_idx",
    query: `CREATE INDEX IF NOT EXISTS "product_accessory_option_lookup_idx"
      ON "product_accessory_option" ("product_type_code", "is_active", "sort_order");`,
  },
  {
    label: "INDEX pav_uniq_idx",
    query: `CREATE UNIQUE INDEX IF NOT EXISTS "pav_uniq_idx"
      ON "product_accessory_variant" ("product_type_code", "accessory_code", "variant_code");`,
  },
  {
    label: "INDEX pav_lookup_idx",
    query: `CREATE INDEX IF NOT EXISTS "pav_lookup_idx"
      ON "product_accessory_variant" ("product_type_code", "accessory_code", "is_active");`,
  },
  {
    // ⚠️ 这一条**不放进 STATEMENTS** —— 它要先查有没有重复。
    // 见下面「加索引之前先查重复」那一步。
    label: "INDEX pav_variant_code_uniq_idx",
    query: `CREATE UNIQUE INDEX IF NOT EXISTS "pav_variant_code_uniq_idx"
      ON "product_accessory_variant" ("variant_code");`,
  },
];

/** 全局唯一索引的名字 —— 单独拎出来给「重复检查」那一步用 */
const VARIANT_CODE_UNIQ_INDEX = "pav_variant_code_uniq_idx";

async function main(): Promise<void> {
  console.log(
    "[apply-catalog-dictionary] 商品目录字典 schema(2026-11-14)\n" +
      "  建表:product_size / product_accessory / product_accessory_option\n" +
      "  加列:product_accessory_variant.applies_to_sizes_cm\n" +
      "  索引:含 variant_code **全局唯一索引**\n" +
      "  ⚠️ 不播种任何一行 —— 播种是另一个脚本(seed:catalog-dictionary)\n"
  );

  if (DRY_RUN) {
    console.log("[apply-catalog-dictionary] --dry-run:只打印 SQL,不连库\n");
    for (const statement of STATEMENTS) {
      console.log(`-- ${statement.label}`);
      console.log(statement.query);
      console.log("");
    }
    console.log(
      "-- ⚠️ 「variant_code 有没有重复」这一项需要连库才能查 —— dry-run 查不了。\n" +
        "--    真跑的时候,如果有重复,脚本会**打印出来并中止**(不硬加索引)。"
    );
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "[apply-catalog-dictionary] DATABASE_URL 没配 —— 先配好再跑(或者看 .env.local)。"
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode")
      ? undefined
      : { rejectUnauthorized: false },
  });

  await client.connect();

  /* ------------------------------------------------- 先查 variant_code 重复 -- */

  /**
   * 加全局唯一索引**之前**先查重复
   *
   * ⇒ 有重复:**打印出来 + 中止**(不硬加索引)。
   *
   * 为什么不能「查到重复就跳过」—— 那等于默默放过一个会让加价算错的脏数据,
   * 而且工作室永远不知道。**中止 + 说清楚哪几行重复**才是能修的状态。
   */
  const dupCheck = await client.query<{
    variant_code: string;
    rows_count: string;
    sample: string;
  }>(
    `SELECT "variant_code",
            count(*)::text AS "rows_count",
            string_agg(
              "product_type_code" || '/' || "accessory_code" || '/' || "variant_code",
              ', '
            ) AS "sample"
       FROM "product_accessory_variant"
      GROUP BY "variant_code"
     HAVING count(*) > 1
      ORDER BY "variant_code"`
  );

  if (dupCheck.rows.length > 0) {
    console.error(
      "\n[apply-catalog-dictionary] ✗ `variant_code` 有重复 —— **中止**\n"
    );
    for (const row of dupCheck.rows) {
      console.error(`  ${row.variant_code}  (${row.rows_count} 行)`);
      console.error(`    ${row.sample}`);
    }
    console.error(
      "\n  商城是拿 `acc_<variantCode>` 当键的 —— 同一个 variantCode 出现在两个\n" +
        "  型号下,加价就变成「取到哪个算哪个」,而且**不报错**。\n" +
        "  ⇒ 先把这些行改掉(改名,或者停用其中一行),再重跑这个脚本。\n" +
        "  ⇒ 全局唯一索引**没有建**(其它表和列已经建好了,重跑是安全的)。\n"
    );
    await client.end();
    process.exit(1);
  }

  console.log("✓ variant_code 没有重复 —— 可以加全局唯一索引\n");

  /* -------------------------------------------------------------- 建表建索引 */

  for (const statement of STATEMENTS) {
    try {
      await client.query(statement.query);
      console.log(`✓ ${statement.label}`);
    } catch (error) {
      console.error(`✗ ${statement.label}`);
      console.error(error instanceof Error ? error.message : error);
      await client.end();
      process.exit(1);
    }
  }

  /* ------------------------------------------------------------ 回读验证 --- */

  /**
   * 回读一次 —— 确认表 / 列 / 索引真的在。
   *
   * **行数必须是 0** —— 脚本不播种(见文件头)。要是这里有行,说明有人手动
   * 往表里塞过东西,那得看一眼是不是想要的。
   */
  const check = await client.query<{
    product_size_table: string;
    product_accessory_table: string;
    product_accessory_option_table: string;
    applies_to_sizes_cm_column: string;
    pav_variant_code_uniq_idx: string;
    product_size_rows: string;
    product_accessory_rows: string;
    product_accessory_option_rows: string;
    pav_rows: string;
  }>(
    `SELECT
      (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'product_size')
        AS product_size_table,
      (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'product_accessory')
        AS product_accessory_table,
      (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'product_accessory_option')
        AS product_accessory_option_table,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'product_accessory_variant'
          AND column_name = 'applies_to_sizes_cm')
        AS applies_to_sizes_cm_column,
      (SELECT count(*)::text FROM pg_indexes
        WHERE tablename = 'product_accessory_variant'
          AND indexname = '${VARIANT_CODE_UNIQ_INDEX}')
        AS pav_variant_code_uniq_idx,
      (SELECT count(*)::text FROM "product_size")
        AS product_size_rows,
      (SELECT count(*)::text FROM "product_accessory")
        AS product_accessory_rows,
      (SELECT count(*)::text FROM "product_accessory_option")
        AS product_accessory_option_rows,
      (SELECT count(*)::text FROM "product_accessory_variant")
        AS pav_rows;`
  );

  const row = check.rows[0];
  /** 「在」就是 1 */
  const yes = (v: string | undefined) => (v === "1" ? "✓" : "✗");
  /** 数量对上了就是 ✓ */
  const count = (v: string | undefined, expected: number) =>
    Number(v) === expected ? "✓" : `✗(实际 ${v ?? "?"},期望 ${expected})`;

  console.log("");
  console.log("[apply-catalog-dictionary] 回读:");
  console.log(`  ${yes(row?.product_size_table)} product_size 表在`);
  console.log(`  ${yes(row?.product_accessory_table)} product_accessory 表在`);
  console.log(
    `  ${yes(row?.product_accessory_option_table)} product_accessory_option 表在`
  );
  console.log(
    `  ${yes(row?.applies_to_sizes_cm_column)} product_accessory_variant.applies_to_sizes_cm 列在`
  );
  console.log(
    `  ${yes(row?.pav_variant_code_uniq_idx)} ${VARIANT_CODE_UNIQ_INDEX} 唯一索引在`
  );
  console.log(
    `  ${count(row?.product_size_rows, 0)} product_size 行 / ` +
      `${count(row?.product_accessory_rows, 0)} product_accessory 行 / ` +
      `${count(row?.product_accessory_option_rows, 0)} product_accessory_option 行` +
      "(脚本不播种)"
  );
  console.log(
    `  现有 ${row?.pav_rows ?? 0} 条配件变体(**已有 SKU 的价一个字节都没动**)`
  );

  await client.end();
  console.log(
    "\n[apply-catalog-dictionary] 完成 —— 接着跑 `pnpm seed:catalog-dictionary`\n" +
      "  把代码常量播种进 DB(那一步也是可选的:不播种的话行为跟今天一模一样)"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
