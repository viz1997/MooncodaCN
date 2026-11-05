#!/usr/bin/env -S npx tsx

/**
 * 注册 Sellbase webhook 端点（2026-11-04）
 *
 * ## 这个脚本干什么
 *
 * 把 `https://<站点>/api/webhooks/sellbase` 注册到 Sellbase,订阅 4 个支付相关
 * 的事件。Sellbase 收到订单状态变化时会往这个地址 POST,本仓库靠它把
 * 「已付款 / 已退款 / 已取消」回写到本地订单(打印工单和商城订单共用一条链)。
 *
 * ## ⚠️ 签名密钥只返回一次
 *
 * `POST /webhooks` 的响应里有 `secret` 字段,**只有这一次**。之后
 * `GET /webhooks` 只能看到 `secret_prefix`(前几位),拿不回完整密钥。
 *
 * 所以密钥要**立刻**落到环境变量 `SELLBASE_WEBHOOK_SECRET` 里。
 *
 * - **不要**写进任何入库的文件(仓库里 `.env*` 被 gitignore 了,但别赌)
 * - 本脚本**默认只打印**到终端
 * - 想让它直接写进本地 `.env.local`(gitignore 覆盖)就加 `--write-env`
 *
 * 密钥弄丢了怎么办:删掉旧端点重新注册(会拿到新密钥),或者用 `PATCH
 * /webhooks/:id` 更新 —— 但 update 响应里也**没有** secret 字段,只有新建才有。
 *
 * ## 跑法
 *
 * ```bash
 * pnpm tsx scripts/register-sellbase-webhook.ts              # 注册 / 更新
 * pnpm tsx scripts/register-sellbase-webhook.ts --list       # 只看现有端点
 * pnpm tsx scripts/register-sellbase-webhook.ts --write-env  # 注册并写进 .env.local
 * pnpm tsx scripts/register-sellbase-webhook.ts --url https://staging.example.com/api/webhooks/sellbase
 * ```
 *
 * ## 幂等
 *
 * 按 **url** 认端点(Sellbase 没有提供自定义 id)。已经注册过同一个 url 就
 * 更新事件列表,不会重复建一个 —— 重复的端点意味着 webhook 被投递两遍,
 * 虽然本地处理是幂等的,但日志会变吵。
 *
 * ## 环境变量
 *
 * `SELLBASE_URL` + `SELLBASE_API_TOKEN`(admin token,需要 `webhooks:write`
 * scope)+ `BETTER_AUTH_URL`(站点地址,用来拼 webhook 的回调 url)。
 * 详见 `src/features/sellbase/lib/env.ts` 的文件头。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

import { callSellbase, getSellbaseAdmin } from "@/features/sellbase/lib/client";
import { getSellbaseConfig, getSiteUrl } from "@/features/sellbase/lib/env";
import { SELLBASE_SUBSCRIBED_EVENTS } from "@/features/sellbase/lib/events";
import { upsertEnvVar } from "./lib/env-file";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

/**
 * 本仓库关心的事件
 *
 * 直接引用 `events.ts` 里那份白名单 —— 两边如果各写一份,迟早会一边加了
 * 一边没加,webhook 收到事件却没人处理,或者反过来。
 */
const EVENTS = SELLBASE_SUBSCRIBED_EVENTS;

/** 端点描述 —— 在 Sellbase 后台一眼认出是本仓库的 */
const DESCRIPTION = "Mooncoda 支付回调(/api/webhooks/sellbase)";

/* -------------------------------------------------------------------------- */
/*  参数解析                                                                    */
/* -------------------------------------------------------------------------- */

const args = process.argv.slice(2);

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function readOption(name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

/* -------------------------------------------------------------------------- */
/*  主流程                                                                      */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const client = getSellbaseAdmin();
  const config = getSellbaseConfig();

  // webhook 端点挂在 SDK 的 `admin` 命名空间下 —— 顶层没有 `webhooks`
  // (`client.webhooks` 是 undefined,调了就是 "Cannot read properties of
  // undefined")。
  const webhooks = client.admin.webhooks;

  console.log(`[webhook] Sellbase:${config.url}`);

  // ---- 1. 目标 url ----
  const url = readOption("--url") ?? `${getSiteUrl()}/api/webhooks/sellbase`;
  console.log(`[webhook] 目标端点:${url}`);

  // ---- 2. 现有端点 ----
  const existing = await callSellbase(() => webhooks.list());

  if (hasFlag("--list")) {
    console.log(`\n[webhook] 现有 ${existing.data.length} 个端点:`);
    for (const hook of existing.data) {
      console.log(
        `  ${hook.enabled ? "✓" : "✗"} ${hook.id}\n` +
          `      url: ${hook.url}\n` +
          `      事件: ${hook.events.join(", ")}\n` +
          `      密钥前缀: ${hook.secret_prefix} · ` +
          `最近投递: ${hook.stats.last_delivery_at ?? "无"} ` +
          `(${hook.stats.last_status ?? "—"})`
      );
    }
    console.log(`\n[webhook] 可订阅的事件:${existing.events.join(", ")}`);
    return;
  }

  // ---- 3. 已有同一个 url → 更新而不是重建 ----
  const match = existing.data.find((hook) => hook.url === url);

  if (match) {
    console.log(`[webhook] 已存在同一 url 的端点(${match.id})· 更新事件列表`);
    const updated = await callSellbase(() =>
      webhooks.update(match.id, {
        url,
        events: [...EVENTS],
        description: DESCRIPTION,
        enabled: true,
        confirm: true,
      })
    );
    console.log(
      `[webhook] 已更新 · 事件:${updated.events.join(", ")} · ` +
        `密钥前缀:${updated.secret_prefix}`
    );
    console.log(
      "\n[webhook] ⚠️  更新不会重新返回 secret —— " +
        "如果 SELLBASE_WEBHOOK_SECRET 还没配好,请删掉这个端点再跑一次本脚本(会新建并返回新密钥)。"
    );
    return;
  }

  // ---- 4. 新建 ----
  console.log(`[webhook] 新建端点 · 事件:${EVENTS.join(", ")}`);

  const created = await callSellbase(() =>
    webhooks.create({
      url,
      events: [...EVENTS],
      description: DESCRIPTION,
      // API token 的写操作必须显式确认
      confirm: true,
    })
  );

  console.log(`\n[webhook] ✅ 已注册`);
  console.log(`  端点 id : ${created.id}`);
  console.log(`  url     : ${created.url}`);
  console.log(`  事件    : ${created.events.join(", ")}`);
  console.log(`  密钥前缀: ${created.secret_prefix}`);

  // ---- 5. 密钥落地 ----
  const envPath = resolve(process.cwd(), ".env.local");

  if (hasFlag("--write-env")) {
    await upsertEnvVar(envPath, "SELLBASE_WEBHOOK_SECRET", created.secret, {
      secret: true,
    });
    console.log(`\n[webhook] ✅ 密钥已写入 ${envPath}`);
    console.log(
      "[webhook]    (.env* 在 .gitignore 里,不会被提交 —— 但仍然别把密钥贴进聊天或工单)"
    );
  } else {
    console.log("\n[webhook] ┌────────────────────────────────────────────");
    console.log("[webhook] │ 签名密钥(只显示这一次,现在就存下来):");
    console.log(`[webhook] │ ${created.secret}`);
    console.log("[webhook] └────────────────────────────────────────────");
    console.log(
      "[webhook] 把它设成环境变量 SELLBASE_WEBHOOK_SECRET(别写进任何入库的文件)。"
    );
    console.log(
      "[webhook] 想让脚本直接写进 .env.local:加 --write-env 重跑(会新建一个端点)。"
    );
  }
}

main().catch((error) => {
  console.error("\n[webhook] 失败:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
