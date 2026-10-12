-- ============================================================================
-- agent.image_gen_token 老行回填（Supabase SQL Editor 可直接跑）
-- 2026-09-08 — 修「老 agent 编辑时 workbench 链接未生成」问题
--
-- 用途：2026-09-08 之前的 agent 行 image_gen_token IS NULL，
--       admin 编辑它们时 dialog 会显示「未生成」。
--       2026-09-08 起新建的 agent 由 src/features/agent/lib/db-agents.ts
--       的 insertAgentToDb 自动生成 imageGenToken（nanoid 24 字符）。
--
-- 本脚本一次性回填老行。Supabase Dashboard → SQL Editor → New Query → 粘贴 → Run。
-- 幂等：可重跑；跑完期望 agent_no_token = 0。
-- ============================================================================

UPDATE "agent"
SET "image_gen_token" = substring(md5(random()::text) from 1 for 24),
    "updated_at" = NOW()
WHERE "image_gen_token" IS NULL;

-- sanity check
SELECT
  (SELECT COUNT(*) FROM "agent" WHERE "image_gen_token" IS NULL) AS agent_no_token,
  (SELECT COUNT(*) FROM "agent") AS total_agents;
-- 期望：agent_no_token = 0；如有 > 0，请重跑或贴报错信息。