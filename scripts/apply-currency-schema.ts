#!/usr/bin/env -S npx tsx

/**
 * 币种迁移:把数据库对齐到**代码里定义的币种**(2026-11-05)
 *
 * ## 为什么需要这个脚本
 *
 * 改币种这件事,代码里改一遍还不够 —— **DB 里还留着上一套**:
 *
 * - `storefront_order.currency` / `cart.currency_code` 的**列默认值**还是
 *   旧币种 —— 不改的话,新落库的订单和购物车都还带着旧币种
 * - `product.base_price_cents` / `product_variant.price_cents` /
 *   `product_accessory_variant.price_delta_cents` 里还是**旧的那套价**
 *   (钥匙扣 299 分 = $2.99)。改币种就是换一套价 —— 旧的价留着,只会跟
 *   新的价混在一起,读表的人分不清哪个是哪个
 *
 * ## 币种**从代码里读**,不写死在这儿
 *
 * 本脚本 import `@/config/currency` 的 `PRICE_CURRENCY` / `PRICE_REGION_ID` ——
 * **那才是唯一的定义处**。写死一份在这儿的话,改币种漏了这个脚本,就会变成
 * 「代码是人民币、DB 默认值是美元」—— 这种错位**不会报错**,只在结账的时候炸。
 *
 * 历史:这个脚本的前身是 `apply-usd-currency-schema.ts`(2026-11-05 改成美元
 * 时写的),当天币种又改回人民币,于是它被换成了这个通用版本。
 *
 * ## 改什么、**不改**什么
 *
 * | 目标 | 处理 |
 * |---|---|
 * | `storefront_order.currency` 列默认值 | 改成 `PRICE_CURRENCY` |
 * | `cart.currency_code` / `cart.region_id` 列默认值 | 改成 `PRICE_CURRENCY` / `PRICE_REGION_ID` |
 * | 已有购物车行 | 改成当前币种 / 区域(购物车是**在途状态**,不是历史) |
 * | 商品目录三张表的价格 | **默认只读校验**(见下面「重定价要显式加 `--force-reprice`」) |
 * | **历史订单**(`storefront_order` 的行) | **一行不动** |
 *
 * ### 历史订单为什么不动
 *
 * 一笔用旧币种下的单,收的就是旧币种。把它改成新币种等于**篡改账本** ——
 * 以后对账(微信 / 支付宝的流水)会对不上。旧单的 `currency` 列就是它当时收的
 * 币种,那才是事实。
 *
 * 旧单里**没付款**的那些(还在 `unpaid`)现在付不了了 —— 两个通道只收当前
 * 币种,通道会明确报错(「本订单的币种是 XXX,但这条通道的价一律是 YYY」),
 * 不会收错钱。脚本会把这些单的数量打出来,要不要取消是工作室的决定(见输出
 * 末尾给出的 SQL)。
 *
 * ## 商品目录怎么重新定价
 *
 * 用的公式跟 `src/features/image-gen/lib/product-variant-sku.ts` 的
 * `buildAllVariantSeeds()` **完全一样**:
 *
 * ```
 * product_variant.price_cents =
 *     product.base_price_cents
 *   + 尺寸加价(product_size 表的**显式值**)
 *   + 配件变体加价(product_accessory_variant 行)
 * ```
 *
 * ⚠️ **尺寸加价和配件加价都从 DB 取**(2026-11-14 起)——
 * 这两列搬进后台了(`/admin/products/[code]`),**后台配的值才是真理源**。
 * 代码常量(`product-catalog.ts` / `product-accessory-variants.ts`)只是
 * **兜底**:字典表还没播种 / 某个型号 DB 里没行时用它。
 *
 * ⇒ 这个脚本**只重刷 SKU 价**和(在 `--force-reprice` 下)基础价;
 * **不碰配件加价** —— 以前它按代码字典重刷那一列,`--force-reprice` 会把
 * 工作室调过的加价悄悄改回去,又是一轮「改了不生效」。
 *
 * ## ⚠️ 重定价要**显式**加 `--force-reprice`(2026-11-08)
 *
 * **价源在 2026-11-08 搬到 DB 了** —— 基础价(`product.base_price_cents`)
 * 是**唯一的**价源,后台 `/admin/products` 改的就是它,SKU 的绝对价由它
 * **自动重算**。
 *
 * ⇒ 这个脚本**默认只读**:把 DB 里跟代码字典不一致的行**列出来 + 警告**,
 * **一个字都不写**。理由很简单 —— 代码字典里的价是**兜底值**(迁移脚本
 * 没跑 / 某个型号还没播种时用它),不是**真理源**。工作室在后台调过的价
 * 才是真理源,脚本把它悄悄改回去,就是又一轮「改了不生效」。
 *
 * 真要重刷(比如刚改完币种,整目录要换一套价),显式加:
 *
 * ```
 * pnpm tsx scripts/apply-currency-schema.ts --force-reprice
 * ```
 *
 * **会覆盖 admin 改过的基础价** —— 这是显式选择,不是默认行为。
 *
 * ## 幂等
 *
 * 跑几遍结果一样:所有语句都是 `UPDATE ... SET <确定的值>` 或
 * `ALTER ... SET DEFAULT`,没有 `ADD COLUMN`,不需要「跑一次就删」。
 *
 * 用法:
 *   pnpm tsx scripts/apply-currency-schema.ts                  # 默认:只读校验
 *   pnpm tsx scripts/apply-currency-schema.ts --force-reprice  # 显式重定价
 *
 * 跑完之后建议再跑一遍两个 seed(补上新增的配件变体):
 *   pnpm tsx src/db/seed-product-accessory-variants.ts
 *   pnpm tsx src/db/seed-products.ts
 */

import "./lib/load-env";

import { PRICE_CURRENCY, PRICE_REGION_ID } from "@/config/currency";
// 字典是纯模块(没有 DB 依赖),静态 import 安全
import {
  BASE_PRICE_CENTS,
  PRODUCT_TYPES,
} from "@/features/gpt-image/lib/product-catalog";
// ⚠️ `SIZE_STEP_CENTS` 的**单一出处**在 catalog-dictionary.ts(2026-11-14 起)
// —— 别在别处再写一份 500。
import { SIZE_STEP_CENTS } from "@/features/image-gen/lib/catalog-dictionary";

/** 配件变体的查表键 —— 三元组 */
function accKey(
  productTypeCode: string,
  accessoryCode: string,
  variantCode: string
): string {
  return `${productTypeCode}|${accessoryCode}|${variantCode}`;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-currency] 缺少 DATABASE_URL");
    process.exit(1);
  }

  // 重定价是**破坏性**的(会覆盖 admin 在后台改过的价)⇒ 必须显式要。
  const FORCE_REPRICE = process.argv.includes("--force-reprice");

  const currency = PRICE_CURRENCY.toUpperCase();
  const region = PRICE_REGION_ID;

  console.log(
    `[apply-currency] 按代码里的定义来:币种 = ${currency},区域 = ${region}`
  );

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  /* ── 1. 列默认值 ───────────────────────────────────────────────────── */

  const defaults: Array<{ label: string; query: string }> = [
    {
      label: `storefront_order.currency 默认值 → ${currency}`,
      query: `ALTER TABLE "storefront_order"
        ALTER COLUMN "currency" SET DEFAULT '${currency}';`,
    },
    {
      label: `cart.currency_code 默认值 → ${currency}`,
      query: `ALTER TABLE "cart"
        ALTER COLUMN "currency_code" SET DEFAULT '${currency}';`,
    },
    {
      label: `cart.region_id 默认值 → ${region}`,
      query: `ALTER TABLE "cart"
        ALTER COLUMN "region_id" SET DEFAULT '${region}';`,
    },
  ];

  for (const { label, query } of defaults) {
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

  /* ── 2. 已有购物车:币种 / 区域 ─────────────────────────────────────── */

  // 购物车是**在途状态** —— 里面的人还没付钱,按新币种走。
  // 行内的价不用动:购物车每次读都按目录重算(见 `cart-store.ts` 的
  // `repriceLineItem()`),存着的那个数只是算不出来时的兜底。
  const cartRes = await client.query(
    `UPDATE "cart"
        SET "currency_code" = $1,
            "region_id" = $2,
            "updated_at" = now()
      WHERE "currency_code" <> $1 OR "region_id" <> $2;`,
    [currency, region]
  );
  console.log(
    `✓ 购物车改成 ${currency}/${region}:${cartRes.rowCount ?? 0} 行` +
      `(行内的价不用改 —— 读的时候按目录重算)`
  );

  /* ── 3. 商品目录:默认只读校验,加了 --force-reprice 才重定价 ─────────── */

  // 价源在 2026-11-08 搬到 DB(基础价 = 唯一的价源,后台改的就是它)。
  // 代码字典里的价退化成**兜底值** ⇒ 这个脚本默认**只读**:
  //   · 校验「SKU 价 = 基础价 + 尺寸阶梯 + 配件加价」这条不变式(对不上就是真问题)
  //   · 报告「基础价跟代码字典不一致」(只是提示 —— 后台改过是正常的)
  // **一个字都不写。** 要重刷必须显式加 --force-reprice。
  console.log(
    FORCE_REPRICE
      ? "\n[商品目录] --force-reprice:按代码里的字典重定价" +
          "(⚠ 会覆盖 admin 在后台改过的价)"
      : "\n[商品目录] 默认**只读校验** —— 不改任何价。" +
          "价源在 2026-11-08 搬到 DB 了(基础价 = 唯一的价源)," +
          "后台改的价才是真理源,脚本把它改回去就是又一轮「改了不生效」。" +
          "\n           真要按代码字典重刷:加 --force-reprice"
  );

  // 3.1 product.base_price_cents
  const productRows = await client.query<{
    code: string;
    base_price_cents: number;
  }>(`SELECT "code", "base_price_cents" FROM "product"`);

  const productDiffs: Array<{
    code: string;
    from: number;
    to: number;
  }> = [];
  for (const row of productRows.rows) {
    const next = BASE_PRICE_CENTS[row.code];
    if (next === undefined) continue; // 字典里没有这个型号 → 不动
    if (next === row.base_price_cents) continue;
    productDiffs.push({
      code: row.code,
      from: row.base_price_cents,
      to: next,
    });
  }

  if (FORCE_REPRICE) {
    for (const d of productDiffs) {
      await client.query(
        `UPDATE "product"
            SET "base_price_cents" = $1, "updated_at" = now()
          WHERE "code" = $2;`,
        [d.to, d.code]
      );
    }
    console.log(`✓ product.base_price_cents:改写 ${productDiffs.length} 行`);
  } else if (productDiffs.length === 0) {
    console.log("✓ product.base_price_cents:跟代码字典一致");
  } else {
    console.log(
      `⚠ product.base_price_cents:有 ${productDiffs.length} 行跟代码字典不一致` +
        "(未改动 —— 后台调过的价是真理源)"
    );
    for (const d of productDiffs) {
      console.log(
        `  · product ${d.code}: ${d.from} → ${d.to} 分` +
          `(${money(d.from, currency)} → ${money(d.to, currency)})`
      );
    }
  }

  // 3.2 product_accessory_variant.price_delta_cents
  //     键 = 产品码 | 配件码 | 变体码
  //
  // ⚠️ 2026-11-14:这一列**不再按代码字典重刷**。
  //
  // 配件加价搬进后台了(`/admin/products/[code]` → 配件变体)⇒ **后台配的
  // 值才是真理源**。以前这里拿 `PRODUCT_ACCESSORY_VARIANTS`(代码常量)
  // 当真理源,`--force-reprice` 会把工作室调过的加价悄悄改回去 —— 又一轮
  // 「改了不生效」。代码字典现在只是**兜底**(字典表没播种时的初始值)。
  //
  // 所以这一节**只读出加价**,给 3.3 算 SKU 价用;一个字都不写。
  const accRows = await client.query<{
    product_type_code: string;
    accessory_code: string;
    variant_code: string;
    price_delta_cents: number;
  }>(
    `SELECT "product_type_code", "accessory_code", "variant_code", "price_delta_cents"
       FROM "product_accessory_variant"`
  );

  console.log(
    `✓ product_accessory_variant.price_delta_cents:只读 ${accRows.rows.length} 行` +
      "(不重刷 —— 配件加价由后台管)"
  );

  // 3.3 product_variant.price_cents
  //     = 基础价 + 尺寸加价 + 配件变体加价
  //     公式跟 buildAllVariantSeeds() / recomputeVariantPrices() 一致
  //
  //     **只读模式下查的是「不变式」**(用 DB 里自己的基础价和配件加价);
  //     **--force-reprice 模式下用新刷的基础价 + DB 里的配件加价**。
  //
  //     ⚠️ 尺寸加价和配件加价**两边模式都从 DB 取** —— 这两列 2026-11-14
  //     起是**后台配的**(真理源在 DB),代码常量只是「字典表还没播种」时的
  //     兜底。按代码字典重刷 = 又一轮「后台改了不生效」。
  const newBase = new Map<string, number>();
  for (const row of productRows.rows) {
    const next = BASE_PRICE_CENTS[row.code];
    newBase.set(
      row.code,
      FORCE_REPRICE ? (next ?? row.base_price_cents) : row.base_price_cents
    );
  }

  // 配件加价 —— **DB 的行**(两边模式都一样)
  const accDelta = new Map<string, number>();
  for (const row of accRows.rows) {
    accDelta.set(
      accKey(row.product_type_code, row.accessory_code, row.variant_code),
      row.price_delta_cents
    );
  }

  // 尺寸加价 —— **DB 的 `product_size` 表**(后台能配 ⇒ 真理源在 DB)
  //
  // 这个脚本用裸 `pg`(不 import `@/db`)⇒ 自己查。
  // 表还不存在(迁移没跑)⇒ **整份退回代码常量兜底**(idx × ¥5)
  // —— 跟改造前的行为一个字节都不变。
  //
  // 合并口径跟 `catalog-dictionary.ts` 的 `mergeCatalogDictionary()` 一致:
  // **逐型号** —— 某个型号在 DB 里有行 ⇒ 那个型号的尺寸全听 DB 的;
  // 一个都没有 ⇒ 用代码常量。
  const sizeRowsByType = new Map<string, Map<string, number>>();
  try {
    const sizeRows = await client.query<{
      product_type_code: string;
      size_code: string;
      price_delta_cents: number;
      is_active: boolean;
    }>(
      `SELECT "product_type_code", "size_code", "price_delta_cents", "is_active"
         FROM "product_size"`
    );
    for (const row of sizeRows.rows) {
      const m =
        sizeRowsByType.get(row.product_type_code) ?? new Map<string, number>();
      // 停用的那一档 = 那一档没了 ⇒ 不进 map(查的时候当成「查不到」)
      if (row.is_active) m.set(row.size_code, row.price_delta_cents);
      sizeRowsByType.set(row.product_type_code, m);
    }
  } catch {
    // 表还不存在 ⇒ 整份退回代码常量兜底
    sizeRowsByType.clear();
    console.log(
      "  (product_size 表还不存在 —— 尺寸加价退回代码常量兜底:idx × ¥5)"
    );
  }

  /**
   * 某一档尺寸的加价 —— `null` = **查不到**(这一行不参与重算)
   *
   * 跟 `catalog-dictionary.ts` 的 `sizeDeltaCentsFor()` **一个口径**:
   * 查不到就返回 null,**不许当成 0** —— 当成 0 = 静默把某一档的尺寸加价
   * 抹掉,价算错了还不报错。
   */
  function resolveSizeDelta(
    typeCode: string,
    sizeCode: string
  ): number | null {
    const typeRows = sizeRowsByType.get(typeCode);
    if (typeRows) {
      // 这个型号在 DB 里有行 ⇒ 全听 DB 的(含「这一档被停用了」的情况)
      return typeRows.get(sizeCode) ?? null;
    }
    // 这个型号 DB 里没有 ⇒ 代码常量兜底
    const productType = PRODUCT_TYPES.find((pt) => pt.code === typeCode);
    if (!productType) return null;
    const idx = productType.sizes.indexOf(sizeCode);
    if (idx < 0) return null;
    return idx * SIZE_STEP_CENTS;
  }

  const variantRows = await client.query<{
    sku: string;
    product_code: string;
    size_code: string;
    accessory_code: string;
    variant_code: string;
    price_cents: number;
  }>(
    `SELECT "sku", "product_code", "size_code", "accessory_code", "variant_code", "price_cents"
       FROM "product_variant"`
  );

  const variantDiffs: Array<{
    sku: string;
    from: number;
    to: number;
  }> = [];
  let variantUnmatched = 0;
  for (const row of variantRows.rows) {
    // 尺寸档查不到(型号不在字典里 / 这一档被停用)⇒ **这一行不参与重算**
    // —— 当成 0 会把尺寸加价悄悄抹掉(价算错还不报错)。
    const sizeDelta = resolveSizeDelta(row.product_code, row.size_code);
    if (sizeDelta === null) {
      variantUnmatched += 1;
      continue;
    }

    // 配件变体加价 —— 跟 `recomputeVariantPrices()` 一个口径:
    // 有变体码却查不到加价 ⇒ **跳过这一行**(不当成 0)
    let accessoryDelta = 0;
    if (row.variant_code !== "N-A" && row.variant_code !== "") {
      const found = accDelta.get(
        accKey(row.product_code, row.accessory_code, row.variant_code)
      );
      if (found === undefined) {
        variantUnmatched += 1;
        continue;
      }
      accessoryDelta = found;
    }

    const next =
      (newBase.get(row.product_code) ?? 0) + sizeDelta + accessoryDelta;
    if (next === row.price_cents) continue;
    variantDiffs.push({ sku: row.sku, from: row.price_cents, to: next });
  }

  if (FORCE_REPRICE) {
    for (const d of variantDiffs) {
      await client.query(
        `UPDATE "product_variant"
            SET "price_cents" = $1, "updated_at" = now()
          WHERE "sku" = $2;`,
        [d.to, d.sku]
      );
    }
    console.log(
      `✓ product_variant.price_cents:改写 ${variantDiffs.length} 行` +
        (variantUnmatched > 0
          ? `(${variantUnmatched} 行对不上字典,原样保留)`
          : "")
    );
  } else if (variantDiffs.length === 0) {
    console.log(
      "✓ product_variant.price_cents:跟「基础价 + 尺寸加价 + 配件加价」一致"
    );
  } else {
    console.log(
      `⚠ product_variant.price_cents:有 ${variantDiffs.length} 行跟` +
        "「基础价 + 尺寸加价 + 配件加价」对不上(未改动)"
    );
    for (const d of variantDiffs.slice(0, 20)) {
      console.log(
        `  · ${d.sku}: ${d.from} → ${d.to} 分` +
          `(${money(d.from, currency)} → ${money(d.to, currency)})`
      );
    }
    if (variantDiffs.length > 20) {
      console.log(`  · …还有 ${variantDiffs.length - 20} 行`);
    }
    console.log(
      "    这几行要么是历史脏数据,要么是改基础价时漏了重算 —— " +
        "在 /admin/products 存一次基础价就会重算(或者跑 --force-reprice)。"
    );
  }

  /* ── 4. 历史订单:只报告,不动 ──────────────────────────────────────── */

  const orderStats = await client.query<{
    currency: string;
    payment_status: string;
    count: number;
  }>(
    `SELECT "currency", "payment_status", count(*)::int AS "count"
       FROM "storefront_order"
      WHERE "currency" IS DISTINCT FROM $1
      GROUP BY "currency", "payment_status"
      ORDER BY "currency", "payment_status"`,
    [currency]
  );

  if (orderStats.rows.length === 0) {
    console.log(`✓ 历史订单:没有非 ${currency} 的订单`);
  } else {
    console.log(
      `\n[历史订单]以下订单不是 ${currency} —— **脚本没有改它们**(改了就是篡改账本):`
    );
    for (const row of orderStats.rows) {
      console.log(
        `  · ${row.currency} / ${row.payment_status}:${row.count} 笔`
      );
    }
    const unpaid = orderStats.rows.filter((r) => r.payment_status === "unpaid");
    if (unpaid.length > 0) {
      console.log(
        "\n  这些未付款的旧单**现在付不了**(两个通道只收当前币种,通道会明确报错," +
          "不会收错钱)。要不要取消是工作室的决定 —— 需要的话跑这条:\n" +
          `    UPDATE storefront_order SET status = 'cancelled'\n` +
          `     WHERE currency <> '${currency}' AND payment_status = 'unpaid';`
      );
    }
  }

  /* ── 5. 回读确认 ───────────────────────────────────────────────────── */

  const check = await client.query<{
    order_currency: string;
    cart_currency: string;
    cart_region: string;
    legacy_orders: number;
  }>(
    `SELECT
       (SELECT column_default FROM information_schema.columns
         WHERE table_name = 'storefront_order' AND column_name = 'currency')
         AS order_currency,
       (SELECT column_default FROM information_schema.columns
         WHERE table_name = 'cart' AND column_name = 'currency_code')
         AS cart_currency,
       (SELECT column_default FROM information_schema.columns
         WHERE table_name = 'cart' AND column_name = 'region_id')
         AS cart_region,
       (SELECT count(*)::int FROM storefront_order WHERE currency <> $1)
         AS legacy_orders;`,
    [currency]
  );
  console.log(
    `\n[apply-currency] storefront_order.currency 默认值 = ${check.rows[0]?.order_currency}, ` +
      `cart.currency_code = ${check.rows[0]?.cart_currency}, ` +
      `cart.region_id = ${check.rows[0]?.cart_region}, ` +
      `仍是非 ${currency} 的订单 ${check.rows[0]?.legacy_orders} 笔`
  );

  await client.end();
  console.log(
    "\n[apply-currency] 完成。接下来跑一遍 seed 补上新增的配件变体:\n" +
      "  pnpm tsx src/db/seed-product-accessory-variants.ts\n" +
      "  pnpm tsx src/db/seed-products.ts"
  );
  if (!FORCE_REPRICE) {
    console.log(
      "\n[提示] 这次是**只读校验** —— 商品目录的价一个字都没改。\n" +
        "       要按代码字典重刷:pnpm tsx scripts/apply-currency-schema.ts --force-reprice"
    );
  }
}

/** 分 → 展示文本(给日志用,别拿它去算钱) */
function money(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
