-- 2026-09-12：prompt_template_price 新表 + prompt_order 2 列（对账核心字段）
--
-- 起因：代理商对账痛点——同模板所有规格组合（4cm/6cm × 皮套/无 × 棕/黑 ...）
-- 之前都按 promptTemplate.price 单一固定值扣积分，无法按规格统计"哪种组合
-- 各扣了多少"。promptTemplate.price 改成"基础价"语义，加价规则独立存表。
--
-- ============================================
-- 一、prompt_template_price 新表
-- ============================================
--
-- 设计：basePrice + 加价规则（specKey + priceDelta）。
--   本单总价 = promptTemplate.price + Σ(matching rule.delta)
--
-- specKey 命名规范（与 product-catalog.ts 字典对齐）：
--   size:4 / size:6 / size:8 / size:11
--   accessory:leather / accessory:pvc / accessory:bracket
--   leather_color:natural / leather_color:brown / leather_color:black /
--                  leather_color:red / leather_color:navy
--   protection:exposed / protection:pvc
--
-- 匹配规则（runtime 服务端计算）：
--   size:6        →  promptOrder.productSize = '6'
--   accessory:leather → promptOrder.accessoryCode = 'leather'
--   leather_color:brown → promptOrder.leatherColor = 'brown'
--   protection:exposed → promptOrder.leatherExposed = true（pvcProtection=false）
--   protection:pvc → promptOrder.pvcProtection = true（leatherExposed=false）
--
-- priceDelta 可负数（减价场景）。0 允许（仅占位 / label 展示）。
-- onDelete cascade：模板删 → 规则一起删（template 已死规则无意义）。
--
-- ============================================
-- 二、prompt_order 加 2 列（对账可见）
-- ============================================
--
-- credits_charged：本单实际扣减积分（basePrice + Σ(delta)）。
--   nullable：null = 老订单 / 免扣（price=0）；新建订单非空。
-- credits_breakdown：扣减明细 JSON（[{ specKey, label, delta }]）。
--   用途：admin UI 单卡展示 + 代理商对账明细。
--
-- 两列组合让代理商能 SQL 一查"按 size group by 总扣 / 按皮革色 group by 总扣"。

CREATE TABLE IF NOT EXISTS "prompt_template_price" (
  "id" text PRIMARY KEY,
  "template_id" text NOT NULL
    REFERENCES "prompt_template"("id") ON DELETE CASCADE,
  "spec_key" text NOT NULL,
  "price_delta" integer NOT NULL DEFAULT 0,
  "label" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ptp_template_spec_unique"
  ON "prompt_template_price" ("template_id", "spec_key");

CREATE INDEX IF NOT EXISTS "ptp_template_idx"
  ON "prompt_template_price" ("template_id");

ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "credits_charged" integer;

ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "credits_breakdown" text;