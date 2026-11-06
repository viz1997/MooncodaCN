/**
 * 两种车 —— 纯函数测试
 *
 * 打印服务**不走商城购物袋**(工作室的说法:「模型打印是不走商城正常的购物
 * 车的,而是走打印下单」)。所以有**两张车**:商城购物袋(`storefront`)和
 * 打印单(`print`)。
 *
 * ## 为什么这些值得测
 *
 * 1. **判定在数据层** —— 「这一行能不能放进这张车」写在
 *    `cart-store.ts` 的 `addLineItem()` 里,绕过界面的直接调 API 也进不去。
 *    这里测的是那份判定的**纯函数版本**(两边用的是同一份,不是各写一遍)。
 * 2. **兜底方向不能反** —— 认不出来的 `kind` 一律当商城购物袋。反过来
 *    (兜底成打印单)的话,2026-11-06 之前建的老车里的目录商品行会被**全部
 *    滤掉**,用户的购物袋凭空消失。
 * 3. **放错车要说清楚去哪** —— 话术要指路(「请到打印单页面下单」),不是
 *    一句看不懂的「操作失败」。
 *
 * 纯计算:不碰 DB、不碰网络。跑在 unit project 里。
 */

import { describe, expect, it } from "vitest";

import {
  assertLineAllowedInCart,
  CartKindMismatchError,
  cartKindForLine,
  describeCartKindMismatch,
  isLineAllowedInCart,
  normalizeCartKind,
  PRINT_CART_KIND,
  STOREFRONT_CART_KIND,
} from "@/features/storefront/lib/cart-kind";
import { buildPrintServiceMetadata } from "@/features/storefront/lib/print-service";
import type {
  CartLineItemMetadata,
  PrintServiceSpec,
} from "@/features/storefront/types";

/** 一份基准打印规格 */
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

/** 一行目录商品 */
const CATALOG_LINE: CartLineItemMetadata = {
  productId: "prod_keychain-pet-portrait",
  productHandle: "keychain-pet-portrait",
  productTitle: "宠物钥匙扣",
  productThumbnail: "https://r2.example/thumb/1.png",
  materialId: "mat_resin",
  sizeId: "size_R_6",
  sizeCm: 6,
  aiStyleId: "ai_original",
  engravingText: "",
  rushOrder: false,
  accessoryVariantIds: [],
  previewImage: "https://r2.example/preview/1.png",
  originalImage: "https://r2.example/original/1.png",
};

/** 一行打印服务 */
const PRINT_LINE: CartLineItemMetadata = buildPrintServiceMetadata({
  spec: BASE_SPEC,
});

describe("normalizeCartKind", () => {
  it("认得出来的照原样", () => {
    expect(normalizeCartKind("storefront")).toBe(STOREFRONT_CART_KIND);
    expect(normalizeCartKind("print")).toBe(PRINT_CART_KIND);
  });

  it("认不出来的 → 商城购物袋(老车没有这一列)", () => {
    expect(normalizeCartKind(null)).toBe(STOREFRONT_CART_KIND);
    expect(normalizeCartKind(undefined)).toBe(STOREFRONT_CART_KIND);
    expect(normalizeCartKind("")).toBe(STOREFRONT_CART_KIND);
    expect(normalizeCartKind("Print")).toBe(STOREFRONT_CART_KIND);
    expect(normalizeCartKind(42)).toBe(STOREFRONT_CART_KIND);
  });
});

describe("cartKindForLine", () => {
  it("有 printSpec → 打印单行", () => {
    expect(cartKindForLine(PRINT_LINE)).toBe(PRINT_CART_KIND);
  });

  it("没有 printSpec → 目录商品行", () => {
    expect(cartKindForLine(CATALOG_LINE)).toBe(STOREFRONT_CART_KIND);
    expect(cartKindForLine(null)).toBe(STOREFRONT_CART_KIND);
    expect(cartKindForLine(undefined)).toBe(STOREFRONT_CART_KIND);
  });
});

describe("isLineAllowedInCart", () => {
  it("目录商品只能进商城购物袋", () => {
    expect(isLineAllowedInCart(STOREFRONT_CART_KIND, CATALOG_LINE)).toBe(true);
    expect(isLineAllowedInCart(PRINT_CART_KIND, CATALOG_LINE)).toBe(false);
  });

  it("打印服务只能进打印单", () => {
    expect(isLineAllowedInCart(PRINT_CART_KIND, PRINT_LINE)).toBe(true);
    expect(isLineAllowedInCart(STOREFRONT_CART_KIND, PRINT_LINE)).toBe(false);
  });
});

describe("describeCartKindMismatch", () => {
  it("放得进去 → 没有话术", () => {
    expect(
      describeCartKindMismatch(STOREFRONT_CART_KIND, CATALOG_LINE)
    ).toBeNull();
    expect(describeCartKindMismatch(PRINT_CART_KIND, PRINT_LINE)).toBeNull();
  });

  it("打印服务进商城购物袋 → 话术指向打印单页面", () => {
    const message = describeCartKindMismatch(STOREFRONT_CART_KIND, PRINT_LINE);
    expect(message).toContain("打印单");
  });

  it("目录商品进打印单 → 话术说清楚打印单只放什么", () => {
    const message = describeCartKindMismatch(PRINT_CART_KIND, CATALOG_LINE);
    expect(message).toContain("打印服务");
  });
});

describe("assertLineAllowedInCart", () => {
  it("放得进去 → 什么都不发生", () => {
    expect(() =>
      assertLineAllowedInCart(STOREFRONT_CART_KIND, CATALOG_LINE)
    ).not.toThrow();
    expect(() =>
      assertLineAllowedInCart(PRINT_CART_KIND, PRINT_LINE)
    ).not.toThrow();
  });

  it("放错车 → 抛 CartKindMismatchError(路由要靠类型分辨 400 / 500)", () => {
    expect(() =>
      assertLineAllowedInCart(STOREFRONT_CART_KIND, PRINT_LINE)
    ).toThrow(CartKindMismatchError);

    expect(() =>
      assertLineAllowedInCart(PRINT_CART_KIND, CATALOG_LINE)
    ).toThrow(CartKindMismatchError);
  });

  it("抛出来的错带上话术", () => {
    try {
      assertLineAllowedInCart(STOREFRONT_CART_KIND, PRINT_LINE);
      expect.unreachable("应该抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(CartKindMismatchError);
      expect((error as Error).message).toContain("打印单");
    }
  });
});
