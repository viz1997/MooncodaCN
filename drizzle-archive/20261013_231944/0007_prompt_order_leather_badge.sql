-- LB 皮革徽章定制字段扩展（2026-09-10）
--
-- 加 4 列到 prompt_order：leather_color / leather_exposed / pvc_protection / remarks。
-- 全部 nullable，capability-gated（仅 LB 型号 + 用户填了才用，其他行保持 null）。
-- 与现有 engraving_text / engraving_exposed 同维度，互不联动。
--
-- 沿用 0006 的 IF NOT EXISTS 幂等兜底：db:push 不会重跑这个文件，
-- 但手工 psql / 新环境 bootstrap 都能直接跑且不会撞 "column already exists"。

ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "leather_color" text;--> statement-breakpoint
ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "leather_exposed" boolean;--> statement-breakpoint
ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "pvc_protection" boolean;--> statement-breakpoint
ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "remarks" text;
