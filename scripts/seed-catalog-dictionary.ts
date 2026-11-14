#!/usr/bin/env -S npx tsx

/**
 * Seed:商品目录字典(2026-11-14)
 *
 * 把**代码常量**搬进 DB 字典表:
 * - `product_size` —— 每个型号的尺寸档 + **显式加价**(`idx * 500`)
 * - `product_accessory` —— 配件字典(取代 `ACCESSORY_META`)
 * - `product_accessory_option` —— 「哪个型号能配哪些配件」
 * - `product_accessory_variant.applies_to_sizes_cm` —— 玻璃罩那三个变体的
 *   `[4]` / `[6]` / `[8]`
 *
 * ## 为什么要播种
 *
 * 尺寸 / 配件清单搬进 DB 之后,**DB 是真理源**,代码常量只是**兜底**。
 * 兜底的口径是「DB 没播种 ⇒ 行为跟今天一模一样」⇒ **不播种也完全能跑**。
 *
 * 播种的意义是:**让工作室在后台看到的就是现在这套配置**,改起来心里有底。
 * 而且播种之后,后台改一行就能立刻看到效果(不播种的话,后台那一页是空的)。
 *
 * ## ⚠️ 切过去的那一刻,**行为零变化**
 *
 * 播种进去的值**就是今天代码常量算出来的值**:
 * - 尺寸加价 = `idx * 500`(跟那四处散落的算法一模一样)
 * - 尺寸排序 = `(idx + 1) * 10`
 * - 配件排序 = `(idx + 1) * 10`(按 `ACCESSORIES` 的顺序)
 * - 配件归属排序 = `(idx + 1) * 10`(按 `PRODUCT_TYPES[].accessories` 的顺序)
 *
 * ⚠️ **配件的名字 / 分类取自 `ACCESSORY_META`,不是 `ACCESSORIES`** ——
 * 两份常量的 `name` 不完全一样(`metal`:`ACCESSORIES` 写「金属」、
 * `ACCESSORY_META` 写「金属扣」)。兜底字典用的是 `ACCESSORY_META`
 * ⇒ 播种必须跟它一致,否则「播种前 / 播种后」行为会变。
 *
 * ## 幂等 + **不覆盖工作室改过的值**
 *
 * - 插入一律 `ON CONFLICT DO NOTHING` ⇒ 已有行**一个字都不动**。
 * - `applies_to_sizes_cm` 的回填**只改还停在默认值 `'[]'` 的行** ⇒
 *   工作室已经配过的行不会被覆盖。
 *
 * ⇒ **跑几遍都安全**,而且**不会把后台改的价悄悄改回去**。
 *
 * ## 用法
 *
 * ```bash
 * # 只打印要写什么,不连库
 * pnpm tsx scripts/seed-catalog-dictionary.ts --dry-run
 *
 * # 真跑
 * pnpm tsx scripts/seed-catalog-dictionary.ts
 * pnpm seed:catalog-dictionary
 * ```
 *
 * **不代跑** —— 工作室的库由工作室自己执行。
 *
 * ## 前置
 *
 * 先跑迁移(建表 + 加列):
 *
 * ```bash
 * pnpm migrate:apply-catalog-dictionary
 * ```
 */

// ⚠️ 必须排 import 列表**第一个** —— `src/db/index.ts` 在模块顶层就查
// `DATABASE_URL`,拿不到直接抛错。静态 import 比模块体先跑,所以 .env 得
// 先加载,再让 `@/db` 被求值。顺序反了照样炸(见 scripts/lib/load-env.ts)。
import "./lib/load-env";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  productAccessory,
  productAccessoryOption,
  productAccessoryVariant,
  productSize,
} from "@/db/schema";
import {
  ACCESSORIES,
  ACCESSORY_META,
  PRODUCT_TYPES,
} from "@/features/gpt-image/lib/product-catalog";
import { PRODUCT_ACCESSORY_VARIANTS } from "@/features/gpt-image/lib/product-accessory-variants";

/** `--dry-run` —— 只打印要写什么,不连库 */
const DRY_RUN = process.argv.includes("--dry-run");

/** 尺寸加价的步长 —— 跟 `catalog-dictionary.ts` 的 `SIZE_STEP_CENTS` 一个值 */
const SIZE_STEP_CENTS = 500;

/**
 * `ACCESSORY_META` 的 key 是字面量联合类型,按字符串查要转一下
 *
 * ⚠️ 转成 `Record<string, ... | undefined>` ⇒ 查不到就是 `undefined`
 * (而不是 TS 报错)—— 兜底逻辑跟 `catalog-dictionary.ts` 的
 * `lookupAccessoryMeta` 一个口径。
 */
const accessoryMetaTable = ACCESSORY_META as Readonly<
  Record<
    string,
    { category: string; name: { zh: string; en: string } } | undefined
  >
>;

/* -------------------------------------------------------------------------- */
/*  要写的行                                                                     */
/* -------------------------------------------------------------------------- */

/** `product_size` 行 —— 显式加价 = `idx * 500` */
const sizeRows = PRODUCT_TYPES.flatMap((type) =>
  type.sizes.map((sizeCode, idx) => ({
    id: `ps_${type.code}_${sizeCode}`,
    productTypeCode: type.code,
    sizeCode,
    priceDeltaCents: idx * SIZE_STEP_CENTS,
    sortOrder: (idx + 1) * 10,
    isActive: true,
  }))
);

/** `product_accessory` 行 —— 名字 / 分类跟 `ACCESSORY_META` 一个口径 */
const accessoryRows = ACCESSORIES.map((accessory, idx) => {
  const meta = accessoryMetaTable[accessory.code];
  return {
    code: accessory.code,
    name: meta?.name.zh ?? accessory.code,
    nameEn: meta?.name.en ?? accessory.code,
    category: meta?.category ?? "decor",
    sortOrder: (idx + 1) * 10,
    isActive: true,
  };
});

/** `product_accessory_option` 行 —— 「哪个型号能配哪些配件」 */
const accessoryOptionRows = PRODUCT_TYPES.flatMap((type) =>
  type.accessories.map((accessoryCode, idx) => ({
    id: `pao_${type.code}_${accessoryCode}`,
    productTypeCode: type.code,
    accessoryCode,
    sortOrder: (idx + 1) * 10,
    isActive: true,
  }))
);

/**
 * `product_accessory_variant` 行 —— **只补缺的**
 *
 * 已有行不动(`ON CONFLICT DO NOTHING`)⇒ 工作室改过的加价 / 名字不会被覆盖。
 */
const variantRows = PRODUCT_ACCESSORY_VARIANTS.map((variant) => ({
  id: `pav_${variant.productTypeCode}_${variant.accessoryCode}_${variant.variantCode}`,
  productTypeCode: variant.productTypeCode,
  accessoryCode: variant.accessoryCode,
  variantCode: variant.variantCode,
  name: variant.name,
  nameEn: variant.nameEn,
  swatch: variant.swatch,
  priceDeltaCents: variant.priceDeltaCents,
  appliesToSizesCm: JSON.stringify(variant.appliesToSizesCm),
  sortOrder: variant.sortOrder,
  isActive: true,
}));

/**
 * 「适用尺寸」要回填的行 —— **只有非空的才要回填**
 *
 * 代码常量里 `appliesToSizesCm = []` 的那些(皮套 / 编织绳 / 底座)= 不限尺寸,
 * DB 里那个默认值就是 `'[]'` ⇒ **什么都不用写**。
 */
const appliesToSizesBackfill = PRODUCT_ACCESSORY_VARIANTS.filter(
  (variant) => variant.appliesToSizesCm.length > 0
).map((variant) => ({
  productTypeCode: variant.productTypeCode,
  accessoryCode: variant.accessoryCode,
  variantCode: variant.variantCode,
  value: JSON.stringify(variant.appliesToSizesCm),
}));

/* -------------------------------------------------------------------------- */
/*  跑                                                                           */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log(
    "[seed-catalog-dictionary] 把代码常量搬进 DB 字典表\n" +
      `  product_size              ${sizeRows.length} 行` +
      `(加价 = idx * ${SIZE_STEP_CENTS})\n` +
      `  product_accessory         ${accessoryRows.length} 行\n` +
      `  product_accessory_option  ${accessoryOptionRows.length} 行\n` +
      `  product_accessory_variant ${variantRows.length} 行(只补缺的)\n` +
      "  ⚠️ 已存在的行**一个字都不动**(ON CONFLICT DO NOTHING)\n"
  );

  if (DRY_RUN) {
    console.log("[seed-catalog-dictionary] --dry-run:不连库,下面是写的内容\n");
    console.log("-- product_size");
    for (const row of sizeRows) {
      console.log(
        `   ${row.productTypeCode} / ${row.sizeCode}  +${row.priceDeltaCents} 分  排序 ${row.sortOrder}`
      );
    }
    console.log("-- product_accessory");
    for (const row of accessoryRows) {
      console.log(
        `   ${row.code}  ${row.name} / ${row.nameEn}  [${row.category}]  排序 ${row.sortOrder}`
      );
    }
    console.log("-- product_accessory_option");
    for (const row of accessoryOptionRows) {
      console.log(
        `   ${row.productTypeCode} → ${row.accessoryCode}  排序 ${row.sortOrder}`
      );
    }
    console.log("-- product_accessory_variant(缺失的那些)");
    for (const row of variantRows) {
      console.log(
        `   ${row.productTypeCode}/${row.accessoryCode}/${row.variantCode}` +
          `  +${row.priceDeltaCents} 分  适用尺寸 ${row.appliesToSizesCm}`
      );
    }
    console.log("-- 适用尺寸回填(只改还停在 '[]' 的行)");
    for (const row of appliesToSizesBackfill) {
      console.log(
        `   ${row.productTypeCode}/${row.accessoryCode}/${row.variantCode} → ${row.value}`
      );
    }
    return;
  }

  /* -------------------------------------------------------------- 尺寸字典 -- */

  const insertedSizes = await db
    .insert(productSize)
    .values(sizeRows)
    .onConflictDoNothing({
      target: [productSize.productTypeCode, productSize.sizeCode],
    })
    .returning({ id: productSize.id });

  console.log(
    `✓ product_size:写入 ${insertedSizes.length} 行(其余 ${sizeRows.length - insertedSizes.length} 行已存在,没动)`
  );

  /* -------------------------------------------------------------- 配件字典 -- */

  const insertedAccessories = await db
    .insert(productAccessory)
    .values(accessoryRows)
    .onConflictDoNothing({ target: productAccessory.code })
    .returning({ code: productAccessory.code });

  console.log(
    `✓ product_accessory:写入 ${insertedAccessories.length} 行(其余 ${accessoryRows.length - insertedAccessories.length} 行已存在,没动)`
  );

  /* ---------------------------------------------------------- 配件归属字典 -- */

  const insertedOptions = await db
    .insert(productAccessoryOption)
    .values(accessoryOptionRows)
    .onConflictDoNothing({
      target: [
        productAccessoryOption.productTypeCode,
        productAccessoryOption.accessoryCode,
      ],
    })
    .returning({ id: productAccessoryOption.id });

  console.log(
    `✓ product_accessory_option:写入 ${insertedOptions.length} 行(其余 ${accessoryOptionRows.length - insertedOptions.length} 行已存在,没动)`
  );

  /* ---------------------------------------------------------- 配件变体缺行 -- */

  const insertedVariants = await db
    .insert(productAccessoryVariant)
    .values(variantRows)
    .onConflictDoNothing({
      target: [
        productAccessoryVariant.productTypeCode,
        productAccessoryVariant.accessoryCode,
        productAccessoryVariant.variantCode,
      ],
    })
    .returning({ id: productAccessoryVariant.id });

  console.log(
    `✓ product_accessory_variant:补了 ${insertedVariants.length} 行缺行(其余 ${variantRows.length - insertedVariants.length} 行已存在,没动)`
  );

  /* ------------------------------------------- 「适用尺寸」回填(只填空值) -- */

  /**
   * `applies_to_sizes_cm` 回填 —— **只改还停在默认值 `'[]'` 的行**
   *
   * 为什么不是无条件 UPDATE:工作室在后台配过的「适用尺寸」不能被覆盖。
   * 只在 `= '[]'` 时写 ⇒ 已配过的行一个字节都不动。
   *
   * ⚠️ 玻璃罩那三个变体的目标是 `[4]` / `[6]` / `[8]`,不是 `[]` ⇒
   * 「还没配」跟「不限尺寸」在目标值上不会混淆。
   */
  let backfilled = 0;
  for (const row of appliesToSizesBackfill) {
    const updated = await db
      .update(productAccessoryVariant)
      .set({ appliesToSizesCm: row.value })
      .where(
        and(
          eq(productAccessoryVariant.productTypeCode, row.productTypeCode),
          eq(productAccessoryVariant.accessoryCode, row.accessoryCode),
          eq(productAccessoryVariant.variantCode, row.variantCode),
          eq(productAccessoryVariant.appliesToSizesCm, "[]")
        )
      )
      .returning({ id: productAccessoryVariant.id });
    backfilled += updated.length;
  }

  console.log(
    `✓ product_accessory_variant.applies_to_sizes_cm:回填 ${backfilled} 行(已是目标值 / 工作室改过的,没动)`
  );

  console.log(
    "\n[seed-catalog-dictionary] 完成 —— 尺寸加价 / 配件加价现在跟随后台了。\n" +
      "  改动尺寸加价 ⇒ 对应型号的 SKU 绝对价会重算(后台自动做)。"
  );
}

main().catch((error) => {
  console.error("[seed-catalog-dictionary] 失败:", error);
  process.exit(1);
});
