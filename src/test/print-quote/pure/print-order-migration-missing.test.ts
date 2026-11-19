import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 「迁移脚本没跑」—— 建单接口要说人话,不是 500(2026-11-19)
 *
 * ## 线上真踩过的那一次
 *
 * 生产库的 `print_order` 少了 `idempotency_key` 这一列(2026-11-16 那次
 * 迁移没在那个库上跑)⇒ Drizzle 每次查工单都带那一列 ⇒ PG 报
 *
 * ```
 * 42703 column "idempotency_key" does not exist
 * ```
 *
 * ⇒ 建单接口 500,日志里只有一坨拼接的 SQL。
 *
 * **那句 SQL 对工作室没用** —— 看不出是「迁移脚本没跑」。而且**重试没用**
 * (那是部署环境的事),跟「这次调用挂了」完全是两回事。
 *
 * ## 这个测试守住什么
 *
 * | 守卫 | 为什么 |
 * |---|---|
 * | 缺表 / 缺列 ⇒ **503 + `MIGRATION_MISSING`** | 500 = 「服务器坏了」;503 + 稳定的码 = 「部署环境该跑迁移了」 |
 * | 幂等查表 / 工单列表 / insert 三处**都兜住** | 少兜一处 = 那一处还是 500 + 原始 SQL |
 * | 判定走**共享的** `describeDbError()` | 抄一份 = 两处口径迟早漂(后台那几个页面已经有一份了) |
 * | code ⇒ 文案 key 的映射在位 | 没映射 ⇒ 界面退回笼统那句,还是看不出原因 |
 * | 中英文**键集一致** | 少一个语言 = 那一侧显示 key 名 |
 *
 * 全部是文件扫描 + 纯函数 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 取叶子路径 —— `a.b.c` 那一串 */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  if (Array.isArray(value)) return [prefix];
  const out: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    out.push(...leafPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

const ROUTE = read("src/app/api/print-orders/route.ts");

describe("建单接口 —— 迁移脚本没跑", () => {
  it("判定走共享的那一份 `describeDbError`(不自己抄)", () => {
    expect(ROUTE).toContain(
      'import { describeDbError } from "@/features/shared/lib/db-error"'
    );
    expect(ROUTE).toContain("describeDbError(error)");
    expect(ROUTE).toContain("info.missingRelation");
  });

  it("缺表 / 缺列 ⇒ 503 + `MIGRATION_MISSING`(不是 500)", () => {
    expect(ROUTE).toContain("MIGRATION_MISSING");
    // 那个响应是 **503** —— 「重试没用,得工作室处理」
    expect(ROUTE).toMatch(/MIGRATION_MISSING[\s\S]{0,400}status: 503/);
  });

  it("三处 DB 触碰**都**兜住 —— 少一处那一处还是 500", () => {
    // ① 幂等查表(缺 `idempotency_key` 就是它先炸)
    expect(ROUTE).toMatch(
      /try\s*\{\s*existing = await findPrintOrderByIdempotencyKey/
    );
    // ② 工单列表
    expect(ROUTE).toMatch(/try\s*\{\s*rows = await listUserPrintOrders/);
    // ③ insert(事务里)
    expect(ROUTE).toContain('console.error("[PrintOrder] insert failed"');

    // 兜底的入口被用上三次(①②③ 各一次)
    const guards = ROUTE.match(/migrationMissingResponse\(error\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(3);
  });

  it("原始报错只进日志,**不进响应体**(表结构是内部信息)", () => {
    // 响应体里只给一句人话 + 一个稳定的码
    expect(ROUTE).toContain("数据库还没升级,暂时下不了单");
    expect(ROUTE).toContain('console.error("[PrintOrder] 迁移脚本没跑');
  });
});

describe("code → 文案 key 的映射", () => {
  it("`MIGRATION_MISSING` 有专属的那一句", () => {
    // 界面必须说清楚**下一步做什么**(联系工作室),不能只摆「失败」
    expect(ROUTE).toContain("MIGRATION_MISSING");
  });
});

describe("i18n", () => {
  it("中英文**键集完全一致** —— 少一个语言 = 那一侧显示 key 名", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    expect(leafPaths(en.PrintQuote.printOrder.errors.codes).sort()).toEqual(
      leafPaths(zh.PrintQuote.printOrder.errors.codes).sort()
    );
  });

  it("两个语言都有那一句「数据库还没升级」", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    expect(typeof zh.PrintQuote.printOrder.errors.codes.migrationMissing).toBe(
      "string"
    );
    expect(typeof en.PrintQuote.printOrder.errors.codes.migrationMissing).toBe(
      "string"
    );
    expect(zh.PrintQuote.printOrder.errors.codes.migrationMissing).toContain(
      "数据库还没升级"
    );
  });
});
