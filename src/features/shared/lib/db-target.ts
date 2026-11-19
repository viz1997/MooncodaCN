/**
 * 「我连的是哪个库」—— 纯函数那一半(2026-11-19)
 *
 * ## 为什么要有这个
 *
 * 线上真踩过:生产库的 `print_order` 少了 `idempotency_key` 这一列 ⇒ Drizzle
 * 每次查工单都带那一列 ⇒ PG 报 `42703 column "idempotency_key" does not
 * exist` ⇒ 建单接口 500。
 *
 * 工作室按命令跑完迁移之后,**同一个错又报了一遍**。原因几乎肯定是:
 * **迁移跑在另一个库上** —— 本地 `.env` / `.env.local` 里的 `DATABASE_URL`
 * 跟线上部署(Vercel 环境变量)那份**不是一个**。
 *
 * 而当时的迁移脚本跑完只回读一句「✓ idempotency_key 列在」,
 * **从不打印连的是哪个库** ⇒ 连错库跟跑成功在输出里**长得一模一样**,
 * 直到线上继续报错。
 *
 * ⇒ 迁移脚本的第一行就该说「我连的是哪个库」。这个模块提供那份信息。
 *
 * ## 边界
 *
 * **零 import**(连 `import type` 都没有)⇒ 能进 vitest 的 `unit` project,
 * 不碰数据库、不碰网络、不碰文件系统。
 *
 * - **密码一个字都不出现** —— 这份输出是要贴到聊天 / 工单里的
 * - **认不出来就说认不出来** —— 返回 `null`,不猜
 */

/** 连的是哪个库 —— 给工作室看的身份信息(**密码不出现**) */
export interface DatabaseTarget {
  /** 主机名(pooler 的主机名带 `-pooler`) */
  host: string;
  /** 端口 */
  port: string;
  /** 库名 */
  database: string;
  /** 用户名 */
  user: string;
  /** 走的是连接池(Neon / Supabase 的 pooler) */
  pooler: boolean;
  /** 连接串里要了 SSL */
  ssl: boolean;
  /** 给人看的一行 —— `postgresql://user@host:5432/db` */
  summary: string;
}

/**
 * 连的是哪个库 —— **密码一个字都不出现**
 *
 * 工作室最需要的不是「迁移跑没跑」,是「我连的到底是不是线上那个库」。
 * ⇒ 这一行就是给他跟 Vercel 环境变量里那份 `DATABASE_URL` 对的。
 *
 * - 认不出连接串 ⇒ `null`(不猜)
 * - pooler:主机名带 `-pooler`(Neon)或 `.pooler.`(Supabase)/ 端口 6543
 */
export function describeDatabaseTarget(
  connectionString: string | undefined | null
): DatabaseTarget | null {
  if (!connectionString) return null;

  let host = "";
  let port = "";
  let database = "";
  let user = "";
  let ssl = false;

  try {
    const url = new URL(connectionString);
    host = url.hostname;
    port = url.port || "5432";
    database = url.pathname.replace(/^\//, "");
    user = decodeURIComponent(url.username || "");
    const mode = url.searchParams.get("sslmode");
    ssl = mode ? mode !== "disable" : url.protocol === "postgresql:";
  } catch {
    // 连接串不是 URL 形状 —— 退化到正则,认不出就返回 null(不猜)
    const m =
      /^(?:postgres|postgresql):\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?#]+)(?::(\d+))?\/([^?#]*)/.exec(
        connectionString
      );
    if (!m) return null;
    user = m[1] ?? "";
    host = m[3] ?? "";
    port = m[4] || "5432";
    database = m[5] ?? "";
    ssl = /sslmode=require|sslmode=verify/i.test(connectionString);
  }

  if (!host) return null;

  const pooler =
    host.includes("-pooler") ||
    host.includes(".pooler.") ||
    host.startsWith("pooler.") ||
    port === "6543";

  return {
    host,
    port,
    database,
    user,
    pooler,
    ssl,
    summary: `postgresql://${user ? `${user}@` : ""}${host}:${port}/${database}${
      pooler ? " (pooler)" : ""
    }`,
  };
}

/**
 * 这个主机名是不是**本机**
 *
 * 本机 = `localhost` / `127.0.0.1` / `::1` / `0.0.0.0` / `*.local`。
 *
 * ⇒ 目标是本机时,脚本**必须大声提醒**:改本地那个库**不会**影响线上。
 */
export function isLocalDatabaseHost(host: string | undefined | null): boolean {
  if (!host) return false;
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
  if (h.startsWith("127.")) return true;
  if (h.endsWith(".local") || h.endsWith(".localhost")) return true;
  return false;
}

/**
 * 该给工作室的一句提醒 —— 没有要提醒的就返回 `null`
 *
 * 本机库是最要提醒的那种:脚本跑完照样打印「✓ 列在」,**线上那个库一列
 * 都没变** —— 正是 2026-11-19 那次「跑完迁移还是同一个错」的形状。
 */
export function databaseTargetWarning(
  target: DatabaseTarget | null | undefined
): string | null {
  if (!target) return null;
  if (!isLocalDatabaseHost(target.host)) return null;
  return [
    "⚠️ 目标是**本机**的数据库 —— 改它**不会**影响线上!",
    "   线上那份 DATABASE_URL 在 Vercel 的环境变量里",
    "   (Vercel → mooncoda-cn → Settings → Environment Variables → DATABASE_URL)。",
    "   要对线上那个库跑,把它抄到 shell 里再跑(**不用改任何文件**):",
    "     DATABASE_URL='<Vercel 上那份>' pnpm migrate:xxx",
  ].join("\n");
}
