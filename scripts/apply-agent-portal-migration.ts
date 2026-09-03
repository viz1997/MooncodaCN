/**
 * 2026-09-03：应用 agent portal 迁移（绕过 drizzle-kit push 的 TTY blocker）。
 *
 * 见 [[db-push-interactive-blocker]] —— drizzle-kit push 卡 TTY 提示，
 * 管道喂入也回不了 yes/no 选择。用 pg 直连 + 幂等 DDL 一次过。
 *
 * 操作：
 * 1. user.agent_id 列（FK → agent.id, ON DELETE SET NULL）
 * 2. user_agent_id_idx 索引
 * 3. prompt_order_agent_id_idx 索引
 */
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

// 加载 .env.local / .env（与 drizzle.config.ts 一致）
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL 环境变量未设置");
}

// 检测 SSL（Neon/Supabase 远程必开；本地可关）
const isRemote = databaseUrl.includes("neon.tech") || databaseUrl.includes("supabase");
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
    console.log("[apply] 连上 DB，开始 DDL...");

    // 1. user.agent_id 列 + FK
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'user'
            AND column_name = 'agent_id'
        ) THEN
          ALTER TABLE "user" ADD COLUMN "agent_id" text;
          ALTER TABLE "user"
            ADD CONSTRAINT "user_agent_id_agent_id_fk"
            FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id")
            ON DELETE SET NULL ON UPDATE NO ACTION;
          RAISE NOTICE '[OK] user.agent_id 列 + FK';
        ELSE
          RAISE NOTICE '[skip] user.agent_id 已存在';
        END IF;
      END
      $$;
    `);

    // 2. user_agent_id_idx 索引
    await client.query(`
      CREATE INDEX IF NOT EXISTS "user_agent_id_idx"
      ON "user" USING btree ("agent_id");
    `);
    console.log("[OK] user_agent_id_idx 索引");

    // 3. prompt_order_agent_id_idx（prompt_order.agent_id 是早期 ToB 业务已加的列）
    await client.query(`
      CREATE INDEX IF NOT EXISTS "prompt_order_agent_id_idx"
      ON "prompt_order" USING btree ("agent_id");
    `);
    console.log("[OK] prompt_order_agent_id_idx 索引");

    // 4. sanity check
    const checkRes = await client.query(`
      SELECT
        (SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'user' AND column_name = 'agent_id'
        )) AS user_agent_id_col,
        (SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'user'
            AND indexname = 'user_agent_id_idx'
        )) AS user_idx,
        (SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'prompt_order'
            AND indexname = 'prompt_order_agent_id_idx'
        )) AS prompt_order_idx
    `);
    const r = checkRes.rows[0];
    console.log("[verify] user.agent_id 列:", r.user_agent_id_col);
    console.log("[verify] user_agent_id_idx 索引:", r.user_idx);
    console.log(
      "[verify] prompt_order_agent_id_idx 索引:",
      r.prompt_order_idx
    );

    if (!r.user_agent_id_col || !r.user_idx || !r.prompt_order_idx) {
      throw new Error("迁移应用失败：sanity check 未全通过");
    }
    console.log("[done] agent portal migration 已应用");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[apply] 失败：", e);
  process.exit(1);
});