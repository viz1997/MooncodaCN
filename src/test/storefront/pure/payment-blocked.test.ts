import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 「这一单不许再付了」—— `StorefrontPaymentBlocked`
 *
 * ## 为什么值得测
 *
 * 线上真踩过(`SO-20261114-137332`,¥249):支付宝那边**已经付款成功**,
 * 我们这边因为公钥不对**核不上** ⇒ 订单停在 `unpaid` ⇒
 *
 * 1. 复用待付款单的时候,`checkout()` 把 `ALREADY_PAID` 归成「**支付失败**」
 *    ⇒ 用户以为没付 ⇒ **再付一次**;
 * 2. 而那条链接的 `out_trade_no` 在支付宝那边已经付过了 ⇒ 支付宝回
 *    「该订单已付款(`TRADE_HAS_SUCCESS`)」⇒ **死循环**。
 *
 * ⇒ 「支付失败」这句话在这条路上是**错的**,而且危险 —— 它引导用户去重试
 * 一件已经付过的事。
 *
 * ## 这一栏跟 `StorefrontPaymentIssue` 是**正交**的两件事
 *
 * | 栏 | 回答的问题 | 重试有没有用 |
 * |---|---|---|
 * | `paymentIssue` | **为什么没生成付款入口**(通道没配好 / 这次挂了) | 看情况 |
 * | `paymentBlocked` | **这一单不许再付了**(钱已经发生了) | ❌ **有害** |
 *
 * ⇒ 两个码不许合并 —— 合并了「不要重复付款」这句话就丢了。
 *
 * 纯计算 + 源码结构扫描:不碰 DB、不碰网络。
 */

import {
  paymentBlockedFromLinkCode,
  type StorefrontPaymentBlocked,
  type StorefrontPaymentIssue,
} from "@/features/storefront/lib/payment-issue";

/* -------------------------------------------------------------------------- */
/*  读源码                                                                     */
/* -------------------------------------------------------------------------- */

function read(rel: string): string {
  return readFileSync(
    new URL(`../../../../${rel.replace(/^\/+/, "")}`, import.meta.url),
    "utf8"
  );
}

/** 把注释去掉 —— 只扫真正在跑的代码 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const ISSUE_SRC = read("src/features/storefront/lib/payment-issue.ts");
const ROUTE_SRC = read(
  "src/app/api/store/orders/[orderNo]/payment-link/route.ts"
);
const CHECKOUT_SRC = read("src/features/storefront/lib/checkout.ts");
const PANEL_SRC = read(
  "src/features/storefront/components/checkout-payment-panel.tsx"
);

/* -------------------------------------------------------------------------- */
/*  纯函数                                                                     */
/* -------------------------------------------------------------------------- */

describe("paymentBlockedFromLinkCode", () => {
  it("ALREADY_PAID ⇒ 被挡住", () => {
    expect(paymentBlockedFromLinkCode("ALREADY_PAID")).toBe("ALREADY_PAID");
  });

  it("PAYMENT_UNVERIFIED ⇒ 被挡住(支付宝说付了,我们核不上)", () => {
    expect(paymentBlockedFromLinkCode("PAYMENT_UNVERIFIED")).toBe(
      "PAYMENT_UNVERIFIED"
    );
  });

  it("ORDER_REFUNDED ⇒ 被挡住", () => {
    expect(paymentBlockedFromLinkCode("ORDER_REFUNDED")).toBe("ORDER_REFUNDED");
  });

  it("「入口没生成出来」的那些码 ⇒ **不**挡(跟「钱付过了」是两回事)", () => {
    for (const code of [
      "LINK_FAILED",
      "PAYMENT_NOT_CONFIGURED",
      "CARRIER_MISSING",
      "PAYMENT_FAILED",
      "",
    ]) {
      expect(paymentBlockedFromLinkCode(code)).toBeNull();
    }
  });

  it("空值 ⇒ 不挡", () => {
    expect(paymentBlockedFromLinkCode(null)).toBeNull();
    expect(paymentBlockedFromLinkCode(undefined)).toBeNull();
  });

  it("不认识的码 ⇒ 不挡(**不猜**)", () => {
    expect(paymentBlockedFromLinkCode("SOMETHING_ELSE")).toBeNull();
  });

  it("认出来的码一定落在那三个里", () => {
    const blocked: StorefrontPaymentBlocked[] = [
      "ALREADY_PAID",
      "PAYMENT_UNVERIFIED",
      "ORDER_REFUNDED",
    ];
    for (const code of blocked) {
      expect(paymentBlockedFromLinkCode(code)).toBe(code);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  两栏正交 —— 不许合并                                                        */
/* -------------------------------------------------------------------------- */

describe("paymentIssue 与 paymentBlocked 是两件事", () => {
  it("`StorefrontPaymentIssue` 只有两个值(重试建议相反的那一栏)", () => {
    const match = ISSUE_SRC.match(
      /export type StorefrontPaymentIssue\s*=\s*([^;]+);/
    );
    expect(match).not.toBeNull();
    const values = (match?.[1] ?? "")
      .split("|")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    expect(values.sort()).toEqual(["PAYMENT_FAILED", "PAYMENT_NOT_CONFIGURED"]);
  });

  it("`StorefrontPaymentBlocked` 只有三个值(钱已经发生了的那一栏)", () => {
    const match = ISSUE_SRC.match(
      /export type StorefrontPaymentBlocked\s*=\s*([^;]+);/
    );
    expect(match).not.toBeNull();
    const values = (match?.[1] ?? "")
      .split("|")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    expect(values.sort()).toEqual([
      "ALREADY_PAID",
      "ORDER_REFUNDED",
      "PAYMENT_UNVERIFIED",
    ]);
  });

  it("两个码不许混在一起(混了「不要重复付款」那句话就没了)", () => {
    const issueBlock = ISSUE_SRC.match(
      /export type StorefrontPaymentIssue\s*=\s*([^;]+);/
    )?.[1];
    const blockedBlock = ISSUE_SRC.match(
      /export type StorefrontPaymentBlocked\s*=\s*([^;]+);/
    )?.[1];
    expect(issueBlock).not.toContain("ALREADY_PAID");
    expect(issueBlock).not.toContain("PAYMENT_UNVERIFIED");
    expect(issueBlock).not.toContain("ORDER_REFUNDED");
    expect(blockedBlock).not.toContain("PAYMENT_FAILED");
    expect(blockedBlock).not.toContain("PAYMENT_NOT_CONFIGURED");
  });

  it("`paymentIssue` 的两个值确实就是那两个 —— 类型层面也对得上", () => {
    // 编译期守:这两个值必须落在 `StorefrontPaymentIssue` 里
    const ok: StorefrontPaymentIssue = "PAYMENT_NOT_CONFIGURED";
    const failed: StorefrontPaymentIssue = "PAYMENT_FAILED";
    expect([ok, failed]).toEqual(["PAYMENT_NOT_CONFIGURED", "PAYMENT_FAILED"]);
  });
});

/* -------------------------------------------------------------------------- */
/*  HTTP 状态码:409(状态冲突) vs 502(这次挂了)                                 */
/* -------------------------------------------------------------------------- */

describe("付款入口接口的状态码", () => {
  const route = stripComments(ROUTE_SRC);

  it("「钱已经发生了」那三个码 ⇒ **409**(不是 502)", () => {
    expect(route).toContain('link.code === "ALREADY_PAID"');
    expect(route).toContain('link.code === "ORDER_REFUNDED"');
    expect(route).toContain('link.code === "PAYMENT_UNVERIFIED"');
    // 409 那一档写在三元里
    expect(route).toMatch(/\? 409\s*:\s*502/);
  });

  it("不是「钱已经发生了」的那些 ⇒ 502(这次挂了,重试就好)", () => {
    expect(route).toMatch(/\? 409\s*:\s*502/);
  });

  it("PAYMENT_UNVERIFIED 的人话**不许**说成「重试一下」", () => {
    const match = route.match(
      /case "PAYMENT_UNVERIFIED":\s*return\s+"([^"]+)";/
    );
    expect(match).not.toBeNull();
    const message = match?.[1] ?? "";
    expect(message).toContain("请不要重复付款");
    expect(message).not.toContain("重试");
  });

  it("ALREADY_PAID 的人话说「已经付过了」", () => {
    const match = route.match(/case "ALREADY_PAID":\s*return\s+"([^"]+)";/);
    expect(match?.[1] ?? "").toContain("已经付过");
  });
});

/* -------------------------------------------------------------------------- */
/*  结算复用路径                                                               */
/* -------------------------------------------------------------------------- */

describe("结算复用路径", () => {
  const checkout = stripComments(CHECKOUT_SRC);

  it("复用待付款单时用 `paymentBlockedFromLinkCode` 取被挡的码", () => {
    expect(checkout).toContain("paymentBlockedFromLinkCode");
    expect(checkout).toContain("paymentBlocked: blocked");
  });

  it("新单那一路 `paymentBlocked` 是 null(没被挡)", () => {
    expect(checkout).toContain("paymentBlocked: null");
  });

  it("结算响应里两个字段都在", () => {
    expect(checkout).toContain("paymentIssue");
    expect(checkout).toContain("paymentBlocked");
  });
});

/* -------------------------------------------------------------------------- */
/*  买家侧:先说「不许再付」,再说「入口没生成」                                  */
/* -------------------------------------------------------------------------- */

describe("买家侧的说法顺序", () => {
  const panel = stripComments(PANEL_SRC);

  it("三个被挡的码都有人话", () => {
    expect(panel).toContain('body?.paymentBlocked === "ALREADY_PAID"');
    expect(panel).toContain('body?.paymentBlocked === "PAYMENT_UNVERIFIED"');
    expect(panel).toContain('body?.paymentBlocked === "ORDER_REFUNDED"');
  });

  it("**先**判 paymentBlocked,再判 paymentIssue", () => {
    const blockedAt = panel.indexOf('body?.paymentBlocked === "ALREADY_PAID"');
    const issueAt = panel.indexOf("body?.paymentIssue ===");
    expect(blockedAt).toBeGreaterThan(-1);
    expect(issueAt).toBeGreaterThan(-1);
    // 顺序反了 ⇒ 用户会先看到「入口生成失败,请重新获取」⇒ 再付一次
    expect(blockedAt).toBeLessThan(issueAt);
  });

  it("PAYMENT_UNVERIFIED 的人话里带「请不要重复付款」", () => {
    const at = panel.indexOf('body?.paymentBlocked === "PAYMENT_UNVERIFIED"');
    expect(at).toBeGreaterThan(-1);
    const slice = panel.slice(at, at + 600);
    expect(slice).toContain("请不要重复付款");
  });
});
