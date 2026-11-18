#!/usr/bin/env -S npx tsx

/**
 * 应用「淘宝下单」schema(2026-11-17)
 *
 * - `product_taobao_link` —— 「本站商品 → 淘宝链接」的映射表
 * - `storefront_order.external_paid_cents` —— **外部渠道**实收金额(分)
 *
 * ## 这两条路是干什么的
 *
 * 买家不信任一个新店 ⇒ 结算页除了支付宝,多一个「**淘宝下单**」:点了跳到
 * 淘宝的商品页,在淘宝付款(享受平台担保)。钱进的是**淘宝那个账户**,不在本
 * 仓库的收钱链路里 ⇒ 工作室在淘宝后台看到钱到了,再回本站把那笔单**手工
 * 标成已收款**。
 *
 * ## 为什么需要一张新表
 *
 * `product` 表是**型号**级的(6 行:R / A / P / RM / LB / M),而商城卖的是
 * **12 件设计**(4 钥匙扣 + 4 手办 + 4 冰箱贴)—— 一件设计挂在某个型号下面。
 * ⇒ 一个型号对应 1~4 件设计,淘宝那边**每个设计一个链接** ⇒ 挂型号上必然
 * 对不上(买家点了会落到别的设计)。
 *
 * ⇒ 这张表按 **handle** 存(商城那件设计的 id,`mock-catalog.ts` 的
 * `SEEDS[].handle`)—— 跟 `storefront_order_item.product_handle` 是同一个
 * 字符串。
 *
 * ## 为什么需要新的一列
 *
 * 淘宝那一单的钱**不进本仓库的收钱链路** ⇒ 本仓库这边的 `total_cents` 只是
 * **参考价**(淘宝那边的价、运费模板、优惠券都是它自己那套)。对账靠
 * `external_paid_cents` —— 工作室在淘宝后台看到实收多少,手工填进来。
 *
 * ⚠️ **只有 `taobao` 通道用这一列** —— 微信 / 支付宝的实收金额就是
 * `total_cents`(「逐分相等」),不另存一份。
 *
 * ## 这个脚本做什么、不做什么
 *
 * **做**:建表 + 建索引 + 加列。
 *
 * **不做**:
 *
 * - **不播种任何一行** —— 跑完线上行为(除了下面「直接下单」那条)一个字节都
 *   不变(没配链接的时候,那个支付选项是灰的、标着「暂未开放」)。
 * - **不改任何历史订单** —— `external_paid_cents` 是**可空**的新列,老单
 *   读出来就是 null。
 * - **不改 `payment_channel` 列** —— 那一列本来就是 `text`(不是 PG enum)、
 *   枚举只在 TS 层 ⇒ 加一个 `taobao` 值**不需要迁移**。
 *
 * ## ⚠️ 跑完迁移之后,**淘宝下单的行为变了**(2026-11-18)
 *
 * 新增两列:
 *
 * | 列 | 干什么 | 默认 |
 * |---|---|---|
 * | `sku_map` | 「本站尺寸 id → 淘宝 skuId」的映射(json) | `{}`(没配) |
 * | `direct_order` | 「**直接下单**」开关 —— 跳淘宝的**下单确认页**,不是商品详情页 | **开** |
 *
 * ⇒ **`direct_order` 默认是 `true`** —— 这是**故意的**:工作室报的是
 * 「用户跳到淘宝后没有自动创建订单」,跑完迁移就自动修好了(跳到确认页,
 * 商品 / 件数 / 规格都替他选好,只差填地址和付款)。
 *
 * ⇒ **不想改行为**就在后台 `/admin/taobao-links` 把那颗开关关掉 —— 关掉 =
 * 退回老行为(跳普通商品页)。**每条链接都有这颗开关,一键切回。**
 *
 * ⇒ `sku_map` 是 `{}` 时,直连地址里**不带 skuId** ⇒ 淘宝让买家自己挑一下
 * 规格(比跳商品详情页从头来强)。**工作室要在后台把尺寸和淘宝的 skuId 对上**
 * —— 拿到 skuId 的办法:在淘宝那个商品的页面上把规格都选一遍,地址栏里会出现
 * `skuid=…`。
 *
 * ⚠️ 淘宝那个下单页是**内部 H5 接口**(没公开文档)—— 万一形状变了、淘宝改了
 * 规则 ⇒ 服务端**自动退回普通商品页**(老行为永远留着),退回原因记在日志里。
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
 * pnpm tsx scripts/apply-taobao-link-schema.ts --dry-run
 *
 * # 真跑
 * pnpm tsx scripts/apply-taobao-link-schema.ts
 * pnpm migrate:apply-taobao-link
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
    label: "CREATE TABLE product_taobao_link",
    query: `CREATE TABLE IF NOT EXISTS "product_taobao_link" (
      "id" text PRIMARY KEY,
      "product_handle" text NOT NULL,
      "url" text NOT NULL,
      "item_id" text,
      "note" text,
      "is_active" boolean NOT NULL DEFAULT true,
      "sku_map" json NOT NULL DEFAULT '{}'::json,
      "direct_order" boolean NOT NULL DEFAULT true,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );`,
  },
  {
    label: "CREATE UNIQUE INDEX product_taobao_link_handle_uniq_idx",
    query: `CREATE UNIQUE INDEX IF NOT EXISTS "product_taobao_link_handle_uniq_idx"
      ON "product_taobao_link" ("product_handle");`,
  },
  {
    label: "CREATE INDEX product_taobao_link_active_idx",
    query: `CREATE INDEX IF NOT EXISTS "product_taobao_link_active_idx"
      ON "product_taobao_link" ("product_handle", "is_active");`,
  },
  {
    label: "ALTER TABLE storefront_order ADD COLUMN external_paid_cents",
    query: `ALTER TABLE "storefront_order"
      ADD COLUMN IF NOT EXISTS "external_paid_cents" integer;`,
  },
  {
    label: "ALTER TABLE product_taobao_link ADD COLUMN sku_map",
    query: `ALTER TABLE "product_taobao_link"
      ADD COLUMN IF NOT EXISTS "sku_map" json NOT NULL DEFAULT '{}'::json;`,
  },
  {
    label: "ALTER TABLE product_taobao_link ADD COLUMN direct_order",
    query: `ALTER TABLE "product_taobao_link"
      ADD COLUMN IF NOT EXISTS "direct_order" boolean NOT NULL DEFAULT true;`,
  },
];

async function main() {
  if (DRY_RUN) {
    console.log("[apply-taobao-link] --dry-run:只打印 SQL,不连库\n");
    for (const { label, query } of STATEMENTS) {
      console.log(`-- ${label}`);
      console.log(`${query}\n`);
    }
    console.log(
      "[apply-taobao-link] dry-run 结束 —— 去掉 --dry-run 才会真的执行"
    );
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("[apply-taobao-link] 缺少 DATABASE_URL");
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
   * 回读一次 —— 确认表、索引、列真的在。
   *
   * **行数必须是 0** —— 脚本不播种(见文件头)。要是这里有行,说明有人手动
   * 往表里塞过东西,那得看一眼是不是想要的。
   */
  const check = await client.query<{
    link_table: string;
    link_columns: string;
    link_indexes: string;
    link_rows: string;
    external_paid_cents_column: string;
    external_paid_cents_filled: string;
  }>(
    `SELECT
      (SELECT count(*)::text FROM information_schema.tables
        WHERE table_name = 'product_taobao_link')
        AS link_table,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'product_taobao_link')
        AS link_columns,
      (SELECT count(*)::text FROM pg_indexes
        WHERE tablename = 'product_taobao_link')
        AS link_indexes,
      (SELECT count(*)::text FROM "product_taobao_link")
        AS link_rows,
      (SELECT count(*)::text FROM information_schema.columns
        WHERE table_name = 'storefront_order'
          AND column_name = 'external_paid_cents')
        AS external_paid_cents_column,
      (SELECT count(*)::text FROM "storefront_order"
        WHERE "external_paid_cents" IS NOT NULL)
        AS external_paid_cents_filled;`
  );

  const row = check.rows[0];
  /** 「在」就是 1 */
  const yes = (v: string | undefined) => (v === "1" ? "✓" : "✗");
  /** 数量对上了就是 ✓ */
  const count = (v: string | undefined, expected: number) =>
    Number(v) === expected ? "✓" : `✗(实际 ${v ?? "?"},期望 ${expected})`;

  console.log("");
  console.log("[apply-taobao-link] 回读:");
  console.log(`  ${yes(row?.link_table)} product_taobao_link 表在`);
  console.log(
    `  ${count(row?.link_columns, 10)} product_taobao_link 的 10 个列`
  );
  console.log(
    `  ${count(row?.link_indexes, 2)} product_taobao_link 的 2 个索引(含唯一索引)`
  );
  console.log(
    `  ${yes(row?.external_paid_cents_column)} storefront_order.external_paid_cents 列在`
  );
  console.log(
    `  现有 ${row?.link_rows ?? 0} 条淘宝链接(脚本不播种 —— 工作室自己在后台配)`
  );
  console.log(
    `  现有 ${row?.external_paid_cents_filled ?? 0} 张单填了外部实收金额(脚本不写 —— 工作室手工标)`
  );

  await client.end();
  console.log(
    "\n[apply-taobao-link] 完成 —— 到 /admin/taobao-links 配淘宝链接,/admin/store-orders 手工标已收款"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
