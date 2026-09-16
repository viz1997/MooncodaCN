-- canvas_remote_capability 枚举加 'image-to-3d' 值（2026-09-15）
--
-- 背景：Meshy Image-to-3D 集成需要在画布内置渠道 capability 上扩一个值，
-- 用于 canvasRemoteJob 行记录「新能力 = 把图片转 3D 模型」。
--
-- 设计要点：
--   - 复用现有 canvasRemoteJob 表（不新建）：job 行 capability 列枚举值
--     扩展即可，service / API / Inngest 路径同 image / audio 一致
--   - TS enum literal union 在 src/db/schema.ts 同步加 "image-to-3d"
--   - 复用现有 /api/canvas/poll/[jobId] 路由（DB 分支自动支持新值）
--   - PG ALTER TYPE ADD VALUE IF NOT EXISTS 9.6+ 支持；当前项目 PG ≥ 15
--
-- 与 0013 等手写 SQL 同形态：db:push 不会重跑（pgEnum 在 TS schema 已更新），
-- 实际部署走 apply-all-missing-migrations.ts 兜底（详见
-- [[drizzle-manual-migrations-apply-all]] 记忆）。

ALTER TYPE "canvas_remote_capability" ADD VALUE IF NOT EXISTS 'image-to-3d';