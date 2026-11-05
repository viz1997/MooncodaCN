import { describe, expect, it } from "vitest";

/**
 * 购物车「同规格」判定测试。
 *
 * 纯计算:`node:crypto` 的 sha256,不碰 DB、不碰网络。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个值得测
 *
 * 购物车落库之后,「同一规格合并成一行」不再靠内存里逐字段比对,而是给每
 * 份规格算一个**稳定 hash**,让数据库在 `(cart_id, spec_hash)` 上判重。
 *
 * hash 有两个要求,写错任何一条都会变成用户可见的 bug:
 *
 * 1. **同样的规格永远同一个 hash** —— 否则同一件商品在购物车里裂成两行,
 *    用户得自己删一行
 * 2. **不同的规格不同 hash** —— 否则两件不同的商品被合并成一行,用户买
 *    A 拿到了 B
 *
 * 第 2 条里最隐蔽的是**字段边界**:如果分隔符选成空格,刻字文字
 * `"a b"` + 配件 `[]` 和刻字文字 `"a"` + 配件 `["b"]` 会拼成同一个字符串,
 * 两件不同的商品算出同一个 hash。
 */

import {
  type CartSpecInput,
  computeSpecHash,
  computeSpecHashFromMetadata,
  isSameSpec,
  sortAccessoryIds,
} from "@/features/storefront/lib/cart-spec";
import type { CartLineItemMetadata } from "@/features/storefront/types";

/** 一份基准规格 */
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

describe("sortAccessoryIds", () => {
  it("排序 —— 配件的挑选顺序不影响商品本身", () => {
    expect(sortAccessoryIds(["b", "a", "c"])).toEqual(["a", "b", "c"]);
  });

  it("空值当空数组", () => {
    expect(sortAccessoryIds(null)).toEqual([]);
    expect(sortAccessoryIds(undefined)).toEqual([]);
    expect(sortAccessoryIds([])).toEqual([]);
  });

  it("不改动原数组", () => {
    const ids = ["b", "a"];
    sortAccessoryIds(ids);
    expect(ids).toEqual(["b", "a"]);
  });
});

describe("computeSpecHash", () => {
  it("同样的规格 → 同一个 hash", () => {
    expect(computeSpecHash(BASE)).toBe(computeSpecHash({ ...BASE }));
  });

  it("hash 是定长 hex(16 位)", () => {
    expect(computeSpecHash(BASE)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("配件顺序无关 —— 先点底座再点罩 = 先点罩再点底座", () => {
    const a = computeSpecHash({
      ...BASE,
      accessoryVariantIds: ["acc_base_wood", "acc_cover_glass"],
    });
    const b = computeSpecHash({
      ...BASE,
      accessoryVariantIds: ["acc_cover_glass", "acc_base_wood"],
    });
    expect(a).toBe(b);
  });

  it("配件不同 → hash 不同", () => {
    const a = computeSpecHash({
      ...BASE,
      accessoryVariantIds: ["acc_base_wood"],
    });
    const b = computeSpecHash({
      ...BASE,
      accessoryVariantIds: ["acc_base_stone"],
    });
    expect(a).not.toBe(b);
  });

  it("配件多一个 → hash 不同", () => {
    const a = computeSpecHash({
      ...BASE,
      accessoryVariantIds: ["acc_base_wood"],
    });
    const b = computeSpecHash({
      ...BASE,
      accessoryVariantIds: ["acc_base_wood", "acc_cover_glass"],
    });
    expect(a).not.toBe(b);
  });

  it("每个参与 hash 的字段都算数", () => {
    const base = computeSpecHash(BASE);

    const variants: Array<[string, CartSpecInput]> = [
      ["商品", { ...BASE, productId: "prod_keychain-couple" }],
      ["材质", { ...BASE, materialId: "mat_metal" }],
      ["尺寸", { ...BASE, sizeId: "size_R_4" }],
      ["AI 风格", { ...BASE, aiStyleId: "ai_anime" }],
      ["刻字", { ...BASE, engravingText: "for you" }],
      ["加急", { ...BASE, rushOrder: true }],
      ["预览图", { ...BASE, previewImage: "https://r2.example/preview/2.png" }],
    ];

    for (const [label, spec] of variants) {
      expect(computeSpecHash(spec), `${label} 变了 hash 却没变`).not.toBe(base);
    }
  });

  it("字段边界不含糊 —— 刻字 + 配件的拼接方式不同,hash 也不同", () => {
    // 用空格做分隔符的话,这两份规格会拼成同一个字符串
    const a = computeSpecHash({
      ...BASE,
      engravingText: "a b",
      accessoryVariantIds: [],
    });
    const b = computeSpecHash({
      ...BASE,
      engravingText: "a",
      accessoryVariantIds: ["b"],
    });
    expect(a).not.toBe(b);
  });
});

describe("isSameSpec", () => {
  it("完全一样 → true", () => {
    expect(isSameSpec(BASE, { ...BASE })).toBe(true);
  });

  it("配件顺序不同 → 仍然是同一份规格", () => {
    expect(
      isSameSpec(
        { ...BASE, accessoryVariantIds: ["a", "b"] },
        { ...BASE, accessoryVariantIds: ["b", "a"] }
      )
    ).toBe(true);
  });

  it("有一个字段不同 → false", () => {
    expect(isSameSpec(BASE, { ...BASE, sizeId: "size_R_4" })).toBe(false);
    expect(isSameSpec(BASE, { ...BASE, rushOrder: true })).toBe(false);
  });
});

describe("computeSpecHashFromMetadata", () => {
  const METADATA = {
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

  it("跟手拼的规格算出同一个 hash", () => {
    expect(computeSpecHashFromMetadata(METADATA)).toBe(computeSpecHash(BASE));
  });

  it("metadata 缺配件字段(老数据)→ 当空数组", () => {
    const legacy = {
      ...METADATA,
      accessoryVariantIds: undefined,
    } as unknown as CartLineItemMetadata;

    expect(computeSpecHashFromMetadata(legacy)).toBe(computeSpecHash(BASE));
  });
});
