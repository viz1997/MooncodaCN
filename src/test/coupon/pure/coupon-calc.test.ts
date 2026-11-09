import { describe, expect, it } from "vitest";

import {
  type CouponCheckContext,
  type CouponRule,
  checkCouponApplicable,
  computeCouponDiscount,
  computeCouponEffect,
  computeCouponShippingDiscount,
  couponScopeAllows,
  isFreeShippingCoupon,
  normalizeCouponCode,
  rateToUnits,
} from "@/features/coupon/lib/coupon-calc";

/**
 * 优惠码的纯函数(2026-11-08)
 *
 * ## 守住三件事
 *
 * 1. **算钱只认整数分** —— 满减封顶、百分比**向下取整**、免运费不动商品
 * 2. **判定顺序不变** —— 第一个不满足就返回,顺序是「从外圈往里圈」
 * 3. **折扣永远 ≤ 小计** —— 不会把商品小计算成负数
 *
 * ## 为什么百分比**向下**取整
 *
 * 仓库那条铁律是「**我们收的钱,一律向上取整到分**」。
 * 优惠额向下取整 ⇒ 收上去的合计 = `ceil(base × (1 − rate))` ⇒ **合计向上取整**。
 * 两个方向必须配套 —— 各取各的就会出现「该收 6545,收了 6544」。
 */

/** 固定的「现在」—— 单测不该依赖真实时钟 */
const NOW = new Date("2026-11-08T12:00:00Z");

/** 一份「什么都能用」的上下文 */
function ctx(over: Partial<CouponCheckContext> = {}): CouponCheckContext {
  return {
    orderKind: "mall",
    now: NOW,
    couponBaseCents: 10_000,
    isLoggedIn: true,
    hasOrders: false,
    userUsedCount: 0,
    ...over,
  };
}

/** 一张「什么限制都没有」的券 */
function rule(over: Partial<CouponRule> = {}): CouponRule {
  return {
    kind: "amount",
    amountCents: 2000,
    scope: "both",
    firstOrderOnly: false,
    isActive: true,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    usedCount: 0,
    perUserLimit: null,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/*  工具                                                                       */
/* -------------------------------------------------------------------------- */

describe("码的归一化", () => {
  it("去空格 + 转大写", () => {
    expect(normalizeCouponCode("  abc123 ")).toBe("ABC123");
    expect(normalizeCouponCode("ABC123")).toBe("ABC123");
    expect(normalizeCouponCode("")).toBe("");
  });
});

describe("折扣率换算成整数万分之一", () => {
  it("字符串(PG 的 numeric 读出来就是 string)精确解析", () => {
    expect(rateToUnits("0.1500")).toBe(1500);
    expect(rateToUnits("0.07")).toBe(700);
    expect(rateToUnits("1")).toBe(10_000);
    expect(rateToUnits("0")).toBe(0);
  });

  it("数字也精确(四舍五入到万分之一)", () => {
    expect(rateToUnits(0.15)).toBe(1500);
    expect(rateToUnits(1)).toBe(10_000);
  });

  it("null / undefined / 空串 → 0", () => {
    expect(rateToUnits(null)).toBe(0);
    expect(rateToUnits(undefined)).toBe(0);
    expect(rateToUnits("")).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/*  算钱                                                                       */
/* -------------------------------------------------------------------------- */

describe("满减(`amount`)", () => {
  it("减固定金额", () => {
    expect(computeCouponDiscount(rule({ amountCents: 2000 }), 10_000)).toBe(
      2000
    );
  });

  it("**封顶在小计里** —— 面额比小计大就只减到 0(不倒扣)", () => {
    expect(computeCouponDiscount(rule({ amountCents: 5000 }), 1500)).toBe(1500);
  });

  it("小计是 0 → 减 0", () => {
    expect(computeCouponDiscount(rule({ amountCents: 2000 }), 0)).toBe(0);
  });
});

describe("百分比(`percent`)", () => {
  it("按比例减", () => {
    const out = computeCouponDiscount(
      rule({ kind: "percent", discountRate: "0.1500", amountCents: null }),
      7700
    );
    expect(out).toBe(1155);
  });

  it("**向下取整** —— 优惠额少一分,合计就向上取整", () => {
    // base 3 分、减 15% → 0.45 分 → 向下取整成 0
    const out = computeCouponDiscount(
      rule({ kind: "percent", discountRate: 0.15, amountCents: null }),
      3
    );
    expect(out).toBe(0);
  });

  it("**逐分相等**:优惠额向下取整 ⇒ 合计正好等于 `ceil(base × (1 − rate))`", () => {
    const base = 7700;
    const rate = 0.15;
    const discount = computeCouponDiscount(
      rule({ kind: "percent", discountRate: "0.1500", amountCents: null }),
      base
    );
    const goods = base - discount;

    expect(goods).toBe(Math.ceil(base * (1 - rate)));
    expect(goods).toBe(6545);
  });

  it("封顶 —— 超过 `maxDiscountCents` 就按封顶算", () => {
    const out = computeCouponDiscount(
      rule({
        kind: "percent",
        discountRate: "0.5000",
        maxDiscountCents: 1000,
        amountCents: null,
      }),
      10_000
    );
    expect(out).toBe(1000);
  });

  it("没封顶 → 减到小计为 0", () => {
    const out = computeCouponDiscount(
      rule({ kind: "percent", discountRate: "0.5000", amountCents: null }),
      3000
    );
    expect(out).toBe(1500);
  });

  it("折扣率 0 → 减 0", () => {
    expect(
      computeCouponDiscount(
        rule({ kind: "percent", discountRate: "0", amountCents: null }),
        10_000
      )
    ).toBe(0);
  });
});

describe("免运费(`free_shipping`)", () => {
  const free = rule({ kind: "free_shipping", amountCents: null });

  it("商品不打折", () => {
    expect(computeCouponDiscount(free, 10_000)).toBe(0);
  });

  it("**动的是运费**", () => {
    expect(computeCouponShippingDiscount(free, 800)).toBe(800);
  });

  it("别的券不动运费", () => {
    expect(computeCouponShippingDiscount(rule(), 800)).toBe(0);
  });

  it("`isFreeShippingCoupon` 只认 `free_shipping`", () => {
    expect(isFreeShippingCoupon(free)).toBe(true);
    expect(isFreeShippingCoupon(rule())).toBe(false);
    // 「新人首单」是叠加的修饰,不能把它变成免运费券
    expect(isFreeShippingCoupon(rule({ firstOrderOnly: true }))).toBe(false);
  });
});

describe("折扣永远 ≤ 小计", () => {
  it("三种类型都封顶在小计里", () => {
    const cases: CouponRule[] = [
      rule({ amountCents: 999_999 }),
      rule({ kind: "percent", discountRate: "0.9900", amountCents: null }),
      rule({ kind: "free_shipping", amountCents: null }),
    ];
    for (const r of cases) {
      expect(computeCouponDiscount(r, 1000)).toBeLessThanOrEqual(1000);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  判定                                                                       */
/* -------------------------------------------------------------------------- */

describe("判定顺序 —— 第一个不满足就返回", () => {
  it("码不存在 → NOT_FOUND", () => {
    const out = checkCouponApplicable(null, ctx());
    expect(out).toEqual({ ok: false, code: "COUPON_NOT_FOUND" });
  });

  it("停用 → INACTIVE(排在时窗前面)", () => {
    const out = checkCouponApplicable(
      rule({
        isActive: false,
        startsAt: new Date("2027-01-01T00:00:00Z"),
      }),
      ctx()
    );
    expect(out).toEqual({ ok: false, code: "COUPON_INACTIVE" });
  });

  it("还没生效 → NOT_STARTED", () => {
    const out = checkCouponApplicable(
      rule({ startsAt: new Date("2027-01-01T00:00:00Z") }),
      ctx()
    );
    expect(out).toEqual({ ok: false, code: "COUPON_NOT_STARTED" });
  });

  it("已过期 → EXPIRED", () => {
    const out = checkCouponApplicable(
      rule({ endsAt: new Date("2026-01-01T00:00:00Z") }),
      ctx()
    );
    expect(out).toEqual({ ok: false, code: "COUPON_EXPIRED" });
  });

  it("**SCOPE_MISMATCH 排在 MIN_AMOUNT_NOT_MET 前面**", () => {
    // 范围不对 + 也没满门槛 → 报范围不对
    const out = checkCouponApplicable(
      rule({ scope: "mall", minAmountCents: 99_999 }),
      ctx({ orderKind: "print", couponBaseCents: 100 })
    );
    expect(out).toEqual({ ok: false, code: "COUPON_SCOPE_MISMATCH" });
  });

  it("免运费券用在打印工单上 → NOT_APPLICABLE(打印单没有运费行)", () => {
    const out = checkCouponApplicable(
      rule({ kind: "free_shipping", scope: "both", amountCents: null }),
      ctx({ orderKind: "print" })
    );
    expect(out).toEqual({ ok: false, code: "COUPON_NOT_APPLICABLE" });
  });

  it("没满门槛 → MIN_AMOUNT_NOT_MET", () => {
    const out = checkCouponApplicable(
      rule({ minAmountCents: 5000 }),
      ctx({ couponBaseCents: 4999 })
    );
    expect(out).toEqual({ ok: false, code: "COUPON_MIN_AMOUNT_NOT_MET" });
  });

  it("刚好满门槛 → 通过", () => {
    const out = checkCouponApplicable(
      rule({ minAmountCents: 5000 }),
      ctx({ couponBaseCents: 5000 })
    );
    expect(out).toEqual({ ok: true });
  });

  it("总量用完 → LIMIT_REACHED", () => {
    const out = checkCouponApplicable(
      rule({ usageLimit: 10, usedCount: 10 }),
      ctx()
    );
    expect(out).toEqual({ ok: false, code: "COUPON_LIMIT_REACHED" });
  });

  it("总量还剩 → 通过", () => {
    const out = checkCouponApplicable(
      rule({ usageLimit: 10, usedCount: 9 }),
      ctx()
    );
    expect(out).toEqual({ ok: true });
  });

  it("每人限用超了 → PER_USER_LIMIT_REACHED", () => {
    const out = checkCouponApplicable(
      rule({ perUserLimit: 1 }),
      ctx({ userUsedCount: 1 })
    );
    expect(out).toEqual({ ok: false, code: "COUPON_PER_USER_LIMIT_REACHED" });
  });

  it("**游客**用每人限用的券 → 直接拒(判不了身份)", () => {
    const out = checkCouponApplicable(
      rule({ perUserLimit: 1 }),
      ctx({ isLoggedIn: false })
    );
    expect(out).toEqual({ ok: false, code: "COUPON_PER_USER_LIMIT_REACHED" });
  });

  it("下过单的人用首单券 → NOT_FIRST_ORDER", () => {
    const out = checkCouponApplicable(
      rule({ firstOrderOnly: true }),
      ctx({ hasOrders: true })
    );
    expect(out).toEqual({ ok: false, code: "COUPON_NOT_FIRST_ORDER" });
  });

  it("**游客**用首单券 → 直接拒(判不了身份)", () => {
    const out = checkCouponApplicable(
      rule({ firstOrderOnly: true }),
      ctx({ isLoggedIn: false })
    );
    expect(out).toEqual({ ok: false, code: "COUPON_NOT_FIRST_ORDER" });
  });

  it("没下过单的新人 → 通过", () => {
    const out = checkCouponApplicable(
      rule({ firstOrderOnly: true }),
      ctx({ hasOrders: false })
    );
    expect(out).toEqual({ ok: true });
  });

  it("什么限制都没有 → 通过", () => {
    expect(checkCouponApplicable(rule(), ctx())).toEqual({ ok: true });
  });
});

describe("适用范围", () => {
  it("`both` 两个都行", () => {
    expect(couponScopeAllows("both", "mall")).toBe(true);
    expect(couponScopeAllows("both", "print")).toBe(true);
  });

  it("`mall` 只管商城单", () => {
    expect(couponScopeAllows("mall", "mall")).toBe(true);
    expect(couponScopeAllows("mall", "print")).toBe(false);
  });

  it("`print` 只管打印工单", () => {
    expect(couponScopeAllows("print", "print")).toBe(true);
    expect(couponScopeAllows("print", "mall")).toBe(false);
  });

  it("免运费券在商城单上 → 通过(它动的是运费)", () => {
    const out = checkCouponApplicable(
      rule({ kind: "free_shipping", scope: "mall", amountCents: null }),
      ctx({ orderKind: "mall" })
    );
    expect(out).toEqual({ ok: true });
  });
});

/* -------------------------------------------------------------------------- */
/*  效果(不判资格)                                                             */
/* -------------------------------------------------------------------------- */

describe("效果 —— 只算能减多少,**不判资格**", () => {
  it("满减券:折扣跟 `computeCouponDiscount` 一致", () => {
    const effect = computeCouponEffect(
      rule({ amountCents: 2000 }),
      10_000,
      800
    );
    expect(effect.discountCents).toBe(2000);
    expect(effect.freeShipping).toBe(false);
    expect(effect.freeShippingCents).toBe(0);
  });

  it("免运费券:折扣 0,动的是运费", () => {
    const effect = computeCouponEffect(
      rule({ kind: "free_shipping", amountCents: null }),
      10_000,
      800
    );
    expect(effect.discountCents).toBe(0);
    expect(effect.freeShipping).toBe(true);
    expect(effect.freeShippingCents).toBe(800);
  });

  it("**过期的券也算得出效果** —— 复用上一张待付款单要靠它", () => {
    // 那张单是券还有效的时候建的,折扣已经锁死在它的合计里了。
    // 现在券过期了 —— 用户要付的还是那张单上的价,所以效果必须算得出来。
    const effect = computeCouponEffect(
      rule({ amountCents: 2000, endsAt: new Date("2026-01-01T00:00:00Z") }),
      10_000,
      800
    );
    expect(effect.discountCents).toBe(2000);

    // 同一个券,判定那边却说它过期了 —— **两件事,两个口径**
    const check = checkCouponApplicable(
      rule({ amountCents: 2000, endsAt: new Date("2026-01-01T00:00:00Z") }),
      ctx()
    );
    expect(check).toEqual({ ok: false, code: "COUPON_EXPIRED" });
  });

  it("**额度用完的券也算得出效果** —— 同一回事", () => {
    const effect = computeCouponEffect(
      rule({ amountCents: 2000, usageLimit: 10, usedCount: 10 }),
      10_000,
      800
    );
    expect(effect.discountCents).toBe(2000);

    const check = checkCouponApplicable(
      rule({ amountCents: 2000, usageLimit: 10, usedCount: 10 }),
      ctx()
    );
    expect(check).toEqual({ ok: false, code: "COUPON_LIMIT_REACHED" });
  });

  it("折扣永远 ≤ 小计(跟 `computeCouponDiscount` 同一份口径)", () => {
    const effect = computeCouponEffect(rule({ amountCents: 999_999 }), 1000, 0);
    expect(effect.discountCents).toBe(1000);
  });
});
