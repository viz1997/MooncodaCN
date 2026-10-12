-- 代理商 workbench 模块表结构（2026-09-08）
--
-- 来源：scripts/apply-agent-workbench-migration.ts（被作为幂等兜底保留）。
-- 这里是 DDL-only 镜像，供 `pnpm db:migrate` 跑；data migration（agent.image_gen_token
-- 回填 nanoid）留在 scripts 里手工跑，避免 drizzle migrate 跑数据改动。
--
-- 新环境 setup 顺序（重要）：
-- 1. pnpm install
-- 2. .env.local 配 DATABASE_URL
-- 3. 跑 `pnpm migrate:apply-agent-workbench` —— 把 0000-0005 全部 DDL + data backfill
--    幂等 apply 一遍（历史 0000-0004 的 .sql 是手写的纯 DDL 不带 IF NOT EXISTS，
--    所以新环境不能直接跑 `pnpm db:migrate` 头一遍，会撞 enum/table 已存在的错误；
--    脚本用 DO $$ 检查做了幂等包装，跨环境都能跑）
-- 4. 之后 `pnpm db:migrate` 只会跑本文件（0005）—— drizzle 通过 __drizzle_migrations
--    表的 created_at 时间戳跳过 0000-0004

CREATE TYPE "public"."agent_credit_txn_type" AS ENUM('topup', 'debit');--> statement-breakpoint

ALTER TABLE "agent" ADD COLUMN "image_gen_token" text;--> statement-breakpoint

ALTER TABLE "agent" ADD CONSTRAINT "agent_image_gen_token_unique" UNIQUE ("image_gen_token");--> statement-breakpoint

ALTER TABLE "agent" ADD COLUMN "credit_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "prompt_template" ADD COLUMN "product_type_code" text;--> statement-breakpoint

CREATE TABLE "agent_prompt_template" (
  "agent_id" text NOT NULL,
  "prompt_template_id" text NOT NULL,
  "created_at" timestamp DEFAULT now NOT NULL,
  CONSTRAINT "agent_prompt_template_agent_id_prompt_template_id_pk" PRIMARY KEY("agent_id","prompt_template_id")
);--> statement-breakpoint

ALTER TABLE "agent_prompt_template" ADD CONSTRAINT "apt_agent_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "agent_prompt_template" ADD CONSTRAINT "apt_template_fk" FOREIGN KEY ("prompt_template_id") REFERENCES "public"."prompt_template"("id") ON DELETE cascade;--> statement-breakpoint

CREATE INDEX "apt_agent_idx" ON "agent_prompt_template" USING btree ("agent_id");--> statement-breakpoint

CREATE INDEX "apt_template_idx" ON "agent_prompt_template" USING btree ("prompt_template_id");--> statement-breakpoint

CREATE TABLE "agent_credit_transaction" (
  "id" text PRIMARY KEY NOT NULL,
  "agent_id" text NOT NULL,
  "type" "agent_credit_txn_type" NOT NULL,
  "amount" integer NOT NULL,
  "order_id" text,
  "note" text,
  "created_at" timestamp DEFAULT now NOT NULL
);--> statement-breakpoint

ALTER TABLE "agent_credit_transaction" ADD CONSTRAINT "act_agent_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "agent_credit_transaction" ADD CONSTRAINT "act_order_fk" FOREIGN KEY ("order_id") REFERENCES "public"."prompt_order"("id") ON DELETE set null;--> statement-breakpoint

CREATE INDEX "act_agent_created_idx" ON "agent_credit_transaction" USING btree ("agent_id","created_at");--> statement-breakpoint

CREATE INDEX "act_order_idx" ON "agent_credit_transaction" USING btree ("order_id");