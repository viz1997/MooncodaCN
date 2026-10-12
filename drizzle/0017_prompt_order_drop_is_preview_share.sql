-- 2026-09-13：移除 promptOrder.is_preview_share 列
--
-- preview 凭证已迁移到独立 preview_share 表（0016），不再复用 promptOrder
-- 行 + is_preview_share=true 标记。本列已无任何代码引用（create-preview-share.ts
-- 改写 preview_share、guest-submit 路由按 preview_share 查、/p/[token] 入口按
-- preview_share 分发），drop 释放 schema 与 promptOrder 表语义污染。
--
-- 沿用 IF EXISTS 幂等兜底（db:push 不会重跑，但 psql bootstrap 可直接跑），
-- 与 0012 / 0013 / 0015 一致。

ALTER TABLE "prompt_order" DROP COLUMN IF EXISTS "is_preview_share";