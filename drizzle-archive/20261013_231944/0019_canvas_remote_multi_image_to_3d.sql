-- canvas_remote_capability 枚举加 'multi-image-to-3d' 值（2026-09-16）
--
-- 背景：Meshy Multi-Image to 3D API 集成，与单图 Image-to-3D 并列，
-- 用于 canvasRemoteJob 行记录「新能力 = 2-4 张图合并转 3D 模型」。
-- 节点层复用 meshy-3d:model3d，TS enum literal union 同步加值。
--
-- 设计要点：
--   - 复用现有 canvasRemoteJob 表（不新建）：job 行 capability 列枚举值
--     扩展即可，service / API / Inngest 路径同单图一致
--   - 复用现有 /api/canvas/poll/[jobId] 路由（DB 分支自动支持新值）
--   - 复用 persistBufferToR2 + safeRefund（已 generic over capability）
--   - PG ALTER TYPE ADD VALUE IF NOT EXISTS 9.6+ 支持；当前项目 PG ≥ 15
--
-- 与 0018 等手写 SQL 同形态：db:push 不会重跑（pgEnum 在 TS schema 已更新），
-- 实际部署走 apply-all-missing-migrations.ts 兜底（详见
-- [[drizzle-manual-migrations-apply-all]] 记忆）。

ALTER TYPE "canvas_remote_capability" ADD VALUE IF NOT EXISTS 'multi-image-to-3d';