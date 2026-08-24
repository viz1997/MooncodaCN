#!/usr/bin/env -S npx tsx

/**
 * 校验 agent 业务 schema 是否正确落到 dev DB
 * （apply-agent-schema.ts 之后的 sanity check）
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[verify-agent-schema] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const cols = await client.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_name = 'prompt_order'
        AND column_name IN ('product_type_code','product_size','accessory_code','agent_id')
      ORDER BY column_name`
  );
  console.log(
    "prompt_order new cols:",
    cols.rows.map((r) => `${r.column_name}:${r.data_type}`).join(", ") ||
      "(none)"
  );

  const fk = await client.query<{ constraint_name: string }>(
    `SELECT constraint_name
       FROM information_schema.table_constraints
      WHERE constraint_name = 'prompt_order_agent_id_agent_id_fk'
        AND table_name = 'prompt_order'`
  );
  console.log(
    "FK prompt_order_agent_id_agent_id_fk:",
    fk.rows.length ? "OK" : "MISSING"
  );

  const agent = await client.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'agent'
      ORDER BY ordinal_position`
  );
  console.log("agent table:");
  for (const r of agent.rows) {
    console.log(
      `  - ${r.column_name}: ${r.data_type} ${r.is_nullable === "NO" ? "NOT NULL" : ""}`
    );
  }

  await client.end();
}

main().catch((err) => {
  console.error("[verify-agent-schema] 未处理错误：", err);
  process.exit(1);
});
