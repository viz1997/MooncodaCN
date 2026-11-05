#!/usr/bin/env -S npx tsx

/**
 * 币种迁移:人民币 → 美元(2026-11-05)
 *
 * ## 为什么需要这个脚本
 *
 * 代码里的价已经全改成美元了(见 `src/config/currency.ts`),但 **DB 里还留着
 * 人民币那一套**:
 *
 * - `storefront_order.currency` / `cart.currency_code` 的**列默认值**是 CNY
 *   —— 不改的话,新落库的订单和购物车都还带着人民币
 * - `product.base_price_cents` / `product_variant.price_cents` /
 *   `product_accessory_variant.price_delta_cents` 里还是**人民币那套价**
 *   (钥匙扣 1900 分 = ¥19)。改币种就是换一套价 —— 旧的人民币价留着,只会
 *   跟新的美元价混在一起,读表的人分不清哪个是哪个
 *
 * ## 改什么、**不改**什么
 *
 * | 目标 | 处理 |
 * |---|---|
 * | `storefront_order.currency` 列默认值 | 改成 `'USD'` |
 * | `cart.currency_code` / `cart.region_id` 列默认值 | 改成 `'USD'` / `'us'` |
 * | 已有购物车行 | 改成 USD / us(购物车是**在途状态**,不是历史) |
 * | 商品目录三张表的价格 | 按代码里的字典**重新定价** |
 * | **历史订单**(`storefront_order` 的行) | **一行不动** |
 *
 * ### 历史订单为什么不动
 *
 * 一笔 2026-11-04 用人民币下的单,收的就是人民币。把它改成 USD 等于**篡改
 * 账本** —— 以后对账(Stripe / PayPal 的流水、Shopify 的订单)会对不上。
 * 旧单的 `currency` 列就是它当时收的币种,那才是事实。
 *
 * 旧单里**没付款**的那些(还在 `unpaid`)现在付不了了 —— 三个通道都只收美元,
 * 通道会明确报错(「本订单的币种是 CNY,但这条通道的价一律是 USD」),不会
 * 收错钱。脚本会把这些单的数量打出来,要不要取消是工作室的决定(见输出
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
 *   + 尺寸档位 × SIZE_STEP_CENTS
 *   + 配件变体加价
 * ```
 *
 * 尺寸档位和配件加价都从**代码里的字典**取(`product-catalog.ts` /
 * `product-accessory-variants.ts`),不是从 DB 取 —— DB 里那些数就是旧的人民币
 * 那一套。
 *
 * **会覆盖 admin 改过的价。** 改币种就是换一套价,没有「人民币的价 + 美元
 * 的币种」这种说法。跑完在 `/admin/products` 里按新价重新调一遍。
 *
 * ## 幂等
 *
 * 跑几遍结果一样:所有语句都是 `UPDATE ... SET <确定的值>` 或
 * `ALTER ... SET DEFAULT`,没有 `ADD COLUMN`,不需要「跑一次就删」。
 *
 * 用法:
 *   pnpm tsx scripts/apply-usd-currency-schema.ts
 *
 * 跑完之后建议再跑一遍两个 seed(补上新增的配件变体):
 *   pnpm tsx src/db/seed-product-accessory-variants.ts
 *   pnpm tsx src/db/seed-products.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

import { PRODUCT_ACCESSORY_VARIANTS } from "@/features/gpt-image/lib/product-accessory-variants";
// 字典是纯模块(没有 DB 依赖),静态 import 安全
import {
  BASE_PRICE_CENTS,
  PRODUCT_TYPES,
} from "@/features/gpt-image/lib/product-catalog";
import { SIZE_STEP_CENTS } from "@/features/image-gen/lib/product-variant-sku";

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
    console.error("[apply-usd-currency] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  /* ── 1. 列默认值 ───────────────────────────────────────────────────── */

  const defaults: Array<{ label: string; query: string }> = [
    {
      label: "storefront_order.currency 默认值 → USD",
      query: `ALTER TABLE "storefront_order"
        ALTER COLUMN "currency" SET DEFAULT 'USD';`,
    },
    {
      label: "cart.currency_code 默认值 → USD",
      query: `ALTER TABLE "cart"
        ALTER COLUMN "currency_code" SET DEFAULT 'USD';`,
    },
    {
      label: "cart.region_id 默认值 → us",
      query: `ALTER TABLE "cart"
        ALTER COLUMN "region_id" SET DEFAULT 'us';`,
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
        SET "currency_code" = 'USD',
            "region_id" = 'us',
            "updated_at" = now()
      WHERE "currency_code" <> 'USD' OR "region_id" <> 'us';`
  );
  console.log(
    `✓ 购物车改成 USD/us:${cartRes.rowCount ?? 0} 行` +
      `(行内的价不用改 —— 读的时候按目录重算)`
  );

  /* ── 3. 商品目录:按代码里的字典重新定价 ───────────────────────────── */

  // 3.1 product.base_price_cents
  const productRows = await client.query<{
    code: string;
    base_price_cents: number;
  }>(`SELECT "code", "base_price_cents" FROM "product"`);

  let productUpdated = 0;
  for (const row of productRows.rows) {
    const next = BASE_PRICE_CENTS[row.code];
    if (next === undefined) continue; // 字典里没有这个型号 → 不动
    if (next === row.base_price_cents) continue;
    await client.query(
      `UPDATE "product"
          SET "base_price_cents" = $1, "updated_at" = now()
        WHERE "code" = $2;`,
      [next, row.code]
    );
    productUpdated += 1;
    console.log(
      `  · product ${row.code}: ${row.base_price_cents} → ${next} 分` +
        `($${(row.base_price_cents / 100).toFixed(2)} → $${(next / 100).toFixed(2)})`
    );
  }
  console.log(`✓ product.base_price_cents:改写 ${productUpdated} 行`);

  // 3.2 product_accessory_variant.price_delta_cents
  //     键 = 产品码 | 配件码 | 变体码
  const codeAccMap = new Map<string, number>();
  for (const v of PRODUCT_ACCESSORY_VARIANTS) {
    codeAccMap.set(
      accKey(v.productTypeCode, v.accessoryCode, v.variantCode),
      v.priceDeltaCents
    );
  }

  const accRows = await client.query<{
    product_type_code: string;
    accessory_code: string;
    variant_code: string;
    price_delta_cents: number;
  }>(
    `SELECT "product_type_code", "accessory_code", "variant_code", "price_delta_cents"
       FROM "product_accessory_variant"`
  );

  let accUpdated = 0;
  let accUnmatched = 0;
  for (const row of accRows.rows) {
    const key = accKey(
      row.product_type_code,
      row.accessory_code,
      row.variant_code
    );
    const next = codeAccMap.get(key);
    if (next === undefined) {
      // 代码字典里没有这一行(可能是 admin 自己加的)—— 保持原样
      accUnmatched += 1;
      continue;
    }
    if (next === row.price_delta_cents) continue;
    await client.query(
      `UPDATE "product_accessory_variant"
          SET "price_delta_cents" = $1, "updated_at" = now()
        WHERE "product_type_code" = $2
          AND "accessory_code" = $3
          AND "variant_code" = $4;`,
      [next, row.product_type_code, row.accessory_code, row.variant_code]
    );
    accUpdated += 1;
  }
  console.log(
    `✓ product_accessory_variant.price_delta_cents:改写 ${accUpdated} 行` +
      (accUnmatched > 0 ? `(${accUnmatched} 行不在代码字典里,原样保留)` : "")
  );

  // 3.3 product_variant.price_cents
  //     = 新基础价 + 尺寸档位 × SIZE_STEP_CENTS + 配件变体加价
  //     公式跟 buildAllVariantSeeds() 一致 —— 两边对不上就是 SKU 矩阵错了
  const newBase = new Map<string, number>();
  for (const row of productRows.rows) {
    const next = BASE_PRICE_CENTS[row.code];
    newBase.set(row.code, next ?? row.base_price_cents);
  }

  // 配件加价:优先用代码字典,字典没有的用 DB 里的(上面已经改过了)
  const accDelta = new Map<string, number>();
  for (const row of accRows.rows) {
    const key = accKey(
      row.product_type_code,
      row.accessory_code,
      row.variant_code
    );
    accDelta.set(key, codeAccMap.get(key) ?? row.price_delta_cents);
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

  let variantUpdated = 0;
  let variantUnmatched = 0;
  for (const row of variantRows.rows) {
    const productType = PRODUCT_TYPES.find(
      (pt) => pt.code === row.product_code
    );
    if (!productType) {
      variantUnmatched += 1;
      continue;
    }
    const sizeIdx = productType.sizes.indexOf(row.size_code);
    const sizeDelta = (sizeIdx < 0 ? 0 : sizeIdx) * SIZE_STEP_CENTS;
    const delta = accDelta.get(
      accKey(row.product_code, row.accessory_code, row.variant_code)
    );
    const next =
      (newBase.get(row.product_code) ?? 0) + sizeDelta + (delta ?? 0);
    if (next === row.price_cents) continue;
    await client.query(
      `UPDATE "product_variant"
          SET "price_cents" = $1, "updated_at" = now()
        WHERE "sku" = $2;`,
      [next, row.sku]
    );
    variantUpdated += 1;
  }
  console.log(
    `✓ product_variant.price_cents:改写 ${variantUpdated} 行` +
      (variantUnmatched > 0
        ? `(${variantUnmatched} 行对不上字典,原样保留)`
        : "")
  );

  /* ── 4. 历史订单:只报告,不动 ──────────────────────────────────────── */

  const orderStats = await client.query<{
    payment_status: string;
    count: number;
  }>(
    `SELECT "payment_status", count(*)::int AS "count"
       FROM "storefront_order"
      WHERE "currency" IS DISTINCT FROM 'USD'
      GROUP BY "payment_status"
      ORDER BY "payment_status"`
  );

  if (orderStats.rows.length === 0) {
    console.log("✓ 历史订单:没有非美元的订单");
  } else {
    console.log(
      "\n[历史订单]以下订单还是人民币 —— **脚本没有改它们**(改了就是篡改账本):"
    );
    for (const row of orderStats.rows) {
      console.log(`  · ${row.payment_status}:${row.count} 笔`);
    }
    const unpaid = orderStats.rows.find((r) => r.payment_status === "unpaid");
    if (unpaid) {
      console.log(
        "\n  这些未付款的旧单**现在付不了**(三个通道只收美元,通道会明确报错," +
          "不会收错钱)。要不要取消是工作室的决定 —— 需要的话跑这条:\n" +
          "    UPDATE storefront_order SET status = 'cancelled'\n" +
          "     WHERE currency <> 'USD' AND payment_status = 'unpaid';"
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
       (SELECT count(*)::int FROM storefront_order WHERE currency <> 'USD')
         AS legacy_orders;`
  );
  console.log(
    `\n[apply-usd-currency] storefront_order.currency 默认值 = ${check.rows[0]?.order_currency}, ` +
      `cart.currency_code = ${check.rows[0]?.cart_currency}, ` +
      `cart.region_id = ${check.rows[0]?.cart_region}, ` +
      `仍是非美元的订单 ${check.rows[0]?.legacy_orders} 笔`
  );

  await client.end();
  console.log(
    "\n[apply-usd-currency] 完成。接下来跑一遍 seed 补上新增的配件变体:\n" +
      "  pnpm tsx src/db/seed-product-accessory-variants.ts\n" +
      "  pnpm tsx src/db/seed-products.ts"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
