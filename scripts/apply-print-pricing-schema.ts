#!/usr/bin/env -S npx tsx

/**
 * 应用「打印定价后台」schema(2026-11-06)
 *
 * - `print_material`       —— 材料库(多档可选)
 * - `print_pricing_config` —— 单行设置(`id = 'default'`)
 *
 * ## 这个脚本做什么、不做什么
 *
 * **做**:建表 + 建索引 + 播种两条出厂材料预设。
 *
 * **不做**:不写 `print_pricing_config` 那一行。
 *
 * 配置行为空 = 生效值走 `PRINT_*` 环境变量 → `DEFAULT_CONFIG` 那条老路
 * (逐字段回退)。这样**迁移那一刻线上价格不会静默变掉** —— 跑完脚本
 * 之后,线上还是按今天的价格算,直到工作室在 `/admin/print-pricing`
 * 第一次点「保存」,才把「当前生效值」固化进 DB。
 *
 * ## 为什么播种材料、不播种配置
 *
 * 材料库是**内容**(有它没它都不影响算价),配置行是**决定**(写进去就
 * 接管定价)。播种材料 = 后台一打开就有一份可参考的出厂预设(而且
 * 正好是今天生效的那一档);不播种配置 = 不替工作室做决定。
 *
 * 播种的密度 / 单价取自 `PRINT_*` 环境变量 —— 线上配过的话,预置就
 * 等于线上那一档;没配就是默认值(密度 1.2 / 单价 450 分/g / 支撑密度 1.28)。
 *
 * ## 播种只插不覆盖
 *
 * `ON CONFLICT DO NOTHING` —— 工作室在后台把 `builtin-model` 的密度
 * 改成 1.15 之后,再跑一遍这个脚本**不会**把它改回去。
 *
 * ## 2026-11-07:多一列 `allow_guest_pricing`
 *
 * 「访客可见计价」那个开关的列。线上那张表是 2026-11-06 建的,少这一列 ——
 * 而少了它,读配置那条 `SELECT` 会整条报错(读不到 → 整份退回环境变量兜底,
 * 后台看到的是「读不到定价配置」)。所以这个脚本里有一句 `ALTER TABLE …
 * ADD COLUMN IF NOT EXISTS`,跑一遍就补上,幂等。
 *
 * ## 为什么手写而不是 `db:generate`
 *
 * `db:generate` 生成的迁移文件会**顺着整张 schema 的历史**走一遍,跟库里
 * 已有状态对不上的时候要人工调。这个仓库的迁移都是手写幂等脚本,
 * 跑几遍都安全。
 *
 * 用法:
 *   pnpm tsx scripts/apply-print-pricing-schema.ts
 *   pnpm migrate:print-pricing
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

/** 读一个非负数字环境变量;非法或缺失时用 fallback */
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

/** 出厂预设的值 —— 跟 `pricing-settings.ts` 的兜底口径一致 */
const SEED = {
  model: {
    id: "builtin-model",
    code: "builtin-model",
    name: "出厂树脂",
    kind: "model",
    density: envNumber("PRINT_MATERIAL_DENSITY", 1.2),
    unitPriceCentsPerGram: Math.round(
      envNumber("PRINT_UNIT_PRICE_CENTS_PER_GRAM", 450)
    ),
    sortOrder: 0,
  },
  support: {
    id: "builtin-support",
    code: "builtin-support",
    name: "水溶性支撑",
    kind: "support",
    density: envNumber("PRINT_SUPPORT_DENSITY", 1.28),
    // 支撑的价走「分段规则」(在 print_pricing_config 上),不是材料的每克价
    unitPriceCentsPerGram: null as number | null,
    sortOrder: 1,
  },
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-print-pricing] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const statements: Array<{ label: string; query: string }> = [
    {
      label: "CREATE TABLE print_material",
      query: `CREATE TABLE IF NOT EXISTS "print_material" (
        "id" text PRIMARY KEY,
        "code" text NOT NULL,
        "name" text NOT NULL,
        "kind" text NOT NULL,
        "density" numeric(8,4) NOT NULL,
        "unit_price_cents_per_gram" integer,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label: "CREATE TABLE print_pricing_config",
      query: `CREATE TABLE IF NOT EXISTS "print_pricing_config" (
        "id" text PRIMARY KEY,
        "model_material_id" text REFERENCES "print_material"("id") ON DELETE SET NULL,
        "support_material_id" text REFERENCES "print_material"("id") ON DELETE SET NULL,
        "varnish_fee_cents" integer NOT NULL DEFAULT 1000,
        "varnish_enabled" boolean NOT NULL DEFAULT true,
        "support_threshold" numeric(8,4) NOT NULL DEFAULT '1.0000',
        "support_tier1_ratio" numeric(8,4) NOT NULL DEFAULT '2.0000',
        "support_tier1_price_cents_per_gram" integer NOT NULL DEFAULT 50,
        "support_tier2_price_cents_per_gram" integer NOT NULL DEFAULT 100,
        "support_enabled" boolean NOT NULL DEFAULT false,
        "support_lift_mm" numeric(8,2) NOT NULL DEFAULT '5.00',
        "support_base_margin_mm" numeric(8,2) NOT NULL DEFAULT '5.00',
        "delivery_express_rate" numeric(6,4) NOT NULL DEFAULT '0.1000',
        "delivery_urgent_rate" numeric(6,4) NOT NULL DEFAULT '0.3700',
        "allow_guest_pricing" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      // 2026-11-07:「访客可见计价」那个开关。线上那张表是 2026-11-06 建的,
      // 少这一列 —— 而少了它,`SELECT *` 会整条报错(读不到配置 → 整份退回
      // 环境变量兜底,后台看到的是「读不到定价配置」)。所以补一列。
      //
      // 幂等:跑几遍都安全。默认值 true = 跟代码里的默认值一致
      // (工作室的原话是「现在不登录也允许计价显示」)。
      label: "ALTER TABLE print_pricing_config ADD allow_guest_pricing",
      query: `ALTER TABLE "print_pricing_config"
        ADD COLUMN IF NOT EXISTS "allow_guest_pricing" boolean NOT NULL DEFAULT true;`,
    },
    {
      label: "CREATE INDEX print_material_code_uniq_idx",
      query: `CREATE UNIQUE INDEX IF NOT EXISTS "print_material_code_uniq_idx"
        ON "print_material" ("code");`,
    },
    {
      label: "CREATE INDEX print_material_kind_active_idx",
      query: `CREATE INDEX IF NOT EXISTS "print_material_kind_active_idx"
        ON "print_material" ("kind", "is_active");`,
    },
  ];

  for (const { label, query } of statements) {
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

  // 播种出厂材料 —— ON CONFLICT DO NOTHING(工作室改过的不会被改回去)
  const seeds = [SEED.model, SEED.support];
  for (const seed of seeds) {
    try {
      await client.query(
        `INSERT INTO "print_material"
           ("id", "code", "name", "kind", "density", "unit_price_cents_per_gram",
            "is_active", "sort_order")
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)
         ON CONFLICT DO NOTHING;`,
        [
          seed.id,
          seed.code,
          seed.name,
          seed.kind,
          String(seed.density),
          seed.unitPriceCentsPerGram,
          seed.sortOrder,
        ]
      );
      console.log(`✓ 播种材料 ${seed.code}`);
    } catch (error) {
      console.error(`✗ 播种材料 ${seed.code}`);
      console.error(error instanceof Error ? error.message : error);
      await client.end();
      process.exit(1);
    }
  }

  // 回读一次 —— 确认表真的在、种子真的在、配置行确实**没**被写
  const check = await client.query<{
    material_count: string;
    seed_count: string;
    config_exists: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM "print_material")
         AS material_count,
       (SELECT count(*)::text FROM "print_material"
          WHERE "code" IN ('builtin-model', 'builtin-support'))
         AS seed_count,
       (SELECT count(*)::text FROM "print_pricing_config" WHERE "id" = 'default')
         AS config_exists;`
  );

  const row = check.rows[0];
  console.log(
    `[apply-print-pricing] 材料库 ${row?.material_count ?? 0} 行 ` +
      `(出厂预设 ${row?.seed_count ?? 0} 条),` +
      `配置行 ${row?.config_exists === "1" ? "存在" : "不存在"}`
  );

  if (row?.config_exists === "1") {
    console.log(
      "[apply-print-pricing] 配置行已存在 —— 生效值由后台那一行接管," +
        "本脚本不会改它"
    );
  } else {
    console.log(
      "[apply-print-pricing] 还没写配置行 —— 生效值仍走 PRINT_* 环境变量," +
        "到 /admin/print-pricing 点一次「保存」才固化"
    );
  }

  await client.end();
  console.log("\n[apply-print-pricing] 完成");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
