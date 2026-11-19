import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLUMN_MIGRATION_COMMANDS,
  diffSchema,
  driftToCommands,
  MIGRATION_COMMAND_ORDER,
  migrationCommandFor,
  TABLE_MIGRATION_COMMANDS,
} from "@/features/shared/lib/schema-drift";

/**
 * 「库跟代码差多少」的体检逻辑(2026-11-19)
 *
 * ## 线上真踩过的那一次
 *
 * 生产库的 `print_order` 少了 `idempotency_key` 这一列(2026-11-16 那次迁移
 * 没在那个库上跑)⇒ Drizzle 每次查工单都带那一列 ⇒ PG 报
 *
 * ```
 * 42703 column "idempotency_key" does not exist
 * ```
 *
 * 工作室按命令跑完迁移之后,**同一个错又报了一遍**。最可能的原因只有两个:
 *
 * 1. 迁移**没跑**(脚本失败 / 跑错了库)
 * 2. 迁移**跑在另一个库上** —— 本地 `.env` / `.env.local` 里的
 *    `DATABASE_URL` 跟线上部署(Vercel 环境变量)那份**不是一个**
 *
 * ⇒ 光看「跑没跑」不够,**得先看清楚「我连的是哪个库」**。
 *
 * ## 这个测试守住什么
 *
 * | 守卫 | 为什么 |
 * |---|---|
 * | 每条 `ALTER TABLE … ADD COLUMN` **都有对应的命令** | 缺一条 ⇒ 体检脚本对那一列说「没有对应脚本」,工作室只能自己猜 |
 * | 每条命令**指向真的那个脚本** | 指错了 ⇒ 跑了一条不相干的迁移,列还是缺,还看不出来 |
 * | 每条 `CREATE TABLE` **都有对应的命令** | 同上(整张表都没建的时候) |
 * | 命令**在 `package.json` / 磁盘上真的存在** | 引用一个不存在的脚本 = 工作室照着跑直接报错 |
 * | 漂移 → 命令**去重 + 有序** | 建表的脚本必须排在改列的脚本前面 |
 *
 * 全部是文件扫描 + 纯函数 —— 不需要 DB / 网络 / 浏览器。
 *
 * > 「连的是哪个库」那一半(密码不外泄 / pooler 认得出来 / 迁移脚本必须先
 * > 打印目标库)在 `db-target.test.ts`。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** `package.json` 里的脚本 */
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** 全部手写迁移脚本 */
const SCRIPT_FILES = readdirSync(join(ROOT, "scripts")).filter(
  (f) => f.startsWith("apply-") && f.endsWith(".ts")
);

/** 读一个迁移脚本 */
function readScript(file: string): string {
  return readFileSync(join(ROOT, "scripts", file), "utf8");
}

/**
 * 命令 ⇒ 它指向的脚本文件(**不带 `scripts/` 前缀**,跟扫描出来的名字对齐)
 *
 * - `pnpm tsx scripts/x.ts` ⇒ `x.ts`
 * - `pnpm migrate:apply-x` ⇒ 查 `package.json` 里 `migrate:apply-x` 那条
 */
function commandToFile(command: string): string | null {
  if (command.startsWith("pnpm tsx scripts/")) {
    return command.slice("pnpm tsx scripts/".length);
  }
  if (!command.startsWith("pnpm ")) return null;
  const key = command.slice("pnpm ".length);
  const value = PKG.scripts?.[key];
  if (typeof value !== "string") return null;
  const m = /^tsx\s+scripts\/(\S+\.ts)$/.exec(value.trim());
  return m ? (m[1] ?? null) : null;
}

/** 扫出全部「哪个脚本加了哪一列」 */
function scanColumnAdditions(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re =
    /ALTER TABLE\s+"([a-z_]+)"\s+ADD COLUMN IF NOT EXISTS\s+"([a-z_]+)"/g;
  for (const file of SCRIPT_FILES) {
    const text = readScript(file);
    for (const m of text.matchAll(re)) {
      const table = m[1];
      const column = m[2];
      if (!table || !column) continue;
      const key = `${table}.${column}`;
      const list = out.get(key) ?? [];
      if (!list.includes(file)) list.push(file);
      out.set(key, list);
    }
  }
  return out;
}

/** 扫出全部「哪个脚本建了哪张表」 */
function scanTableCreations(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /CREATE TABLE IF NOT EXISTS\s+"([a-z_]+)"/g;
  for (const file of SCRIPT_FILES) {
    const text = readScript(file);
    for (const m of text.matchAll(re)) {
      const table = m[1];
      if (!table) continue;
      const list = out.get(table) ?? [];
      if (!list.includes(file)) list.push(file);
      out.set(table, list);
    }
  }
  return out;
}

describe("迁移命令表 —— 跟仓库里真的脚本对得上", () => {
  it("每条 `ADD COLUMN` 都有对应的命令", () => {
    const additions = scanColumnAdditions();
    const missing: string[] = [];
    for (const key of additions.keys()) {
      if (!COLUMN_MIGRATION_COMMANDS[key]) missing.push(key);
    }
    expect(missing).toEqual([]);
  });

  it("每条命令指向的脚本,**就是**加这一列的那个脚本", () => {
    const additions = scanColumnAdditions();
    const wrong: string[] = [];
    for (const [key, files] of additions) {
      const command = COLUMN_MIGRATION_COMMANDS[key];
      if (!command) continue;
      const target = commandToFile(command);
      // 指向的文件必须真的提到这一列 —— 指错了等于没跑
      if (!target || !files.includes(target)) {
        wrong.push(`${key} → ${command}(真正加它的是 ${files.join(", ")})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("每条 `CREATE TABLE` 都有对应的命令", () => {
    const creations = scanTableCreations();
    const missing: string[] = [];
    for (const table of creations.keys()) {
      if (!TABLE_MIGRATION_COMMANDS[table]) missing.push(table);
    }
    expect(missing).toEqual([]);
  });

  it("每条建表命令指向的脚本,就是建这一张表的那个脚本", () => {
    const creations = scanTableCreations();
    const wrong: string[] = [];
    for (const [table, files] of creations) {
      const command = TABLE_MIGRATION_COMMANDS[table];
      if (!command) continue;
      const target = commandToFile(command);
      if (!target || !files.includes(target)) {
        wrong.push(`${table} → ${command}(真正建它的是 ${files.join(", ")})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("每条命令都指向一个**真的存在**的脚本", () => {
    const broken: string[] = [];
    const commands = new Set([
      ...Object.values(COLUMN_MIGRATION_COMMANDS),
      ...Object.values(TABLE_MIGRATION_COMMANDS),
    ]);
    for (const command of commands) {
      const file = commandToFile(command);
      if (!file) {
        broken.push(`${command}(命令本身认不出来)`);
        continue;
      }
      if (!SCRIPT_FILES.includes(file.replace("scripts/", ""))) {
        broken.push(`${command} → ${file}(磁盘上没有)`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("每条列级命令的脚本,**真的提到**那一列(别留过期条目)", () => {
    const stale: string[] = [];
    for (const [key, command] of Object.entries(COLUMN_MIGRATION_COMMANDS)) {
      const file = commandToFile(command);
      if (!file) continue;
      const column = key.split(".")[1];
      if (!column) continue;
      if (!readScript(file.replace("scripts/", "")).includes(column)) {
        stale.push(`${key} → ${command}(脚本里没有这一列)`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("建表的脚本排在改列的脚本前面", () => {
    // `apply-print-shipping` 改的是 `print_pricing_config` —— 那张表是
    // `apply-print-pricing` 建的 ⇒ 建表的必须在前。
    const index = (c: string) => MIGRATION_COMMAND_ORDER.indexOf(c);
    expect(index("pnpm migrate:apply-print-pricing")).toBeGreaterThanOrEqual(0);
    expect(index("pnpm migrate:apply-print-shipping")).toBeGreaterThan(
      index("pnpm migrate:apply-print-pricing")
    );
    // `print_order` 是 `apply-print-order` 建的,改它的都排在后面
    expect(index("pnpm migrate:apply-print-order-idempotency")).toBeGreaterThan(
      index("pnpm migrate:apply-print-order")
    );
    // 商城订单表是 `apply-sellbase-payment` 建的
    expect(index("pnpm migrate:apply-coupon")).toBeGreaterThan(
      index("pnpm migrate:apply-sellbase-payment")
    );
  });

  it("`user.medusa_customer_id` 的改名在「加回旧列」之后", () => {
    // `apply-all-missing` 会把旧的 `medusa_customer_id` 加回来,
    // `apply-sellbase-payment` 负责把它改名成 `sellbase_customer_id`。
    // ⇒ 顺序反了旧列就留在库里了。
    const index = (c: string) => MIGRATION_COMMAND_ORDER.indexOf(c);
    expect(index("pnpm migrate:apply-sellbase-payment")).toBeGreaterThan(
      index("pnpm tsx scripts/apply-all-missing-migrations.ts")
    );
  });
});

describe("比一遍:代码要的 vs 库里有的", () => {
  const expected = [
    { table: "print_order", columns: ["id", "order_no", "idempotency_key"] },
    { table: "cart", columns: ["id", "coupon_code"] },
  ];

  it("列齐了 ⇒ 没有漂移", () => {
    const actual = new Map<string, Set<string>>([
      ["print_order", new Set(["id", "order_no", "idempotency_key"])],
      ["cart", new Set(["id", "coupon_code"])],
    ]);
    expect(diffSchema(expected, actual)).toEqual([]);
  });

  it("缺一列 ⇒ 报那一列(表还在)", () => {
    const actual = new Map<string, Set<string>>([
      ["print_order", new Set(["id", "order_no"])],
      ["cart", new Set(["id", "coupon_code"])],
    ]);
    const drift = diffSchema(expected, actual);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.table).toBe("print_order");
    expect(drift[0]?.tableMissing).toBe(false);
    expect(drift[0]?.missingColumns).toEqual(["idempotency_key"]);
  });

  it("整张表都没建 ⇒ 全部列都算缺", () => {
    const actual = new Map<string, Set<string>>([
      ["print_order", new Set(["id", "order_no", "idempotency_key"])],
    ]);
    const drift = diffSchema(expected, actual);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.table).toBe("cart");
    expect(drift[0]?.tableMissing).toBe(true);
    expect(drift[0]?.missingColumns).toEqual(["id", "coupon_code"]);
  });
});

describe("漂移 → 该跑哪些命令", () => {
  it("缺 `idempotency_key` ⇒ 就是那条幂等迁移", () => {
    const drift = [
      {
        table: "print_order",
        tableMissing: false,
        missingColumns: ["idempotency_key"],
      },
    ];
    expect(driftToCommands(drift)).toEqual([
      "pnpm migrate:apply-print-order-idempotency",
    ]);
  });

  it("去重 —— 好几列指向同一条命令只出现一次", () => {
    const drift = [
      {
        table: "print_order",
        tableMissing: false,
        missingColumns: [
          "coupon_code",
          "coupon_discount_cents",
          "payment_status",
        ],
      },
    ];
    const commands = driftToCommands(drift);
    expect(commands).toHaveLength(2);
    expect(commands).toContain("pnpm migrate:apply-coupon");
    expect(commands).toContain("pnpm migrate:apply-sellbase-payment");
  });

  it("按顺序 —— 建表的排在改列的前面", () => {
    const drift = [
      {
        table: "print_order",
        tableMissing: false,
        missingColumns: ["idempotency_key"],
      },
      {
        table: "storefront_order",
        tableMissing: false,
        missingColumns: ["external_paid_cents"],
      },
      { table: "coupon", tableMissing: true, missingColumns: ["id"] },
    ];
    const commands = driftToCommands(drift);
    const idx = (c: string) => commands.indexOf(c);
    expect(idx("pnpm migrate:apply-coupon")).toBeLessThan(
      idx("pnpm migrate:apply-print-order-idempotency")
    );
  });

  it("认不出来的列 ⇒ 不出现在命令列表里(那种要人工看)", () => {
    const drift = [
      {
        table: "user",
        tableMissing: false,
        missingColumns: ["某个从没见过的列"],
      },
    ];
    expect(driftToCommands(drift)).toEqual([]);
  });

  it("列级映射优先于表级映射", () => {
    expect(migrationCommandFor("print_order", "idempotency_key")).toBe(
      "pnpm migrate:apply-print-order-idempotency"
    );
    // 列级没有 ⇒ 退回表级
    expect(migrationCommandFor("print_order", "从没见过的列")).toBe(
      "pnpm migrate:apply-print-order"
    );
    // 两级都没有 ⇒ null
    expect(migrationCommandFor("从没见过的表", "从没见过的列")).toBeNull();
  });
});
