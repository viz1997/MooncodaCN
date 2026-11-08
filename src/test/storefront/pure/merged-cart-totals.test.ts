/**
 * **一张车**的金额口径 —— 纯函数测试
 *
 * 2026-11-08 工作室改口:**「不要 print-order,进入商城那个」**。打印服务跟
 * 目录商品装**同一个购物袋**了(以前是两张车:`storefront` / `print`)。
 *
 * ## 为什么「运费只看目录商品那一部分」值得单测
 *
 * 两件事装在一张车里,但**钱**还是两套:
 *
 * - **目录商品**有运费:¥8,目录商品那部分小计到 ¥99 免
 * - **打印服务没有运费** —— 打印服务的价**就是报价本身**:购物袋里显示
 *   多少、工单上写多少、收银台收多少,是**同一个数**(见
 *   `print-quote/lib/payment.ts`:工单的支付金额恒等于 `total_price_cents`)。
 *   到结算时再加一笔运费,用户看到的总价跟实际收的钱对不上 —— 这种对不上
 *   用户是**一眼看出来的**,只会认为是系统算错,直接不买了。
 *
 * 还有一个更要紧的:打印服务的钱**不该替目录商品把 ¥99 的门槛凑满**。它
 * 不产生快递费,凭什么替人省运费。
 *
 * 这条规则住在 `pricing-constants.ts` 的 `shippingCentsForCart()` ——
 * 客户端(购物袋页 / 抽屉 / 结算页)和服务端(结算)用**同一份**。
 *
 * 纯计算:不碰 DB、不碰网络。跑在 unit project 里。
 */

import { describe, expect, it } from "vitest";

import { computeCartTotals } from "@/features/storefront/lib/cart-totals";
import { shippingCentsForCart } from "@/features/storefront/lib/pricing-constants";
import { buildPrintServiceMetadata } from "@/features/storefront/lib/print-service";
import type {
  CartLineItem,
  CartLineItemMetadata,
  PrintServiceSpec,
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

const BASE_SPEC: PrintServiceSpec = {
  volumeCM3: 12.5,
  surfaceAreaCM2: 48.2,
  dims: [40, 30, 20],
  supportWeightG: 3.1,
  selfSupportRatio: null,
  deliveryTier: "standard",
  modelFileName: "cat.zip",
  modelObjectKey: "print-orders/abc123/cat.zip",
  modelUrl: "https://r2.example/print-orders/abc123/cat.zip",
  modelSizeBytes: 1024,
};

const PRINT_METADATA: CartLineItemMetadata = buildPrintServiceMetadata({
  spec: BASE_SPEC,
});

/** 造一行目录商品 */
function catalogLine(
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
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
  };
}

/** 造一行打印服务(数量恒为 1 —— 一活一模型) */
function printLine(id: string, unitPriceCents: number): CartLineItem {
  return {
    id,
    cartId: "cart_1",
    productId: "service_print_3d",
    productHandle: "print-service",
    productTitle: "定制打印(按克重)",
    productThumbnail: "",
    unitPriceCents,
    discountedUnitPriceCents: unitPriceCents,
    quantity: 1,
    metadata: PRINT_METADATA,
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
  };
}

describe("shippingCentsForCart", () => {
  it("目录商品那部分不到 ¥99 收 ¥8,到了就免", () => {
    expect(shippingCentsForCart(9000)).toBe(800);
    expect(shippingCentsForCart(9900)).toBe(0);
    expect(shippingCentsForCart(20000)).toBe(0);
  });

  it("车里没有目录商品 → 0(没有要寄的东西)", () => {
    expect(shippingCentsForCart(0)).toBe(0);
    // 过了 ¥99 也还是 0 —— 不是「免运费」,是一直没有运费
    expect(shippingCentsForCart(20000)).toBe(0);
  });
});

describe("computeCartTotals(一张车)", () => {
  it("车里只有打印服务 → 没有运费,合计就是小计", () => {
    const totals = computeCartTotals([
      printLine("p1", 5581),
      printLine("p2", 9800),
    ]);

    expect(totals.subtotalCents).toBe(5581 + 9800);
    expect(totals.shippingCents).toBe(0);
    expect(totals.totalCents).toBe(totals.subtotalCents);
    expect(totals.itemCount).toBe(2);
  });

  it("车里只有打印服务 → 没有「还差多少免运费」", () => {
    const totals = computeCartTotals([printLine("p1", 5581)]);
    expect(totals.remainingForFreeShippingCents).toBe(0);
  });

  it("两种行都有 → 小计全算,运费只看目录商品那部分", () => {
    const totals = computeCartTotals([
      catalogLine("c1", 5000),
      printLine("p1", 5581),
    ]);

    expect(totals.subtotalCents).toBe(5000 + 5581);
    expect(totals.catalogSubtotalCents).toBe(5000);
    expect(totals.printSubtotalCents).toBe(5581);
    // 目录商品那部分只有 ¥50 → 收 ¥8 运费
    expect(totals.shippingCents).toBe(800);
    expect(totals.totalCents).toBe(totals.subtotalCents + 800);
  });

  it("打印服务的钱不替目录商品凑满 ¥99 门槛", () => {
    // 目录商品 ¥50 + 打印服务 ¥60 —— 合计 ¥110,但运费基数只有 ¥50
    const totals = computeCartTotals([
      catalogLine("c1", 5000),
      printLine("p1", 6000),
    ]);

    expect(totals.subtotalCents).toBe(11000);
    expect(totals.shippingCents).toBe(800);
    expect(totals.remainingForFreeShippingCents).toBe(9900 - 5000);
  });

  it("目录商品那部分到 ¥99 → 免运费(打印服务在旁边也不影响)", () => {
    const totals = computeCartTotals([
      catalogLine("c1", 9900),
      printLine("p1", 5581),
    ]);

    expect(totals.shippingCents).toBe(0);
    expect(totals.remainingForFreeShippingCents).toBe(0);
  });

  it("空车 → 合计 0,没有运费", () => {
    const totals = computeCartTotals([]);

    expect(totals.subtotalCents).toBe(0);
    expect(totals.shippingCents).toBe(0);
    expect(totals.totalCents).toBe(0);
    expect(totals.itemCount).toBe(0);
    expect(totals.remainingForFreeShippingCents).toBe(0);
  });
});
