#!/usr/bin/env -S npx tsx

/**
 * 直接应用 photoSourceEnum 相关 schema 变更。
 *
 * 2026-08-23 起因：db:push 是交互式（"❯ No, abort / Yes, I want to execute"），
 * 管道喂输入无效。绕过：直接用 postgres-js 跑这 5 条 additive SQL：
 *
 *   CREATE TYPE "public"."photo_source" AS ENUM('upload', 'generation');
 *   ALTER TABLE "photo" ADD COLUMN "source" "photo_source" DEFAULT 'upload' NOT NULL;
 *   ALTER TABLE "photo" ADD COLUMN "image_job_id" text;
 *   ALTER TABLE "photo" ADD COLUMN "prompt" text;
 *   ALTER TABLE "photo" ADD COLUMN "model" text;
 *   ALTER TABLE "photo" ADD CONSTRAINT "photo_image_job_id_image_job_id_fk"
 *     FOREIGN KEY ("image_job_id") REFERENCES "public"."image_job"("id")
 *     ON DELETE set null ON UPDATE no action;
 *
 * 全部 additive —— 已有数据不动。重复运行 IF NOT EXISTS 兜底。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-schema] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const statements: Array<{ label: string; query: string }> = [
    {
      label: "CREATE TYPE photo_source",
      // DO block 兜底：type 已存在时跳过
      query: `DO $$ BEGIN
        CREATE TYPE "public"."photo_source" AS ENUM('upload', 'generation');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;`,
    },
    {
      label: "ADD COLUMN photo.source",
      query: `ALTER TABLE "photo" ADD COLUMN IF NOT EXISTS "source" "photo_source" DEFAULT 'upload' NOT NULL;`,
    },
    {
      label: "ADD COLUMN photo.image_job_id",
      query: `ALTER TABLE "photo" ADD COLUMN IF NOT EXISTS "image_job_id" text;`,
    },
    {
      label: "ADD COLUMN photo.prompt",
      query: `ALTER TABLE "photo" ADD COLUMN IF NOT EXISTS "prompt" text;`,
    },
    {
      label: "ADD COLUMN photo.model",
      query: `ALTER TABLE "photo" ADD COLUMN IF NOT EXISTS "model" text;`,
    },
    {
      label: "ADD FK photo.image_job_id -> image_job.id",
      // FK 不能用 IF NOT EXISTS（旧 PG 不支持），用 information_schema 查一下
      query: `DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'photo_image_job_id_image_job_id_fk'
        ) THEN
          ALTER TABLE "photo"
            ADD CONSTRAINT "photo_image_job_id_image_job_id_fk"
            FOREIGN KEY ("image_job_id") REFERENCES "public"."image_job"("id")
            ON DELETE set null ON UPDATE no action;
        END IF;
      END $$;`,
    },
  ];

  for (const { label, query } of statements) {
    process.stdout.write(`[apply-schema] ${label} ... `);
    try {
      await client.query(query);
      console.log("✓");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗\n[apply-schema] ${label} 失败：${msg}`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log("[apply-schema] 全部语句执行成功");
}

main().catch((err) => {
  console.error("[apply-schema] 未处理错误：", err);
  process.exit(1);
});
