/**
 * 打印「我连的是哪个库」—— 给迁移脚本用(2026-11-19)
 *
 * ## 为什么要有这个
 *
 * 线上真踩过:生产库的 `print_order` 少了 `idempotency_key` 这一列 ⇒ 建单接口
 * 500。工作室按命令跑完迁移之后,**同一个错又报了一遍**。
 *
 * 根因是**迁移跑在另一个库上** —— 本地 `.env` / `.env.local` 里的
 * `DATABASE_URL` 跟线上部署(Vercel 环境变量)那份**不是一个**。
 *
 * 而那时候的迁移脚本跑完只回读一句「✓ idempotency_key 列在」,
 * **从不打印连的是哪个库** ⇒ **连错库跟跑成功在输出里长得一模一样**,
 * 直到线上继续报错。
 *
 * ⇒ 迁移脚本的**第一行**就该说这个。
 *
 * ## 这个 helper 做什么
 *
 * 1. 打印目标库(主机 / 端口 / 库名 / 用户 / 是不是 pooler)——
 *    **密码一个字都不打**(这份输出是要贴到聊天 / 工单里的)
 * 2. 说这个值**是从哪儿来的**(shell / `.env.local` / `.env`)——
 *    这决定了「你以为连的是哪个」
 * 3. 目标是**本机**的时候**大声提醒** —— 改本地那个库**不会**影响线上
 *
 * ## 用法
 *
 * ```ts
 * import { printDatabaseTarget } from "./lib/print-db-target";
 *
 * if (!process.env.DATABASE_URL) { /* … *\/ }
 * printDatabaseTarget("apply-print-order-idempotency");
 * ```
 *
 * > ⚠️ **这个模块必须在 `DATABASE_URL` 已经加载之后调用** ——
 * > 迁移脚本自己加载 dotenv(`.env.local` 先、`.env` 后),加载完再调。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  databaseTargetWarning,
  describeDatabaseTarget,
} from "@/features/shared/lib/db-target";

/**
 * 这个值是从哪儿来的
 *
 * - `shell` —— shell 里 export 的(**优先级最高**,见下面的说明)
 * - `.env.local` —— 那个文件里的
 * - `.env` —— 那个文件里的
 * - `unknown` —— 认不出来(不猜)
 *
 * ## 为什么 shell 优先级最高
 *
 * `dotenv-expand` 的行为是「**`process.env` 里已经有了就短路**」——
 * 文件里的值**不会**覆盖 shell 里已经 export 的值。
 *
 * ⇒ 所以 `DATABASE_URL='<线上那份>' pnpm migrate:xxx` 一定赢,
 * 而且**不用改任何文件**(改 `.env.local` 有个副作用:忘了改回来,
 * 后面每一条本地脚本都悄悄连到线上)。
 */
export type DatabaseUrlSource = "shell" | ".env.local" | ".env" | "unknown";

/**
 * 从一个 env 文件里读 `DATABASE_URL` 的原始值
 *
 * 自己解析(不引 `dotenv`)—— 只要一个键,不值得起整个 dotenv。
 */
function readEnvFileValue(file: string, key: string): string | null {
  if (!existsSync(file)) return null;
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() !== key) continue;
    let value = line.slice(eq + 1).trim();
    // 去掉引号
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

/**
 * 生效的 `DATABASE_URL` 是从哪儿来的
 *
 * 比对三处:shell(就是 `process.env` 现在的值)、`.env.local`、`.env`。
 * 两个文件里都不是 ⇒ 就是 shell(或者别的地方设的)⇒ 报 `shell`。
 */
export function detectDatabaseUrlSource(
  resolved: string | undefined | null,
  cwd = process.cwd()
): DatabaseUrlSource {
  if (!resolved) return "unknown";
  const local = readEnvFileValue(resolve(cwd, ".env.local"), "DATABASE_URL");
  if (local && local === resolved) return ".env.local";
  const base = readEnvFileValue(resolve(cwd, ".env"), "DATABASE_URL");
  if (base && base === resolved) return ".env";
  return "shell";
}

/**
 * 打印目标库(给工作室看的那几行)
 *
 * @param label 脚本名(印在每一行前面)
 * @param connectionString 生效的连接串 —— 缺省取 `process.env.DATABASE_URL`
 * @param cwd 找 `.env.local` / `.env` 的地方 —— 缺省当前工作目录
 */
export function printDatabaseTarget(
  label: string,
  connectionString: string | undefined | null = process.env.DATABASE_URL,
  cwd: string = process.cwd()
): void {
  console.log(`[${label}] 目标库:`);

  if (!connectionString) {
    console.log("  ❌ 没有 DATABASE_URL —— 这个脚本连不上任何库");
    console.log("");
    return;
  }

  const target = describeDatabaseTarget(connectionString);

  if (!target) {
    console.log("  (连接串不是 URL 形状,认不出来 —— 下面服务器那边自己说了算)");
  } else {
    console.log(
      `  主机 ${target.host} / 端口 ${target.port} / 库 ${target.database} / 用户 ${target.user}`
    );
    console.log(
      `  ${target.pooler ? "走连接池(pooler)" : "直连(不是 pooler)"} / SSL ${
        target.ssl ? "开" : "关"
      }`
    );
  }

  const source = detectDatabaseUrlSource(connectionString, cwd);
  console.log(
    `  DATABASE_URL 来源:${
      source === "shell"
        ? "shell(你 export 的那个 —— 优先级最高)"
        : source === "unknown"
          ? "认不出来"
          : source
    }`
  );

  const warning = databaseTargetWarning(target);
  if (warning) {
    console.log("");
    console.log(warning);
  }

  console.log(
    "  确认这是**线上那个库**再往下跑 —— 跟 Vercel 环境变量里那份对一下。"
  );
  console.log("");
}
