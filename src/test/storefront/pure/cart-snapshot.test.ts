import { describe, expect, it } from "vitest";

/**
 * 「这单买了什么」的快照测试。
 *
 * 纯计算:sha256,不碰 DB、不碰网络。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个值得测
 *
 * 购物车改成「**付款成功才清空**」之后,有两件事靠这份快照:
 *
 * 1. **复用** —— 购物车现在装的 == 某一单已经买了的 → 那一单直接复用
 * 2. **摘除** —— 付款成功后 → 把买掉的那些行从购物车里摘掉
 *
 * 第 2 件是**钱**的事:摘错了,用户付了钱购物袋里还留着(看着像没买成),
 * 或者摘多了,没买的东西被清掉(用户白丢了一单)。所以「订单行的 hash 必须
 * 等于购物车行的 hash」这条不变量得守住 —— 它是两边对上的唯一依据
 * (订单行和购物车行不是同一张表,也没有共同的行 id)。
 */

import type { ShippingAddressSnapshot } from "@/db/schema";
import {
  buildLineSnapshot,
  isSameAddress,
  isSameLineSnapshot,
} from "@/features/storefront/lib/cart-snapshot";
import {
  type CartSpecInput,
  computeSpecHash,
  computeSpecHashForLine,
} from "@/features/storefront/lib/cart-spec";
import {
  buildPrintServiceMetadata,
  PRINT_SERVICE_PRODUCT_ID,
} from "@/features/storefront/lib/print-service";
import type {
  CartLineItemMetadata,
  PrintServiceSpec,
} from "@/features/storefront/types";

/** 一份基准规格(跟加购时手拼的一样) */
const BASE: CartSpecInput = {
  productId: "prod_keychain-pet-portrait",
  materialId: "mat_resin",
  sizeId: "size_R_6",
  aiStyleId: "ai_original",
  engravingText: "",
  rushOrder: false,
  accessoryVariantIds: [],
  previewImage: "https://r2.example/preview/1.png",
};

/** 购物车行里的 metadata */
const METADATA: CartLineItemMetadata = {
  productId: BASE.productId,
  productHandle: "keychain-pet-portrait",
  productTitle: "宠物钥匙扣",
  productThumbnail: "https://r2.example/thumb/1.png",
  materialId: BASE.materialId,
  sizeId: BASE.sizeId,
  sizeCm: 6,
  aiStyleId: BASE.aiStyleId,
  engravingText: BASE.engravingText,
  rushOrder: BASE.rushOrder,
  accessoryVariantIds: BASE.accessoryVariantIds,
  previewImage: BASE.previewImage,
  originalImage: "https://r2.example/original/1.png",
};

/** 一份打印服务规格 */
const PRINT_SPEC: PrintServiceSpec = {
  volumeCM3: 12.5,
  surfaceAreaCM2: 30.25,
  dims: [20, 15, 10],
  supportWeightG: 1.5,
  selfSupportRatio: 0.2,
  deliveryTier: "standard",
  modelFileName: "model.zip",
  modelObjectKey: "users/u_1/models/m_1/model.zip",
  modelUrl: "https://r2.example/users/u_1/models/m_1/model.zip",
  modelSizeBytes: 1024,
};

describe("computeSpecHashForLine —— 订单行的 hash 必须等于购物车行的 hash", () => {
  it("跟加购时手拼的规格算出同一个 hash", () => {
    expect(
      computeSpecHashForLine({ productId: BASE.productId, metadata: METADATA })
    ).toBe(computeSpecHash(BASE));
  });

  it("product id 用**行上那个**,不是 metadata 里那个", () => {
    // `metadata.productId` 是客户端带来的 id,行上的 `product_id` 是服务端
    // 解析过的那个 —— 打印服务行的哨兵值 `service_print_3d` 就是在这儿
    // 换掉的。hash 必须跟**行上那个**走,否则永远对不上 `cart_item.spec_hash`
    const metadata = { ...METADATA, productId: "client_said_this" };
    const lineProductId = "server_resolved_this";

    expect(computeSpecHashForLine({ productId: lineProductId, metadata })).toBe(
      computeSpecHash({
        ...BASE,
        productId: lineProductId,
        previewImage: metadata.previewImage,
      })
    );
    expect(
      computeSpecHashForLine({ productId: lineProductId, metadata })
    ).not.toBe(
      computeSpecHashForLine({ productId: metadata.productId, metadata })
    );
  });

  it("打印服务行:hash 跟购物车加购时算的那个一样", () => {
    // 购物车落库时用的是「行上的 productId + metadata 里的 printSpec」
    const metadata = buildPrintServiceMetadata({ spec: PRINT_SPEC });

    expect(
      computeSpecHashForLine({
        productId: PRINT_SERVICE_PRODUCT_ID,
        metadata,
      })
    ).toBe(
      computeSpecHash({
        ...BASE,
        productId: PRINT_SERVICE_PRODUCT_ID,
        printSpec: PRINT_SPEC,
      })
    );
  });

  it("打印服务行:服务端回填的耗材克重**不影响** hash", () => {
    // 服务端重算之后会往 printSpec 里回填 materialWeightG(纯展示用),
    // 订单行存的是回填之后的那份 —— hash 必须跟购物车里的那份一样
    const metadata = buildPrintServiceMetadata({ spec: PRINT_SPEC });
    const repriced = buildPrintServiceMetadata({
      spec: { ...PRINT_SPEC, materialWeightG: 3.75 },
    });

    expect(
      computeSpecHashForLine({
        productId: PRINT_SERVICE_PRODUCT_ID,
        metadata: repriced,
      })
    ).toBe(
      computeSpecHashForLine({
        productId: PRINT_SERVICE_PRODUCT_ID,
        metadata,
      })
    );
  });
});

describe("buildLineSnapshot", () => {
  it("算出的 hash 跟加购时一样", () => {
    const snapshot = buildLineSnapshot([
      { productId: BASE.productId, metadata: METADATA, quantity: 2 },
    ]);

    expect(snapshot).toEqual([
      { specHash: computeSpecHash(BASE), quantity: 2 },
    ]);
  });

  it("顺序无关 —— 购物车的行序和订单的行序不一定一样", () => {
    const a = buildLineSnapshot([
      { productId: "prod_a", metadata: METADATA, quantity: 1 },
      {
        productId: "prod_b",
        metadata: { ...METADATA, sizeId: "size_R_4" },
        quantity: 3,
      },
    ]);
    const b = buildLineSnapshot([
      {
        productId: "prod_b",
        metadata: { ...METADATA, sizeId: "size_R_4" },
        quantity: 3,
      },
      { productId: "prod_a", metadata: METADATA, quantity: 1 },
    ]);

    expect(a).toEqual(b);
  });

  it("空购物车 → 空快照", () => {
    expect(buildLineSnapshot([])).toEqual([]);
  });
});

describe("isSameLineSnapshot", () => {
  const snapshot = buildLineSnapshot([
    { productId: BASE.productId, metadata: METADATA, quantity: 2 },
  ]);

  it("一样 → true", () => {
    expect(isSameLineSnapshot(snapshot, [...snapshot])).toBe(true);
  });

  it("数量不同 → false", () => {
    const other = buildLineSnapshot([
      { productId: BASE.productId, metadata: METADATA, quantity: 3 },
    ]);
    expect(isSameLineSnapshot(snapshot, other)).toBe(false);
  });

  it("规格不同 → false", () => {
    const other = buildLineSnapshot([
      {
        productId: BASE.productId,
        metadata: { ...METADATA, sizeId: "size_R_4" },
        quantity: 2,
      },
    ]);
    expect(isSameLineSnapshot(snapshot, other)).toBe(false);
  });

  it("多一行 → false", () => {
    const other = buildLineSnapshot([
      { productId: BASE.productId, metadata: METADATA, quantity: 2 },
      { productId: "prod_b", metadata: METADATA, quantity: 1 },
    ]);
    expect(isSameLineSnapshot(snapshot, other)).toBe(false);
  });
});

describe("isSameAddress", () => {
  const address = {
    recipientName: "张三",
    phone: "13800000000",
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    detail: "科技园路 1 号",
  };

  it("一样 → true", () => {
    expect(isSameAddress(address, { ...address })).toBe(true);
  });

  it("差一个字段 → false", () => {
    expect(
      isSameAddress(address, { ...address, detail: "科技园路 2 号" })
    ).toBe(false);
    expect(isSameAddress(address, { ...address, phone: "13900000000" })).toBe(
      false
    );
  });

  it("区为空 vs 区是空串 → 同一个地址", () => {
    // 快照是从 JSON 读回来的 —— 缺字段就是 undefined,不是 ""
    const missing = {
      ...address,
      district: undefined,
    } as unknown as ShippingAddressSnapshot;

    expect(isSameAddress(missing, { ...address, district: "" })).toBe(true);
  });

  it("一边没有地址 → false", () => {
    expect(isSameAddress(null, address)).toBe(false);
    expect(isSameAddress(address, null)).toBe(false);
  });
});
