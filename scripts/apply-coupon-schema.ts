#!/usr/bin/env -S npx tsx

/**
 * 应用「优惠码(订单级)」schema(2026-11-08)
 *
 * - `coupon`            —— 券本身(规则 / 适用范围 / 有效期 / 限额)
 * - `coupon_redemption` —— 谁在哪个单上用了哪个码,减了多少
 * - `cart`              —— 加 `coupon_code`(码**住在车上**)
 * - `storefront_order`  —— 加 `coupon_code` + `coupon_discount_cents`
 * - `print_order`       —— 加 `coupon_code` + `coupon_discount_cents`
 *
 * ## 这个脚本做什么、不做什么
 *
 * **做**:建表 + 建索引 + 给三张已有的表补列。
 *
 * **不做**:
 *
 * - **不写任何一张券** —— 券是工作室自己发的,脚本替他们发一张就等于
 *   替他们做了一次促销决定。跑完脚本,后台 `/admin/coupons` 是空的,
 *   工作室点「快速开一张」就能建第一张。
 * - **不重算历史订单的金额** —— 老订单的 `total_cents` /
 *   `total_price_cents` **一个字节都不动**。新增的两列默认值是 0,
 *   恒等式 `total = 小计 − 数量折扣 − 优惠 + 运费` 对老单依然成立
 *   (优惠是 0)。
 *
 * ## 幂等
 *
 * 全部用 `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` /
 * `CREATE INDEX IF NOT EXISTS` —— 跑几遍都安全,补列也不会把工作室
 * 改过的数据盖回去。
 *
 * ## 为什么手写而不是 `db:generate`
 *
 * `db:generate` 生成的迁移文件会**顺着整张 schema 的历史**走一遍,跟
 * 库里已有状态对不上的时候要人工调。这个仓库的迁移都是手写幂等脚本,
 * 跑几遍都安全。
 *
 * ## 用法
 *
 * ```bash
 * # 只打印 SQL,不连库
 * pnpm tsx scripts/apply-coupon-schema.ts --dry-run
 *
 * # 真跑
 * pnpm tsx scripts/apply-coupon-schema.ts
 * pnpm migrate:apply-coupon
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
  /* ---------------------------------------------------------------- 券 --- */

  {
    label: "CREATE TABLE coupon",
    query: `CREATE TABLE IF NOT EXISTS "coupon" (
      "id" text PRIMARY KEY,
      "code" text NOT NULL,
      "name" text NOT NULL,
      "kind" text NOT NULL,
      "amount_cents" integer,
      "discount_rate" numeric(6,4),
      "max_discount_cents" integer,
      "min_amount_cents" integer NOT NULL DEFAULT 0,
      "scope" text NOT NULL DEFAULT 'both',
      "first_order_only" boolean NOT NULL DEFAULT false,
      "usage_limit" integer,
      "per_user_limit" integer,
      "used_count" integer NOT NULL DEFAULT 0,
      "starts_at" timestamp,
      "ends_at" timestamp,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
  {
    label: "CREATE UNIQUE INDEX coupon_code_uniq_idx",
    query: `CREATE UNIQUE INDEX IF NOT EXISTS "coupon_code_uniq_idx"
      ON "coupon" ("code");`,
  },
  {
    label: "CREATE INDEX coupon_active_created_idx",
    query: `CREATE INDEX IF NOT EXISTS "coupon_active_created_idx"
      ON "coupon" ("is_active", "created_at");`,
  },

  /* ---------------------------------------------------------- 用券记录 --- */

  {
    label: "CREATE TABLE coupon_redemption",
    query: `CREATE TABLE IF NOT EXISTS "coupon_redemption" (
      "id" text PRIMARY KEY,
      "coupon_id" text NOT NULL REFERENCES "coupon"("id") ON DELETE CASCADE,
      "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "order_kind" text NOT NULL,
      "order_id" text NOT NULL,
      "discount_cents" integer NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
  {
    // 幂等靠它:一单最多记一次 —— 建单请求重投不会把 used_count 加两遍
    label: "CREATE UNIQUE INDEX coupon_redemption_order_uniq_idx",
    query: `CREATE UNIQUE INDEX IF NOT EXISTS "coupon_redemption_order_uniq_idx"
      ON "coupon_redemption" ("order_kind", "order_id");`,
  },
  {
    label: "CREATE INDEX coupon_redemption_coupon_user_idx",
    query: `CREATE INDEX IF NOT EXISTS "coupon_redemption_coupon_user_idx"
      ON "coupon_redemption" ("coupon_id", "user_id");`,
  },
  {
    label: "CREATE INDEX coupon_redemption_coupon_created_idx",
    query: `CREATE INDEX IF NOT EXISTS "coupon_redemption_coupon_created_idx"
      ON "coupon_redemption" ("coupon_id", "created_at");`,
  },

  /* ------------------------------------------------------------- 车上 --- */

  {
    // 码**住在车上**,不在结算的 body 里 —— 车是服务端从 DB 读的,
    // 少一个入口,少一处能传错的地方。
    label: "ALTER TABLE cart ADD coupon_code",
    query: `ALTER TABLE "cart"
      ADD COLUMN IF NOT EXISTS "coupon_code" text;`,
  },

  /* ------------------------------------------------------------- 商城 --- */

  {
    label: "ALTER TABLE storefront_order ADD coupon_code",
    query: `ALTER TABLE "storefront_order"
      ADD COLUMN IF NOT EXISTS "coupon_code" text;`,
  },
  {
    // 默认 0 —— 老单的恒等式不受影响
    label: "ALTER TABLE storefront_order ADD coupon_discount_cents",
    query: `ALTER TABLE "storefront_order"
      ADD COLUMN IF NOT EXISTS "coupon_discount_cents" integer NOT NULL DEFAULT 0;`,
  },

  /* ------------------------------------------------------------- 打印 --- */

  {
    label: "ALTER TABLE print_order ADD coupon_code",
    query: `ALTER TABLE "print_order"
      ADD COLUMN IF NOT EXISTS "coupon_code" text;`,
  },
  {
    // 打印工单**没有运费行** —— 它的 delivery_fee_cents 是交期加价。
    // 优惠的基数是「总报价 − 交期加价」,加价不打折。
    label: "ALTER TABLE print_order ADD coupon_discount_cents",
    query: `ALTER TABLE "print_order"
      ADD COLUMN IF NOT EXISTS "coupon_discount_cents" integer NOT NULL DEFAULT 0;`,
  },
];

async function main() {
  if (DRY_RUN) {
    console.log("[apply-coupon] --dry-run:只打印 SQL,不连库\n");
    for (const { label, query } of STATEMENTS) {
      console.log(`-- ${label}`);
      console.log(`${query}\n`);
    }
    console.log("[apply-coupon] dry-run 结束 —— 去掉 --dry-run 才会真的执行");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("[apply-coupon] 缺少 DATABASE_URL");
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
   * 回读一次 —— 确认表真的在、列真的补上了。
   *
   * **历史订单的金额一个都没动** —— 这里把两边的合计都读出来对一下:
   * 老单的新列是 0,恒等式必须还成立。
   */
  const check = await client.query<{
    coupon_count: string;
    redemption_count: string;
    cart_has_coupon_code: string;
    storefront_has_coupon_code: string;
    storefront_has_coupon_discount: string;
    print_has_coupon_code: string;
    print_has_coupon_discount: string;
    storefront_mismatch: string;
    print_mismatch: string;
  }>(
    `SELECT
      (SELECT count(*)::text FROM "coupon")
        AS coupon_count,
      (SELECT count(*)::text FROM "coupon_redemption")
        AS redemption_count,
      (SELECT count(*)::text FROM information_schema.columns
         WHERE table_name = 'cart' AND column_name = 'coupon_code')
        AS cart_has_coupon_code,
      (SELECT count(*)::text FROM information_schema.columns
         WHERE table_name = 'storefront_order' AND column_name = 'coupon_code')
        AS storefront_has_coupon_code,
      (SELECT count(*)::text FROM information_schema.columns
         WHERE table_name = 'storefront_order' AND column_name = 'coupon_discount_cents')
        AS storefront_has_coupon_discount,
      (SELECT count(*)::text FROM information_schema.columns
         WHERE table_name = 'print_order' AND column_name = 'coupon_code')
        AS print_has_coupon_code,
      (SELECT count(*)::text FROM information_schema.columns
         WHERE table_name = 'print_order' AND column_name = 'coupon_discount_cents')
        AS print_has_coupon_discount,
      -- 商城恒等式:total = subtotal - discount - coupon_discount + shipping
      (SELECT count(*)::text FROM "storefront_order"
        WHERE "total_cents" <> "subtotal_cents" - "discount_cents"
              - "coupon_discount_cents" + "shipping_cents")
        AS storefront_mismatch,
      -- 打印恒等式:total_price = 四项费用 - 优惠(**没有运费**)
      (SELECT count(*)::text FROM "print_order"
        WHERE "total_price_cents" <> "weight_fee_cents" + "varnish_fee_cents"
              + "support_fee_cents" + "delivery_fee_cents" - "coupon_discount_cents")
        AS print_mismatch;`
  );

  const row = check.rows[0];
  const yes = (v: string | undefined) => (v === "1" ? "✓" : "✗");

  console.log("");
  console.log("[apply-coupon] 回读:");
  console.log(`  ${yes(row?.cart_has_coupon_code)} cart.coupon_code`);
  console.log(
    `  ${yes(row?.storefront_has_coupon_code)} storefront_order.coupon_code`
  );
  console.log(
    `  ${yes(row?.storefront_has_coupon_discount)} storefront_order.coupon_discount_cents`
  );
  console.log(`  ${yes(row?.print_has_coupon_code)} print_order.coupon_code`);
  console.log(
    `  ${yes(row?.print_has_coupon_discount)} print_order.coupon_discount_cents`
  );
  console.log(
    `  券 ${row?.coupon_count ?? 0} 张(脚本不播种 —— 工作室自己在后台发)`
  );
  console.log(`  用券记录 ${row?.redemption_count ?? 0} 条`);

  const mallBad = Number(row?.storefront_mismatch ?? 0);
  const printBad = Number(row?.print_mismatch ?? 0);
  if (mallBad === 0 && printBad === 0) {
    console.log("  ✓ 恒等式没有破(历史订单的金额一个都没动)");
  } else {
    console.error(
      `  ✗ 恒等式破了 —— 商城 ${mallBad} 行 / 打印 ${printBad} 行对不上`
    );
    console.error(
      "    本脚本只加列,理论上不会破。真对不上请先查是不是库里有别的脚本改过金额。"
    );
    await client.end();
    process.exit(1);
  }

  await client.end();
  console.log("\n[apply-coupon] 完成 —— 到 /admin/coupons 发第一张券");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
