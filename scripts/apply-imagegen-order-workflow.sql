-- 2026-09-09：/image-gen 升级为 6 步下单工作台所需的数据准备
--
-- 背景：
--   之前 /image-gen 是公开 demo（一次性生图，不建订单）。
--   现在改为登录用户的下单入口：选模板 → 选规格 → 上传多图 → 生成 → 选候选 → 提交。
--   提交时调用 createOrderFromImageGenAction（写 promptOrder）+ submitPublicOrderAction
--   （扣个人 credit）。
--
-- 改动：
--   1. prompt_template.product_type_code 按名称推断回填（冰箱贴→P 等）
--   2. product_effect 加 product_type_code 列（nullable），透传 prompt_template 字段
--   3. 回填 promptTemplate→productEffect 的 product_type_code（重跑 sync 即可）

-- 1. prompt_template.product_type_code 回填
UPDATE prompt_template SET product_type_code = 'P'  WHERE id = 'PKQtq8ibbfufAz5NoROlY';   -- 冰箱贴
UPDATE prompt_template SET product_type_code = 'R'  WHERE id = '2Y4j8pnaI6F5dE5fn07MR';   -- 钥匙扣
UPDATE prompt_template SET product_type_code = 'R'  WHERE id = 'TEXF9Db-yg0QHXvgz84aZ';   -- 钥匙扣（精简版）
UPDATE prompt_template SET product_type_code = 'A'  WHERE id = 'VOBwsbShhJoW-tUurmSQX';   -- 徽章
UPDATE prompt_template SET product_type_code = 'RM' WHERE id = 'NEI3lrBX7i9tGPgkE_7sd';   -- 半面头部
UPDATE prompt_template SET product_type_code = 'LB' WHERE id = 'igPgvmtca4QAQk0gsKcwb';   -- 皮革徽章

-- 2. product_effect 加 product_type_code 列（幂等）
ALTER TABLE product_effect ADD COLUMN IF NOT EXISTS product_type_code text;

-- 3. 重跑同步脚本会把 product_type_code 字段带过去；如不想重跑，可手动：
UPDATE product_effect pe
SET product_type_code = pt.product_type_code
FROM prompt_template pt
WHERE pe.id = pt.id
  AND pe.author = 'sync-from-promptTemplate'
  AND pe.product_type_code IS DISTINCT FROM pt.product_type_code;
