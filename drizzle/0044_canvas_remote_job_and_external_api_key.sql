-- canvas_remote_job + external_api_key 新表（2026-10-12）
--
-- 背景：
-- 1. src/db/schema.ts:1644 定义了 canvasRemoteJob（画布内置渠道生成任务，
--    image / video / audio / text / image-to-3d / multi-image-to-3d 6 种能力），
--    实际部署从未建表。drizzle/0018 / 0019 仅为该表的枚举 ADD VALUE，没有建表语句。
-- 2. src/db/schema.ts:2016 定义了 externalApiKey（外部生图 API Key 鉴权表），
--    同样从未建表。/admin/external-api-keys 路由 admin 调用 createExternalApiKey
--    时报 42P01（relation does not exist）。
--
-- 两条表都是新表 + 新枚举，不依赖任何已存表的状态，所以可以独立成一条 migration。
-- 所有 CREATE 都包了 IF NOT EXISTS / OR REPLACE 守卫，方便 apply-all-missing
-- 脚本重复执行。索引同样 IF NOT EXISTS。
--
-- 真实部署路径：apply-all-missing-migrations.ts 兜底（见
-- [[drizzle-manual-migrations-apply-all]] 记忆）。
-- db:push / db:generate 在本项目当前 journal + snapshot 链断裂的情况下都跑不通
-- （drizzle-kit 报 snapshot collision），所以手写 SQL 兜底是唯一可行路径。

-- ============================================
-- 1. canvas_remote_job_status 枚举
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'canvas_remote_job_status') THEN
    CREATE TYPE "public"."canvas_remote_job_status" AS ENUM (
      'pending',
      'processing',
      'completed',
      'failed'
    );
  END IF;
END
$$;--> statement-breakpoint

-- ============================================
-- 2. canvas_remote_capability 枚举
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'canvas_remote_capability') THEN
    CREATE TYPE "public"."canvas_remote_capability" AS ENUM (
      'image',
      'video',
      'audio',
      'text',
      'image-to-3d',
      'multi-image-to-3d'
    );
  END IF;
END
$$;--> statement-breakpoint

-- ============================================
-- 3. external_api_key_status 枚举
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'external_api_key_status') THEN
    CREATE TYPE "public"."external_api_key_status" AS ENUM (
      'active',
      'disabled'
    );
  END IF;
END
$$;--> statement-breakpoint

-- ============================================
-- 4. canvas_remote_job 表
-- ============================================
CREATE TABLE IF NOT EXISTS "canvas_remote_job" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "capability" "canvas_remote_capability" NOT NULL,
  "mode" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" "canvas_remote_job_status" NOT NULL DEFAULT 'pending',
  "result" jsonb,
  "error" text,
  "credits_consumed" integer,
  "transaction_id" text,
  "provider_job_id" text,
  "inngest_event_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "crj_user_created_idx"
  ON "canvas_remote_job" ("user_id", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "crj_status_idx"
  ON "canvas_remote_job" ("status");--> statement-breakpoint

-- ============================================
-- 5. external_api_key 表
-- ============================================
CREATE TABLE IF NOT EXISTS "external_api_key" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "status" "external_api_key_status" NOT NULL DEFAULT 'active',
  "created_by" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "monthly_quota" integer NOT NULL DEFAULT 100,
  "monthly_calls" integer NOT NULL DEFAULT 0,
  "monthly_calls_reset_at" timestamp NOT NULL DEFAULT now(),
  "total_calls" integer NOT NULL DEFAULT 0,
  "last_used_at" timestamp,
  "allowed_masks" text NOT NULL DEFAULT '[]',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);--> statement-breakpoint

-- SHA-256(rawKey) 唯一 —— 验证时按 hash 查表（O(1) lookup）
CREATE UNIQUE INDEX IF NOT EXISTS "external_api_key_hash_unique"
  ON "external_api_key" ("key_hash");--> statement-breakpoint

-- admin 列表常用按 status 过滤
CREATE INDEX IF NOT EXISTS "external_api_key_status_idx"
  ON "external_api_key" ("status", "deleted_at");
