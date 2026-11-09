import { describe, expect, it } from "vitest";

import type { CouponView } from "@/features/coupon/lib/coupon-calc";
import { computeCartTotals } from "@/features/storefront/lib/cart-totals";
import type { CartLineItem } from "@/features/storefront/types";

/**
 * 优惠码在购物袋里的金额口径(2026-11-08)
 *
 * ## 这个文件守住什么
 *
 * 优惠码是**订单级**的 —— 折扣不减在任何一行上,而是减整单。它跟
 * 「数量阶梯折扣」是**两码事**:
 *
 * - 数量阶梯折扣 → 折在**单价**上 → `discountCents`
 * - 优惠码 → 减**整单** → `couponDiscountCents`
 *
 * 合计恒等式:
 *
 * ```
 * totalCents = subtotalCents − couponDiscountCents + shippingCents
 * ```
 *
 * ## 三条容易写错的
 *
 * 1. **运费门槛在优惠之前算** —— 门槛看的是**折后小计**(还没减优惠码的
 *    那个数)。优惠把金额压到 ¥99 以下反而**多收**运费,那是坑用户。
 * 2. **百分比 / 满减不碰运费** —— 运费不是商品。只有「免运费」券动它。
 * 3. **免运费券下不再催用户** —— 「再买 ¥X 免运费」的进度条得停下来,
 *    运费已经是 0 了。
 *
 * 纯函数,不需要 DB / 网络 / 浏览器。
 */

/* -------------------------------------------------------------------------- */
/*  夹具                                                                       */
/* -------------------------------------------------------------------------- */

/** 一行购物车 —— 只需要跟金额有关的三个数 */
function line(opts: {
  unitPriceCents: number;
  discountedUnitPriceCents: number;
  quantity: number;
}): CartLineItem {
  return {
    id: "line-1",
    cartId: "cart-1",
    productId: "prod_keychain",
    productHandle: "keychain",
    productTitle: "钥匙扣",
    productThumbnail: "",
    unitPriceCents: opts.unitPriceCents,
    discountedUnitPriceCents: opts.discountedUnitPriceCents,
    quantity: opts.quantity,
    metadata: {
      productId: "prod_keychain",
      productHandle: "keychain",
      productTitle: "钥匙扣",
      productThumbnail: "",
      materialId: "mat_resin",
      sizeId: "size_R_4",
      sizeCm: 4,
      aiStyleId: "ai_original",
      engravingText: "",
      rushOrder: false,
      accessoryVariantIds: [],
      previewImage: "",
      originalImage: "",
    },
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
  };
}

/** 一张券的效果快照 —— 服务端算好的那种 */
function coupon(partial: Partial<CouponView>): CouponView {
  return {
    code: "SAVE20",
    kind: "amount",
    discountCents: 0,
    freeShipping: false,
    freeShippingCents: 0,
    minAmountCents: 0,
    ...partial,
  };
}

/** 免运费门槛(分)—— ¥99 */
const FREE_SHIPPING_THRESHOLD = 9900;
/** 默认运费(分)—— ¥8 */
const SHIPPING = 800;

/* -------------------------------------------------------------------------- */
/*  没有券                                                                     */
/* -------------------------------------------------------------------------- */

describe("购物袋金额 —— 没有券", () => {
  it("小计 = Σ(折后单价 × 数量),合计 = 小计 + 运费", () => {
    const items = [
      line({
        unitPriceCents: 1990,
        discountedUnitPriceCents: 1990,
        quantity: 2,
      }),
    ];

    const totals = computeCartTotals(items);

    expect(totals.subtotalCents).toBe(3980);
    expect(totals.rawSubtotalCents).toBe(3980);
    expect(totals.discountCents).toBe(0);
    expect(totals.shippingCents).toBe(SHIPPING);
    expect(totals.couponDiscountCents).toBe(0);
    expect(totals.totalCents).toBe(3980 + SHIPPING);
  });

  it("数量阶梯折扣落在 `discountCents`,跟优惠码**分开放**", () => {
    // 10 件打九折 —— 单价折了(¥9.90 → ¥8.91)
    const items = [
      line({
        unitPriceCents: 990,
        discountedUnitPriceCents: 891,
        quantity: 10,
      }),
    ];

    const totals = computeCartTotals(items, coupon({ discountCents: 500 }));

    expect(totals.rawSubtotalCents).toBe(9900);
    expect(totals.subtotalCents).toBe(8910);
    // 数量折扣 = 折扣前小计 − 小计
    expect(totals.discountCents).toBe(990);
    // 优惠码是**另一码事** —— 另开一列
    expect(totals.couponDiscountCents).toBe(500);
    expect(totals.shippingCents).toBe(SHIPPING);
    expect(totals.totalCents).toBe(8910 - 500 + SHIPPING);
  });
});

/* -------------------------------------------------------------------------- */
/*  满减 / 百分比                                                              */
/* -------------------------------------------------------------------------- */

describe("购物袋金额 —— 满减券", () => {
  it("合计 = 小计 − 优惠 + 运费", () => {
    const items = [
      line({
        unitPriceCents: 3990,
        discountedUnitPriceCents: 3990,
        quantity: 2,
      }),
    ];

    const totals = computeCartTotals(
      items,
      coupon({ kind: "amount", discountCents: 2000 })
    );

    expect(totals.subtotalCents).toBe(7980);
    expect(totals.couponDiscountCents).toBe(2000);
    expect(totals.shippingCents).toBe(SHIPPING);
    expect(totals.totalCents).toBe(7980 - 2000 + SHIPPING);
  });

  it("**运费门槛在优惠之前算** —— 优惠把小计压到门槛下,运费不重新算", () => {
    // 折后小计 ¥99.50 —— 刚好过免运费门槛
    const items = [
      line({
        unitPriceCents: 9950,
        discountedUnitPriceCents: 9950,
        quantity: 1,
      }),
    ];

    const totals = computeCartTotals(
      items,
      coupon({ kind: "amount", discountCents: 2000 })
    );

    // 优惠后只有 ¥79.50,但运费**仍然是 0** —— 门槛看的是优惠前的小计
    expect(totals.subtotalCents).toBe(9950);
    expect(totals.shippingCents).toBe(0);
    expect(totals.totalCents).toBe(9950 - 2000);
  });

  it("**满减 / 百分比不碰运费** —— 运费该收还是收", () => {
    const items = [
      line({
        unitPriceCents: 1990,
        discountedUnitPriceCents: 1990,
        quantity: 1,
      }),
    ];

    const totals = computeCartTotals(
      items,
      coupon({ kind: "percent", discountCents: 500 })
    );

    expect(totals.shippingCents).toBe(SHIPPING);
    expect(totals.totalCents).toBe(1990 - 500 + SHIPPING);
  });

  it("优惠额**封顶在小计里** —— 合计永远不是负数", () => {
    const items = [
      line({
        unitPriceCents: 1000,
        discountedUnitPriceCents: 1000,
        quantity: 1,
      }),
    ];

    const totals = computeCartTotals(
      items,
      coupon({ kind: "amount", discountCents: 999_999 })
    );

    // 服务端那一侧已经封过顶(`computeCouponDiscount`),这里是兜底:
    // 车里的行数在两次读取之间变了的话,快照会比小计大
    expect(totals.couponDiscountCents).toBe(1000);
    expect(totals.totalCents).toBe(1000 - 1000 + SHIPPING);
    expect(totals.totalCents).toBeGreaterThanOrEqual(0);
  });
});

/* -------------------------------------------------------------------------- */
/*  免运费                                                                     */
/* -------------------------------------------------------------------------- */

describe("购物袋金额 —— 免运费券", () => {
  it("运费置 0,商品不打折", () => {
    const items = [
      line({
        unitPriceCents: 1990,
        discountedUnitPriceCents: 1990,
        quantity: 1,
      }),
    ];

    const totals = computeCartTotals(
      items,
      coupon({ kind: "free_shipping", freeShipping: true })
    );

    expect(totals.shippingCents).toBe(0);
    expect(totals.couponDiscountCents).toBe(0);
    expect(totals.totalCents).toBe(1990);
  });

  it("免运费券下**不再催用户**「再买 ¥X 免运费」", () => {
    const items = [
      line({
        unitPriceCents: 1990,
        discountedUnitPriceCents: 1990,
        quantity: 1,
      }),
    ];

    const totals = computeCartTotals(
      items,
      coupon({ kind: "free_shipping", freeShipping: true })
    );

    expect(totals.remainingForFreeShippingCents).toBe(0);
  });

  it("没有券的时候进度条照常算", () => {
    const items = [
      line({
        unitPriceCents: 1990,
        discountedUnitPriceCents: 1990,
        quantity: 1,
      }),
    ];

    const totals = computeCartTotals(items);

    expect(totals.remainingForFreeShippingCents).toBe(
      FREE_SHIPPING_THRESHOLD - 1990
    );
  });
});
