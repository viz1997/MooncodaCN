-- prompt_order admin global cursor indexes for /admin/orders infinite scroll.
-- 2026-09-18
--
-- /admin/orders 走 admin 全局视角（skipCreatorFilter=true），不复用 0006 索引
-- （开头是 created_by，对 admin 无 createdBy 过滤的场景无用）。
--
-- 列表查询模板：
--   WHERE (status = ?)
--     AND (created_by = ?)
--     AND (platform = ?)
--     AND (created_at BETWEEN ? AND ?)
--     AND (order_no LIKE ? OR recipient_name LIKE ?)
--     AND ((created_at < ?) OR (created_at = ? AND id < ?))
--   ORDER BY created_at DESC, id DESC
--   LIMIT 31
--
-- 两索引：
--   1) prompt_order_admin_cursor_idx (status, created_at DESC, id DESC)
--      状态过滤时使用，planner 走 index range scan
--   2) prompt_order_admin_all_cursor_idx (created_at DESC, id DESC)
--      无状态过滤时使用
--
-- LIKE 模糊匹配仍走 seq scan，v1 接受；后续若 admin 流量大可加 pg_trgm。
--
-- Idempotent (IF NOT EXISTS);通过 scripts/apply-admin-prompt-order-indexes.ts
-- 手动跑（db:migrate 跑不通，参考 [[drizzle-migration-bootstrapping]]）。

CREATE INDEX IF NOT EXISTS "prompt_order_admin_cursor_idx"
  ON "prompt_order" ("status", "created_at" DESC, "id" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prompt_order_admin_all_cursor_idx"
  ON "prompt_order" ("created_at" DESC, "id" DESC);
