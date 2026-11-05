import { describe, expect, it } from "vitest";

/**
 * 支付通道的「开放名单」与「通道清单」。
 *
 * 纯计算:不碰 DB、不碰网络。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个值得测
 *
 * 工作室 2026-11-05 定了:只用**微信 + 支付宝**两个付款方式(人民币结算,
 * 境内商户的原生场景)。Shopify 那条路下线了 —— 界面上不再摆出来。
 *
 * 这几条不变量:
 *
 * 1. **两个通道都在开放名单里** —— 少一个,界面上就少一个付款方式
 * 2. **Shopify 不在名单里** —— 它下线了,不接新单
 * 3. **旧路 `stripe` 不在名单里** —— 它也不接新单
 *
 * 另外守住「清单 = 名单」:清单接口(`/api/store/payment-channels`)返回的就是
 * 这份名单,前端画的选择器跟它一一对应。
 */

import {
  ALL_CHANNELS,
  ENABLED_PAYMENT_CHANNELS,
  isPaymentChannelEnabled,
} from "@/features/payments/lib/channels";

describe("ENABLED_PAYMENT_CHANNELS —— 开放名单", () => {
  it("两个通道都开放(界面上一律摆出来)", () => {
    expect([...ENABLED_PAYMENT_CHANNELS]).toEqual(["wechat", "alipay"]);
  });

  it("Shopify 已下线 —— 不在名单里,不接新单", () => {
    expect(isPaymentChannelEnabled("shopify")).toBe(false);
    expect(ENABLED_PAYMENT_CHANNELS).not.toContain("shopify");
  });

  it("旧路 stripe 不在名单里 —— 不再接新单", () => {
    expect(isPaymentChannelEnabled("stripe")).toBe(false);
    expect(ENABLED_PAYMENT_CHANNELS).not.toContain("stripe");
  });

  it("空 / 乱写的通道 id 一律不开放", () => {
    expect(isPaymentChannelEnabled(null)).toBe(false);
    expect(isPaymentChannelEnabled(undefined)).toBe(false);
    expect(isPaymentChannelEnabled("")).toBe(false);
    expect(isPaymentChannelEnabled("paypal")).toBe(false);
  });
});

describe("ALL_CHANNELS —— 清单接口返回什么", () => {
  it("就是开放名单里的那些,顺序一致", () => {
    expect(ALL_CHANNELS.map((channel) => channel.channel)).toEqual([
      ...ENABLED_PAYMENT_CHANNELS,
    ]);
  });

  it("带得动名字和说明 —— 前端没配 i18n 文案时有个兜底", () => {
    for (const channel of ALL_CHANNELS) {
      expect(channel.label.length).toBeGreaterThan(0);
      expect(channel.description.length).toBeGreaterThan(0);
    }
  });

  it("Shopify 已下线 —— 不在清单里(界面上不摆出来)", () => {
    expect(ALL_CHANNELS.map((c) => c.channel)).not.toContain("shopify");
  });

  it("旧路 stripe 不在清单里 —— 它不再接新单", () => {
    expect(ALL_CHANNELS.map((c) => c.channel)).not.toContain("stripe");
  });
});
