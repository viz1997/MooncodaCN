-- prompt_order 加 platform 列（2026-09-11）
--
-- 业务侧 ToB 渠道归因：代理商想知道这单从哪个渠道来的（淘宝 / 小红书 /
-- 抖音 / 独立站 / 国内红人 / 国外红人 / 合作方 / 营销推广），用于活动复盘
-- 和结算对账。LB 皮革徽章（MASK_LB_LEATHER_BADGE）能力门控，其他产品
-- 型号不会落 platform。
--
-- 字段语义：
--   - text：与 productTypeCode / leatherColor 等业务字符串列对齐
--   - nullable：null = 用户未选 / 不知道从哪个渠道来；admin 复盘用 null 兜底
--   - code 值域在 PLATFORMS 字典（src/features/gpt-image/lib/product-catalog.ts）
--
-- 沿用 0010/0011 幂等兜底（IF NOT EXISTS），db:push 不会重跑但 psql
-- bootstrap 也能直接跑。

ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "platform" text;