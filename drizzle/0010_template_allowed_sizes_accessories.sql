-- productEffect + promptTemplate 模板级 allowed_sizes / allowed_accessories（2026-09-10）
--
-- 加 2 列到 product_effect：
--   allowed_sizes        —— JSON 字符串数组，cm 数字字符串（"6"、"8"）
--                            null/空 = 按 productTypeCode 字典 sizes 全量；非空 = 仅这些值
--   allowed_accessories  —— JSON 字符串数组，accessory code 字符串
--                            null/空 = 按字典全量；非空 = 仅这些 code
--
-- 加同样 2 列到 prompt_template（共用同一字段语义，让 admin UI 一处改动两边生效）。
--
-- 全部 nullable；null 等价于"继承字典默认"，零迁移成本，老数据原样可用。
--
-- 沿用 0007-0009 的 IF NOT EXISTS 幂等兜底：db:push 不会重跑这个文件，
-- 但手工 psql / 新环境 bootstrap 都能直接跑且不会撞 "column already exists"。

ALTER TABLE "product_effect" ADD COLUMN IF NOT EXISTS "allowed_sizes" text;--> statement-breakpoint
ALTER TABLE "product_effect" ADD COLUMN IF NOT EXISTS "allowed_accessories" text;--> statement-breakpoint
ALTER TABLE "prompt_template" ADD COLUMN IF NOT EXISTS "allowed_sizes" text;--> statement-breakpoint
ALTER TABLE "prompt_template" ADD COLUMN IF NOT EXISTS "allowed_accessories" text;
