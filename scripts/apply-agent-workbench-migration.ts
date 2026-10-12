/**
 * 2026-09-07：应用 agent workbench 迁移（绕过 drizzle-kit push 的 TTY blocker）。
 *
 * 见 [[db-push-interactive-blocker]] —— drizzle-kit push 卡 TTY 提示。
 * 用 pg 直连 + 幂等 DDL 一次过。
 *
 * 操作：
 * 1. agent.image_gen_token 列（unique）
 * 2. agent.credit_balance 列（NOT NULL DEFAULT 0）
 * 3. prompt_template.product_type_code 列（nullable）
 * 4. 回填 agent.image_gen_token（用 nanoid 24 字符，仅 NULL 行）
 * 5. agent_prompt_template 表 + 索引 + FK（CASCADE）
 * 6. agent_credit_txn_type enum + agent_credit_transaction 表 + 索引 + FK
 *
 * 决策：
 * - 积分扣减只在 agent workbench 路径，ToC /p/[token] 不扣费
 * - promptOrder.templateId 维持 NOT NULL（plan 复盘后回退此改动）
 * - promptOrder.orderNo schema 已补回 .unique()（无需 DDL，DB 已有约束）
 */
import { config as loadEnv } from "dotenv";
import { nanoid } from "nanoid";
import { Client } from "pg";

// 加载 .env.local / .env（与 drizzle.config.ts 一致）
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL 环境变量未设置");
}

// 检测 SSL（Neon/Supabase 远程必开；本地可关）
const isRemote =
  databaseUrl.includes("neon.tech") || databaseUrl.includes("supabase");
const finalUrl = databaseUrl
  .replace(/[?&]sslmode=[^&]*/g, "")
  .replace(/[?&]ssl=[^&]*/g, "")
  .replace(/[?&]uselibpqcompat=[^&]*/g, "");

// DDL idempotency —— 所有 ADD COLUMN / CREATE 都包在 DO $$ 里检查
async function exec(client: Client, sql: string) {
  await client.query(sql);
}

async function main() {
  const client = new Client({
    connectionString: finalUrl,
    ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();
  try {
    console.log("[apply] 连上 DB，开始 DDL...");

    // 1. agent.image_gen_token 列（unique，nullable）
    await exec(
      client,
      `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'agent'
            AND column_name = 'image_gen_token'
        ) THEN
          ALTER TABLE "agent" ADD COLUMN "image_gen_token" TEXT;
          ALTER TABLE "agent"
            ADD CONSTRAINT "agent_image_gen_token_unique" UNIQUE ("image_gen_token");
          RAISE NOTICE '[OK] agent.image_gen_token 列 + UNIQUE 约束';
        ELSE
          RAISE NOTICE '[skip] agent.image_gen_token 已存在';
        END IF;
      END
      $$;
    `
    );

    // 2. agent.credit_balance 列（NOT NULL DEFAULT 0）
    await exec(
      client,
      `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'agent'
            AND column_name = 'credit_balance'
        ) THEN
          ALTER TABLE "agent"
            ADD COLUMN "credit_balance" INTEGER NOT NULL DEFAULT 0;
          RAISE NOTICE '[OK] agent.credit_balance 列';
        ELSE
          RAISE NOTICE '[skip] agent.credit_balance 已存在';
        END IF;
      END
      $$;
    `
    );

    // 3. prompt_template.product_type_code 列（nullable，运行时校验对齐 PRODUCT_TYPES）
    await exec(
      client,
      `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'prompt_template'
            AND column_name = 'product_type_code'
        ) THEN
          ALTER TABLE "prompt_template" ADD COLUMN "product_type_code" TEXT;
          RAISE NOTICE '[OK] prompt_template.product_type_code 列';
        ELSE
          RAISE NOTICE '[skip] prompt_template.product_type_code 已存在';
        END IF;
      END
      $$;
    `
    );

    // 4. 回填 agent.image_gen_token（仅 NULL 行，nanoid 24 字符）
    const backfillRes = await client.query(`
      SELECT id FROM "agent"
      WHERE "image_gen_token" IS NULL
    `);
    const toFill = backfillRes.rows as Array<{ id: string }>;
    console.log(`[backfill] 待回填 agent 数量：${toFill.length}`);
    for (const row of toFill) {
      const token = nanoid(24);
      await client.query(
        `UPDATE "agent" SET "image_gen_token" = $1, "updated_at" = NOW() WHERE "id" = $2`,
        [token, row.id]
      );
    }
    if (toFill.length > 0) {
      console.log(`[OK] agent.image_gen_token 回填完成`);
    } else {
      console.log("[skip] 无需回填");
    }

    // 5. agent_prompt_template M2M 中间表 + 索引 + FK
    await exec(
      client,
      `
      CREATE TABLE IF NOT EXISTS "agent_prompt_template" (
        "agent_id" TEXT NOT NULL,
        "prompt_template_id" TEXT NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("agent_id", "prompt_template_id")
      );
    `
    );
    console.log("[OK] agent_prompt_template 表");

    await exec(
      client,
      `CREATE INDEX IF NOT EXISTS "apt_agent_idx"
       ON "agent_prompt_template" USING btree ("agent_id");`
    );
    console.log("[OK] apt_agent_idx 索引");

    await exec(
      client,
      `CREATE INDEX IF NOT EXISTS "apt_template_idx"
       ON "agent_prompt_template" USING btree ("prompt_template_id");`
    );
    console.log("[OK] apt_template_idx 索引");

    // FK：CASCADE 删除（中间表行无意义）
    await exec(
      client,
      `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'apt_agent_fk'
            AND table_name = 'agent_prompt_template'
        ) THEN
          ALTER TABLE "agent_prompt_template"
            ADD CONSTRAINT "apt_agent_fk"
            FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id")
            ON DELETE CASCADE;
          RAISE NOTICE '[OK] agent_prompt_template.agent_id FK';
        ELSE
          RAISE NOTICE '[skip] agent_prompt_template.agent_id FK 已存在';
        END IF;
      END
      $$;
    `
    );
    await exec(
      client,
      `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'apt_template_fk'
            AND table_name = 'agent_prompt_template'
        ) THEN
          ALTER TABLE "agent_prompt_template"
            ADD CONSTRAINT "apt_template_fk"
            FOREIGN KEY ("prompt_template_id") REFERENCES "public"."prompt_template"("id")
            ON DELETE CASCADE;
          RAISE NOTICE '[OK] agent_prompt_template.prompt_template_id FK';
        ELSE
          RAISE NOTICE '[skip] agent_prompt_template.prompt_template_id FK 已存在';
        END IF;
      END
      $$;
    `
    );

    // 6. agent_credit_txn_type enum + agent_credit_transaction 表
    await exec(
      client,
      `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type
          WHERE typname = 'agent_credit_txn_type'
        ) THEN
          CREATE TYPE "agent_credit_txn_type" AS ENUM ('topup', 'debit');
          RAISE NOTICE '[OK] agent_credit_txn_type enum';
        ELSE
          RAISE NOTICE '[skip] agent_credit_txn_type 已存在';
        END IF;
      END
      $$;
    `
    );

    await exec(
      client,
      `
      CREATE TABLE IF NOT EXISTS "agent_credit_transaction" (
        "id" TEXT PRIMARY KEY,
        "agent_id" TEXT NOT NULL,
        "type" "agent_credit_txn_type" NOT NULL,
        "amount" INTEGER NOT NULL,
        "order_id" TEXT,
        "note" TEXT,
        "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `
    );
    console.log("[OK] agent_credit_transaction 表");

    await exec(
      client,
      `CREATE INDEX IF NOT EXISTS "act_agent_created_idx"
       ON "agent_credit_transaction" USING btree ("agent_id", "created_at");`
    );
    console.log("[OK] act_agent_created_idx 索引");

    await exec(
      client,
      `CREATE INDEX IF NOT EXISTS "act_order_idx"
       ON "agent_credit_transaction" USING btree ("order_id");`
    );
    console.log("[OK] act_order_idx 索引");

    // FK
    await exec(
      client,
      `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'act_agent_fk'
            AND table_name = 'agent_credit_transaction'
        ) THEN
          ALTER TABLE "agent_credit_transaction"
            ADD CONSTRAINT "act_agent_fk"
            FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id")
            ON DELETE CASCADE;
          RAISE NOTICE '[OK] agent_credit_transaction.agent_id FK';
        ELSE
          RAISE NOTICE '[skip] agent_credit_transaction.agent_id FK 已存在';
        END IF;
      END
      $$;
    `
    );
    await exec(
      client,
      `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'act_order_fk'
            AND table_name = 'agent_credit_transaction'
        ) THEN
          ALTER TABLE "agent_credit_transaction"
            ADD CONSTRAINT "act_order_fk"
            FOREIGN KEY ("order_id") REFERENCES "public"."prompt_order"("id")
            ON DELETE SET NULL;
          RAISE NOTICE '[OK] agent_credit_transaction.order_id FK';
        ELSE
          RAISE NOTICE '[skip] agent_credit_transaction.order_id FK 已存在';
        END IF;
      END
      $$;
    `
    );

    // 7. sanity check
    const checkRes = await client.query(`
      SELECT
        (SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'agent' AND column_name = 'image_gen_token'
        )) AS agent_image_token_col,
        (SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'agent' AND column_name = 'credit_balance'
        )) AS agent_credit_balance_col,
        (SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'prompt_template' AND column_name = 'product_type_code'
        )) AS template_product_type_col,
        (SELECT COUNT(*) FROM "agent" WHERE "image_gen_token" IS NULL) AS agent_no_token,
        (SELECT COUNT(*) FROM "agent_prompt_template") AS m2m_rows,
        (SELECT COUNT(*) FROM "agent_credit_transaction") AS txn_rows,
        (SELECT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'agent_credit_txn_type'
        )) AS txn_type_enum
    `);
    const r = checkRes.rows[0];
    console.log("[verify] agent.image_gen_token 列:", r.agent_image_token_col);
    console.log(
      "[verify] agent.credit_balance 列:",
      r.agent_credit_balance_col
    );
    console.log(
      "[verify] prompt_template.product_type_code 列:",
      r.template_product_type_col
    );
    console.log("[verify] agent 还有未回填 token 的:", r.agent_no_token);
    console.log("[verify] agent_prompt_template 行数:", r.m2m_rows);
    console.log("[verify] agent_credit_transaction 行数:", r.txn_rows);
    console.log("[verify] agent_credit_txn_type enum:", r.txn_type_enum);

    if (
      !r.agent_image_token_col ||
      !r.agent_credit_balance_col ||
      !r.template_product_type_col ||
      Number(r.agent_no_token) !== 0 ||
      !r.txn_type_enum
    ) {
      throw new Error("迁移应用失败：sanity check 未全通过");
    }
    console.log("[done] agent workbench migration 已应用");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("[apply] 失败：", e);
  process.exit(1);
});
