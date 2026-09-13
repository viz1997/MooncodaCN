#!/usr/bin/env -S npx tsx

/**
 * 2026-09-12：一锅端 apply drizzle/0006~0013 所有遗漏 migration
 *
 * 起因：production 一连串 PG 42703（platform_order_no / leather_color / ...），
 * 排查发现 drizzle/0006+ 一系列手写 SQL 增量从来没在两边 DB 跑过：
 *   - db:push 卡 TTY 交互式（见 [[db-push-interactive-blocker]]）
 *   - drizzle-kit migrate 也跑不通（这些不是 drizzle-kit 生成的 migration）
 *   - 所以老套路是手工 psql 跑，但 production 一直没补
 *
 * 这次把 0006 ~ 0013 所有 additive / IF NOT EXISTS 语句一次性跑完：
 *   0006  prompt_order cursor indexes
 *   0007  prompt_order LB 4 列
 *   0008  product_effect allowed_capabilities / allowed_colors
 *   0009  product_line 新表 + product_effect.prompt_template_id
 *   0010  product_effect + prompt_template allowed_sizes / allowed_accessories
 *   0011  product_effect + prompt_template model default = 'qwen'
 *   0012  prompt_order platform 列
 *   0013  prompt_order platform_order_no 列
 *   0014  prompt_template_price 新表 + prompt_order credits_charged / credits_breakdown 列
 *   0015  prompt_order.is_preview_share 列
 *
 * 所有语句都包了 IF NOT EXISTS（或 SET DEFAULT，本身幂等），
 * 重复跑安全。脚本里直接 embed SQL 而非读 .sql 文件，避免
 * dev 环境 drizzle/ 路径解析不一致。
 *
 * 用法：
 *   pnpm tsx scripts/apply-all-missing-migrations.ts
 *
 * prod 需要把 Vercel 环境变量 DATABASE_URL 临时拷到 .env.local 再跑，
 * 或在 Vercel SQL / Supabase 控制台直接跑等价的 SQL（脚本里每条语句都打印了 label）。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-all] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const statements: Array<{ label: string; query: string }> = [
    // 0006 prompt_order cursor indexes
    {
      label: "0006 prompt_order_cursor_idx",
      query: `CREATE INDEX IF NOT EXISTS "prompt_order_cursor_idx"
        ON "prompt_order" ("created_by", "created_at" DESC, "id" DESC);`,
    },
    {
      label: "0006 prompt_order_cursor_status_idx",
      query: `CREATE INDEX IF NOT EXISTS "prompt_order_cursor_status_idx"
        ON "prompt_order" ("created_by", "status", "created_at" DESC, "id" DESC);`,
    },

    // 0007 prompt_order LB 4 列
    {
      label: "0007 prompt_order.leather_color",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "leather_color" text;`,
    },
    {
      label: "0007 prompt_order.leather_exposed",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "leather_exposed" boolean;`,
    },
    {
      label: "0007 prompt_order.pvc_protection",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "pvc_protection" boolean;`,
    },
    {
      label: "0007 prompt_order.remarks",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "remarks" text;`,
    },

    // 0008 product_effect LB capabilities + colors
    {
      label: "0008 product_effect.allowed_capabilities",
      query: `ALTER TABLE "product_effect" ADD COLUMN IF NOT EXISTS "allowed_capabilities" text;`,
    },
    {
      label: "0008 product_effect.allowed_colors",
      query: `ALTER TABLE "product_effect" ADD COLUMN IF NOT EXISTS "allowed_colors" text;`,
    },

    // 0009 product_line 新表 + product_effect.prompt_template_id
    {
      label: "0009 CREATE TABLE product_line",
      query: `CREATE TABLE IF NOT EXISTS "product_line" (
        "product_line_id" text PRIMARY KEY,
        "name" text NOT NULL,
        "category" text NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "cover_url" text NOT NULL DEFAULT '',
        "spec" text NOT NULL DEFAULT '',
        "pricing" text NOT NULL DEFAULT '',
        "status" text NOT NULL DEFAULT 'active',
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label: "0009 product_line_status_idx",
      query: `CREATE INDEX IF NOT EXISTS "product_line_status_idx"
        ON "product_line" ("status");`,
    },
    {
      label: "0009 product_effect.prompt_template_id",
      query: `ALTER TABLE "product_effect" ADD COLUMN IF NOT EXISTS "prompt_template_id" text;`,
    },

    // 0010 allowed_sizes / allowed_accessories on product_effect + prompt_template
    {
      label: "0010 product_effect.allowed_sizes",
      query: `ALTER TABLE "product_effect" ADD COLUMN IF NOT EXISTS "allowed_sizes" text;`,
    },
    {
      label: "0010 product_effect.allowed_accessories",
      query: `ALTER TABLE "product_effect" ADD COLUMN IF NOT EXISTS "allowed_accessories" text;`,
    },
    {
      label: "0010 prompt_template.allowed_sizes",
      query: `ALTER TABLE "prompt_template" ADD COLUMN IF NOT EXISTS "allowed_sizes" text;`,
    },
    {
      label: "0010 prompt_template.allowed_accessories",
      query: `ALTER TABLE "prompt_template" ADD COLUMN IF NOT EXISTS "allowed_accessories" text;`,
    },

    // 0011 model default = 'qwen'
    {
      label: "0011 product_effect.model DEFAULT qwen",
      query: `ALTER TABLE "product_effect" ALTER COLUMN "model" SET DEFAULT 'qwen';`,
    },
    {
      label: "0011 prompt_template.model DEFAULT qwen",
      query: `ALTER TABLE "prompt_template" ALTER COLUMN "model" SET DEFAULT 'qwen';`,
    },

    // 0012 prompt_order.platform
    {
      label: "0012 prompt_order.platform",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "platform" text;`,
    },

    // 0013 prompt_order.platform_order_no
    {
      label: "0013 prompt_order.platform_order_no",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "platform_order_no" text;`,
    },

    // 0014 prompt_template_price 新表 + prompt_order credits_charged / credits_breakdown
    {
      label: "0014 CREATE TABLE prompt_template_price",
      query: `CREATE TABLE IF NOT EXISTS "prompt_template_price" (
        "id" text PRIMARY KEY,
        "template_id" text NOT NULL
          REFERENCES "prompt_template"("id") ON DELETE CASCADE,
        "spec_key" text NOT NULL,
        "price_delta" integer NOT NULL DEFAULT 0,
        "label" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label: "0014 ptp_template_spec_unique",
      query: `CREATE UNIQUE INDEX IF NOT EXISTS "ptp_template_spec_unique"
        ON "prompt_template_price" ("template_id", "spec_key");`,
    },
    {
      label: "0014 ptp_template_idx",
      query: `CREATE INDEX IF NOT EXISTS "ptp_template_idx"
        ON "prompt_template_price" ("template_id");`,
    },
    {
      label: "0014 prompt_order.credits_charged",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "credits_charged" integer;`,
    },
    {
      label: "0014 prompt_order.credits_breakdown",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "credits_breakdown" text;`,
    },

    // 0015 prompt_order.is_preview_share
    {
      label: "0015 prompt_order.is_preview_share",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "is_preview_share" boolean NOT NULL DEFAULT false;`,
    },
  ];

  let ok = 0;
  let fail = 0;
  for (const { label, query } of statements) {
    process.stdout.write(`[apply-all] ${label} ... `);
    try {
      await client.query(query);
      console.log("✓");
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗\n[apply-all] ${label} 失败：${msg}`);
      fail++;
      // 不立即退出 —— 把全部跑完，最后给汇总
    }
  }

  console.log(`\n[apply-all] 完成：✓ ${ok} / ✗ ${fail} / 总 ${statements.length}`);
  await client.end();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[apply-all] 未处理错误：", err);
  process.exit(1);
});