/**
 * Shopify 通道的币种策略 —— **不换算**
 *
 * ## 这个文件守住什么
 *
 * 一句话:**我们的代码里没有汇率**。
 *
 * 本仓库的价一律人民币,原样搬进 Shopify 草稿订单,展示币种设成人民币。
 * 换算(结算成美元)是 Shopify 那边的事,而且它在**草稿单创建那一刻就把汇率
 * 锁死** —— 用户看到的价、我们收到的钱,用的是同一个数。
 *
 * 所以这个文件钉的是**「能不能用人民币收钱」这个判定**,以及判定失败时的
 * 报错文案 —— 那段文案是工作室唯一能照着改的东西(改 Markets 或者改店铺
 * 结算币种),写清楚一点省一轮来回。
 *
 * 纯函数:不碰 DB、不碰网络。跑在 unit project 里。
 */

import { describe, expect, it } from "vitest";

import {
  PRICE_CURRENCY,
  resolvePresentmentCurrency,
} from "@/features/payments/providers/shopify/currency";
import { ShopifyNotConfiguredError } from "@/features/payments/providers/shopify/errors";

describe("本仓库的价", () => {
  it("一律人民币", () => {
    expect(PRICE_CURRENCY).toBe("CNY");
  });
});

describe("resolvePresentmentCurrency —— 路 1:店铺结算币种就是人民币", () => {
  it("店铺就是人民币 → 展示币种是人民币(不用碰 Markets)", () => {
    const plan = resolvePresentmentCurrency({
      shopCurrency: "CNY",
      enabledPresentmentCurrencies: [],
    });
    expect(plan).toEqual({
      presentmentCurrency: "CNY",
      mode: "shop_currency",
    });
  });

  it("大小写不重要 —— 店铺回 'cny' 也认", () => {
    const plan = resolvePresentmentCurrency({
      shopCurrency: "cny",
      enabledPresentmentCurrencies: [],
    });
    expect(plan.presentmentCurrency).toBe("CNY");
  });

  it("店铺就是人民币时,Markets 开着什么都不影响", () => {
    const plan = resolvePresentmentCurrency({
      shopCurrency: "CNY",
      enabledPresentmentCurrencies: ["USD", "EUR"],
    });
    expect(plan.mode).toBe("shop_currency");
  });
});

describe("resolvePresentmentCurrency —— 路 2:Markets 里启用了人民币", () => {
  it("店铺结算美元,但 Markets 里有人民币 → 展示币种是人民币", () => {
    const plan = resolvePresentmentCurrency({
      shopCurrency: "USD",
      enabledPresentmentCurrencies: ["EUR", "CNY"],
    });
    expect(plan).toEqual({
      presentmentCurrency: "CNY",
      mode: "markets",
    });
  });

  it("大小写不重要 —— 'cny' 也认", () => {
    const plan = resolvePresentmentCurrency({
      shopCurrency: "USD",
      enabledPresentmentCurrencies: ["cny"],
    });
    expect(plan.mode).toBe("markets");
  });
});

describe("resolvePresentmentCurrency —— 两条都不满足就报错", () => {
  it("店铺结算美元,Markets 里没有人民币 → 抛「没配好」", () => {
    expect(() =>
      resolvePresentmentCurrency({
        shopCurrency: "USD",
        enabledPresentmentCurrencies: ["EUR", "GBP"],
      })
    ).toThrow(ShopifyNotConfiguredError);
  });

  it("报错文案要说清楚怎么改(改 Markets / 改店铺结算币种)", () => {
    let message = "";
    try {
      resolvePresentmentCurrency({
        shopCurrency: "USD",
        enabledPresentmentCurrencies: ["EUR"],
      });
    } catch (error) {
      message = (error as Error).message;
    }
    // 工作室照着这段话就能改 —— 两条修法都要写出来
    expect(message).toContain("市场");
    expect(message).toContain("CNY");
    expect(message).toContain("结算币种");
    // 顺便把店铺现在的样子报出来
    expect(message).toContain("USD");
    expect(message).toContain("EUR");
  });

  it("一个展示币种都没开 → 也报错(别当成「没限制」)", () => {
    expect(() =>
      resolvePresentmentCurrency({
        shopCurrency: "USD",
        enabledPresentmentCurrencies: [],
      })
    ).toThrow(ShopifyNotConfiguredError);
  });

  it("**不猜汇率** —— 报错里不能出现任何换算出来的数", () => {
    try {
      resolvePresentmentCurrency({
        shopCurrency: "USD",
        enabledPresentmentCurrencies: [],
      });
      expect.unreachable("应该抛错");
    } catch (error) {
      const message = (error as Error).message;
      // 「汇率」这个词不能出现 —— 这条路就是没有汇率
      expect(message).not.toContain("汇率");
      expect(message).not.toContain("rate");
    }
  });
});

describe("resolvePresentmentCurrency —— 别的币种当价时", () => {
  it("价不是人民币 → 走同一条判定逻辑(默认价格币种是人民币)", () => {
    // 将来本仓库要支持别的币种时,判定逻辑不用改
    const plan = resolvePresentmentCurrency({
      shopCurrency: "JPY",
      enabledPresentmentCurrencies: [],
      priceCurrency: "jpy",
    });
    expect(plan).toEqual({
      presentmentCurrency: "JPY",
      mode: "shop_currency",
    });
  });

  it("价是美元、店铺结算美元 → 也认", () => {
    const plan = resolvePresentmentCurrency({
      shopCurrency: "USD",
      enabledPresentmentCurrencies: [],
      priceCurrency: "usd",
    });
    expect(plan.presentmentCurrency).toBe("USD");
  });
});
