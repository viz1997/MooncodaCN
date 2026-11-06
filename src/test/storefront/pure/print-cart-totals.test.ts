/**
 * 打印单的金额口径 —— 纯函数测试
 *
 * ## 为什么「没有运费」这条值得单测
 *
 * 打印服务的价**就是报价本身**:打印单显示多少、工单上写多少、收银台实际收
 * 多少,是**同一个数**(见 `print-quote/lib/payment.ts`:工单的支付金额恒
 * 等于 `total_price_cents`)。
 *
 * 到结算时再加一笔运费,用户在打印单看到的总价就跟实际收的钱对不上了 ——
 * 而这种对不上用户是**一眼看出来的**,只会认为是系统算错,直接不买了。
 *
 * 这条规则住在 `pricing-constants.ts` 的 `shippingCentsForCart()` ——
 * 客户端(购物袋页 / 打印单页)和服务端(结算)用**同一份**。
 *
 * 纯计算:不碰 DB、不碰网络。跑在 unit project 里。
 */

import { describe, expect, it } from "vitest";
import {
  PRINT_CART_KIND,
  STOREFRONT_CART_KIND,
} from "@/features/storefront/lib/cart-kind";
import { computeCartTotals } from "@/features/storefront/lib/cart-totals";
import { shippingCentsForCart } from "@/features/storefront/lib/pricing-constants";
import type {
  CartLineItem,
  CartLineItemMetadata,
} from "@/features/storefront/types";

const CATALOG_METADATA: CartLineItemMetadata = {
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

/** 造一行车上的行 */
function line(
  id: string,
  unitPriceCents: number,
  quantity = 1,
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
    metadata: CATALOG_METADATA,
    createdAt: "2026-11-06T00:00:00.000Z",
    updatedAt: "2026-11-06T00:00:00.000Z",
  };
}

describe("shippingCentsForCart", () => {
  it("商城购物袋:不到 ¥99 收 ¥8,到了就免", () => {
    expect(shippingCentsForCart(STOREFRONT_CART_KIND, 9000)).toBe(800);
    expect(shippingCentsForCart(STOREFRONT_CART_KIND, 9900)).toBe(0);
    expect(shippingCentsForCart(STOREFRONT_CART_KIND, 20000)).toBe(0);
  });

  it("打印单:一律 0 —— 价就是报价本身", () => {
    expect(shippingCentsForCart(PRINT_CART_KIND, 0)).toBe(0);
    expect(shippingCentsForCart(PRINT_CART_KIND, 9000)).toBe(0);
    // 过了 ¥99 也还是 0 —— 打印单没有免运费这回事,是一直没有运费
    expect(shippingCentsForCart(PRINT_CART_KIND, 20000)).toBe(0);
  });
});

describe("computeCartTotals(打印单)", () => {
  it("没有运费 —— 合计就是小计", () => {
    const totals = computeCartTotals(
      [line("a", 5581), line("b", 9800)],
      PRINT_CART_KIND
    );

    expect(totals.subtotalCents).toBe(5581 + 9800);
    expect(totals.shippingCents).toBe(0);
    expect(totals.totalCents).toBe(totals.subtotalCents);
    expect(totals.itemCount).toBe(2);
  });

  it("没有「还差多少免运费」—— 打印单不走那个门槛", () => {
    const totals = computeCartTotals([line("a", 1000)], PRINT_CART_KIND);
    expect(totals.remainingForFreeShippingCents).toBe(0);
  });

  it("同一批行,商城购物袋会收运费 —— 区别只来自车的性质", () => {
    const items = [line("a", 5581)];

    expect(computeCartTotals(items, STOREFRONT_CART_KIND).shippingCents).toBe(
      800
    );
    expect(computeCartTotals(items, PRINT_CART_KIND).shippingCents).toBe(0);
  });

  it("不传 kind → 按商城购物袋算(老调用方的默认)", () => {
    expect(computeCartTotals([line("a", 5581)]).shippingCents).toBe(800);
  });

  it("空打印单 → 合计 0,没有运费", () => {
    const totals = computeCartTotals([], PRINT_CART_KIND);

    expect(totals.subtotalCents).toBe(0);
    expect(totals.shippingCents).toBe(0);
    expect(totals.totalCents).toBe(0);
    expect(totals.itemCount).toBe(0);
  });
});
