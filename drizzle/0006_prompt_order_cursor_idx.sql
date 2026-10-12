-- prompt_order cursor composite indexes for /image-gen/orders infinite scroll.
-- 2026-09-10
--
-- List query pattern (keyset pagination):
--   WHERE created_by = ?
--     AND (status = ?)
--     AND ((created_at < ?) OR (created_at = ? AND id < ?))
--   ORDER BY created_at DESC, id DESC
--   LIMIT 31
--
-- Old index prompt_order_created_by_idx only has created_by. From page 2 on,
-- PG had to filesort the entire user history after picking the leaf. The
-- composite index (created_by, created_at DESC, id DESC) lets PG reverse-scan
-- directly to the cursor row in O(log N + pageSize).
--
-- Two indexes:
--   1) prompt_order_cursor_idx         - no status filter
--   2) prompt_order_cursor_status_idx - status filter applied
--
-- Wrapped with CREATE INDEX IF NOT EXISTS for idempotency (same pattern as
-- scripts/apply-agent-workbench-migration.ts). Drizzle migrate bookkeeping
-- table is not updated; db:migrate is not runnable on this DB anyway
-- (see [[drizzle-migration-bootstrapping]]).

CREATE INDEX IF NOT EXISTS "prompt_order_cursor_idx"
  ON "prompt_order" ("created_by", "created_at" DESC, "id" DESC);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prompt_order_cursor_status_idx"
  ON "prompt_order" ("created_by", "status", "created_at" DESC, "id" DESC);