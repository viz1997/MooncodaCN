#!/usr/bin/env -S npx tsx

/**
 * 2026-09-12：代理商对账汇总脚本 —— 按规格拆解积分扣减
 *
 * 起因：之前 promptTemplate.price 是单一固定值，对账痛点"哪种规格组合各扣了
 * 多少积分"无解。新加的 prompt_order.credits_charged + credits_breakdown 两列
 * 让对账一目了然：本脚本按 4 个维度聚合（总扣 / 模板 / 规格 / 月份），代理商
 * 一眼看清各规格贡献。
 *
 * 用法：
 *   pnpm tsx scripts/inspect-order-credit-breakdown.ts
 *
 * 输出 5 段：
 *   1. 总览：所有 SELECTED / CANDIDATES_READY 订单总数 + 总扣积分
 *   2. 按模板 group by：哪个模板贡献最多
 *   3. 按 spec_key group by（拆 JSON）：哪个规格贡献最多
 *   4. 按月份 group by：本月 vs 上月趋势
 *   5. 最近 20 单明细：orderNo + 模板名 + 规格摘要 + 总额
 *
 * 数据源：prod 跑需要把 Vercel DATABASE_URL 临时拷到 .env.local（参考
 * apply-all-missing-migrations.ts 注释）。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[inspect] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // 1. 总览
  const overview = await client.query<{
    total_orders: string;
    total_credits: string;
    avg_credits: string;
  }>(
    `SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(credits_charged), 0) AS total_credits,
        COALESCE(AVG(credits_charged), 0)::numeric(10, 2) AS avg_credits
     FROM prompt_order
     WHERE credits_charged IS NOT NULL AND credits_charged > 0
       AND status IN ('SELECTED', 'CANDIDATES_READY')`
  );
  console.log("\n========== 1. 总览 ==========");
  console.table(overview.rows);

  // 2. 按模板 group by
  const byTemplate = await client.query<{
    template_id: string;
    template_name: string;
    order_count: string;
    total_credits: string;
    avg_credits: string;
  }>(
    `SELECT
        o.template_id,
        t.name AS template_name,
        COUNT(*) AS order_count,
        COALESCE(SUM(o.credits_charged), 0) AS total_credits,
        COALESCE(AVG(o.credits_charged), 0)::numeric(10, 2) AS avg_credits
     FROM prompt_order o
     JOIN prompt_template t ON t.id = o.template_id
     WHERE o.credits_charged IS NOT NULL AND o.credits_charged > 0
       AND o.status IN ('SELECTED', 'CANDIDATES_READY')
     GROUP BY o.template_id, t.name
     ORDER BY SUM(o.credits_charged) DESC, COUNT(*) DESC
     LIMIT 30`
  );
  console.log("\n========== 2. 按模板 group by（Top 30） ==========");
  console.table(byTemplate.rows);

  // 3. 按 spec_key group by（拆 credits_breakdown JSON 数组）
  const bySpecKey = await client.query<{
    spec_key: string;
    hit_count: string;
    total_delta: string;
    avg_delta: string;
  }>(
    `WITH exploded AS (
       SELECT
         (item->>'specKey') AS spec_key,
         (item->>'delta')::int AS delta
       FROM prompt_order o
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN o.credits_breakdown IS NULL OR o.credits_breakdown = ''
              THEN '[]'::jsonb
              ELSE o.credits_breakdown::jsonb
         END
       ) AS item
       WHERE o.credits_charged IS NOT NULL AND o.credits_charged > 0
         AND o.status IN ('SELECTED', 'CANDIDATES_READY')
     )
     SELECT
       spec_key,
       COUNT(*) AS hit_count,
       COALESCE(SUM(delta), 0) AS total_delta,
       COALESCE(AVG(delta), 0)::numeric(10, 2) AS avg_delta
     FROM exploded
     GROUP BY spec_key
     ORDER BY SUM(delta) DESC, COUNT(*) DESC`
  );
  console.log("\n========== 3. 按 spec_key group by（拆 JSON 明细） ==========");
  console.log("hit_count = 命中次数，total_delta = 总加价积分（绝对值之和）");
  console.table(bySpecKey.rows);

  // 4. 按月份 group by
  const byMonth = await client.query<{
    month: string;
    order_count: string;
    total_credits: string;
  }>(
    `SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) AS order_count,
        COALESCE(SUM(credits_charged), 0) AS total_credits
     FROM prompt_order
     WHERE credits_charged IS NOT NULL AND credits_charged > 0
       AND status IN ('SELECTED', 'CANDIDATES_READY')
     GROUP BY TO_CHAR(created_at, 'YYYY-MM')
     ORDER BY month DESC
     LIMIT 12`
  );
  console.log("\n========== 4. 按月份 group by（最近 12 个月） ==========");
  console.table(byMonth.rows);

  // 5. 最近 20 单明细（orderNo + 模板名 + 规格摘要 + 总额）
  const recent = await client.query<{
    order_no: string;
    template_name: string;
    spec_summary: string;
    base_price: number | null;
    delta_total: number | null;
    total_credits: number | null;
    created_at: Date;
  }>(
    `SELECT
        o.order_no,
        t.name AS template_name,
        o.product_size || 'cm' ||
          CASE WHEN o.accessory_code IS NOT NULL THEN ' · ' || o.accessory_code ELSE '' END ||
          CASE WHEN o.leather_color IS NOT NULL THEN ' · 皮革' || o.leather_color ELSE '' END ||
          CASE WHEN o.leather_exposed = TRUE THEN ' · 外露' ELSE '' END ||
          CASE WHEN o.pvc_protection = TRUE THEN ' · PVC' ELSE '' END
          AS spec_summary,
        t.price AS base_price,
        CASE WHEN o.credits_breakdown IS NOT NULL
             THEN (SELECT COALESCE(SUM((item->>'delta')::int), 0)
                   FROM jsonb_array_elements(o.credits_breakdown::jsonb) AS item)
        END AS delta_total,
        o.credits_charged AS total_credits,
        o.created_at
     FROM prompt_order o
     JOIN prompt_template t ON t.id = o.template_id
     WHERE o.credits_charged IS NOT NULL AND o.credits_charged > 0
       AND o.status IN ('SELECTED', 'CANDIDATES_READY')
     ORDER BY o.created_at DESC
     LIMIT 20`
  );
  console.log("\n========== 5. 最近 20 单明细 ==========");
  console.table(recent.rows);

  await client.end();
}

main().catch((err) => {
  console.error("[inspect] 未处理错误：", err);
  process.exit(1);
});