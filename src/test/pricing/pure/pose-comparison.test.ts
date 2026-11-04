import { describe, expect, it } from "vitest";
import {
  comparePoseSupport,
  describePose,
  poseSavingPct,
  weightPanelNumbers,
} from "@/features/pricing/lib/pose-comparison";

/**
 * 初始角度 vs 当前姿态 —— 支撑克重对比(2026-11-04)
 *
 * 摆盘结果里要同时摆出两个克重:初始角度 (0°,0°) 的和当前姿态的。
 * 这里守住两件事:
 * 1. 「省 X%」的算法:省得多才算数,省得少(甚至没省)是 0;
 * 2. 初始角度的克重还没算出来时,对比行不显示(而不是显示一个假的 0)。
 */
describe("poseSavingPct —— 摆盘省了多少支撑", () => {
  it("初始 12 g → 当前 8 g:省 33%", () => {
    expect(poseSavingPct(12, 8)).toBe(33);
  });

  it("初始 100 g → 当前 50 g:省 50%", () => {
    expect(poseSavingPct(100, 50)).toBe(50);
  });

  it("省不出来(初始角度还没算)→ 0", () => {
    expect(poseSavingPct(undefined, 8)).toBe(0);
  });

  it("当前姿态没有支撑 → 0(不能除以 0)", () => {
    expect(poseSavingPct(12, 0)).toBe(0);
  });

  it("没省反而多了 → 0(不显示负数)", () => {
    expect(poseSavingPct(8, 12)).toBe(0);
  });

  it("一样多 → 0", () => {
    expect(poseSavingPct(10, 10)).toBe(0);
  });

  it("省得很少(1% 以下)→ 0,免得显示「省 0%」", () => {
    // 100 g → 99 g = 省 1%,四舍五入后是 1
    expect(poseSavingPct(100, 99)).toBe(1);
    // 100 g → 99.9 g = 省 0.1% → 0
    expect(poseSavingPct(100, 99.9)).toBe(0);
  });
});

describe("comparePoseSupport —— 对比行", () => {
  it("两个克重都摆出来,附带省掉的百分比", () => {
    const cmp = comparePoseSupport(12, 8);
    expect(cmp.initialWeightG).toBe(12);
    expect(cmp.currentWeightG).toBe(8);
    expect(cmp.savingPct).toBe(33);
  });

  it("初始角度的数还没算出来 → 那一行不显示(initialWeightG = null)", () => {
    const cmp = comparePoseSupport(undefined, 8);
    expect(cmp.initialWeightG).toBeNull();
    expect(cmp.currentWeightG).toBe(8);
    expect(cmp.savingPct).toBe(0);
  });

  it("初始角度 = 当前姿态 → 显示两个一样的数,不省", () => {
    const cmp = comparePoseSupport(0.76, 0.76);
    expect(cmp.initialWeightG).toBeCloseTo(0.76, 6);
    expect(cmp.savingPct).toBe(0);
  });
});

describe("describePose —— 支撑克重标的是哪个姿态", () => {
  it("三个角都是 0 → 初始角度", () => {
    expect(describePose(0, 0, 0).isInitial).toBe(true);
  });

  it("手动拖了 X → 不是初始角度", () => {
    // ⚠️ 这里跟「跑没跑过智能摆盘」无关 —— 只看姿态本身
    expect(describePose(30, 0, 0).isInitial).toBe(false);
    expect(describePose(0, 45, 0).isInitial).toBe(false);
    expect(describePose(0, 0, 90).isInitial).toBe(false);
  });

  it("把三个角原样带出来(标在克重下面)", () => {
    const p = describePose(-180, 90, 15);
    expect(p.x).toBe(-180);
    expect(p.y).toBe(90);
    expect(p.z).toBe(15);
  });
});

describe("weightPanelNumbers —— 三个数要能对上", () => {
  it("总克重 = 耗材克重 + 支撑克重(显示值)", () => {
    // 42.6 + 52.2 = 94.8 → 显示 43 / 53 / 96,不能是 95
    const w = weightPanelNumbers(42.6, 52.2);
    expect(w.material).toBe(43);
    expect(w.support).toBe(53);
    expect(w.total).toBe(96);
    expect(w.total).toBe(w.material + w.support);
  });

  it("小数向上取整(0.4 g 显示 1 g,不显示 0 g)", () => {
    const w = weightPanelNumbers(0.4, 0.2);
    expect(w.material).toBe(1);
    expect(w.support).toBe(1);
    expect(w.total).toBe(2);
  });

  it("没有支撑时 → 总克重 = 耗材克重", () => {
    const w = weightPanelNumbers(43, 0);
    expect(w.total).toBe(43);
  });

  it("整数原样保留", () => {
    const w = weightPanelNumbers(43, 53);
    expect(w).toEqual({ material: 43, support: 53, total: 96 });
  });
});
