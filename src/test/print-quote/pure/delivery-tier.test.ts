import { describe, expect, it } from "vitest";

/**
 * 交期档位(48 / 72 / 96 小时)+ 按比例加收 —— 纯函数测试
 *
 * ## 为什么这个值得测
 *
 * 加价是**按比例**收的,比例错了不会报错,只会安静地算错钱:
 *
 *   1. 基数拿错(拿合计当基数)—— 加价里套加价,越算越高,而且「明细加起来
 *      = 合计」这条恒等式会破,用户来对账的时候才发现
 *   2. 档位认不出来时按**最贵**的兜底 —— 客户端传个 `"URGENT "`(带空格)
 *      就能按特急收费
 *   3. 比例写死成 37% —— 工作室想调价只能改代码发版
 *
 * 这几条都是纯函数的判断,写反例比在 dev 环境手动点便宜得多。
 *
 * ## 取整口径(2026-11-08)
 *
 * 计价**一律向上取整到分** —— 工作室的原话「计价需要向上取整」。加价也是
 * 用户付的钱,同样向上。所以工作室那张参考表在 ¥55.81 的活上,
 * 72 小时那档从 +¥5.58 变成 **+¥5.59**(48 小时那档不变)。
 */

import {
  computeDeliveryFeeCents,
  DEFAULT_DELIVERY_RATES,
  DELIVERY_TIERS,
  type DeliveryRates,
  getDeliveryTier,
  normalizeDeliveryTier,
} from "@/features/print-quote/lib/delivery-tier";
import type { PrintPricingSettings } from "@/features/print-quote/lib/pricing-settings";
import { computePrintQuote } from "@/features/print-quote/lib/quote-server";

/**
 * 一份**手写**的生效设置 —— 不从 env / DB 取
 *
 * 报价引擎现在吃 `settings` 入参(2026-11-06):价从哪儿来由调用方决定。
 * 这个测试只管「交期加价接进报价」,所以固定一份设置最省心 —— 也让这个文件
 * 保持 DB-free(env 都不用读),留在 Vitest 的 `unit` project 里。
 */
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
  supportEnabled: false,
  varnishFeeCents: 1000,
  varnishEnabled: true,
  supportLiftMm: 5,
  supportBaseMarginMm: 5,
  deliveryRates: DEFAULT_DELIVERY_RATES,
  allowGuestPricing: true,
};

describe("normalizeDeliveryTier", () => {
  it("认得的三档原样返回", () => {
    expect(normalizeDeliveryTier("standard")).toBe("standard");
    expect(normalizeDeliveryTier("express")).toBe("express");
    expect(normalizeDeliveryTier("urgent")).toBe("urgent");
  });

  it("认不出来的落到标准档 —— 绝不按最贵的那档兜底", () => {
    for (const bogus of [
      undefined,
      null,
      "",
      "URGENT",
      "urgent ",
      "expresss",
      42,
      {},
      ["urgent"],
    ]) {
      expect(normalizeDeliveryTier(bogus)).toBe("standard");
    }
  });
});

describe("getDeliveryTier", () => {
  it("三档的小时数是 96 / 72 / 48", () => {
    expect(getDeliveryTier("standard").hours).toBe(96);
    expect(getDeliveryTier("express").hours).toBe(72);
    expect(getDeliveryTier("urgent").hours).toBe(48);
  });

  it("档位表按「快 → 慢」排,UI 直接按这个顺序渲染", () => {
    expect(DELIVERY_TIERS.map((tier) => tier.id)).toEqual([
      "urgent",
      "express",
      "standard",
    ]);
  });
});

describe("computeDeliveryFeeCents", () => {
  it("加价 = ceil(小计 × 比例)", () => {
    expect(computeDeliveryFeeCents(10_000, "express")).toBe(1000);
    expect(computeDeliveryFeeCents(10_000, "urgent")).toBe(3700);
    expect(computeDeliveryFeeCents(10_000, "standard")).toBe(0);
  });

  it("工作室那张表:¥55.81 的活 → 48 小时 +¥20.65 / 72 小时 +¥5.59 / 96 小时 +¥0.00", () => {
    const subtotal = 5581; // 分
    expect(computeDeliveryFeeCents(subtotal, "urgent")).toBe(2065);
    // 5581 × 0.10 = 558.1 → **向上取整 559**(原来是四舍五入的 558)
    expect(computeDeliveryFeeCents(subtotal, "express")).toBe(559);
    expect(computeDeliveryFeeCents(subtotal, "standard")).toBe(0);
  });

  it("48 小时的加价约是 72 小时的 3.7 倍(那两组数反推出来的比例比)", () => {
    const subtotal = 5581;
    const ratio =
      computeDeliveryFeeCents(subtotal, "urgent") /
      computeDeliveryFeeCents(subtotal, "express");
    expect(ratio).toBeGreaterThan(3.6);
    expect(ratio).toBeLessThan(3.8);
  });

  it("向上取整到分 —— 明细加起来必须等于合计", () => {
    // 5581 × 0.37 = 2064.97 → 2065
    expect(computeDeliveryFeeCents(5581, "urgent")).toBe(2065);
    // 1001 × 0.37 = 370.37 → **371**(向上取整;四舍五入是 370)
    expect(computeDeliveryFeeCents(1001, "urgent")).toBe(371);
  });

  it("**绝不向下取整** —— 有一丝零头就往上一分", () => {
    // 999 × 0.1 = 99.9 → 100(不是 99)
    expect(computeDeliveryFeeCents(999, "express")).toBe(100);
    // 1 × 0.37 = 0.37 → 1(不是 0)
    expect(computeDeliveryFeeCents(1, "urgent")).toBe(1);
  });

  it("浮点不许多收那一分 —— 1.1 × 100 是 110.00000000000001", () => {
    // 1001 × 0.1 = 100.10000000000001 → 101(真值 100.1 → 101)
    expect(computeDeliveryFeeCents(1001, "express")).toBe(101);
    // 1000 × 0.1 = 100.00000000000001 → 100(**不是 101** —— 浮点误差不能变成钱)
    expect(computeDeliveryFeeCents(1000, "express")).toBe(100);
    // 1000 × 0.37 = 370.00000000000006 → 371? 真值 370 → 370
    expect(computeDeliveryFeeCents(1000, "urgent")).toBe(370);
  });

  it("基数是 0 / 负数 / 非数 → 0(不加价,不报错)", () => {
    expect(computeDeliveryFeeCents(0, "urgent")).toBe(0);
    expect(computeDeliveryFeeCents(-100, "urgent")).toBe(0);
    expect(computeDeliveryFeeCents(Number.NaN, "urgent")).toBe(0);
  });

  it("比例可以整体换掉(工作室调价不用改代码)", () => {
    const rates: DeliveryRates = { standard: 0, express: 0.2, urgent: 0.5 };
    expect(computeDeliveryFeeCents(10_000, "express", rates)).toBe(2000);
    expect(computeDeliveryFeeCents(10_000, "urgent", rates)).toBe(5000);
  });

  it("默认比例就是 37% / 10% / 0%", () => {
    expect(DEFAULT_DELIVERY_RATES).toEqual({
      standard: 0,
      express: 0.1,
      urgent: 0.37,
    });
  });
});

describe("computePrintQuote —— 交期加价接进报价", () => {
  const base = {
    volumeCM3: 10,
    surfaceAreaCM2: 120,
    dims: [50, 40, 30] as [number, number, number],
  };

  it("标准档不加价", () => {
    const quote = computePrintQuote(SETTINGS, {
      ...base,
      deliveryTier: "standard",
    });
    expect(quote).not.toBeNull();
    expect(quote?.deliveryFeeCents).toBe(0);
    expect(quote?.deliveryHours).toBe(96);
  });

  it("加急档的加价 = ceil(小计 × 比例)", () => {
    const quote = computePrintQuote(SETTINGS, {
      ...base,
      deliveryTier: "express",
    });
    expect(quote).not.toBeNull();
    const subtotal =
      (quote?.weightFeeCents ?? 0) +
      (quote?.varnishFeeCents ?? 0) +
      (quote?.supportFeeCents ?? 0);
    expect(quote?.deliveryFeeCents).toBe(
      computeDeliveryFeeCents(subtotal, "express", quote?.deliveryRates)
    );
    expect(quote?.deliveryHours).toBe(72);
  });

  it("不传档位 = 标准档(不能因为缺省就多收钱)", () => {
    const withTier = computePrintQuote(SETTINGS, {
      ...base,
      deliveryTier: "standard",
    });
    const withoutTier = computePrintQuote(SETTINGS, base);
    expect(withoutTier?.deliveryFeeCents).toBe(0);
    expect(withoutTier?.totalPriceCents).toBe(withTier?.totalPriceCents);
  });

  it("「明细加起来 = 合计」这条恒等式还成立", () => {
    for (const tier of ["standard", "express", "urgent"] as const) {
      const quote = computePrintQuote(SETTINGS, {
        ...base,
        deliveryTier: tier,
      });
      expect(quote).not.toBeNull();
      expect(quote?.totalPriceCents).toBe(
        (quote?.weightFeeCents ?? 0) +
          (quote?.varnishFeeCents ?? 0) +
          (quote?.supportFeeCents ?? 0) +
          (quote?.deliveryFeeCents ?? 0)
      );
    }
  });

  it("加价只跟档位有关,跟几何无关 —— 同一个模型换档位,小计不变", () => {
    const standard = computePrintQuote(SETTINGS, {
      ...base,
      deliveryTier: "standard",
    });
    const urgent = computePrintQuote(SETTINGS, {
      ...base,
      deliveryTier: "urgent",
    });
    const subtotalOf = (q: typeof standard) =>
      (q?.weightFeeCents ?? 0) +
      (q?.varnishFeeCents ?? 0) +
      (q?.supportFeeCents ?? 0);
    expect(subtotalOf(urgent)).toBe(subtotalOf(standard));
    expect(urgent?.totalPriceCents).toBeGreaterThan(
      standard?.totalPriceCents ?? 0
    );
  });
});
