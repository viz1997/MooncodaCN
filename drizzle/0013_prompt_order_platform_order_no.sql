-- prompt_order 加 platform_order_no 列（2026-09-11）
--
-- 渠道订单号（与 platform 配对）：用户在淘宝 / 小红书 / 抖音 / 独立站 /
-- 国内红人 / 国外红人 / 合作方 / 营销推广 等外部渠道下单时填的渠道侧订单号，
-- 用于代理商对账 + 跨平台订单匹配。
--
-- 字段语义：
--   - text：跨平台订单号体系（淘宝 15~18 位数字 / 小红书字母数字混合 / 抖音
--     ID 等），异构字符串不能上 enum
--   - nullable：null = 用户未选 platform / 渠道订单号不知道 / 单纯走代理商统计
--   - capability-gated：canPlatform=false 的型号此列保持 null
--
-- 与 0012 platform 配对使用：platform 是"哪来的"（字典 code），platform_order_no
-- 是"在那边的具体订单号"（free text）。两者都可独立为空。
--
-- 沿用 0012 幂等兜底（IF NOT EXISTS），db:push 不会重跑但 psql bootstrap
-- 也能直接跑。

ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "platform_order_no" text;
