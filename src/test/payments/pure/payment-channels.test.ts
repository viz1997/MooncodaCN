import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 支付通道的「开放名单」与「登记清单」。
 *
 * 纯计算:不碰 DB、不碰网络。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 两个概念,别混
 *
 * | | 是什么 | 住在哪儿 |
 * |---|---|---|
 * | **开放名单** | 工作室现在让顾客用哪几个 —— 管**摆不摆出来** | `ENABLED_PAYMENT_CHANNELS` |
 * | **登记清单** | 登记过的通道 —— 管**老单能不能付** | `ALL_CHANNELS` |
 *
 * 顾客侧看到的清单 = 登记清单 ∩ 开放名单(`registry.ts` 的
 * `listPaymentChannels()`)。**关掉一个通道 = 从开放名单里拿掉它**,登记清单
 * 和 provider 都留着 —— 已经建好的单照样能取到付款入口。
 *
 * ## 变迁
 *
 * - 2026-11-05:只用**微信 + 支付宝**(人民币结算,境内商户的原生场景)。
 *   Shopify 那条路下线了 —— 界面上不再摆出来。
 * - 2026-11-17:工作室要求**隐藏微信支付** ⇒ 顾客侧只摆支付宝。微信的
 *   provider / 登记条目**都留着**(老单要能付;想放回来只要改一行)。
 * - 2026-11-18:加了 **`taobao`(淘宝下单)** ⇒ 开放名单是「支付宝 → 淘宝下单」。
 *   淘宝那一路**钱不进本仓库**(买家在淘宝付),所以它跟支付宝是两种完全
 *   不同的东西,但**「摆出来」这一层跟别的通道一样** —— 一道闸管摆不摆,
 *   一道闸管配没配好。
 *
 * ## 守住什么
 *
 * 1. **开放名单 = 现在摆出来的那些** —— 微信 2026-11-17 起不在里面
 * 2. **Shopify / 旧路 `stripe` 不在名单里** —— 它们不接新单
 * 3. **登记清单 ⊇ 开放名单** —— 每个开放的通道都在清单里(不然清单接口就画不出来)
 * 4. **清单接口按开放名单过滤** —— 源码扫描守住(微信因此不出现在界面上)
 * 5. **provider 仍然注册着微信** —— 老单照样能付完(别把老单晾在那儿)
 * 6. **淘宝在开放名单里,而且排在支付宝后面**(工作室要的顺序)
 * 7. **provider 注册着淘宝** —— 别把「登记了」跟「provider 在」拆开
 */

import {
  ALL_CHANNELS,
  ENABLED_PAYMENT_CHANNELS,
  isPaymentChannelEnabled,
} from "@/features/payments/lib/channels";

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里**提到**那个名字不算违规(那儿恰恰要解释改了什么) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const REGISTRY = "src/features/payments/lib/registry.ts";
const PICKER = "src/features/payments/components/payment-channel-picker.tsx";

describe("ENABLED_PAYMENT_CHANNELS —— 开放名单", () => {
  it("2026-11-18 起开放支付宝 + 淘宝下单(微信被工作室要求隐藏)", () => {
    expect([...ENABLED_PAYMENT_CHANNELS]).toEqual(["alipay", "taobao"]);
  });

  it("淘宝在名单里 —— 顾客侧看得见「淘宝下单」", () => {
    expect(isPaymentChannelEnabled("taobao")).toBe(true);
    expect(ENABLED_PAYMENT_CHANNELS).toContain("taobao");
  });

  it("微信不在名单里 —— 顾客侧看不到微信支付", () => {
    expect(isPaymentChannelEnabled("wechat")).toBe(false);
    expect(ENABLED_PAYMENT_CHANNELS).not.toContain("wechat");
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

describe("ALL_CHANNELS —— 登记过的通道", () => {
  it("开放名单 ⊆ 登记清单(每个开放的通道都得在清单里)", () => {
    const registered = ALL_CHANNELS.map((channel) => channel.channel);
    for (const channel of ENABLED_PAYMENT_CHANNELS) {
      expect(registered, `${channel} 开放了却不在登记清单里`).toContain(
        channel
      );
    }
  });

  it("微信还留在登记清单里 —— 老单要能取到付款入口,想放回来时改一行就行", () => {
    expect(ALL_CHANNELS.map((channel) => channel.channel)).toContain("wechat");
    // 但它**不在**开放名单里 ⇒ 顾客侧摆不出来
    expect(isPaymentChannelEnabled("wechat")).toBe(false);
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

  it("淘宝排在支付宝后面 —— 工作室要的展示顺序", () => {
    const registered = ALL_CHANNELS.map((c) => c.channel);
    expect(registered.indexOf("taobao")).toBe(registered.indexOf("alipay") + 1);
  });
});

describe("清单接口 —— 登记清单 ∩ 开放名单", () => {
  it("按开放名单过滤(微信因此不出现在界面上)", () => {
    const src = stripComments(read(REGISTRY));
    // 用正则而不是字面量 —— Biome 会把这一句拆成三行
    expect(src).toMatch(
      /ALL_CHANNELS\.filter\(\(channel\) =>\s*isPaymentChannelEnabled\(channel\.channel\)\s*\)/
    );
  });

  it("provider 仍然注册着微信 —— 已经建好的微信单照样能付完", () => {
    const src = stripComments(read(REGISTRY));
    expect(src).toMatch(/wechat:\s*wechatPayProvider/);
    expect(src).toMatch(/alipay:\s*alipayPayProvider/);
  });

  it("provider 注册着淘宝 —— 登记清单里有它,provider 就得在", () => {
    const src = stripComments(read(REGISTRY));
    expect(src).toMatch(/taobao:\s*taobaoPayProvider/);
  });

  it("顾客侧的选择器不许写死通道 —— 清单接口给什么就画什么", () => {
    const src = stripComments(read(PICKER));
    expect(src).not.toContain("wechat");
    expect(src).not.toContain("alipay");
  });
});
