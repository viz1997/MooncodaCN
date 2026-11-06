import { describe, expect, it } from "vitest";

/**
 * 支撑加价的**分段计价** —— 纯函数测试
 *
 * ## 工作室的规则(原文)
 *
 * > 模型支撑超过 1:1 的多的支撑按照 **0.5 元一克**,1:2 的多的支撑按照
 * > **1 元一克**。
 *
 * 也就是**分段**收,不是一刀切:
 *
 * ```
 * 本体支撑比例 r = 支撑克重 ÷ 耗材克重     (1 = 1:1,2 = 1:2)
 *
 * r ≤ 1        不收钱(1:1 以内的支撑是工艺必需)
 * 1 < r ≤ 2    超出部分 × 0.5 元/g      ← 第一档
 * r > 2        再超出部分 × 1 元/g      ← 第二档
 * ```
 *
 * ## 为什么这个值得测
 *
 * 分段最容易错在**克重怎么切**:
 *
 * - 忘了「先折比例再折克重」—— 直接拿 `W − 耗材克重` 当超阈值克重,
 *   比例 1:1.5 和 1:2 收一样的钱(工作室那张表就是按比例分的档)
 * - 阈值以下也收钱 —— 1:1 以内的支撑是工艺必需,不收
 * - 明细加起来 ≠ 合计 —— 逐档取整的差额没处理,用户会来问「为什么差一分」
 *
 * 这几条都是纯函数的判断,写反例比在 dev 环境手动点便宜得多。
 */

import { computeSupportFeeBands } from "@/features/pricing/lib/pricing-engine";
import type { PrintPricingSettings } from "@/features/print-quote/lib/pricing-settings";
import { computePrintQuote } from "@/features/print-quote/lib/quote-server";

/* -------------------------------------------------------------------------- */
/*  手写的样例                                                                  */
/* -------------------------------------------------------------------------- */

/** 一份生效设置 —— 支撑加价开着,两档单价就是工作室给的那两个 */
const SETTINGS: PrintPricingSettings = {
  modelMaterialId: null,
  modelMaterialName: "测试树脂",
  modelDensity: 1.2,
  unitPriceCentsPerGram: 450,
  supportMaterialId: null,
  supportMaterialName: "测试支撑",
  supportDensity: 1.28,
  supportThreshold: 1,
  supportTier1Ratio: 2,
  supportTier1PriceCentsPerGram: 50,
  supportTier2PriceCentsPerGram: 100,
  supportEnabled: true,
  varnishFeeCents: 0,
  varnishEnabled: false,
  supportLiftMm: 5,
  supportBaseMarginMm: 5,
  deliveryRates: { standard: 0, express: 0.1, urgent: 0.37 },
};

/** 第一档 / 第二档的单位 —— 元/g(引擎内部用元) */
const TIER1_PRICE = 0.5;
const TIER2_PRICE = 1;

/**
 * 取第 n 项 —— 越界就抛
 *
 * `noUncheckedIndexedAccess` 下 `bands[0]` 的类型是 `T | undefined`,
 * 直接写 `at(bands, 0).weightG` 过不了编译。这里包一层,顺带给出「没有第
 * 几档」这种能看懂的失败信息。
 */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`没有第 ${index + 1} 项`);
  return item;
}

/* -------------------------------------------------------------------------- */
/*  引擎层                                                                      */
/* -------------------------------------------------------------------------- */

describe("computeSupportFeeBands —— 分段克重怎么切", () => {
  it("比例不超过阈值 → 一档都不收", () => {
    for (const r of [0.5, 0.999, 1]) {
      const bands = computeSupportFeeBands({
        supportWeight: 20,
        selfSupportRatio: r,
        threshold: 1,
        tier1Ratio: 2,
        tier1Price: TIER1_PRICE,
        tier2Price: TIER2_PRICE,
      });
      expect(bands).toEqual([]);
    }
  });

  it("1:1~1:2 之间 → 只有第一档", () => {
    // 支撑 20 g,比例 1.5 → 耗材 13.33 g
    // 超阈值克重 = 20 × (1.5 − 1) / 1.5 = 6.667 g
    const bands = computeSupportFeeBands({
      supportWeight: 20,
      selfSupportRatio: 1.5,
      threshold: 1,
      tier1Ratio: 2,
      tier1Price: TIER1_PRICE,
      tier2Price: TIER2_PRICE,
    });
    expect(bands).toHaveLength(1);
    expect(at(bands, 0).fromRatio).toBe(1);
    expect(at(bands, 0).upToRatio).toBe(2);
    expect(at(bands, 0).price).toBe(TIER1_PRICE);
    expect(at(bands, 0).weightG).toBeCloseTo(6.6667, 3);
    expect(at(bands, 0).fee).toBeCloseTo(3.3333, 3);
  });

  it("超过 1:2 → 两档,超阈值克重按比例切", () => {
    // 支撑 20 g,比例 3 → 耗材 6.67 g
    // 第一档:20 × (2 − 1) / 3 = 6.667 g @ 0.5 元/g = 3.333 元
    // 第二档:20 × (3 − 2) / 3 = 6.667 g @ 1.0 元/g = 6.667 元
    const bands = computeSupportFeeBands({
      supportWeight: 20,
      selfSupportRatio: 3,
      threshold: 1,
      tier1Ratio: 2,
      tier1Price: TIER1_PRICE,
      tier2Price: TIER2_PRICE,
    });
    expect(bands).toHaveLength(2);
    expect(at(bands, 0).fromRatio).toBe(1);
    expect(at(bands, 0).upToRatio).toBe(2);
    expect(at(bands, 0).weightG).toBeCloseTo(6.6667, 3);
    expect(at(bands, 0).fee).toBeCloseTo(3.3333, 3);
    expect(at(bands, 1).fromRatio).toBe(2);
    expect(at(bands, 1).upToRatio).toBeNull();
    expect(at(bands, 1).weightG).toBeCloseTo(6.6667, 3);
    expect(at(bands, 1).fee).toBeCloseTo(6.6667, 3);
  });

  it("两档克重加起来 = 超阈值克重", () => {
    // 超阈值克重 = W × (r − T) / r —— 阈值 T = 1 时它正好等于
    // 「支撑克重 − 耗材克重」,但**两档之间的切分**只有比例能算出来
    const W = 20;
    const r = 3;
    const bands = computeSupportFeeBands({
      supportWeight: W,
      selfSupportRatio: r,
      threshold: 1,
      tier1Ratio: 2,
      tier1Price: TIER1_PRICE,
      tier2Price: TIER2_PRICE,
    });
    const totalWeight = bands.reduce((sum, b) => sum + b.weightG, 0);
    expect(totalWeight).toBeCloseTo((W * (r - 1)) / r, 6);
    // 20 − 6.67 = 13.33 —— 减法只能给一个总数,分不出两段
    expect(at(bands, 0).weightG).toBeCloseTo(6.6667, 3);
    expect(at(bands, 1).weightG).toBeCloseTo(6.6667, 3);
  });

  it("比例刚好等于第一档上界 → 只有第一档,不进第二档", () => {
    const bands = computeSupportFeeBands({
      supportWeight: 20,
      selfSupportRatio: 2,
      threshold: 1,
      tier1Ratio: 2,
      tier1Price: TIER1_PRICE,
      tier2Price: TIER2_PRICE,
    });
    expect(bands).toHaveLength(1);
    expect(at(bands, 0).weightG).toBeCloseTo(10, 6);
  });

  it("第一档上界配得比阈值还小 → 抬到阈值,超出部分全进第二档", () => {
    const bands = computeSupportFeeBands({
      supportWeight: 20,
      selfSupportRatio: 3,
      threshold: 1,
      tier1Ratio: 0.5, // 配错了
      tier1Price: TIER1_PRICE,
      tier2Price: TIER2_PRICE,
    });
    expect(bands).toHaveLength(1);
    // 第一档是空的(上界被抬到阈值 = 下界)→ 全进第二档
    expect(at(bands, 0).fromRatio).toBe(1);
    expect(at(bands, 0).upToRatio).toBeNull();
    expect(at(bands, 0).price).toBe(TIER2_PRICE);
    // 克重还是全部超阈值那部分:20 × (3 − 1) / 3 = 13.333 g
    expect(at(bands, 0).weightG).toBeCloseTo(13.3333, 3);
  });

  it("缺克重 / 缺比例 / 非数 → 空数组(不报错)", () => {
    const base = {
      threshold: 1,
      tier1Ratio: 2,
      tier1Price: TIER1_PRICE,
      tier2Price: TIER2_PRICE,
    };
    expect(computeSupportFeeBands({ ...base, selfSupportRatio: 2 })).toEqual(
      []
    );
    expect(computeSupportFeeBands({ ...base, supportWeight: 20 })).toEqual([]);
    expect(
      computeSupportFeeBands({
        ...base,
        supportWeight: Number.NaN,
        selfSupportRatio: 2,
      })
    ).toEqual([]);
    expect(
      computeSupportFeeBands({
        ...base,
        supportWeight: 0,
        selfSupportRatio: 2,
      })
    ).toEqual([]);
  });

  it("单价配成 0 → 那一档不收钱,但克重仍然算出来(明细看得见)", () => {
    const bands = computeSupportFeeBands({
      supportWeight: 20,
      selfSupportRatio: 1.5,
      threshold: 1,
      tier1Ratio: 2,
      tier1Price: 0,
      tier2Price: TIER2_PRICE,
    });
    expect(bands).toHaveLength(1);
    expect(at(bands, 0).fee).toBe(0);
    expect(at(bands, 0).weightG).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/*  报价层                                                                      */
/* -------------------------------------------------------------------------- */

describe("computePrintQuote —— 分段支撑费接进报价", () => {
  const base = {
    volumeCM3: 10,
    surfaceAreaCM2: 120,
    dims: [50, 40, 30] as [number, number, number],
  };

  it("支撑加价关着 → 一分不收", () => {
    const quote = computePrintQuote(
      { ...SETTINGS, supportEnabled: false },
      { ...base, supportWeightG: 20, selfSupportRatio: 3 }
    );
    expect(quote?.supportFeeCents).toBe(0);
    expect(quote?.supportFeeBands).toEqual([]);
  });

  it("1:1~1:2 → 按第一档单价收", () => {
    const quote = computePrintQuote(SETTINGS, {
      ...base,
      supportWeightG: 20,
      selfSupportRatio: 1.5,
    });
    expect(quote).not.toBeNull();
    // 6.667 g × ¥0.50/g = ¥3.33
    expect(quote?.supportFeeCents).toBe(333);
    expect(quote?.supportFeeBands).toHaveLength(1);
    expect(at(quote?.supportFeeBands ?? [], 0).priceCentsPerGram).toBe(50);
    expect(at(quote?.supportFeeBands ?? [], 0).feeCents).toBe(333);
  });

  it("超过 1:2 → 两档都收", () => {
    const quote = computePrintQuote(SETTINGS, {
      ...base,
      supportWeightG: 20,
      selfSupportRatio: 3,
    });
    expect(quote).not.toBeNull();
    // 3.333 + 6.667 = ¥10.00
    expect(quote?.supportFeeCents).toBe(1000);
    expect(quote?.supportFeeBands).toHaveLength(2);
    expect(at(quote?.supportFeeBands ?? [], 0).priceCentsPerGram).toBe(50);
    expect(at(quote?.supportFeeBands ?? [], 1).priceCentsPerGram).toBe(100);
  });

  it("各档之和恒等于支撑加价(明细加起来 = 合计)", () => {
    // 取整的差额由最后一档吸收 —— 逐档取整再相加可能跟总额取整差 1 分
    for (const W of [7, 13.3, 20, 33.7, 101.9]) {
      for (const r of [1.05, 1.5, 2, 2.37, 3, 5.5]) {
        const quote = computePrintQuote(SETTINGS, {
          ...base,
          supportWeightG: W,
          selfSupportRatio: r,
        });
        const sum = (quote?.supportFeeBands ?? []).reduce(
          (acc, band) => acc + band.feeCents,
          0
        );
        expect(sum).toBe(quote?.supportFeeCents);
      }
    }
  });

  it("「明细加起来 = 合计」这条恒等式还成立(支撑费算进去)", () => {
    for (const r of [1.2, 2, 3.4]) {
      const quote = computePrintQuote(SETTINGS, {
        ...base,
        supportWeightG: 20,
        selfSupportRatio: r,
      });
      expect(quote?.totalPriceCents).toBe(
        (quote?.weightFeeCents ?? 0) +
          (quote?.varnishFeeCents ?? 0) +
          (quote?.supportFeeCents ?? 0) +
          (quote?.deliveryFeeCents ?? 0)
      );
    }
  });

  it("没跑摆盘(没有支撑克重) → 不收支撑费", () => {
    const quote = computePrintQuote(SETTINGS, {
      ...base,
      supportWeightG: null,
      selfSupportRatio: null,
    });
    expect(quote?.supportFeeCents).toBe(0);
    expect(quote?.supportFeeBands).toEqual([]);
  });
});
