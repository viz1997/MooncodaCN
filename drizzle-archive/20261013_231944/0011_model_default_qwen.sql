-- model 列默认值对齐 qwen（2026-09-11）
--
-- 背景：IMAGE_MODELS 精简到 3 个核心模型（qwen / gpt_image_2 / nano_banana2），
-- 即梦（doubao）等旧模型下线。新插入 product_effect / prompt_template 若不显式
-- 传 model 字段，DB 层 default 仍是 "doubao"（旧 schema 留下），会变成"未知模型"
-- 没法走 adapter 调度。app 层 schema 已改 default("qwen")，这里同步把 DB 列 default
-- 也改成 qwen，避免 default 漂移。
--
-- 幂等：Drizzle 列 default 用 SET DEFAULT，本身就是 idempotent 语义（重复跑效果一致）。
-- 不需要 IF NOT EXISTS 包装 —— PostgreSQL ALTER COLUMN SET DEFAULT 不存在 "已存在" 报错。

ALTER TABLE "product_effect" ALTER COLUMN "model" SET DEFAULT 'qwen';--> statement-breakpoint
ALTER TABLE "prompt_template" ALTER COLUMN "model" SET DEFAULT 'qwen';