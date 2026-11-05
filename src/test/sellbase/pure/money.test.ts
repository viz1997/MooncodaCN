import { describe, expect, it } from "vitest";

/**
 * 金额换算测试 —— 本仓库的「分」↔ Sellbase 的「最小货币单位」。
 *
 * 纯计算:零依赖,不碰 DB、不碰 env。跑在 unit project 里。
 *
 * ## 为什么这个值得测
 *
 * 金额算错是**直接损失钱**的那类 bug,而且很难在联调时发现:CNY 下两个
 * 单位恰好 1:1,测什么都对,换成别的币种就整体偏移。
 *
 * 这里把两种「分」分开测:
 *
 * - 本仓库的金额单位是**人民币分**(1/100 CNY)
 * - Sellbase 的金额单位是**店铺 `default_currency` 的最小单位**
 *
 * CNY 时两者相等(所以函数是恒等),但 USD 之类就不是了 —— 换算层写错了
 * 是「收 ¥10 收了 $10」这种量级的事故。
 */

import {
  amountsMatchWithinRounding,
  centsToStoreAmount,
  getCurrencyConversion,
  SellbaseCurrencyError,
  storeAmountToCents,
} from "@/features/sellbase/lib/money";

describe("getCurrencyConversion", () => {
  it("CNY + 汇率 1 → 恒等换算", () => {
    const conversion = getCurrencyConversion("cny", 1);
    expect(conversion).toEqual({ currency: "cny", rate: 1 });
  });

  it("币种大小写不敏感", () => {
    expect(getCurrencyConversion("CNY", 1).currency).toBe("cny");
    expect(getCurrencyConversion("Cny", 1).currency).toBe("cny");
  });

  it("币种是 CNY 但汇率不是 1 → 报错(配置自相矛盾)", () => {
    expect(() => getCurrencyConversion("cny", 7.2)).toThrow(
      SellbaseCurrencyError
    );
  });

  it("汇率不是正数 → 报错", () => {
    expect(() => getCurrencyConversion("usd", 0)).toThrow(
      SellbaseCurrencyError
    );
    expect(() => getCurrencyConversion("usd", -1)).toThrow(
      SellbaseCurrencyError
    );
    expect(() => getCurrencyConversion("usd", Number.NaN)).toThrow(
      SellbaseCurrencyError
    );
  });

  it("非 CNY 币种允许任意正汇率", () => {
    expect(getCurrencyConversion("usd", 7.2)).toEqual({
      currency: "usd",
      rate: 7.2,
    });
  });
});

describe("centsToStoreAmount", () => {
  it("CNY 是恒等函数", () => {
    const conversion = getCurrencyConversion("cny", 1);
    expect(centsToStoreAmount(0, conversion)).toBe(0);
    expect(centsToStoreAmount(1, conversion)).toBe(1);
    expect(centsToStoreAmount(9900, conversion)).toBe(9900);
    expect(centsToStoreAmount(-500, conversion)).toBe(-500);
  });

  it("换币种按汇率缩放", () => {
    const conversion = getCurrencyConversion("usd", 7.2);
    // ¥100 = 10000 分 → × 7.2 = 72000(美分的最小单位)
    expect(centsToStoreAmount(10000, conversion)).toBe(72000);
  });

  it("换算有取整 —— 半分四舍五入", () => {
    const conversion = getCurrencyConversion("usd", 7.25);
    // 10 × 7.25 = 72.5 → 73
    expect(centsToStoreAmount(10, conversion)).toBe(73);
  });
});

describe("storeAmountToCents", () => {
  it("CNY 是恒等函数", () => {
    const conversion = getCurrencyConversion("cny", 1);
    expect(storeAmountToCents(9900, conversion)).toBe(9900);
  });

  it("换币种按汇率缩放(反向)", () => {
    const conversion = getCurrencyConversion("usd", 7.2);
    expect(storeAmountToCents(72000, conversion)).toBe(10000);
  });

  it("来回换算在取整误差内能还原", () => {
    const conversion = getCurrencyConversion("usd", 7.2);
    for (const cents of [1, 99, 1234, 9900, 123456]) {
      const back = storeAmountToCents(
        centsToStoreAmount(cents, conversion),
        conversion
      );
      expect(Math.abs(back - cents)).toBeLessThanOrEqual(1);
    }
  });
});

describe("amountsMatchWithinRounding", () => {
  it("CNY 下必须逐分相等 —— 差 1 分就是账对不上", () => {
    const conversion = getCurrencyConversion("cny", 1);
    expect(amountsMatchWithinRounding(9900, 9900, conversion)).toBe(true);
    expect(amountsMatchWithinRounding(9900, 9899, conversion)).toBe(true);
    expect(amountsMatchWithinRounding(9900, 9898, conversion)).toBe(false);
  });

  it("换币种时 1 个最小单位的差算「只是取整」", () => {
    const conversion = getCurrencyConversion("usd", 7.2);
    const store = centsToStoreAmount(10000, conversion);
    expect(amountsMatchWithinRounding(10000, store + 1, conversion)).toBe(true);
    expect(amountsMatchWithinRounding(10000, store + 2, conversion)).toBe(
      false
    );
  });
});
