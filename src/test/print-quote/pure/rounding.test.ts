import { describe, expect, it } from "vitest";

/**
 * 计价取整 —— **一律向上取整到分**
 *
 * ## 为什么值得测
 *
 * 工作室 2026-11-08 的要求:「计价需要向上取整」。这条口径有两个坑,都是
 * **静默**的 —— 少收了不报错,多收了也不报错,只有跟工作室对账的时候才
 * 看得出来:
 *
 * 1. **浮点误差被向上取整吃掉** —— `1.1 × 100` 在 IEEE754 下是
 *    `110.00000000000001`,`Math.ceil` 得出 **111**,白多收一分。
 * 2. **`-0`** —— `Math.ceil(0 - 1e-9)` 是 **-0**。`-0 === 0` 为真,但
 *    `Object.is(-0, 0)` 为假 —— 落库、序列化、单元断言都当它是另一个数。
 *
 * ## 依赖
 *
 * 纯函数,不碰 DB、不碰 React —— 跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 */

import {
  ceilCents,
  yuanToCentsCeil,
} from "@/features/print-quote/lib/rounding";

describe("ceilCents", () => {
  it("有一丝零头就往上一分", () => {
    expect(ceilCents(99.9)).toBe(100);
    expect(ceilCents(0.37)).toBe(1);
    expect(ceilCents(1.01)).toBe(2);
  });

  it("整数分原样返回", () => {
    expect(ceilCents(0)).toBe(0);
    expect(ceilCents(100)).toBe(100);
    expect(ceilCents(2065)).toBe(2065);
  });

  it("浮点误差不能变成钱 —— 1.1 × 100 = 110.00000000000001", () => {
    expect(ceilCents(110.00000000000001)).toBe(110);
    expect(ceilCents(7.000000000000001)).toBe(7);
    expect(ceilCents(100.00000000000001)).toBe(100);
  });

  it("真的零头不会被 epsilon 吃掉", () => {
    // 0.01 分是真实存在的最小零头 —— epsilon 比它小七个数量级
    expect(ceilCents(100.01)).toBe(101);
    expect(ceilCents(0.01)).toBe(1);
  });

  it("0 归一化成 +0(不是 -0)", () => {
    expect(Object.is(ceilCents(0), 0)).toBe(true);
    expect(Object.is(ceilCents(-0), 0)).toBe(true);
  });

  it("非数原样返回(不静默变成 0)", () => {
    expect(Number.isNaN(ceilCents(Number.NaN))).toBe(true);
    expect(ceilCents(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("yuanToCentsCeil", () => {
  it("元 → 分,向上取整", () => {
    expect(yuanToCentsCeil(3.3333)).toBe(334);
    expect(yuanToCentsCeil(45.81)).toBe(4581);
    expect(yuanToCentsCeil(10.2)).toBe(1020);
  });

  it("四舍五入会少收的那一分,向上取整不会", () => {
    // ¥3.3333 —— 四舍五入 333,向上取整 334
    expect(Math.round(3.3333 * 100)).toBe(333);
    expect(yuanToCentsCeil(3.3333)).toBe(334);
  });

  it("浮点误差不许多收那一分", () => {
    expect(yuanToCentsCeil(1.1)).toBe(110);
    expect(yuanToCentsCeil(0.07)).toBe(7);
    expect(yuanToCentsCeil(2.675)).toBe(268);
  });

  it("0 是 +0", () => {
    expect(Object.is(yuanToCentsCeil(0), 0)).toBe(true);
  });
});
