import { describe, expect, it } from "vitest";
import {
  checkReliefTier,
  detectReliefKind,
  RELIEF_MAX_THICKNESS_MM,
  RELIEF_THINNESS_RATIO,
  reliefLiftMm,
  resolveReliefKind,
} from "@mooncoda/print-tool-core/pricing/relief-detect";

/**
 * 浮雕 / 手办 —— 托底高度分两档(2026-11-15)
 *
 * 工作室的原话:
 *
 * > 「克重工具中浮雕模型不需要像手办模型5mm底部支撑，只需要1mm支撑」
 *
 * 托底**算进支撑体积** ⇒ 托底变了,支撑克重就变了 ⇒ **支撑加价就变了**。
 * 所以这一档的判定不是显示上的细节,是**钱的口径**。
 *
 * ## 三条要守住的
 *
 * 1. **判不出来的时候取贵的那一档** —— 托底越高 ⇒ 支撑越多 ⇒ 支撑费越高。
 *    退化输入(0 / NaN / 长度不对)一律当**手办**。
 * 2. **手动只能往更保守的方向走** —— 「手动挑浮雕」就是「手动少付钱」那个
 *    旋钮,几何判定是手办时它**退化回手办**。
 * 3. **服务端那道闸只挡「少收钱」那一个方向** —— 「报浮雕、判成手办」拒;
 *    「报手办、判成浮雕」放行(那是多收)。
 */

describe("浮雕判定 —— 纯几何", () => {
  it("扁平板 ⇒ 浮雕", () => {
    // 冰箱贴 / 浮雕徽章的典型形状
    expect(detectReliefKind([60, 60, 4])).toBe("relief");
    expect(detectReliefKind([40, 40, 2])).toBe("relief");
    // 轴向换了顺序也认得出(内部会排)
    expect(detectReliefKind([4, 60, 60])).toBe("relief");
    expect(detectReliefKind([60, 4, 60])).toBe("relief");
  });

  it("手办 ⇒ 手办(立方体 / 立柱 / 球)", () => {
    expect(detectReliefKind([30, 30, 30])).toBe("figurine");
    expect(detectReliefKind([20, 20, 120])).toBe("figurine");
    expect(detectReliefKind([50, 40, 35])).toBe("figurine");
  });

  it("厚板不是浮雕 —— 超过厚度上限", () => {
    // 15mm 厚的长方形板:形状像浮雕,但太厚了 ⇒ 手办
    expect(detectReliefKind([60, 60, 15])).toBe("figurine");
    expect(detectReliefKind([60, 60, RELIEF_MAX_THICKNESS_MM])).toBe("relief");
    expect(detectReliefKind([60, 60, RELIEF_MAX_THICKNESS_MM + 0.01])).toBe(
      "figurine"
    );
  });

  it("薄但不够扁 ⇒ 手办(比例判据)", () => {
    // 10 × 10 × 9:厚度过了,但最小边 9 没比第二小边 10 薄一半(要 ≤ 5)⇒ 手办
    expect(detectReliefKind([10, 10, 9])).toBe("figurine");
    // 20 × 10 × 10:最小边 10 = 第二小边 10 ⇒ 要 ≤ 5 才算扁 ⇒ 手办
    expect(detectReliefKind([20, 10, 10])).toBe("figurine");
    expect(RELIEF_THINNESS_RATIO).toBe(0.5);
  });

  it("比例判据的边界 —— 刚好薄一半就是浮雕", () => {
    // 20 × 10 × 5:最小边 5 = 第二小边 10 × 0.5 ⇒ 刚好在边界上 ⇒ 浮雕
    expect(detectReliefKind([20, 10, 5])).toBe("relief");
    // 再厚一点就出局了
    expect(detectReliefKind([20, 10, 5.1])).toBe("figurine");
  });

  it("退化输入一律当手办 —— 判不出来时取**贵的那一档**", () => {
    expect(detectReliefKind(null)).toBe("figurine");
    expect(detectReliefKind(undefined)).toBe("figurine");
    expect(detectReliefKind([])).toBe("figurine");
    expect(detectReliefKind([10, 10])).toBe("figurine");
    expect(detectReliefKind([0, 60, 60])).toBe("figurine");
    expect(detectReliefKind([-1, 60, 60])).toBe("figurine");
    expect(detectReliefKind([Number.NaN, 60, 60])).toBe("figurine");
    expect(detectReliefKind([Number.POSITIVE_INFINITY, 60, 60])).toBe(
      "figurine"
    );
  });
});

describe("托底高度 —— 两档各是多少", () => {
  const lifts = { figurineLiftMm: 5, reliefLiftMm: 1 };

  it("浮雕 1mm / 手办 5mm", () => {
    expect(reliefLiftMm("relief", lifts)).toBe(1);
    expect(reliefLiftMm("figurine", lifts)).toBe(5);
  });

  it("托底高度**跟随后台** —— 传进来多少就是多少", () => {
    expect(
      reliefLiftMm("relief", { figurineLiftMm: 5, reliefLiftMm: 0.5 })
    ).toBe(0.5);
    expect(
      reliefLiftMm("figurine", { figurineLiftMm: 8, reliefLiftMm: 1 })
    ).toBe(8);
  });
});

describe("生效档位 —— 手动指定也不能越界", () => {
  it("自动 ⇒ 按几何判定", () => {
    expect(resolveReliefKind("auto", [60, 60, 4])).toBe("relief");
    expect(resolveReliefKind("auto", [30, 30, 30])).toBe("figurine");
    expect(resolveReliefKind(null, [60, 60, 4])).toBe("relief");
    expect(resolveReliefKind(undefined, [60, 60, 4])).toBe("relief");
  });

  it("手动挑浮雕 + 几何也是浮雕 ⇒ 浮雕(1mm 托底)", () => {
    expect(resolveReliefKind("relief", [60, 60, 4])).toBe("relief");
  });

  it("手动挑浮雕 + 几何是手办 ⇒ **退化回手办**(手动不能少收钱)", () => {
    expect(resolveReliefKind("relief", [30, 30, 30])).toBe("figurine");
  });

  it("手动选手办 ⇒ 一律手办(不管几何像不像)", () => {
    expect(resolveReliefKind("figurine", [60, 60, 4])).toBe("figurine");
  });
});

describe("服务端那道闸 —— 只挡「少收钱」那一个方向", () => {
  it("报浮雕 + 判定浮雕 ⇒ 放行", () => {
    const r = checkReliefTier([60, 60, 4], "relief");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe("relief");
  });

  it("报浮雕 + 判定手办 ⇒ **拒**(少收支撑费的方向)", () => {
    const r = checkReliefTier([30, 30, 30], "relief");
    expect(r.ok).toBe(false);
    // 拒的时候要告诉客户端**服务端认定的那一档** —— 客户端照着它重算
    if (!r.ok) expect(r.kind).toBe("figurine");
  });

  it("报手办 + 判定浮雕 ⇒ **放行**(那是多收,不是少收)", () => {
    const r = checkReliefTier([60, 60, 4], "figurine");
    expect(r.ok).toBe(true);
  });

  it("没报档位(老客户端)⇒ 按服务端自己判定的那一档走,不报错", () => {
    const relief = checkReliefTier([60, 60, 4], null);
    expect(relief.ok).toBe(true);
    if (relief.ok) expect(relief.kind).toBe("relief");

    const figurine = checkReliefTier([30, 30, 30], undefined);
    expect(figurine.ok).toBe(true);
    if (figurine.ok) expect(figurine.kind).toBe("figurine");
  });
});
