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
 *   0016  preview_share 独立表（分享链接 ≠ 下单）—— 创建 + 3 个索引
 *   0017  prompt_order.is_preview_share 列移除（preview_share 独立后不再需要）
 *   0040  preview_share 升级 6 步工作台 —— 扩 enum 至 9 态 + 16 字段 + 1 索引
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

    // 0016 preview_share 独立表（分享链接 ≠ 下单实体）
    {
      label: "0016 CREATE TABLE preview_share",
      query: `
        CREATE TABLE IF NOT EXISTS "preview_share" (
          "id" text PRIMARY KEY,
          "order_no" text NOT NULL UNIQUE,
          "token" text NOT NULL UNIQUE,
          "template_id" text NOT NULL REFERENCES "prompt_template"("id") ON DELETE RESTRICT,
          "reference_image_url" text NOT NULL,
          "demo_preview_url" text NOT NULL,
          "candidates" text NOT NULL,
          "selected_cell" integer,
          "credits_charged" integer NOT NULL DEFAULT 0,
          "credits_breakdown" text,
          "product_type_code" text,
          "product_size" text,
          "accessory_code" text,
          "engraving_text" text,
          "engraving_exposed" boolean,
          "leather_color" text,
          "leather_exposed" boolean,
          "pvc_protection" boolean,
          "remarks" text,
          "platform" text,
          "platform_order_no" text,
          "status" text NOT NULL DEFAULT 'pending',
          "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
          "linked_order_id" text,
          "confirmed_at" timestamp,
          "confirmed_by_ip" text,
          "expires_at" timestamp NOT NULL,
          "created_at" timestamp NOT NULL DEFAULT now(),
          "updated_at" timestamp NOT NULL DEFAULT now()
        );
      `,
    },
    {
      label: "0016 preview_share_creator_created_idx",
      query: `CREATE INDEX IF NOT EXISTS "preview_share_creator_created_idx" ON "preview_share"("created_by", "created_at" DESC);`,
    },
    {
      label: "0016 preview_share_status_expires_idx",
      query: `CREATE INDEX IF NOT EXISTS "preview_share_status_expires_idx" ON "preview_share"("status", "expires_at");`,
    },
    {
      label: "0016 preview_share_linked_order_idx",
      query: `CREATE INDEX IF NOT EXISTS "preview_share_linked_order_idx" ON "preview_share"("linked_order_id");`,
    },

    // 0017 prompt_order.is_preview_share 列移除
    {
      label: "0017 DROP prompt_order.is_preview_share",
      query: `ALTER TABLE "prompt_order" DROP COLUMN IF EXISTS "is_preview_share";`,
    },

    // 0040 preview_share 升级 6 步工作台（preview 流可走完整 ToC 流程 + credit 锁定）
    //
    // 注意：status 字段在 0016 是 text 列（不是 PG enum 类型），所以新状态值
    // 直接落到 text 上即可，不需要 ALTER TYPE。status 校验由 schema.ts 的
    // previewShareStatusValues literal union 在 TS 层把关。
    //
    // 状态机列（镜像 promptOrder 字段名）
    {
      label: "0040 uploaded_images",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "uploaded_images" text;`,
    },
    {
      label: "0040 images_per_upload",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "images_per_upload" integer NOT NULL DEFAULT 3;`,
    },
    {
      label: "0040 upload_count",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "upload_count" integer NOT NULL DEFAULT 0;`,
    },
    {
      label: "0040 uploaded_at",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "uploaded_at" timestamp;`,
    },
    {
      label: "0040 generated_at",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "generated_at" timestamp;`,
    },
    {
      label: "0040 selections",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "selections" text;`,
    },
    {
      label: "0040 selected_index",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "selected_index" integer;`,
    },
    {
      label: "0040 selected_at",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "selected_at" timestamp;`,
    },
    {
      label: "0040 selected_batch_count",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "selected_batch_count" integer NOT NULL DEFAULT 0;`,
    },
    // 生成态
    {
      label: "0040 generation_task",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "generation_task" text;`,
    },
    {
      label: "0040 error_message",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "error_message" text;`,
    },
    {
      label: "0040 cancelled_at",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;`,
    },
    // Credit 锁定
    {
      label: "0040 credits_locked",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "credits_locked" integer NOT NULL DEFAULT 0;`,
    },
    {
      label: "0040 credits_locked_at",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "credits_locked_at" timestamp;`,
    },
    {
      label: "0040 regenerate_limit",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "regenerate_limit" integer NOT NULL DEFAULT 3;`,
    },
    {
      label: "0040 used_regenerate_count",
      query: `ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "used_regenerate_count" integer NOT NULL DEFAULT 0;`,
    },
    // 索引
    {
      label: "0040 preview_share_uploads_idx",
      query: `CREATE INDEX IF NOT EXISTS "preview_share_uploads_idx" ON "preview_share"("token", "status");`,
    },
    // 2026-09-16：Better Auth phoneNumber 插件字段（drizzle/0041_phone_auth.sql）
    {
      label: "0041 user.phone_number",
      query: `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone_number" text;`,
    },
    {
      label: "0041 user.phone_number_verified",
      query: `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone_number_verified" boolean NOT NULL DEFAULT false;`,
    },
    {
      label: "0041 user_phone_number_key",
      query: `CREATE UNIQUE INDEX IF NOT EXISTS "user_phone_number_key" ON "user" ("phone_number");`,
    },
    // 2026-09-16：微信小程序 openid + Medusa customer 关联（drizzle/0042_user_wechat_medusa.sql）
    {
      label: "0042 user.wechat_openid",
      query: `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "wechat_openid" text;`,
    },
    {
      label: "0042 user.wechat_unionid",
      query: `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "wechat_unionid" text;`,
    },
    {
      label: "0042 user.medusa_customer_id",
      query: `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "medusa_customer_id" text;`,
    },
    {
      label: "0042 user.last_login_at",
      query: `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp;`,
    },
    {
      label: "0042 user_wechat_openid_key",
      query: `CREATE UNIQUE INDEX IF NOT EXISTS "user_wechat_openid_key" ON "user" ("wechat_openid");`,
    },
    {
      label: "0042 user_wechat_unionid_idx",
      query: `CREATE INDEX IF NOT EXISTS "user_wechat_unionid_idx" ON "user" ("wechat_unionid");`,
    },
    {
      label: "0042 user_medusa_customer_id_idx",
      query: `CREATE INDEX IF NOT EXISTS "user_medusa_customer_id_idx" ON "user" ("medusa_customer_id");`,
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

  console.log(
    `\n[apply-all] 完成：✓ ${ok} / ✗ ${fail} / 总 ${statements.length}`
  );
  await client.end();
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[apply-all] 未处理错误：", err);
  process.exit(1);
});
