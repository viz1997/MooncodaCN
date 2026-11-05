import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 载体变体解析测试。
 *
 * ## 什么是「载体变体」
 *
 * 本仓库的定价维度有上万个组合,Sellbase 的变体是价格单元 —— 让 Sellbase
 * 原生购物车跑起来得造一万多个变体,还得想办法把刻字文字塞进去(它的
 * 购物车行没有 metadata 字段)。
 *
 * 所以走「本仓库算价,Sellbase 只做收银台」:建单时每一行指向一个**载体
 * 变体**,它只负责给 Sellbase 一个合法的 `variant_id` 和一个能看懂的标题,
 * **真正的价格永远是 `unit_price_amount`**。
 *
 * ## 这里测什么
 *
 * - `sizeCodeFromSpecSizeId` —— 纯字符串解析,`size_R_6` → `6`
 * - `resolveCarrierVariant` —— 精确匹配 / 退让 / 找不到时的报错文案
 *
 * 载体解析要查 DB,但那部分逻辑不该依赖真的 DB:这里把 `@/db` mock 掉,
 * 按「查到什么」喂它。跑在 unit project 里(`pnpm test:run --project=unit`),
 * 零 DB 依赖。
 */

import {
  CarrierNotFoundError,
  PRINT_SERVICE_SKU,
  resolveCarrierVariant,
  resolvePrintServiceCarrier,
  sizeCodeFromSpecSizeId,
} from "@/features/sellbase/lib/carrier";

/**
 * mock 掉 `@/db`
 *
 * `db.select(...).from(...).where(...).limit(1)` 是一条链,每次 `.limit()`
 * 从队列里取一批「查到的行」—— 精确匹配查一次、退让查一次,正好用队列。
 */
const { dbState } = vi.hoisted(() => ({
  dbState: {
    /** 依次返回给每次 select 的结果 */
    queue: [] as Array<Array<Record<string, unknown>>>,
  },
}));

vi.mock("@/db", () => {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: () => Promise.resolve(dbState.queue.shift() ?? []),
  };
  return {
    db: {
      select: () => builder,
    },
  };
});

beforeEach(() => {
  dbState.queue = [];
});

describe("sizeCodeFromSpecSizeId", () => {
  it("`size_R_6` → `6`", () => {
    expect(sizeCodeFromSpecSizeId("size_R_6")).toBe("6");
  });

  it("别的型号也一样取末段", () => {
    expect(sizeCodeFromSpecSizeId("size_M_15")).toBe("15");
    expect(sizeCodeFromSpecSizeId("size_RM_11")).toBe("11");
    expect(sizeCodeFromSpecSizeId("size_LB_8")).toBe("8");
  });

  it("末段不是数字 → null", () => {
    expect(sizeCodeFromSpecSizeId("size_R_custom")).toBeNull();
    expect(sizeCodeFromSpecSizeId("size_R")).toBeNull();
  });

  it("空值 → null", () => {
    expect(sizeCodeFromSpecSizeId(null)).toBeNull();
    expect(sizeCodeFromSpecSizeId(undefined)).toBeNull();
    expect(sizeCodeFromSpecSizeId("")).toBeNull();
  });
});

describe("resolveCarrierVariant", () => {
  it("精确匹配(产品码 + 尺寸码)命中 → 返回那一行", async () => {
    dbState.queue = [
      [
        {
          variantId: "v_exact",
          sku: "SKU-R-6",
          productCode: "R",
        },
      ],
    ];

    const carrier = await resolveCarrierVariant({
      productCode: "R",
      sizeCode: "6",
    });

    expect(carrier).toEqual({
      variantId: "v_exact",
      sku: "SKU-R-6",
      productCode: "R",
    });
    // 精确命中就不该再查一次
    expect(dbState.queue).toHaveLength(0);
  });

  it("精确匹配没命中 → 退到该产品码下任意一个已同步的变体", async () => {
    dbState.queue = [
      [], // 精确匹配:空
      [
        {
          variantId: "v_fallback",
          sku: "SKU-R-4",
          productCode: "R",
        },
      ], // 退让:有一行
    ];

    const carrier = await resolveCarrierVariant({
      productCode: "R",
      sizeCode: "6",
    });

    expect(carrier.variantId).toBe("v_fallback");
    expect(carrier.sku).toBe("SKU-R-4");
  });

  it("没有尺寸码时直接走退让查询", async () => {
    dbState.queue = [
      [
        {
          variantId: "v_any",
          sku: "SKU-R-4",
          productCode: "R",
        },
      ],
    ];

    const carrier = await resolveCarrierVariant({ productCode: "R" });
    expect(carrier.variantId).toBe("v_any");
  });

  it("两跳都没命中 → CarrierNotFoundError,文案指向同步脚本", async () => {
    dbState.queue = [[], []];

    await expect(
      resolveCarrierVariant({ productCode: "R", sizeCode: "6" })
    ).rejects.toThrow(CarrierNotFoundError);

    await expect(
      resolveCarrierVariant({ productCode: "R", sizeCode: "6" })
    ).rejects.toThrow(/R\/6/);

    await expect(
      resolveCarrierVariant({ productCode: "R", sizeCode: "6" })
    ).rejects.toThrow(/sync-sellbase-catalog\.ts/);
  });

  it("查到行但 sellbaseVariantId 是空的 → 当作没找到", async () => {
    // 同步脚本还没跑过:行在,但 sellbase_variant_id 是 null
    dbState.queue = [
      [{ variantId: null, sku: "SKU-R-6", productCode: "R" }],
      [],
    ];

    await expect(
      resolveCarrierVariant({ productCode: "R", sizeCode: "6" })
    ).rejects.toThrow(CarrierNotFoundError);
  });
});

describe("resolvePrintServiceCarrier", () => {
  it("命中 → 返回打印服务载体", async () => {
    dbState.queue = [
      [
        {
          variantId: "v_service",
          sku: PRINT_SERVICE_SKU,
          productCode: "SERVICE",
        },
      ],
    ];

    const carrier = await resolvePrintServiceCarrier();
    expect(carrier.variantId).toBe("v_service");
    expect(carrier.sku).toBe(PRINT_SERVICE_SKU);
  });

  it("没建好 → CarrierNotFoundError,文案指向同步脚本", async () => {
    dbState.queue = [[]];

    await expect(resolvePrintServiceCarrier()).rejects.toThrow(
      CarrierNotFoundError
    );
    await expect(resolvePrintServiceCarrier()).rejects.toThrow(
      /sync-sellbase-catalog\.ts/
    );
  });
});
