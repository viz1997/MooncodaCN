/**
 * 2026-09-03：只读自检 —— 确认 agent portal 各层就绪情况。
 *
 * 不写数据，只 query：
 * 1. user.agent_id 列 + 两个索引是否存在
 * 2. agent 表现有数据（有几个启用的、有几个被绑了 user）
 * 3. user 表里 role=admin 的人数 / 没有任何 agentId 的用户数
 * 4. prompt_order.agent_id 列是否就绪
 *
 * 输出一份"待用户手动绑定 / 还差什么"的报告，让用户决定要不要绑定、绑哪个。
 */
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL 未设置");

const isRemote =
  databaseUrl.includes("neon.tech") || databaseUrl.includes("supabase");
const finalUrl = databaseUrl
  .replace(/[?&]sslmode=[^&]*/g, "")
  .replace(/[?&]ssl=[^&]*/g, "")
  .replace(/[?&]uselibpqcompat=[^&]*/g, "");

async function main() {
  const client = new Client({
    connectionString: finalUrl,
    ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();
  try {
    console.log("============================================");
    console.log("agent portal 自检报告");
    console.log("============================================\n");

    // 1. schema 就绪情况
    const schemaRes = await client.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'user' AND column_name = 'agent_id'
        ) AS user_agent_id_col,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'prompt_order' AND column_name = 'agent_id'
        ) AS prompt_order_agent_id_col,
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'user'
            AND indexname = 'user_agent_id_idx'
        ) AS user_idx,
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'prompt_order'
            AND indexname = 'prompt_order_agent_id_idx'
        ) AS prompt_order_idx,
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'prompt_order_history'
            AND indexname = 'poh_order_trigger_image_idx_idx'
        ) AS poh_trigger_image_idx
    `);
    const s = schemaRes.rows[0];
    console.log("[schema 就绪]");
    console.log(
      `  user.agent_id 列:             ${s.user_agent_id_col ? "✓" : "✗ 缺失"}`
    );
    console.log(
      `  prompt_order.agent_id 列:     ${
        s.prompt_order_agent_id_col ? "✓" : "✗ 缺失"
      }`
    );
    console.log(
      `  user_agent_id_idx 索引:       ${s.user_idx ? "✓" : "✗ 缺失"}`
    );
    console.log(
      `  prompt_order_agent_id_idx:    ${
        s.prompt_order_idx ? "✓" : "✗ 缺失"
      }`
    );
    console.log(
      `  poh_trigger_image_idx_idx:    ${
        s.poh_trigger_image_idx ? "✓" : "✗ 缺失"
      }`
    );

    // 2. agent 表
    const agentRes = await client.query<{ total: string; active: string }>(
      `SELECT COUNT(*)::text AS total,
              SUM(CASE WHEN is_active THEN 1 ELSE 0 END)::text AS active
       FROM agent`
    );
    const ag = agentRes.rows[0];
    if (!ag) throw new Error("agent 查询失败");
    console.log("\n[agent 表]");
    console.log(`  总数: ${ag.total}， 启用: ${ag.active}`);

    // 3. user 表
    const userRes = await client.query<{
      total: string;
      admins: string;
      bound: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END)::text AS admins,
         SUM(CASE WHEN agent_id IS NOT NULL THEN 1 ELSE 0 END)::text AS bound
       FROM "user"`
    );
    const u = userRes.rows[0];
    if (!u) throw new Error("user 查询失败");
    console.log("\n[user 表]");
    console.log(`  总数: ${u.total}， admin: ${u.admins}， 绑 agentId: ${u.bound}`);

    // 4. prompt_order 已有 agentId 的订单（验证 listOrders 过滤路径会返回数据）
    const orderRes = await client.query<{ total: string; with_agent: string }>(
      `SELECT COUNT(*)::text AS total,
              SUM(CASE WHEN agent_id IS NOT NULL THEN 1 ELSE 0 END)::text AS with_agent
       FROM prompt_order`
    );
    const o = orderRes.rows[0];
    if (!o) throw new Error("prompt_order 查询失败");
    console.log("\n[prompt_order 表]");
    console.log(`  总数: ${o.total}， ToB 订单（agentId 非空）: ${o.with_agent}`);

    // 5. 给出"想手动测 /agent 流程"的下一步
    console.log("\n============================================");
    console.log("下一步（手动执行 —— 你来定）");
    console.log("============================================");
    if (Number(ag.active) === 0) {
      console.log(
        "⚠ 没有启用的 agent —— 在 /admin/agents 新建一个 is_active=true 的代理商档案"
      );
    }
    if (Number(u.bound) === 0) {
      console.log("⚠ 没有 user 绑定 agentId —— 绑定一个用于自检：");
      console.log(
        "    UPDATE \"user\" SET agent_id = '<AG_xxx>' WHERE email = '<某账号邮箱>';"
      );
      console.log("  建议绑定一个 role='user' 的账号（不是 admin）来做自检");
      console.log("  —— admin 绑 agentId 后 /admin 仍可用，但测的是双重身份路径");
    }

    const allReady =
      s.user_agent_id_col &&
      s.prompt_order_agent_id_col &&
      s.user_idx &&
      s.prompt_order_idx &&
      s.poh_trigger_image_idx &&
      Number(ag.active) > 0 &&
      Number(u.bound) > 0;
    if (allReady) {
      console.log("\n✓ schema 与数据全就绪 —— 可以登录绑定账号访问 /agent/orders");
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[verify] 失败：", e);
  process.exit(1);
});