#!/usr/bin/env -S npx tsx

/**
 * 只读体检 —— 「这个库跟上代码差多少」(2026-11-19)
 *
 * ## 为什么要有这个脚本
 *
 * 线上真踩过:生产库的 `print_order` 少了 `idempotency_key` 这一列
 * (2026-11-16 那次迁移**没在那个库上跑**)⇒ Drizzle 每次查工单都带那一列
 * ⇒ PG 报 `42703 column "idempotency_key" does not exist` ⇒ 建单接口 500。
 *
 * 工作室按命令跑完迁移之后,**同一个错又报了一遍**。那时候能确认的只有两件事:
 *
 * 1. 那个库**真的还缺**这一列(PG 的 `position: '37'` 正好落在
 *    `"idempotency_key"` 的引号上 ⇒ 前三列(`id` / `order_no` / `user_id`)
 *    在,**后面的每一列都还没验证过**)
 * 2. 错误里**看不出连的是哪个库** —— 日志只有一坨拼接的 SQL
 *
 * ⇒ 光说「跑迁移」没用。**得先让人看清自己连的是哪个库**。
 * 本地 `.env` / `.env.local` 里的 `DATABASE_URL` 跟线上部署(Vercel 环境
 * 变量)那份**经常不是一个** —— 迁移跑在本地那个库上,线上那个当然还缺列,
 * 而且输出里**长得跟跑成功一模一样**(脚本只回读一句「✓ 列在」,从不打印
 * 连的是哪个库)。
 *
 * ## 这个脚本做什么
 *
 * **只读** —— 一条 `SELECT` 都不写,一行数据都不改。
 *
 * 1. 打印**连的是哪个库**(连接串里的主机 / 库名 / 用户 / 是不是 pooler)
 * 2. 打印**服务器那边自己说的**是谁(`current_database` / `current_user` /
 *    服务端地址 / PG 版本)—— 两边对不上,说明中间有代理或连错
 * 3. 比一遍**代码要的列**和**库里有的列** ⇒ 列出漂移
 * 4. 给出**该跑哪几条 `pnpm migrate:…`**(按顺序)
 *
 * ## 用法
 *
 * ```bash
 * pnpm schema:check                 # 全查
 * pnpm schema:check print_order     # 只查一张表
 * ```
 *
 * ## 不代跑
 *
 * **工作室的库由工作室自己执行** —— 本脚本只**看**,不改。
 * 跑完看到「缺哪几列」之后,才去跑对应的迁移脚本。
 */

import "./lib/load-env";

import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import * as appSchema from "@/db/schema";
import type { ExpectedTable } from "@/features/shared/lib/schema-drift";
import {
  COLUMN_MIGRATION_COMMANDS,
  diffSchema,
  driftToCommands,
} from "@/features/shared/lib/schema-drift";
import { printDatabaseTarget } from "./lib/print-db-target";

/** 只查这几张表(命令行给的)—— 空 = 全查 */
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith("-"));

/**
 * 代码要的那些表和列
 *
 * 从 Drizzle 的 schema 里读 ⇒ **跟运行时用的是同一份真相**,
 * 不会「脚本里写一份、代码里是另一份」。
 */
function collectExpectedTables(): ExpectedTable[] {
  const byName = new Map<string, Set<string>>();

  for (const value of Object.values(appSchema)) {
    // relations 不是表 —— `isTable` 把它们滤掉
    if (!isTable(value)) continue;
    const name = getTableName(value);
    if (!name) continue;
    const columns = byName.get(name) ?? new Set<string>();
    for (const column of Object.values(getTableColumns(value))) {
      columns.add(column.name);
    }
    byName.set(name, columns);
  }

  return [...byName.entries()].map(([table, columns]) => ({
    table,
    columns: [...columns],
  }));
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "[schema:check] ❌ 没有 DATABASE_URL —— 在 .env.local 里配好再跑"
    );
    console.error(
      "   (值只进环境变量,别进仓库文件。线上那份在 Vercel 的环境变量里 ——"
    );
    console.error(
      "   ⚠️ 要确认的是**线上那份**,不是本地这份 —— 连错库等于没跑)"
    );
    process.exit(1);
  }

  /* ------------------------------------------------------------ 连的是哪个库 --- */

  console.log("[schema:check] 只读体检 —— 不改任何东西\n");
  // 跟迁移脚本共用一份打印 —— 两处不可能漂(2026-11-19)
  printDatabaseTarget("schema:check", connectionString);

  /* ------------------------------------------------------------------ 连库 --- */

  const { Client } = await import("pg");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
  } catch (error) {
    console.error(
      "\n[schema:check] ❌ 连不上:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }

  try {
    /* ------------------------------------------------- 服务器那边自己说的是谁 --- */

    const identity = await client.query<{
      db: string;
      usr: string;
      addr: string | null;
      port: string | null;
      version: string;
    }>(
      `SELECT current_database() AS db,
              current_user      AS usr,
              inet_server_addr()::text AS addr,
              inet_server_port()::text AS port,
              current_setting('server_version') AS version;`
    );
    const row = identity.rows[0];

    console.log("\n服务器那边自己说的:");
    console.log(`  current_database = ${row?.db ?? "?"}`);
    console.log(`  current_user     = ${row?.usr ?? "?"}`);
    console.log(
      `  服务端地址        = ${row?.addr ?? "?"}:${row?.port ?? "?"}`
    );
    console.log(`  PG 版本          = ${row?.version ?? "?"}`);

    /* ------------------------------------------------------------ 比一遍列 --- */

    const expected = collectExpectedTables();
    const scoped = ONLY.length
      ? expected.filter((t) => ONLY.includes(t.table))
      : expected;

    if (ONLY.length && scoped.length === 0) {
      console.error(
        `\n[schema:check] ❌ 代码里没有这几张表:${ONLY.join(", ")}`
      );
      process.exit(1);
    }

    const tableNames = scoped.map((t) => t.table);
    const columnsRes = await client.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[]);`,
      [tableNames]
    );

    const actual = new Map<string, Set<string>>();
    for (const r of columnsRes.rows) {
      const set = actual.get(r.table_name) ?? new Set<string>();
      set.add(r.column_name);
      actual.set(r.table_name, set);
    }

    const expectedColumnCount = scoped.reduce(
      (n, t) => n + t.columns.length,
      0
    );
    const actualColumnCount = [...actual.values()].reduce(
      (n, s) => n + s.size,
      0
    );

    console.log(
      `\n代码要 ${scoped.length} 张表 / ${expectedColumnCount} 列;库里查到 ${
        actual.size
      } 张表 / ${actualColumnCount} 列`
    );

    const drift = diffSchema(scoped, actual);

    if (drift.length === 0) {
      console.log("\n✓ 没有漂移 —— 库跟代码对得上");
      await client.end();
      process.exit(0);
    }

    console.log(`\n✗ 漂移 ${drift.length} 处:`);
    for (const d of drift) {
      if (d.tableMissing) {
        console.log(
          `  ${d.table} —— 整张表都没建(${d.missingColumns.length} 列)`
        );
      } else {
        console.log(`  ${d.table} —— 缺 ${d.missingColumns.length} 列:`);
        for (const c of d.missingColumns) console.log(`    - ${c}`);
      }
    }

    const commands = driftToCommands(drift);
    if (commands.length > 0) {
      console.log("\n该跑的命令(按顺序 —— 有的脚本要改别的脚本建的表):");
      for (const c of commands) console.log(`  ${c}`);
    }

    /* ------------------------------------------------- 认不出来的那些列 --- */

    const unmapped: string[] = [];
    for (const d of drift) {
      for (const column of d.missingColumns) {
        const key = `${d.table}.${column}`;
        if (!(key in COLUMN_MIGRATION_COMMANDS)) unmapped.push(key);
      }
    }
    if (unmapped.length > 0) {
      console.log(
        "\n下面这些列**没有对应的迁移脚本** —— 它们要么是模板自带的表"
      );
      console.log("(缺了要靠 `pnpm db:push`),要么是新加的、还没写迁移脚本:");
      for (const key of unmapped) console.log(`  - ${key}`);
    }

    console.log("\n⚠️ 跑之前先对一遍「目标库」那几行 —— 跟 Vercel 环境变量里的");
    console.log(
      "   DATABASE_URL 是同一个库吗?本地 .env / .env.local 那份跟线上"
    );
    console.log("   往往不是同一个(连错库 = 白跑,而且看不出白跑)。");
    console.log("跑完再跑一次本脚本 —— 列齐了就会说「没有漂移」。");

    await client.end();
    process.exit(1);
  } catch (error) {
    console.error(
      "[schema:check] 查库失败:",
      error instanceof Error ? error.message : error
    );
    await client.end().catch(() => {});
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
