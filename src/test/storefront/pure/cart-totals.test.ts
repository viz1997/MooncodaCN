import { describe, expect, it } from "vitest";

/**
 * 购物车金额口径 —— 纯函数测试
 *
 * 纯计算:不碰 DB、不碰网络。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个值得测
 *
 * 购物袋详情页(`/cart`)和结算页(`/checkout`)显示的是**同一笔钱的两个视图**
 * —— 两页的合计必须字面相等,否则用户会挑一个信,或者干脆不买了。
 *
 * 口径里最容易写错的一条:**折扣落在单价上,不是总价上**。
 *
 * - 对的:小计 = 折后单价 × 数量(买 10 个打九折 → 每个 900,小计 9000)
 * - 错的:小计 = 原价 × 数量 再整体打九折(→ 9000,数字一样但**逐分的分法**
 *   不同,收银台那边对不上)
 *
 * 阶梯折扣是**按行数量**算的,两行 6 件 + 4 件 ≠ 一行 10 件 —— 这个差别
 * 只有在多行的时候才看得出来,所以下面专门有一例多行。
 */

import { computeCartTotals } from "@/features/storefront/lib/cart-totals";
import type {
  CartLineItem,
  CartLineItemMetadata,
} from "@/features/storefront/types";

const METADATA: CartLineItemMetadata = {
  productId: "prod_keychain",
  productHandle: "keychain",
  productTitle: "钥匙扣",
  productThumbnail: "",
  materialId: "mat_resin",
  sizeId: "size_R_6",
  sizeCm: 6,
  aiStyleId: "ai_original",
  engravingText: "",
  rushOrder: false,
  accessoryVariantIds: [],
  previewImage: "",
  originalImage: "",
};

/** 造一行购物车(只关心价和数量,其余是占位) */
function line(
  id: string,
  unitPriceCents: number,
  quantity: number,
  discountedUnitPriceCents = unitPriceCents
): CartLineItem {
  return {
    id,
    cartId: "cart_1",
    productId: "prod_keychain",
    productHandle: "keychain",
    productTitle: "钥匙扣",
    productThumbnail: "",
    unitPriceCents,
    discountedUnitPriceCents,
    quantity,
    metadata: METADATA,
    createdAt: "2026-11-06T00:00:00.000Z",
    updatedAt: "2026-11-06T00:00:00.000Z",
  };
}

describe("computeCartTotals", () => {
  it("空购物车 → 小计是 0,运费还是 ¥8(免运费差额按 ¥99 算)", () => {
    // 运费规则只有一条:目录商品小计不到 ¥99 就收 ¥8,到了免。
    // 空车的小计是 0 → 收 ¥8 —— 这是 2026-11-08 退回去之后的行为
    // (打印服务并进商城购物袋那一版给空车开了个 0 的口子,现在没有了)。
    expect(computeCartTotals([])).toEqual({
      subtotalCents: 0,
      rawSubtotalCents: 0,
      discountCents: 0,
      shippingCents: 800,
      totalCents: 800,
      itemCount: 0,
      remainingForFreeShippingCents: 9900,
    });
  });

  it("小计 = 折后单价 × 数量", () => {
    // 1000 分的单买 3 件,单价折到 900(阶梯折扣落在**单价**上)
    const totals = computeCartTotals([line("a", 1000, 3, 900)]);

    expect(totals.subtotalCents).toBe(2700);
    expect(totals.itemCount).toBe(3);
  });

  it("数量折扣 = 折扣前小计 − 折后小计", () => {
    const totals = computeCartTotals([line("a", 1000, 3, 900)]);

    expect(totals.rawSubtotalCents).toBe(3000);
    expect(totals.discountCents).toBe(300);
  });

  it("没折扣的行 → 折扣是 0(不是负数)", () => {
    const totals = computeCartTotals([line("a", 1000, 2)]);

    expect(totals.discountCents).toBe(0);
    expect(totals.rawSubtotalCents).toBe(totals.subtotalCents);
  });

  it("多行分开算 —— 每行按**自己**的行数量打折", () => {
    // 两行:6 件(不打折)+ 4 件(也不打折)—— 各行都不够 10 件的档
    const totals = computeCartTotals([line("a", 1000, 6), line("b", 2000, 4)]);

    expect(totals.subtotalCents).toBe(6000 + 8000);
    expect(totals.itemCount).toBe(10);
    expect(totals.discountCents).toBe(0);
  });

  it("运费:小计不到 ¥99 收 ¥8,到了就免", () => {
    expect(computeCartTotals([line("a", 1000, 9)]).shippingCents).toBe(800);
    expect(computeCartTotals([line("a", 1000, 9)]).totalCents).toBe(9000 + 800);

    expect(computeCartTotals([line("a", 1000, 10)]).shippingCents).toBe(0);
    expect(computeCartTotals([line("a", 1000, 10)]).totalCents).toBe(10000);
  });

  it("免运费差额 = 还差多少才到 ¥99", () => {
    expect(
      computeCartTotals([line("a", 1000, 5)]).remainingForFreeShippingCents
    ).toBe(9900 - 5000);
    // 已经过了门槛 → 0(不是负数)
    expect(
      computeCartTotals([line("a", 1000, 20)]).remainingForFreeShippingCents
    ).toBe(0);
  });

  it("合计 = 小计 + 运费", () => {
    const totals = computeCartTotals([line("a", 1000, 3, 900)]);

    expect(totals.totalCents).toBe(totals.subtotalCents + totals.shippingCents);
  });

  it("车里**只有目录商品**(2026-11-08)—— 没有「打印服务那部分」这种分支", () => {
    // 工作室的说法:「不要放入购物车,放在这里 account/print-orders」。
    // 打印服务是另一条线(工单自己建、自己收款),不进商城购物袋。
    //
    // 所以运费只有一种情况:目录商品。小计到 ¥99 免,不到收 ¥8 ——
    // 「运费只看目录商品那部分」那套逻辑(合并时期才有)整个退回去了。
    const totals = computeCartTotals([line("a", 5581, 1)]);

    expect(totals.subtotalCents).toBe(5581);
    expect(totals.itemCount).toBe(1);
    expect(totals.discountCents).toBe(0);
    // ¥55.81 不到 ¥99 → 收 ¥8
    expect(totals.shippingCents).toBe(800);
    expect(totals.totalCents).toBe(5581 + 800);
  });
});
