-- 2026-09-13：创建 preview_share 独立表
--
-- 分享链接 ≠ 下单。代理商在 /image-gen 生成预览图后点「分享给客户预览」
-- 创建 preview_share 凭证（status='pending'），**不**写 promptOrder。客户
-- 扫码进 /p/[token] 看到预览图 + 规格摘要 → 点「确认下单」→ guest-submit
-- 路由扣代理商 credit 并 NEW INSERT promptOrder(status='SELECTED') +
-- 关联回 preview_share.linkedOrderId。
--
-- 设计动机：之前用 promptOrder.isPreviewShare=true + status=CANDIDATES_READY
-- 共用 promptOrder 表达「分享链接」语义有两个问题：
--   1. promptOrder 是订单实体，被 SELECTED 后走生产排期 / 占用订单号 / 扣
--      减 credit；分享链接不是订单，混进 promptOrder 污染 /image-gen/orders
--      列表（代理商看到一堆「待确认」凭证而非真实订单）
--   2. promptOrder 状态机（PENDING → GENERATING → CANDIDATES_READY →
--      SELECTED）是为「订单生图流程」设计，分享链接需要的是 PENDING →
--      CONFIRMED（客人主动确认）→ 关联 promptOrder 的另一套语义
--
-- 本表专为「分享链接」实体设计，不污染 promptOrder。配套 0017 移除
-- promptOrder.is_preview_share 列。
--
-- 字段语义：
--   - token：访问 token（与 promptOrder.token 同生成器 randomBytes(16).hex）
--   - candidates：[[demoPreviewUrl]] 嵌套数组，与 promptOrder.candidates 对齐，
--     /api/orders/[token]/candidates/[imageIdx]/[candIdx] 路由读这张表返图
--   - selected_cell：客人最终选的分镜（0..N-1），CONFIRMED 时写入；PENDING 时 null
--   - credits_charged / credits_breakdown：创建时由 price-calculator 提前算好
--     写入，避免客人确认时重算导致预览价 / 实际价漂移（template.price 或
--     matching rule 改动情况下）
--   - status：pending / confirmed / expired 三态。pending → confirmed 由
--     guest-submit 路由触发（新建 promptOrder + UPDATE 本表 + 扣 credit）
--   - linked_order_id：confirmed 时指向新建 promptOrder.id（nullable，
--     pending 时为 null）。客人后续再访问 /p/[token] 时按此跳转到 SELECTED 视图
--   - confirmed_by_ip：客人确认时的 IP（防滥用 / 审计）
--   - expires_at：默认 now + 7 天，超时未确认 → 状态置 expired（前端显示「链接失效」）

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

CREATE INDEX IF NOT EXISTS "preview_share_creator_created_idx"
  ON "preview_share"("created_by", "created_at" DESC);

-- cron 清理 expired 凭证：WHERE status='pending' AND expires_at < now()
CREATE INDEX IF NOT EXISTS "preview_share_status_expires_idx"
  ON "preview_share"("status", "expires_at");

-- 客人确认后跳 SELECTED 视图：WHERE linked_order_id = ? 反查 promptOrder.token
CREATE INDEX IF NOT EXISTS "preview_share_linked_order_idx"
  ON "preview_share"("linked_order_id");