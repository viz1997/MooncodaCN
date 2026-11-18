import { describe, expect, it } from "vitest";

import {
  buildTaobaoCheckoutUrl,
  buildTaobaoOrderUrl,
  checkTaobaoSkuMap,
  isValidTaobaoItemId,
  isValidTaobaoSkuId,
  resolveTaobaoSkuId,
  TAOBAO_ORDER_URL,
} from "@/features/taobao/lib/taobao-order-link";

/**
 * 淘宝「**直接下单**」链接(2026-11-18)
 *
 * ## 守住什么
 *
 * 工作室报的是:**「用户跳到淘宝后没有自动创建订单」**。
 *
 * ⇒ 得跳淘宝的**下单确认页**(`buyParam` 带商品 + 数量 + 规格),不是商品详情页。
 *
 * 但那个地址是淘宝的**内部 H5 接口**(没公开文档)⇒ **永远要有一条兜底**:
 * 拼不出来就退回后台配的那个普通商品页(老行为)。⇒ 后台那颗「直接下单」开关
 * 能一键切回老行为。
 *
 * ## 为什么要「不猜」
 *
 * 一个猜出来的 skuId 会把买家带到**错的规格**上去(工作室那边对不上货)⇒
 * 认不出来就是 `null`,直连地址里**不带** skuId(让淘宝让买家自己挑一下规格)。
 */

/** 后台配的那个普通商品页 —— 所有兜底都退到它 */
const PRODUCT_PAGE = "https://item.taobao.com/item.htm?id=615435872558";

describe("淘宝下单确认页 —— 地址怎么拼", () => {
  it("带 skuId ⇒ 三段 `buyParam`", () => {
    const url = buildTaobaoOrderUrl({
      itemId: "615435872558",
      quantity: 1,
      skuId: "4512805343789",
    });
    expect(url).toBe(
      `${TAOBAO_ORDER_URL}?buyParam=615435872558_1_4512805343789`
    );
  });

  it("没 skuId ⇒ 两段 `buyParam`(淘宝让买家自己挑规格)", () => {
    const url = buildTaobaoOrderUrl({
      itemId: "615435872558",
      quantity: 2,
      skuId: null,
    });
    expect(url).toBe(`${TAOBAO_ORDER_URL}?buyParam=615435872558_2`);
  });

  it("**不许有任何空格** —— 参数里有空格淘宝会回「系统繁忙」", () => {
    const url = buildTaobaoOrderUrl({
      itemId: "615435872558",
      quantity: 3,
      skuId: "4512805343789",
    });
    expect(url).not.toContain(" ");
    expect(url).not.toContain("%20");
  });

  it("跳的是淘宝那个下单确认页,不是商品详情页", () => {
    const url = buildTaobaoOrderUrl({ itemId: "1", quantity: 1 });
    expect(url.startsWith(TAOBAO_ORDER_URL)).toBe(true);
    expect(url).not.toContain("item.htm");
  });
});

describe("商品 id / skuId 的形状", () => {
  it("商品 id 必须是纯数字", () => {
    expect(isValidTaobaoItemId("615435872558")).toBe(true);
    expect(isValidTaobaoItemId(" 615435872558 ")).toBe(true);
    expect(isValidTaobaoItemId("615435872558a")).toBe(false);
    expect(isValidTaobaoItemId("")).toBe(false);
    expect(isValidTaobaoItemId(null)).toBe(false);
    expect(isValidTaobaoItemId(123)).toBe(false);
  });

  it("skuId 必须是纯数字", () => {
    expect(isValidTaobaoSkuId("4512805343789")).toBe(true);
    expect(isValidTaobaoSkuId("4512805343789 ")).toBe(true);
    expect(isValidTaobaoSkuId("4512805343789x")).toBe(false);
    expect(isValidTaobaoSkuId(undefined)).toBe(false);
  });
});

describe("「本站尺寸 id → 淘宝 skuId」的映射", () => {
  it("查得到 ⇒ 那个 skuId", () => {
    const map = { size_R_4: "4512805343789", size_R_6: "4512805343790" };
    expect(resolveTaobaoSkuId(map, "size_R_4")).toBe("4512805343789");
    expect(resolveTaobaoSkuId(map, "size_R_6")).toBe("4512805343790");
  });

  it("查不到 ⇒ **null,不猜**", () => {
    // 猜一个 skuId 会把买家带到错的规格上 ⇒ 宁可让淘宝让买家自己挑
    expect(resolveTaobaoSkuId({ size_R_4: "1" }, "size_R_6")).toBeNull();
    expect(resolveTaobaoSkuId(null, "size_R_4")).toBeNull();
    expect(resolveTaobaoSkuId({}, null)).toBeNull();
  });

  it("映射里那个值不是纯数字 ⇒ 当作没配", () => {
    expect(resolveTaobaoSkuId({ size_R_4: "abc" }, "size_R_4")).toBeNull();
  });
});

describe("映射表 —— 收一下", () => {
  it("空 / 没有 ⇒ 空表(不是错)", () => {
    expect(checkTaobaoSkuMap(null)).toEqual({ ok: true, map: {} });
    expect(checkTaobaoSkuMap(undefined)).toEqual({ ok: true, map: {} });
    expect(checkTaobaoSkuMap({})).toEqual({ ok: true, map: {} });
  });

  it("值是空串 ⇒ **这一条不配**(不是错)—— 直接丢掉", () => {
    const result = checkTaobaoSkuMap({
      size_R_4: "4512805343789",
      size_R_6: "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.map).toEqual({ size_R_4: "4512805343789" });
    }
  });

  it("键 / 值不对 ⇒ INVALID_SKU_ID(**不猜**)", () => {
    expect(checkTaobaoSkuMap({ size_R_4: "abc" })).toEqual({
      ok: false,
      problem: "INVALID_SKU_ID",
    });
    expect(checkTaobaoSkuMap({ "": "4512805343789" })).toEqual({
      ok: false,
      problem: "INVALID_SKU_ID",
    });
    expect(checkTaobaoSkuMap({ size_R_4: 123 })).toEqual({
      ok: false,
      problem: "INVALID_SKU_ID",
    });
    expect(checkTaobaoSkuMap(["size_R_4"])).toEqual({
      ok: false,
      problem: "INVALID_SKU_ID",
    });
    expect(checkTaobaoSkuMap("nope")).toEqual({
      ok: false,
      problem: "INVALID_SKU_ID",
    });
  });
});

describe("这一单该跳到哪个地址", () => {
  const base = {
    url: PRODUCT_PAGE,
    itemId: "615435872558",
    skuMap: { size_R_4: "4512805343789" },
    directOrder: true,
    quantity: 1,
  };

  it("配好了 ⇒ 淘宝的下单确认页(带 skuId)", () => {
    const result = buildTaobaoCheckoutUrl({ ...base, sizeIds: ["size_R_4"] });
    expect(result.mode).toBe("direct");
    expect(result.fallback).toBeNull();
    expect(result.skuId).toBe("4512805343789");
    expect(result.url).toBe(
      `${TAOBAO_ORDER_URL}?buyParam=615435872558_1_4512805343789`
    );
  });

  it("没配映射 ⇒ 地址**不带** skuId(还是直连确认页)", () => {
    // 比跳商品详情页从头来强 —— 买家落到确认页,淘宝让他自己挑一下规格
    const result = buildTaobaoCheckoutUrl({
      ...base,
      skuMap: {},
      sizeIds: ["size_R_4"],
    });
    expect(result.mode).toBe("direct");
    expect(result.skuId).toBeNull();
    expect(result.url).toBe(`${TAOBAO_ORDER_URL}?buyParam=615435872558_1`);
  });

  it("订单行没有尺寸(老订单)⇒ 不带 skuId", () => {
    const result = buildTaobaoCheckoutUrl({ ...base, sizeIds: [] });
    expect(result.mode).toBe("direct");
    expect(result.skuId).toBeNull();
  });

  it("后台把「直接下单」关掉 ⇒ 退回普通商品页(老行为)", () => {
    const result = buildTaobaoCheckoutUrl({ ...base, directOrder: false });
    expect(result.mode).toBe("product");
    expect(result.fallback).toBe("DIRECT_ORDER_DISABLED");
    expect(result.url).toBe(PRODUCT_PAGE);
  });

  it("抠不出淘宝商品 id ⇒ 退回普通商品页", () => {
    const result = buildTaobaoCheckoutUrl({ ...base, itemId: null });
    expect(result.mode).toBe("product");
    expect(result.fallback).toBe("NO_ITEM_ID");
    expect(result.url).toBe(PRODUCT_PAGE);
  });

  it("数量不对 ⇒ 退回普通商品页", () => {
    for (const quantity of [0, -1, Number.NaN]) {
      const result = buildTaobaoCheckoutUrl({ ...base, quantity });
      expect(result.mode).toBe("product");
      expect(result.fallback).toBe("INVALID_QUANTITY");
      expect(result.url).toBe(PRODUCT_PAGE);
    }
  });

  it("一单里两种尺寸 ⇒ 退回普通商品页(**一个 skuId 装不下**)", () => {
    const result = buildTaobaoCheckoutUrl({
      ...base,
      sizeIds: ["size_R_4", "size_R_6"],
    });
    expect(result.mode).toBe("product");
    expect(result.fallback).toBe("MULTIPLE_SIZES");
    expect(result.url).toBe(PRODUCT_PAGE);
  });

  it("同一个尺寸买两件 ⇒ 还是直连(件数进 buyParam)", () => {
    const result = buildTaobaoCheckoutUrl({
      ...base,
      quantity: 2,
      sizeIds: ["size_R_4", "size_R_4"],
    });
    expect(result.mode).toBe("direct");
    expect(result.url).toBe(
      `${TAOBAO_ORDER_URL}?buyParam=615435872558_2_4512805343789`
    );
  });

  it("**每一种兜底都退到后台配的那个链接** —— 永远有一条路能走通", () => {
    const fallbacks = [
      { ...base, directOrder: false },
      { ...base, itemId: null },
      { ...base, quantity: 0 },
      { ...base, sizeIds: ["size_R_4", "size_R_6"] },
    ];
    for (const input of fallbacks) {
      const result = buildTaobaoCheckoutUrl(input);
      expect(result.mode).toBe("product");
      expect(result.url).toBe(PRODUCT_PAGE);
      expect(result.fallback).not.toBeNull();
    }
  });
});
