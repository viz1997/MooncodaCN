import { describe, expect, it } from "vitest";

/**
 * 数量阶梯折扣的口径测试。
 *
 * 纯计算:不碰 DB、不碰网络。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 核心恒等式
 *
 * ```
 * totalPriceCents === discountedUnitPriceCents × quantity
 * ```
 *
 * 为什么这条这么重要:Sellbase 的行合计 = `unit_price_amount × quantity`,
 * 而 `unit_price_amount` 填的就是 `discountedUnitPriceCents`。这条恒等式
 * 成立,本仓库结算页显示的价跟 Stripe 实收的价才**逐分相等**。
 *
 * 写反了会怎样 —— 旧口径是「先乘数量再折总价」:
 *
 * ```
 * subtotal = unit × qty
 * total    = subtotal - round(subtotal × rate)
 * ```
 *
 * 跟新口径最多差 ⌊qty/2⌋ 分。目录里现有的价都是 100 的倍数,两种口径碰巧
 * 相等 —— 所以光靠目录数据测不出「顺序反了」。这里用**奇数单价**测:
 * 单元价 1999、数量 10,新口径收 17990,旧口径收 17991,差 1 分。
 *
 * ## 为什么这件事值得单独测
 *
 * 差 1 分不会有人投诉,但**用户看到的价和实际收的价不是同一个数**是更难
 * 解释的问题 —— 客服只能说「系统算的」。而且它只在特定单价下出现,联调时
 * 大概率撞不到。
 */

import {
  calculatePricing,
  computeQuantityDiscount,
} from "@/features/storefront/lib/pricing";
import {
  calculateRemainingForFreeShipping,
  calculateShippingCents,
  getQuantityTier,
  PRICING_CONSTANTS,
  QUANTITY_TIERS,
} from "@/features/storefront/lib/pricing-constants";
import type { CustomizationSpec } from "@/features/storefront/types";

/** 一份 R(钥匙扣)的合法规格 —— 基准价 ¥19 + 6cm 尺寸 +¥5 */
const BASE_SPEC: CustomizationSpec = {
  productId: "prod_keychain-pet-portrait",
  productHandle: "keychain-pet-portrait",
  productTypeCode: "R",
  materialId: "mat_resin",
  sizeId: "size_R_6",
  aiStyleId: "ai_original",
  engravingText: "",
  rushOrder: false,
  accessoryVariantIds: [],
  quantity: 1,
  previewImageUrl: "",
  originalImageUrl: "",
};

function specWith(overrides: Partial<CustomizationSpec>): CustomizationSpec {
  return { ...BASE_SPEC, ...overrides };
}

describe("getQuantityTier", () => {
  it("按行数量取档", () => {
    expect(getQuantityTier(1).discountRate).toBe(0);
    expect(getQuantityTier(9).discountRate).toBe(0);
    expect(getQuantityTier(10).discountRate).toBe(0.1);
    expect(getQuantityTier(49).discountRate).toBe(0.1);
    expect(getQuantityTier(50).discountRate).toBe(0.2);
    expect(getQuantityTier(100).discountRate).toBe(0.2);
  });

  it("档位是从高往低排的 —— 第一个命中的就是最高的折扣", () => {
    expect(QUANTITY_TIERS[0]?.minQty).toBe(50);
    expect(QUANTITY_TIERS[QUANTITY_TIERS.length - 1]?.minQty).toBe(1);
  });
});

describe("computeQuantityDiscount", () => {
  it("行合计 = 折后单价 × 数量", () => {
    for (const unit of [0, 1, 1999, 2400, 19900]) {
      for (const qty of [1, 9, 10, 49, 50, 100]) {
        const d = computeQuantityDiscount(unit, qty);
        expect(d.totalPriceCents, `unit=${unit} qty=${qty}`).toBe(
          d.discountedUnitPriceCents * qty
        );
      }
    }
  });

  it("折扣额 = 折前合计 − 折后合计", () => {
    const d = computeQuantityDiscount(2400, 10);
    expect(d.discountCents).toBe(2400 * 10 - d.totalPriceCents);
    expect(d.discountCents).toBeGreaterThan(0);
  });

  it("单价为 0 → 什么都不变", () => {
    const d = computeQuantityDiscount(0, 50);
    expect(d.discountedUnitPriceCents).toBe(0);
    expect(d.totalPriceCents).toBe(0);
    expect(d.discountCents).toBe(0);
  });

  it("数量 1 → 不打折", () => {
    const d = computeQuantityDiscount(2400, 1);
    expect(d.discountedUnitPriceCents).toBe(2400);
    expect(d.discountCents).toBe(0);
  });

  it("折扣越买越多越大", () => {
    const at10 = computeQuantityDiscount(2400, 10).discountedUnitPriceCents;
    const at50 = computeQuantityDiscount(2400, 50).discountedUnitPriceCents;
    expect(at10).toBe(2160); // 2400 × 0.9
    expect(at50).toBe(1920); // 2400 × 0.8
    expect(at50).toBeLessThan(at10);
  });

  it("奇数单价下,「先折单价」和「先折总价」差 1 分 —— 这就是顺序的意义", () => {
    const unit = 1999;
    const qty = 10;

    // 新口径:先折单价
    const newWay = computeQuantityDiscount(unit, qty);

    // 旧口径:先乘数量再折总价
    const subtotal = unit * qty;
    const oldTotal = subtotal - Math.round(subtotal * 0.1);

    expect(newWay.totalPriceCents).toBe(17990);
    expect(oldTotal).toBe(17991);
    expect(newWay.totalPriceCents).not.toBe(oldTotal);
  });
});

describe("calculatePricing 的阶梯折扣", () => {
  it("行合计 = 折后单价 × 数量", () => {
    for (const quantity of [1, 5, 10, 25, 50, 100]) {
      const pricing = calculatePricing(specWith({ quantity }));
      expect(pricing.totalPriceCents, `quantity=${quantity}`).toBe(
        pricing.discountedUnitPriceCents * quantity
      );
    }
  });

  it("折扣额 = 折前合计 − 折后合计", () => {
    const pricing = calculatePricing(specWith({ quantity: 10 }));
    expect(pricing.breakdown.quantityTierDiscountCents).toBe(
      pricing.unitPriceCents * 10 - pricing.totalPriceCents
    );
  });

  it("数量 1 → 折后单价 = 原价", () => {
    const pricing = calculatePricing(specWith({ quantity: 1 }));
    expect(pricing.discountedUnitPriceCents).toBe(pricing.unitPriceCents);
    expect(pricing.breakdown.quantityTierDiscountCents).toBe(0);
  });

  it("数量 10 → 折后单价 = 原价 × 0.9", () => {
    const pricing = calculatePricing(specWith({ quantity: 10 }));
    expect(pricing.discountedUnitPriceCents).toBe(
      Math.round(pricing.unitPriceCents * 0.9)
    );
  });

  it("数量 50 → 折后单价 = 原价 × 0.8", () => {
    const pricing = calculatePricing(specWith({ quantity: 50 }));
    expect(pricing.discountedUnitPriceCents).toBe(
      Math.round(pricing.unitPriceCents * 0.8)
    );
  });

  it("单价拆解加起来 = 单价", () => {
    const pricing = calculatePricing(specWith({ quantity: 10 }));
    const b = pricing.breakdown;
    const sum =
      b.baseCents +
      b.materialCents +
      b.sizeCents +
      b.aiStyleCents +
      b.accessoryCents +
      b.engravingFeeCents +
      b.rushOrderCents;
    expect(sum).toBe(pricing.unitPriceCents);
  });

  it("加急 / 刻字只影响单价,不影响折扣口径", () => {
    const plain = calculatePricing(specWith({ quantity: 10 }));
    const rush = calculatePricing(specWith({ quantity: 10, rushOrder: true }));
    expect(rush.unitPriceCents).toBe(
      plain.unitPriceCents + PRICING_CONSTANTS.RUSH_ORDER_FEE_CENTS
    );
    expect(rush.totalPriceCents).toBe(rush.discountedUnitPriceCents * 10);
  });

  it("不同型号都守同一条恒等式", () => {
    const specs: CustomizationSpec[] = [
      specWith({ quantity: 10 }),
      specWith({
        productId: "prod_magnet-pet-fridge",
        productHandle: "magnet-pet-fridge",
        productTypeCode: "P",
        sizeId: "size_P_6",
        quantity: 50,
      }),
      specWith({
        productId: "prod_figure-pet-statue",
        productHandle: "figure-pet-statue",
        productTypeCode: "M",
        materialId: "mat_resin_premium",
        sizeId: "size_M_8",
        quantity: 3,
      }),
    ];

    for (const spec of specs) {
      const pricing = calculatePricing(spec);
      expect(pricing.totalPriceCents).toBe(
        pricing.discountedUnitPriceCents * spec.quantity
      );
    }
  });

  it("非法数量直接报错 —— 别让 0 价单子流出去", () => {
    expect(() => calculatePricing(specWith({ quantity: 0 }))).toThrow();
    expect(() => calculatePricing(specWith({ quantity: -1 }))).toThrow();
    expect(() =>
      calculatePricing(
        specWith({ quantity: PRICING_CONSTANTS.MAX_QUANTITY + 1 })
      )
    ).toThrow();
  });
});

describe("运费", () => {
  it("到门槛免运费,不到收 8 块", () => {
    expect(calculateShippingCents(0)).toBe(
      PRICING_CONSTANTS.DEFAULT_SHIPPING_CENTS
    );
    expect(
      calculateShippingCents(
        PRICING_CONSTANTS.FREE_SHIPPING_THRESHOLD_CENTS - 1
      )
    ).toBe(PRICING_CONSTANTS.DEFAULT_SHIPPING_CENTS);
    expect(
      calculateShippingCents(PRICING_CONSTANTS.FREE_SHIPPING_THRESHOLD_CENTS)
    ).toBe(0);
  });

  it("门槛按**折后**金额算 —— 结算页算的就是折后小计", () => {
    // 折前 11000 → 折后 9900 → 免运费
    expect(calculateShippingCents(9900)).toBe(0);
    // 单价 1100 × 10 件 → 折后 990 分/件 → 合计 9900
    const discounted = computeQuantityDiscount(1100, 10);
    expect(discounted.totalPriceCents).toBe(9900);
    expect(calculateShippingCents(discounted.totalPriceCents)).toBe(0);
  });

  it("还差多少才免运费 —— 负数归零", () => {
    expect(calculateRemainingForFreeShipping(0)).toBe(9900);
    expect(calculateRemainingForFreeShipping(9800)).toBe(100);
    expect(calculateRemainingForFreeShipping(12000)).toBe(0);
  });
});
