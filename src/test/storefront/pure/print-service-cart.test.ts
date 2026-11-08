/**
 * 打印服务购物车行 —— 纯函数测试
 *
 * 打印服务是**来料加工**:用户自带 3D 模型,按克重计价,目录里没有对应商品。
 * 所以它在购物车里走的是另一套字段(几何 + 交期 + 模型文件),判定靠
 * `metadata.printSpec` 在不在,不是 `productId`。
 *
 * ## 为什么这些值得测
 *
 * 1. **判据不能错** —— 判错的话,打印服务行会被当成普通商品行去定价,
 *    然后报一句用户看不懂的「未知产品」。
 * 2. **hash 必须区分不同的活** —— 同一组几何但**不同的模型文件**是两件
 *    不同的活(工作室要打的不是同一个东西)。合成一行的话,第二份模型就
 *    丢了,工作室只收到一份。
 * 3. **交期档位要进 hash** —— 加急和不加急是两份额报价(加价 37% / 10%)。
 *    合成一行的话,用户看到的「加急」会被后面合并进来的标准档行覆盖掉。
 * 4. **工具页传出来的几何不能被动过** —— 服务端按 `printSpec` 重算报价,
 *    几何一旦被加工过,用户看到的尺寸跟工单上的价就对不上。
 *
 * 纯计算:不碰 DB、不碰网络。跑在 unit project 里。
 */

import { describe, expect, it } from "vitest";

import { computeSpecHash } from "@/features/storefront/lib/cart-spec";
import {
  buildPrintServiceMetadata,
  buildPrintServiceSpecFromGeometry,
  getPrintServiceSpec,
  isPrintServiceMetadata,
  PRINT_SERVICE_PRODUCT_ID,
  printServiceSpecHashParts,
  printServiceSpecToQuoteInput,
} from "@/features/storefront/lib/print-service";
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

describe("buildPrintServiceMetadata / getPrintServiceSpec", () => {
  it("建出来再读回去 —— 规格原样保留", () => {
    const metadata = buildPrintServiceMetadata({ spec: BASE_SPEC });
    expect(getPrintServiceSpec(metadata)).toEqual(BASE_SPEC);
  });

  it("目录商品那套字段是空的 —— 材质 / 尺寸 / 配件对打印服务没有意义", () => {
    const metadata = buildPrintServiceMetadata({ spec: BASE_SPEC });
    expect(metadata.materialId).toBe("");
    expect(metadata.sizeId).toBe("");
    expect(metadata.sizeCm).toBe(0);
    expect(metadata.aiStyleId).toBe("");
    expect(metadata.engravingText).toBe("");
    expect(metadata.rushOrder).toBe(false);
    expect(metadata.accessoryVariantIds).toEqual([]);
    expect(metadata.previewImage).toBe("");
    expect(metadata.originalImage).toBe("");
  });

  it("封面图默认是空的 —— 手上是模型文件(一个 zip),不是图片", () => {
    const metadata = buildPrintServiceMetadata({ spec: BASE_SPEC });
    expect(metadata.productThumbnail).toBe("");
  });

  it("productId 是哨兵值 —— 不查目录", () => {
    const metadata = buildPrintServiceMetadata({ spec: BASE_SPEC });
    expect(metadata.productId).toBe(PRINT_SERVICE_PRODUCT_ID);
  });

  it("判据是 printSpec 在不在 —— 目录商品行不是打印服务行", () => {
    const catalog: CartLineItemMetadata = {
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
    expect(isPrintServiceMetadata(catalog)).toBe(false);
    expect(getPrintServiceSpec(catalog)).toBeNull();
    expect(isPrintServiceMetadata(null)).toBe(false);
    expect(getPrintServiceSpec(undefined)).toBeNull();
  });
});

describe("printServiceSpecToQuoteInput", () => {
  it("几何原样传给报价引擎 —— 不做任何加工", () => {
    expect(printServiceSpecToQuoteInput(BASE_SPEC)).toEqual({
      volumeCM3: 12.5,
      surfaceAreaCM2: 48.2,
      dims: [40, 30, 20],
      supportWeightG: 3.1,
      selfSupportRatio: null,
      deliveryTier: "standard",
    });
  });

  it("展示用的克重不进报价输入 —— 它不参与定价", () => {
    const withWeight: PrintServiceSpec = {
      ...BASE_SPEC,
      materialWeightG: 8.8,
    };
    expect(printServiceSpecToQuoteInput(withWeight)).not.toHaveProperty(
      "materialWeightG"
    );
  });
});

describe("printServiceSpecHashParts", () => {
  it("同样的规格 → 同样的部分", () => {
    expect(printServiceSpecHashParts(BASE_SPEC)).toEqual(
      printServiceSpecHashParts({ ...BASE_SPEC })
    );
  });

  it("每个决定「是不是同一件活」的字段都参与", () => {
    const base = printServiceSpecHashParts(BASE_SPEC).join("|");

    const variants: Array<[string, PrintServiceSpec]> = [
      ["体积", { ...BASE_SPEC, volumeCM3: 12.6 }],
      ["表面积", { ...BASE_SPEC, surfaceAreaCM2: 48.3 }],
      ["尺寸", { ...BASE_SPEC, dims: [41, 30, 20] }],
      ["支撑克重", { ...BASE_SPEC, supportWeightG: 3.2 }],
      ["支撑比例", { ...BASE_SPEC, selfSupportRatio: 0.8 }],
      ["交期档位", { ...BASE_SPEC, deliveryTier: "urgent" }],
      [
        "模型文件",
        { ...BASE_SPEC, modelObjectKey: "print-orders/zzz/cat.zip" },
      ],
    ];

    for (const [label, spec] of variants) {
      expect(
        printServiceSpecHashParts(spec).join("|"),
        `${label} 变了 hash 却没变`
      ).not.toBe(base);
    }
  });

  it("模型文件的 URL 不参与 —— 域名一改 hash 就全变,存量购物车会裂成两行", () => {
    const base = printServiceSpecHashParts(BASE_SPEC).join("|");
    const otherDomain = printServiceSpecHashParts({
      ...BASE_SPEC,
      modelUrl: "https://cdn.example/print-orders/abc123/cat.zip",
    }).join("|");
    expect(otherDomain).toBe(base);
  });
});

describe("buildPrintServiceSpecFromGeometry(工具页 → 购物袋)", () => {
  const UPLOADED = {
    fileName: "cat.zip",
    objectKey: "print-orders/abc123/cat.zip",
    url: "https://r2.example/print-orders/abc123/cat.zip",
    sizeBytes: 1024,
  };

  const GEOMETRY = {
    volumeCM3: 12.5,
    surfaceAreaCM2: 48.2,
    dims: [40, 30, 20] as [number, number, number],
    supportWeightG: 3.1,
    selfSupportRatio: 0.82,
  };

  it("几何原样搬过去 —— 服务端按同一组数重算报价", () => {
    const spec = buildPrintServiceSpecFromGeometry(GEOMETRY, UPLOADED);
    expect(spec.volumeCM3).toBe(12.5);
    expect(spec.surfaceAreaCM2).toBe(48.2);
    expect(spec.dims).toEqual([40, 30, 20]);
    expect(spec.supportWeightG).toBe(3.1);
    expect(spec.selfSupportRatio).toBe(0.82);
  });

  it("没跑摆盘的两个数是 null —— 不是 0(0 会被当成「没有支撑」)", () => {
    const spec = buildPrintServiceSpecFromGeometry(
      { ...GEOMETRY, supportWeightG: null, selfSupportRatio: null },
      UPLOADED
    );
    expect(spec.supportWeightG).toBeNull();
    expect(spec.selfSupportRatio).toBeNull();
  });

  it("交期一律标准档 —— 工具页不选交期,用户在购物袋上改", () => {
    const spec = buildPrintServiceSpecFromGeometry(
      { ...GEOMETRY, deliveryTier: "urgent" },
      UPLOADED
    );
    expect(spec.deliveryTier).toBe("standard");
  });

  it("模型文件四个字段原样带过去 —— 归属校验靠对象键", () => {
    const spec = buildPrintServiceSpecFromGeometry(GEOMETRY, UPLOADED);
    expect(spec.modelFileName).toBe("cat.zip");
    expect(spec.modelObjectKey).toBe("print-orders/abc123/cat.zip");
    expect(spec.modelUrl).toBe(
      "https://r2.example/print-orders/abc123/cat.zip"
    );
    expect(spec.modelSizeBytes).toBe(1024);
  });

  it("往返一圈几何不变 —— 购物袋上的报价跟工具页量的是同一组数", () => {
    const spec = buildPrintServiceSpecFromGeometry(GEOMETRY, UPLOADED);
    const back = printServiceSpecToQuoteInput(spec);
    expect(back.volumeCM3).toBe(GEOMETRY.volumeCM3);
    expect(back.surfaceAreaCM2).toBe(GEOMETRY.surfaceAreaCM2);
    expect(back.dims).toEqual(GEOMETRY.dims);
    expect(back.supportWeightG).toBe(GEOMETRY.supportWeightG);
    expect(back.selfSupportRatio).toBe(GEOMETRY.selfSupportRatio);
  });
});

describe("打印服务行的购物车 hash", () => {
  const hashOf = (spec: PrintServiceSpec) =>
    computeSpecHash({
      productId: PRINT_SERVICE_PRODUCT_ID,
      materialId: "",
      sizeId: "",
      aiStyleId: "",
      engravingText: "",
      rushOrder: false,
      accessoryVariantIds: [],
      previewImage: "",
      printSpec: spec,
    });

  it("同样的活 → 同一个 hash(会合并成一行)", () => {
    expect(hashOf(BASE_SPEC)).toBe(hashOf({ ...BASE_SPEC }));
  });

  it("不同的模型文件 → 不同的 hash(不会合并)", () => {
    expect(hashOf(BASE_SPEC)).not.toBe(
      hashOf({ ...BASE_SPEC, modelObjectKey: "print-orders/zzz/dog.zip" })
    );
  });

  it("交期档位不同 → 不同的 hash(加急和不加急是两行)", () => {
    expect(hashOf(BASE_SPEC)).not.toBe(
      hashOf({ ...BASE_SPEC, deliveryTier: "urgent" })
    );
  });

  it("打印服务行跟目录商品行不会撞 —— 走的是另一套字段", () => {
    const printHash = hashOf(BASE_SPEC);
    const catalogHash = computeSpecHash({
      productId: PRINT_SERVICE_PRODUCT_ID,
      materialId: "",
      sizeId: "",
      aiStyleId: "",
      engravingText: "",
      rushOrder: false,
      accessoryVariantIds: [],
      previewImage: "",
    });
    expect(printHash).not.toBe(catalogHash);
  });
});
