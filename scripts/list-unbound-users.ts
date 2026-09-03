/**
 * 2026-09-03：列出还没绑 agentId 的 user —— 让用户挑一个来绑。
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
    const res = await client.query<{
      id: string;
      email: string;
      role: string;
      email_verified: boolean;
      agent_id: string | null;
    }>(
      `SELECT id, email, role, email_verified, agent_id
       FROM "user"
       WHERE agent_id IS NULL
       ORDER BY "created_at" ASC
       LIMIT 10`
    );
    if (res.rows.length === 0) {
      console.log("没有可绑定的 user（都已绑 agentId 或表为空）");
      return;
    }
    console.log("可绑定的 user（前 10，按 created_at 升序）：\n");
    console.table(
      res.rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        verified: r.email_verified,
        agent_id: r.agent_id ?? "(空)",
      }))
    );
    console.log("\n绑定 SQL 模板（复制后改 email 与 agent_id）：");
    console.log(`  UPDATE "user" SET agent_id = '<AG_id>' WHERE email = '<email>';`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[list] 失败：", e);
  process.exit(1);
});