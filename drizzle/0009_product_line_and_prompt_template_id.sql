-- product_line 新表 + product_effect.prompt_template_id 列（2026-09-10）
--
-- 1. product_line 新表（独立产品线实体，替代 product_effect.product_line_ids JSON 列做关联）
--    - status enum: active / inactive / draft（参考 productEffect 现有约定）
--    - spec / pricing 用 JSON 字符串列（沿用 db-effects.ts 解析模式），由应用层类型化
--    - product_line_id 是业务主键 text，不用 uuid（便于 seed/迁移对齐 MOCK_PRODUCT_LINES.id）
--    - 不加 FK（与现有 product_line_ids json 一致，避免 schema 同步死锁）
--
-- 2. product_effect 加 prompt_template_id text 列（引用 prompt_template.id）
--    - 可空（NULL = 用本地 prompt 字段，promptTemplateId 关系是 admin 录入时手填）
--    - 不加 FK（应用层校验合法性，避免 schema 同步死锁）
--
-- 沿用 0007/0008 IF NOT EXISTS 幂等兜底：db:push 不会重跑此文件，
-- 手工 psql / 新环境 bootstrap 都能直接跑且不会撞 "already exists"。

CREATE TABLE IF NOT EXISTS "product_line" (
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
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "product_line_status_idx"
  ON "product_line" ("status");--> statement-breakpoint

ALTER TABLE "product_effect" ADD COLUMN IF NOT EXISTS "prompt_template_id" text;