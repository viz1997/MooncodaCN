#!/usr/bin/env -S npx tsx

/**
 * 应用代理商业务 schema 变更（2026-08-23）
 *
 * - CREATE TABLE agent
 * - promptOrder 加 product_type_code / product_size / accessory_code / agent_id 列
 * - agent_id FK -> agent.id (on delete set null)
 *
 * 全部 additive，IF NOT EXISTS / DO block 兜底保证幂等。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[apply-agent-schema] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const statements: Array<{ label: string; query: string }> = [
    {
      label: "CREATE TABLE agent",
      query: `CREATE TABLE IF NOT EXISTS "agent" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "contact" text,
        "phone" text,
        "email" text,
        "remark" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );`,
    },
    {
      label: "ADD COLUMN prompt_order.product_type_code",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "product_type_code" text;`,
    },
    {
      label: "ADD COLUMN prompt_order.product_size",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "product_size" text;`,
    },
    {
      label: "ADD COLUMN prompt_order.accessory_code",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "accessory_code" text;`,
    },
    {
      label: "ADD COLUMN prompt_order.agent_id",
      query: `ALTER TABLE "prompt_order" ADD COLUMN IF NOT EXISTS "agent_id" text;`,
    },
    {
      label: "ADD FK prompt_order.agent_id -> agent.id",
      query: `DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'prompt_order_agent_id_agent_id_fk'
        ) THEN
          ALTER TABLE "prompt_order"
            ADD CONSTRAINT "prompt_order_agent_id_agent_id_fk"
            FOREIGN KEY ("agent_id") REFERENCES "agent"("id")
            ON DELETE set null ON UPDATE no action;
        END IF;
      END $$;`,
    },
  ];

  for (const { label, query } of statements) {
    process.stdout.write(`[apply-agent-schema] ${label} ... `);
    try {
      await client.query(query);
      console.log("✓");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗\n[apply-agent-schema] ${label} 失败：${msg}`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log("[apply-agent-schema] 全部语句执行成功");
}

main().catch((err) => {
  console.error("[apply-agent-schema] 未处理错误：", err);
  process.exit(1);
});