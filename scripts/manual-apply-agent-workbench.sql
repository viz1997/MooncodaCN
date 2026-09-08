-- ============================================================================
-- agent-workbench migration (Supabase SQL Editor 可直接跑)
-- 2026-09-08 — 修复 Vercel prod DB 缺 agent-workbench 列
--
-- 来源：scripts/apply-agent-workbench-migration.ts（CLI 脚本，绕 drizzle-kit push）
-- 这里给纯 SQL 版本，让你可以直接粘贴到 Supabase Dashboard → SQL Editor →
-- New Query → Run，不需要本地 tsx 环境。
--
-- 全部 DDL 用 DO $$ IF NOT EXISTS 包裹，幂等可重跑。
-- 包含：
--   1. agent.image_gen_token (TEXT, UNIQUE)
--   2. agent.credit_balance (INTEGER NOT NULL DEFAULT 0)
--   3. prompt_template.product_type_code (TEXT)
--   4. 回填 agent.image_gen_token（data migration）
--   5. agent_prompt_template 表 + 索引 + FK
--   6. agent_credit_txn_type enum + agent_credit_transaction 表 + 索引 + FK
--   7. sanity check
--
-- 如果中途某条 RAISE NOTICE 显示 [skip] 表示已建过，正常。
-- ============================================================================

-- 1. agent.image_gen_token 列 + UNIQUE 约束
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent'
      AND column_name = 'image_gen_token'
  ) THEN
    ALTER TABLE "agent" ADD COLUMN "image_gen_token" TEXT;
    ALTER TABLE "agent"
      ADD CONSTRAINT "agent_image_gen_token_unique" UNIQUE ("image_gen_token");
    RAISE NOTICE '[OK] agent.image_gen_token 列 + UNIQUE 约束';
  ELSE
    RAISE NOTICE '[skip] agent.image_gen_token 已存在';
  END IF;
END $$;

-- 2. agent.credit_balance 列
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent'
      AND column_name = 'credit_balance'
  ) THEN
    ALTER TABLE "agent"
      ADD COLUMN "credit_balance" INTEGER NOT NULL DEFAULT 0;
    RAISE NOTICE '[OK] agent.credit_balance 列';
  ELSE
    RAISE NOTICE '[skip] agent.credit_balance 已存在';
  END IF;
END $$;

-- 3. prompt_template.product_type_code 列
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'prompt_template'
      AND column_name = 'product_type_code'
  ) THEN
    ALTER TABLE "prompt_template" ADD COLUMN "product_type_code" TEXT;
    RAISE NOTICE '[OK] prompt_template.product_type_code 列';
  ELSE
    RAISE NOTICE '[skip] prompt_template.product_type_code 已存在';
  END IF;
END $$;

-- 4. 回填 agent.image_gen_token（仅 NULL 行）
--    SQL Editor 没 nanoid()，改用 substring(md5(random()::text), 1, 24)
DO $$
DECLARE
  r RECORD;
  new_token TEXT;
  filled INT := 0;
BEGIN
  FOR r IN SELECT id FROM "agent" WHERE "image_gen_token" IS NULL LOOP
    new_token = substring(md5(random()::text) from 1 for 24);
    UPDATE "agent"
      SET "image_gen_token" = new_token, "updated_at" = NOW()
      WHERE "id" = r.id;
    filled := filled + 1;
  END LOOP;
  RAISE NOTICE '[OK] agent.image_gen_token 回填 % 行', filled;
END $$;

-- 5. agent_prompt_template 表 + 索引 + FK
CREATE TABLE IF NOT EXISTS "agent_prompt_template" (
  "agent_id" TEXT NOT NULL,
  "prompt_template_id" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("agent_id", "prompt_template_id")
);

CREATE INDEX IF NOT EXISTS "apt_agent_idx"
  ON "agent_prompt_template" USING btree ("agent_id");

CREATE INDEX IF NOT EXISTS "apt_template_idx"
  ON "agent_prompt_template" USING btree ("prompt_template_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'apt_agent_fk'
      AND table_name = 'agent_prompt_template'
  ) THEN
    ALTER TABLE "agent_prompt_template"
      ADD CONSTRAINT "apt_agent_fk"
      FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id")
      ON DELETE CASCADE;
    RAISE NOTICE '[OK] agent_prompt_template.agent_id FK';
  ELSE
    RAISE NOTICE '[skip] agent_prompt_template.agent_id FK 已存在';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'apt_template_fk'
      AND table_name = 'agent_prompt_template'
  ) THEN
    ALTER TABLE "agent_prompt_template"
      ADD CONSTRAINT "apt_template_fk"
      FOREIGN KEY ("prompt_template_id") REFERENCES "public"."prompt_template"("id")
      ON DELETE CASCADE;
    RAISE NOTICE '[OK] agent_prompt_template.prompt_template_id FK';
  ELSE
    RAISE NOTICE '[skip] agent_prompt_template.prompt_template_id FK 已存在';
  END IF;
END $$;

-- 6. agent_credit_txn_type enum + agent_credit_transaction 表
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'agent_credit_txn_type'
  ) THEN
    CREATE TYPE "agent_credit_txn_type" AS ENUM ('topup', 'debit');
    RAISE NOTICE '[OK] agent_credit_txn_type enum';
  ELSE
    RAISE NOTICE '[skip] agent_credit_txn_type 已存在';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "agent_credit_transaction" (
  "id" TEXT PRIMARY KEY,
  "agent_id" TEXT NOT NULL,
  "type" "agent_credit_txn_type" NOT NULL,
  "amount" INTEGER NOT NULL,
  "order_id" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "act_agent_created_idx"
  ON "agent_credit_transaction" USING btree ("agent_id", "created_at");

CREATE INDEX IF NOT EXISTS "act_order_idx"
  ON "agent_credit_transaction" USING btree ("order_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'act_agent_fk'
      AND table_name = 'agent_credit_transaction'
  ) THEN
    ALTER TABLE "agent_credit_transaction"
      ADD CONSTRAINT "act_agent_fk"
      FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id")
      ON DELETE CASCADE;
    RAISE NOTICE '[OK] agent_credit_transaction.agent_id FK';
  ELSE
    RAISE NOTICE '[skip] agent_credit_transaction.agent_id FK 已存在';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'act_order_fk'
      AND table_name = 'agent_credit_transaction'
  ) THEN
    ALTER TABLE "agent_credit_transaction"
      ADD CONSTRAINT "act_order_fk"
      FOREIGN KEY ("order_id") REFERENCES "public"."prompt_order"("id")
      ON DELETE SET NULL;
    RAISE NOTICE '[OK] agent_credit_transaction.order_id FK';
  ELSE
    RAISE NOTICE '[skip] agent_credit_transaction.order_id FK 已存在';
  END IF;
END $$;

-- 7. sanity check（最后一行 SELECT 会显示一张 1 行 7 列的状态表）
SELECT
  (SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent' AND column_name = 'image_gen_token'
  )) AS agent_image_token_col,
  (SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent' AND column_name = 'credit_balance'
  )) AS agent_credit_balance_col,
  (SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prompt_template' AND column_name = 'product_type_code'
  )) AS template_product_type_col,
  (SELECT COUNT(*) FROM "agent" WHERE "image_gen_token" IS NULL) AS agent_no_token,
  (SELECT COUNT(*) FROM "agent_prompt_template") AS m2m_rows,
  (SELECT COUNT(*) FROM "agent_credit_transaction") AS txn_rows,
  (SELECT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'agent_credit_txn_type'
  )) AS txn_type_enum;

-- 期望结果：所有 *_col / *_type 都是 true，agent_no_token = 0。
-- 如果有 false 或 agent_no_token > 0，复制 NOTICE 报错信息贴回我。