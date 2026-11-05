#!/usr/bin/env -S npx tsx

/**
 * 往 `.env.local` 写一个环境变量(2026-11-05)
 *
 * ## 为什么有这个小工具
 *
 * 写环境变量统一走 `scripts/lib/env-file.ts` 的 `upsertEnvVar()` —— 它是
 * **替换**同名变量而不是追加(追加会出现两个同名变量,dotenv 取哪个取决于
 * 顺序,很容易踩「密钥明明配了却读不到」)。
 *
 * 但直接手改 `.env.local` 有两个坑:
 *
 * - 文件里有几十个密钥,编辑器一打开就全进上下文了
 * - 追加 vs 替换的语义得自己保证
 *
 * 所以走这个脚本:只碰指定的**一个**变量,值不回显(只回显掩码后的)。
 *
 * ## 用法
 *
 * ```bash
 * pnpm tsx scripts/set-env-var.ts NEXT_PUBLIC_SUPPORT_EMAIL support@mooncoda.com
 * pnpm tsx scripts/set-env-var.ts SELLBASE_API_TOKEN mooncoda_live_xxx --secret
 * pnpm tsx scripts/set-env-var.ts FOO bar --file .env
 * ```
 *
 * ⚠️ **别把密钥贴进聊天 / 命令历史** —— 这个脚本只回显掩码值,但命令本身
 * 是明文的。密钥类的用 `scripts/lib/env-file.ts` 里的脚本落盘。
 */

import { resolve } from "node:path";

import { upsertEnvVar } from "./lib/env-file";

/** 回显时只留头尾,中间打码 */
function mask(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

function readFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const [key, value] = args;

  if (!key || value === undefined) {
    console.error(
      "用法:pnpm tsx scripts/set-env-var.ts <KEY> <VALUE> [--secret]"
    );
    process.exit(1);
  }

  const file = readFlag("file") ? ".env" : ".env.local";
  const envPath = resolve(process.cwd(), file);

  await upsertEnvVar(envPath, key, value, { secret: readFlag("secret") });

  console.log(
    `[set-env-var] ✅ ${file} 里 ${key} = ${mask(value)}(已替换同名变量)`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
