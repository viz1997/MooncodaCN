import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  databaseTargetWarning,
  describeDatabaseTarget,
  isLocalDatabaseHost,
} from "@/features/shared/lib/db-target";

/**
 * 「我连的是哪个库」—— 2026-11-19
 *
 * ## 线上真踩过的那一次
 *
 * 生产库的 `print_order` 少了 `idempotency_key` 这一列 ⇒ 建单接口 500。
 * 工作室按命令跑完迁移之后,**同一个错又报了一遍**。
 *
 * 最可能的原因不是「迁移没跑」,是**「迁移跑在另一个库上」** —— 本地
 * `.env` / `.env.local` 里的 `DATABASE_URL` 跟线上部署(Vercel 环境变量)
 * 那份**不是一个**。而当时的迁移脚本跑完只回读一句「✓ 列在」,
 * **从不打印连的是哪个库** ⇒ **连错库跟跑成功在输出里长得一模一样**。
 *
 * ⇒ 每个迁移脚本的第一行都得说这个。
 *
 * ## 这个测试守住什么
 *
 * | 守卫 | 为什么 |
 * |---|---|
 * | **密码一个字都不出现** | 这份输出是要贴到聊天 / 工单里的 |
 * | 主机 / 端口 / 库名 / 用户 认得出来 | 工作室拿它跟 Vercel 环境变量里那份对 |
 * | **pooler 认得出来** | Neon / Supabase 的 pooler 主机名跟直连的不一样,别看错 |
 * | SSL 开没开认得出来 | pooler 必须开 SSL,关了连不上 |
 * | 认不出来就说认不出来 | **不猜** —— 猜错比不猜更坏 |
 * | 本机库要**大声提醒** | 改本地那个库**不会**影响线上(那正是那次事故的形状) |
 * | **每个迁移脚本都调 `printDatabaseTarget()`** | 漏一个 = 那个脚本连错库也看不出来 |
 * | **打印在加载 env 之后** | 先打印 = 打印的是上一轮的旧值,等于没打 |
 *
 * 全部是纯函数 + 文件扫描 —— 不需要 DB / 网络 / 浏览器。
 *
 * > 「库跟代码差多少」那一半在 `schema-drift.test.ts`。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 全部手写迁移脚本 */
const SCRIPT_FILES = readdirSync(join(ROOT, "scripts")).filter(
  (f) => f.startsWith("apply-") && f.endsWith(".ts")
);

/** 读一个迁移脚本 */
function readScript(file: string): string {
  return readFileSync(join(ROOT, "scripts", file), "utf8");
}

describe("连的是哪个库 —— 身份信息", () => {
  it("密码一个字都不出现", () => {
    const target = describeDatabaseTarget(
      "postgresql://postgres:sup3r-s3cret@db.example.com:5432/mydb"
    );
    expect(target).not.toBeNull();
    const serialized = JSON.stringify(target);
    expect(serialized).not.toContain("sup3r-s3cret");
    expect(serialized).not.toContain("s3cret");
    // 摘要里也不该有
    expect(target?.summary).not.toContain("sup3r");
  });

  it("主机 / 端口 / 库名 / 用户 都认得出来", () => {
    const target = describeDatabaseTarget(
      "postgresql://postgres.abc123:pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"
    );
    expect(target?.host).toBe("aws-0-ap-northeast-1.pooler.supabase.com");
    expect(target?.port).toBe("6543");
    expect(target?.database).toBe("postgres");
    expect(target?.user).toBe("postgres.abc123");
    expect(target?.summary).toBe(
      "postgresql://postgres.abc123@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres (pooler)"
    );
  });

  it("Neon 的 pooler 主机名认得出来", () => {
    const target = describeDatabaseTarget(
      "postgresql://user:pw@ep-cool-name-pooler.us-east-2.aws.neon.tech:5432/neondb"
    );
    expect(target?.pooler).toBe(true);
    expect(target?.summary).toContain("(pooler)");
  });

  it("Supabase 的 pooler 认得出来(端口 6543)", () => {
    const target = describeDatabaseTarget(
      "postgresql://postgres:pw@db.xyzcompany.supabase.co:6543/postgres"
    );
    expect(target?.pooler).toBe(true);
  });

  it("直连(不是 pooler)认得出来", () => {
    const target = describeDatabaseTarget(
      "postgresql://user:pw@db.example.com:5432/mydb"
    );
    expect(target?.pooler).toBe(false);
    expect(target?.summary).not.toContain("(pooler)");
  });

  it("SSL 开没开认得出来", () => {
    // 没写 `sslmode` 的 postgres 连接串默认要 SSL
    expect(
      describeDatabaseTarget("postgresql://u:p@h.example.com:5432/db")?.ssl
    ).toBe(true);
    // 显式关掉
    expect(
      describeDatabaseTarget(
        "postgresql://u:p@h.example.com:5432/db?sslmode=disable"
      )?.ssl
    ).toBe(false);
    // 显式要
    expect(
      describeDatabaseTarget(
        "postgresql://u:p@h.example.com:5432/db?sslmode=require"
      )?.ssl
    ).toBe(true);
  });

  it("认不出来就说认不出来(不猜)", () => {
    expect(describeDatabaseTarget(undefined)).toBeNull();
    expect(describeDatabaseTarget(null)).toBeNull();
    expect(describeDatabaseTarget("")).toBeNull();
    expect(describeDatabaseTarget("这不是一个连接串")).toBeNull();
  });
});

describe("本机库 —— 改它不会影响线上", () => {
  it("本机主机名认得出来", () => {
    expect(isLocalDatabaseHost("localhost")).toBe(true);
    expect(isLocalDatabaseHost("127.0.0.1")).toBe(true);
    expect(isLocalDatabaseHost("127.0.0.53")).toBe(true);
    expect(isLocalDatabaseHost("::1")).toBe(true);
    expect(isLocalDatabaseHost("[::1]")).toBe(true);
    expect(isLocalDatabaseHost("0.0.0.0")).toBe(true);
    expect(isLocalDatabaseHost("mysqld.local")).toBe(true);
  });

  it("线上主机名**不是**本机", () => {
    expect(isLocalDatabaseHost("db.example.com")).toBe(false);
    expect(
      isLocalDatabaseHost("aws-0-ap-northeast-1.pooler.supabase.com")
    ).toBe(false);
    expect(isLocalDatabaseHost("")).toBe(false);
    expect(isLocalDatabaseHost(null)).toBe(false);
  });

  it("目标是本机 ⇒ 必须大声提醒", () => {
    const target = describeDatabaseTarget(
      "postgresql://postgres:pw@127.0.0.1:5432/mooncoda"
    );
    const warning = databaseTargetWarning(target);
    expect(warning).not.toBeNull();
    expect(warning).toContain("本机");
    expect(warning).toContain("不会");
    // 提醒里要给出**怎么用线上那份**
    expect(warning).toContain("DATABASE_URL=");
    expect(warning).not.toContain("pw");
  });

  it("目标是线上 ⇒ 不提醒(别刷屏)", () => {
    const target = describeDatabaseTarget(
      "postgresql://u:p@db.example.com:5432/mydb"
    );
    expect(databaseTargetWarning(target)).toBeNull();
  });

  it("认不出来的目标 ⇒ 不提醒(不猜)", () => {
    expect(databaseTargetWarning(null)).toBeNull();
    expect(databaseTargetWarning(undefined)).toBeNull();
  });
});

describe("每个迁移脚本都得先说「我连的是哪个库」", () => {
  it("仓库里**每一个** `scripts/apply-*.ts` 都调了 `printDatabaseTarget(`", () => {
    const missing: string[] = [];
    for (const file of SCRIPT_FILES) {
      if (!readScript(file).includes("printDatabaseTarget(")) {
        missing.push(file);
      }
    }
    expect(missing).toEqual([]);
  });

  it("打印**在加载 env 之后** —— 先打印 = 打印的是上一轮的旧值", () => {
    // 三种加载 dotenv 的写法都算(见 CLAUDE.md「scripts 里的 dotenv 必须先加载」)
    const markers = ["dotenvExpand(", "loadEnv({", 'import "./lib/load-env"'];
    const wrongOrder: string[] = [];
    for (const file of SCRIPT_FILES) {
      const text = readScript(file);
      const callIndex = text.indexOf("printDatabaseTarget(");
      if (callIndex === -1) continue;
      let lastLoad = -1;
      for (const marker of markers) {
        const idx = text.lastIndexOf(marker);
        if (idx > lastLoad) lastLoad = idx;
      }
      if (lastLoad === -1) continue; // 没有 dotenv 加载(不该有,但不管)
      if (callIndex < lastLoad) {
        wrongOrder.push(`${file}(打印在加载 env 之前)`);
      }
    }
    expect(wrongOrder).toEqual([]);
  });

  it("打印**在动手改库之前** —— 打完再改,顺序不能反", () => {
    const wrongOrder: string[] = [];
    for (const file of SCRIPT_FILES) {
      const text = readScript(file);
      const callIndex = text.indexOf("printDatabaseTarget(");
      if (callIndex === -1) continue;
      // 「动手」的信号 = **第一次真的发查询**(SQL 文本写在文件前头不算 ——
      // 那只是常量,执行顺序看的是调用点)
      const m = /\.query\(/.exec(text);
      if (!m) continue;
      if (m.index < callIndex) {
        wrongOrder.push(`${file}(先改库、后打印)`);
      }
    }
    expect(wrongOrder).toEqual([]);
  });
});
