/**
 * DB 报错形状的判定 —— 守住「迁移脚本没跑」这件事能被认出来
 *
 * 2026-11-06 线上真踩过:工作室点「保存计价设置」报「保存失败,看服务端
 * 日志」,日志里只有一坨 SQL(`Failed query: select … from
 * "print_pricing_config" …`)。真正的原因(`relation "print_pricing_config"
 * does not exist`)埋在 `cause` 里,没被打印出来,更没被界面认出来。
 *
 * 这一个文件把那条因果链认出来,后台才能回一句能照着做的提示。
 */

import { describe, expect, it } from "vitest";
import {
  describeDbError,
  isMissingPrintPricingTable,
} from "@/features/print-quote/lib/db-error";

/**
 * 造一个 Drizzle 包过 PG 错误的链
 *
 * 真机上长这样:`DrizzleQueryError` 的 `message` 是拼接的 SQL,`cause` 是
 * PG 的原始错误(带 `code`)。
 */
function drizzleError(pgMessage: string, pgCode?: string): Error {
  const pg = Object.assign(new Error(pgMessage), { code: pgCode });
  return Object.assign(
    new Error(
      `Failed query: select "id" from "print_pricing_config" where "id" = $1 limit $2\nparams: default,1`
    ),
    { cause: pg }
  );
}

describe("describeDbError", () => {
  it("认出「表不存在」", () => {
    const info = describeDbError(
      drizzleError('relation "print_pricing_config" does not exist', "42P01")
    );
    expect(info.missingRelation).toBe(true);
  });

  it("认出「列不存在」", () => {
    const info = describeDbError(
      drizzleError(
        'column "print_pricing_config.varnish_fee" does not exist',
        "42703"
      )
    );
    expect(info.missingRelation).toBe(true);
  });

  it("没有 code 也能靠消息认出来", () => {
    // 有些驱动不把 code 传上来 —— 只剩消息
    const info = describeDbError(
      drizzleError('relation "print_material" does not exist')
    );
    expect(info.missingRelation).toBe(true);
  });

  it("别的错不算「表不存在」", () => {
    const info = describeDbError(
      drizzleError(
        'duplicate key value violates unique constraint "x"',
        "23505"
      )
    );
    expect(info.missingRelation).toBe(false);
  });

  it("「does not exist」但说的不是表 / 列 —— 不算", () => {
    // 免得把「某个扩展没装」误判成「迁移脚本没跑」
    const info = describeDbError(
      drizzleError("function pg_stat_statements() does not exist")
    );
    expect(info.missingRelation).toBe(false);
  });

  it("不是错误的东西也不炸", () => {
    expect(describeDbError(undefined).missingRelation).toBe(false);
    expect(describeDbError("一段字符串").missingRelation).toBe(false);
    expect(describeDbError(null).missingRelation).toBe(false);
  });

  it("循环引用的 cause 链不会转死", () => {
    const a: { message: string; cause?: unknown } = { message: "a" };
    const b: { message: string; cause?: unknown } = { message: "b", cause: a };
    a.cause = b;
    expect(() => describeDbError(a)).not.toThrow();
  });

  it("消息里带上了 cause 链上的原始信息", () => {
    // 日志里要能看到真正的原因,而不只是一坨 SQL
    const info = describeDbError(
      drizzleError('relation "print_pricing_config" does not exist', "42P01")
    );
    expect(info.message).toContain(
      'relation "print_pricing_config" does not exist'
    );
    expect(info.message).toContain("Failed query");
  });
});

describe("isMissingPrintPricingTable", () => {
  it("表不存在 = true", () => {
    expect(
      isMissingPrintPricingTable(
        drizzleError('relation "print_pricing_config" does not exist', "42P01")
      )
    ).toBe(true);
  });

  it("其它错 = false", () => {
    expect(
      isMissingPrintPricingTable(
        drizzleError("connection terminated unexpectedly")
      )
    ).toBe(false);
  });
});
