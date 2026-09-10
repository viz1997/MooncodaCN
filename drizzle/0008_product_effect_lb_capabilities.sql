-- productEffect 模板级 capability 覆盖 + 皮革色子集（2026-09-10）
--
-- 加 2 列到 product_effect：
--   allowed_capabilities  —— JSON 字符串，Partial<ProductCapabilities>
--                            null = 继承 catalog 默认（productType.capabilities）
--                            非空 = 模板级覆盖（覆盖的 key 用 override 值；
--                            没出现的 key 沿用 catalog；canEngrave 不在覆盖范围）
--   allowed_colors        —— JSON 字符串数组，如 ["brown","black"]
--                            null/空 = LEATHER_COLORS 全展示；非空 = 仅这些 code
--
-- 全部 nullable；null 等价于"继承默认值"，零迁移成本，老数据原样可用。
--
-- 沿用 0007 的 IF NOT EXISTS 幂等兜底：db:push 不会重跑这个文件，
-- 但手工 psql / 新环境 bootstrap 都能直接跑且不会撞 "column already exists"。

ALTER TABLE "product_effect" ADD COLUMN IF NOT EXISTS "allowed_capabilities" text;--> statement-breakpoint
ALTER TABLE "product_effect" ADD COLUMN IF NOT EXISTS "allowed_colors" text;