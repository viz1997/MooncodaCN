#!/usr/bin/env -S npx tsx

/**
 * 建 Sellbase 店铺 + admin token(2026-11-04)
 *
 * `npx sellbase init` 会把这件事跟一堆前端脚手架捆在一起(装包、写
 * `components/sellbase/*`、写 `src/app/admin/[[...path]]/page.tsx`、往
 * CLAUDE.md 追加托管块)。本仓库不需要那些 —— 只借它两件事:
 *
 * 1. **建店铺**(`sellbase.stores`)—— 币种 CNY、税率 0、国家 CN
 * 2. **建 admin token**(`sellbase.api_tokens`)—— `mooncoda_live_…`
 *
 * ## 为什么不用 init 自带的 token
 *
 * init 的默认 scope 是 `DEFAULT_AGENT_SCOPES` = 全部 scope 减去
 * `refunds:write` 和 `webhooks:write` —— 后者被刻意排除,因为「把店铺数据
 * 发到外部 url」是一条独立权限。
 *
 * 但本仓库**要**用它注册 webhook(`scripts/register-sellbase-webhook.ts`),
 * 所以这里的 token 显式带上 `webhooks:write`。仍然**不带**
 * `refunds:write` —— 退款是动钱的操作,本仓库这轮不发起退款。
 *
 * ## 前置
 *
 * Sellbase 的迁移要先落到同一个 Supabase 项目里:
 *
 * ```bash
 * supabase db push --include-all     # supabase/migrations/ 里是 Sellbase 的迁移
 * ```
 *
 * ## 跑法
 *
 * ```bash
 * pnpm tsx scripts/bootstrap-sellbase-store.ts               # 只打印 token
 * pnpm tsx scripts/bootstrap-sellbase-store.ts --write-env   # 并写进 .env.local
 * ```
 *
 * ⚠️ token **只显示这一次**(库里只存 sha256)—— 加 `--write-env` 直接落盘,
 * 别贴进聊天。
 */

import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

import { upsertEnvVar } from "./lib/env-file";
import { SELLBASE_TOKEN_PREFIX } from "./lib/sellbase-token";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

/**
 * token 前缀
 *
 * 跟 `scripts/fetch-sellbase-assets.ts` 打进 bundle 的那个一致 —— Sellbase
 * 靠 `credential.startsWith(BRAND.tokenPrefix)` 认「这是 admin token」。
 * 前缀为什么不能是 Sellbase 默认的 `sb_live_`(撞 Supabase 的 API key
 * 命名空间,网关会 401)见 `scripts/lib/sellbase-token.ts`。
 */
const TOKEN_PREFIX = SELLBASE_TOKEN_PREFIX;

/**
 * 这个 token 要的 scope
 *
 * = Sellbase 的 DEFAULT_AGENT_SCOPES + `webhooks:write`
 * (注册 webhook 端点要用;见 `src/features/sellbase/lib/env.ts`)
 *
 * 刻意**不含** `refunds:write` —— 退款动钱,本仓库只处理退款事件,不发退款。
 */
const TOKEN_SCOPES = [
  "catalog:read",
  "catalog:write",
  "orders:read",
  "orders:write",
  "customers:read",
  "discounts:write",
  "settings:write",
  "integrations:write",
  "webhooks:write",
];

/** 店铺参数 —— 跟 `scripts/sync-sellbase-catalog.ts` 的两条硬断言对齐 */
const STORE = {
  name: "Mooncoda 小梦定制馆",
  slug: "mooncoda",
  currency: "CNY",
  country: "CN",
  locale: "zh-Hans",
  timezone: "Asia/Shanghai",
};

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[bootstrap-sellbase] 缺少 DATABASE_URL");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    // ── 1. 迁移落没落? ──────────────────────────────────────────────────
    const schemaCheck = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM information_schema.tables
        WHERE table_schema = 'sellbase' AND table_name IN ('stores', 'api_tokens')`
    );
    if (Number(schemaCheck.rows[0]?.n ?? 0) < 2) {
      console.error(
        "[bootstrap-sellbase] 共享库里还没有 sellbase schema —— " +
          "先把 Sellbase 的迁移推上去:supabase db push --include-all"
      );
      process.exit(1);
    }

    // ── 2. 店铺(没有就建) ──────────────────────────────────────────────
    const existing = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM sellbase.stores ORDER BY created_at LIMIT 1`
    );

    let storeId: string;
    if (existing.rows[0]) {
      storeId = existing.rows[0].id;
      console.log(`[bootstrap-sellbase] 店铺已存在:${existing.rows[0].name}`);
    } else {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO sellbase.stores
           (name, slug, default_currency, default_locale, timezone, country, settings)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING id`,
        [
          STORE.name,
          STORE.slug,
          STORE.currency,
          STORE.locale,
          STORE.timezone,
          STORE.country,
          JSON.stringify({ tax: { mode: "inclusive", rate_bps: 0 } }),
        ]
      );
      storeId = inserted.rows[0].id;
      console.log(
        `[bootstrap-sellbase] 已建店铺:${STORE.name}(${STORE.currency} · 税率 0)`
      );
    }

    // ── 3. token ────────────────────────────────────────────────────────
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const tokenHash = createHash("sha256").update(token).digest("hex");

    await client.query(
      `INSERT INTO sellbase.api_tokens (store_id, name, token_hash, prefix, scopes)
       VALUES ($1, $2, $3, $4, $5::text[])`,
      [storeId, "Mooncoda 服务端", tokenHash, token.slice(0, 12), TOKEN_SCOPES]
    );

    console.log(
      `[bootstrap-sellbase] token 已建(scope: ${TOKEN_SCOPES.join(", ")})`
    );

    // ── 3b. 作废前缀对不上的旧 token ─────────────────────────────────────
    //
    // 前缀换过(`sb_live_` → `mooncoda_live_`),旧 token 网关根本不让它
    // 过去,留着只是让人以为还能用。标成 revoked,别真删 —— 审计日志里
    // 还能看到它存在过。
    //
    // 比的是 `left(prefix, 12)`:Sellbase 存进 `prefix` 列的是 token 的
    // **前 12 个字符**,而我们的前缀是 13 个 —— 直接 `starts_with` 会把
    // 自己刚建的 token 也当成旧的作废掉。
    const stale = await client.query<{ name: string; prefix: string }>(
      `UPDATE sellbase.api_tokens
          SET revoked_at = now()
        WHERE store_id = $1
          AND revoked_at IS NULL
          AND left(prefix, 12) <> left($2, 12)
        RETURNING name, prefix`,
      [storeId, TOKEN_PREFIX]
    );
    for (const row of stale.rows) {
      console.log(
        `[bootstrap-sellbase] ♻️  已作废旧 token:${row.name}(${row.prefix}…)`
      );
    }

    // ── 4. 落地 ─────────────────────────────────────────────────────────
    const envPath = resolve(process.cwd(), ".env.local");
    if (hasFlag("--write-env")) {
      await upsertEnvVar(envPath, "SELLBASE_API_TOKEN", token, {
        secret: true,
      });
      console.log(`[bootstrap-sellbase] ✅ 已写入 ${envPath}`);
      console.log(
        "[bootstrap-sellbase]    (.env* 在 .gitignore 里 —— 但仍然别把密钥贴进聊天)"
      );
    } else {
      console.log(
        "\n[bootstrap-sellbase] ┌──────────────────────────────────────"
      );
      console.log(
        "[bootstrap-sellbase] │ admin token(只显示这一次,现在就存下来):"
      );
      console.log(`[bootstrap-sellbase] │ ${token}`);
      console.log(
        "[bootstrap-sellbase] └──────────────────────────────────────"
      );
      console.log(
        "[bootstrap-sellbase] 设成 SELLBASE_API_TOKEN,或加 --write-env 重跑。"
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\n[bootstrap-sellbase] 失败:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
