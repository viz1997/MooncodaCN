-- 2026-09-14：preview 流升级为完整 6 步工作台 + 代理商 credit 锁定
--
-- 业务动机：
-- 之前 preview_share 凭证（/p/{token]）只支持「预览 → 确认」二选一（status 只有
-- pending / confirmed / expired 三态）。代理商要求客人走完整 6 步工作台：
--   PENDING (created, credits locked) →
--   UPLOADED (客人传原图) →
--   GENERATING (Lingting 生成中) →
--   CANDIDATES_READY (4 张 cell 收齐) →
--   SELECTED (客人选了 cell) →
--   CONFIRMED (终态：新建 promptOrder SELECTED + 释放剩余 credit)
--   任意态可逃逸到 FAILED / CANCELLED / EXPIRED
--
-- Credit 锁定：代理商在 createPreviewShare 时按 totalCredits × (1 + regenerateLimit)
-- 一次性预扣。regenerate 走 credits_transaction 记账（balance 不再扣）。confirm 扣
-- basePrice，剩余 grantCredits(refund) 释放。MVP regenerateLimit 硬编码 3。
--
-- 字段镜像 promptOrder 状态机（uploadedImages/selections/generationTask 等）——
-- 这是有意的设计：preview_share 走自己的状态机，但 JSON 字段结构与 promptOrder
-- 对齐，service 函数复用 submitLingtingTask / queryLingtingTask / persistCandidateToR2
-- 不需要写两套。

-- 1. 状态机列（status 在 0016 是 text 列而非 PG enum 类型，新状态值落到 text 上即可）
--    status 9 态：pending / uploaded / generating / candidates_ready / selected
--                / confirmed / expired / failed / cancelled
--    由 schema.ts 的 previewShareStatusValues literal union 在 TS 层把关。
--    DB 不需要 ALTER TYPE 加值。

-- 2. 状态机列（镜像 promptOrder 字段名）
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "uploaded_images" text;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "images_per_upload" integer NOT NULL DEFAULT 3;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "upload_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "uploaded_at" timestamp;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "generated_at" timestamp;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "selections" text;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "selected_index" integer;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "selected_at" timestamp;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "selected_batch_count" integer NOT NULL DEFAULT 0;

-- 3. 生成态
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "generation_task" text;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "error_message" text;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;

-- 4. Credit 锁定
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "credits_locked" integer NOT NULL DEFAULT 0;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "credits_locked_at" timestamp;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "regenerate_limit" integer NOT NULL DEFAULT 3;
ALTER TABLE "preview_share" ADD COLUMN IF NOT EXISTS "used_regenerate_count" integer NOT NULL DEFAULT 0;

-- 5. 索引：/status + /poll 路由按 token + status 查
CREATE INDEX IF NOT EXISTS "preview_share_uploads_idx"
  ON "preview_share"("token", "status");
