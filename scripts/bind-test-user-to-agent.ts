/**
 * 2026-09-03：自检脚本—— 绑定现有 admin 账号到第一个启用的 agent（ToB 自下单自检）。
 *
 * 目的：
 / 1. 找到 admin 角色账号（role='admin'，不是 user）
 / 2. 找到第一个启用的 agent（is_active=true）
 / 3. UPDATE user.agent_id = 该 agent.id
 *
 * 运行后 admin 账号登录应能访问 /agent/orders（虽然他是 admin，但现在绑了
 * agentId，checkAgent 会通过）。
 *
 * 注意：这是个一次性开发脚本，验证完后无需保留；为方便手测不删。
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
    // 找一个 admin
    const adminRes = await client.query<{ id: string; email: string }>(
      `SELECT id, email FROM "user"
       WHERE role = 'admin' AND "banned" = false
       ORDER BY "createdAt" ASC LIMIT 1`
    );
    if (adminRes.rows.length === 0) {
      throw new Error("找不到 admin 账号，请先 ensureDefaultAdmin() 跑过一次");
    }
    const admin = adminRes.rows[0];
    if (!admin) throw new Error("admin 行不存在");
    console.log(`[bind] admin: ${admin.email} (id=${admin.id})`);

    // 找一个启用 agent
    const agentRes = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM agent WHERE is_active = true ORDER BY "createdAt" ASC LIMIT 1`
    );
    if (agentRes.rows.length === 0) {
      throw new Error("找不到启用的 agent，请先在 /admin/agents 建一个");
    }
    const a = agentRes.rows[0];
    if (!a) throw new Error("agent 行不存在");
    console.log(`[bind] agent: ${a.name} (id=${a.id})`);

    // 绑定
    await client.query(
      `UPDATE "user" SET agent_id = $1, "updatedAt" = NOW() WHERE id = $2`,
      [a.id, admin.id]
    );
    console.log(
      `[bind] OK —— admin ${admin.email} 现在绑到 agent ${a.name}`
    );

    // 验证
    const verify = await client.query(
      `SELECT id, email, role, agent_id FROM "user" WHERE id = $1`,
      [admin.id]
    );
    console.log("[verify] user row:", verify.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[bind] 失败：", e);
  process.exit(1);
});