#!/usr/bin/env -S npx tsx

/**
 * 把 `sellbase-jobs` 接进 pg_cron(2026-11-04)
 *
 * ## 为什么必须做这一步
 *
 * Sellbase 的**所有 webhook 投递**都发生在 `sellbase-jobs` 这个 Edge
 * Function 里(`runJobs()` → `deliverWebhooks()`)。订单付款后,API 只是往
 * `sellbase.webhook_deliveries` 写一行「待投递」,真正把事件 POST 到本仓库
 * `/api/webhooks/sellbase` 的是 jobs 函数。
 *
 * jobs 函数平时靠 **pg_cron 每分钟调一次**:
 *
 * ```
 * cron → sellbase.invoke_jobs() → net.http_post(jobs_url, Bearer <key>)
 * ```
 *
 * URL 和 key 存在 **Supabase Vault** 里(secret 名 `sellbase_jobs_url` /
 * `sellbase_jobs_key`),由 `sellbase.configure_jobs(url, key)` 写入。
 * 不配这一步,cron 每次都直接 return —— **本仓库永远收不到付款 webhook**,
 * 商城订单会一直卡在「未付款」。
 *
 * ## key 是哪个
 *
 * 是这个 Supabase 项目的 **service role key**(`SUPABASE_SERVICE_ROLE_KEY`)——
 * jobs 函数比对的是它自己环境变量里的那个值:
 *
 * ```js
 * if (auth !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) → 401
 * ```
 *
 * 拿法:`supabase projects api-keys --project-ref <ref> --reveal`
 * (或者 Dashboard → Project Settings → API Keys)。
 *
 * ## 跑法
 *
 * ```bash
 * # key 已经从环境变量读到了(下面任一种)
 * SUPABASE_SERVICE_ROLE_KEY=… pnpm tsx scripts/configure-sellbase-jobs.ts
 *
 * # 或者让脚本顺手写进 .env.local
 * pnpm tsx scripts/configure-sellbase-jobs.ts --write-env
 * ```
 *
 * ⚠️ service role key 是**整个项目的钥匙**(能绕过所有 RLS)。它只进
 * `.env.local`(gitignore 覆盖),不进仓库文件、不进聊天。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

import { upsertEnvVar } from "./lib/env-file";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

/** key 放哪个环境变量 —— 跟 Edge Runtime 里那个同名 */
const KEY_VAR = "SUPABASE_SERVICE_ROLE_KEY";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[configure-jobs] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const serviceKey = process.env[KEY_VAR]?.trim();
  if (!serviceKey) {
    console.error(
      `[configure-jobs] 缺少 ${KEY_VAR} —— 拿法:\n` +
        "  npx supabase projects api-keys --project-ref <ref> --reveal"
    );
    process.exit(1);
  }

  // jobs 函数的地址 —— 跟 API 同一个项目,只是函数名不同
  const supabaseUrl = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SELLBASE_URL?.split("/functions/")[0] ??
    ""
  ).trim();
  if (!supabaseUrl) {
    console.error(
      "[configure-jobs] 缺少 NEXT_PUBLIC_SUPABASE_URL(或者 SELLBASE_URL)"
    );
    process.exit(1);
  }
  const jobsUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/sellbase-jobs`;

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    // configure_jobs 是 security definer,只授了 service_role —— postgres
    // 是 owner,照样能调。
    await client.query("select sellbase.configure_jobs($1, $2)", [
      jobsUrl,
      serviceKey,
    ]);

    const rows = await client.query<{ name: string }>(
      `select name from vault.secrets
        where name in ('sellbase_jobs_url', 'sellbase_jobs_key')
        order by name`
    );
    console.log(`[configure-jobs] ✅ 已写入 vault:${jobsUrl}`);
    console.log(
      `[configure-jobs]    vault 里的 secret:${rows.rows.map((r) => r.name).join(", ")}`
    );
    console.log(
      "[configure-jobs]    cron(sellbase-run-jobs)每分钟会调一次 jobs 函数 —— " +
        "webhook 从这一刻起才投得到本仓库"
    );
  } finally {
    await client.end();
  }

  if (hasFlag("--write-env")) {
    const envPath = resolve(process.cwd(), ".env.local");
    await upsertEnvVar(envPath, KEY_VAR, serviceKey, { secret: true });
    console.log(`[configure-jobs] ✅ ${KEY_VAR} 已写入 ${envPath}`);
  }
}

main().catch((error) => {
  console.error("\n[configure-jobs] 失败:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
