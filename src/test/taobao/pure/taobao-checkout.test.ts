import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 结算链路上的**淘宝那一路**(2026-11-18)
 *
 * ## 这一条路跟别的通道根本不同
 *
 * | | 微信 / 支付宝 | 淘宝 |
 * |---|---|---|
 * | 钱进哪儿 | 本仓库的商户号 / 账户 | **淘宝那个账户** |
 * | 谁确认收款 | 平台推过来的通知(webhook) | **工作室手工标** |
 * | 本仓库的金额 | 就是收的金额(「逐分相等」) | **只是参考价** |
 *
 * ⇒ 本仓库这边的金额口径一个字没动(仍是 `computeCartTotals()` 那一份),
 * 只是**钱不在这儿收** ⇒ 「逐分相等」在这一条路上**按构造就不成立**,
 * 界面上的文案必须把这件事说出来(`taobaoNotice`)。
 *
 * ## 守住什么
 *
 * 1. **两道闸都在建单之前** —— 「一单只能一件设计」+「不用本站优惠码」。
 *    闸跑在订单行落库之前 ⇒ 不成立的单**不落订单行、不记用券**。
 * 2. **多件设计那个码是 400,不是 503** —— 通道好好的,是**这一单的内容**
 *    跟它不匹配 ⇒ 重试永远没用。
 * 3. **优惠码不许被静默忽略** —— 本站算出来的优惠淘宝那边不认 ⇒ 静默忽略
 *    就是少收钱 ⇒ 直接报「不适用」。
 * 4. **复用上一张待付款单时通道也要一样** —— 少了这一条,一笔支付宝的单
 *    会被当成淘宝单复用 ⇒ 用户点了「去淘宝下单」拿到的却是支付宝的链接。
 */

const ROOT = resolve(process.cwd());

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

const CHECKOUT = "src/features/storefront/lib/checkout.ts";
const PENDING = "src/features/storefront/lib/pending-order.ts";
const ROUTE = "src/app/api/store/checkout/route.ts";
const PROVIDER = "src/features/payments/providers/taobao/index.ts";
const PANEL = "src/features/storefront/components/checkout-payment-panel.tsx";

describe("结算链路 —— 淘宝的两道闸", () => {
  it("多件不同的设计 ⇒ TAOBAO_MULTIPLE_DESIGNS", () => {
    const src = stripComments(read(CHECKOUT));
    expect(src).toContain("TAOBAO_MULTIPLE_DESIGNS");
    // 判据是**不同的设计**(Set 去了重)不是「几件货」
    expect(src).toMatch(
      /new Set\(lines\.map\(\(line\) => line\.item\.productHandle\)\)/
    );
  });

  it("优惠码在淘宝那一路不许被静默忽略 ⇒ COUPON_NOT_APPLICABLE", () => {
    const src = stripComments(read(CHECKOUT));
    expect(src).toMatch(/channel === "taobao" && couponEffect/);
    expect(src).toContain("COUPON_NOT_APPLICABLE");
  });

  it("优惠码那道闸排在「码不存在」后面 —— 先说「不存在」,再说「不适用」", () => {
    const src = stripComments(read(CHECKOUT));
    const notFound = src.indexOf("COUPON_NOT_FOUND");
    const notApplicable = src.indexOf("COUPON_NOT_APPLICABLE");
    expect(notFound).toBeGreaterThan(-1);
    expect(notApplicable).toBeGreaterThan(-1);
    expect(notFound).toBeLessThan(notApplicable);
  });

  it("闸跑在**建单之前** —— 不成立的单不落订单行、不记用券", () => {
    const src = stripComments(read(CHECKOUT));
    const channelAt = src.indexOf("resolveCheckoutChannel(input.channel)");
    const multiAt = src.indexOf("TAOBAO_MULTIPLE_DESIGNS", channelAt);
    const couponAt = src.indexOf("COUPON_NOT_APPLICABLE", channelAt);
    const insertAt = src.indexOf("tx.insert(storefrontOrder)");

    expect(channelAt).toBeGreaterThan(-1);
    expect(multiAt).toBeGreaterThan(channelAt);
    expect(couponAt).toBeGreaterThan(channelAt);
    expect(insertAt).toBeGreaterThan(multiAt);
    expect(insertAt).toBeGreaterThan(couponAt);
  });

  it("多件设计那个码是 **400**,不是 503", () => {
    // 503 = 「这个通道现在用不了,过会儿再试」—— 可这儿通道好好的,
    // 是**这一单的内容**跟它不匹配 ⇒ 重试永远没用。
    const src = stripComments(read(ROUTE));
    const block = /case "TAOBAO_MULTIPLE_DESIGNS":\s*return\s+(\d+);/.exec(src);
    expect(block, "路由里没有 TAOBAO_MULTIPLE_DESIGNS 的状态码").toBeTruthy();
    expect(block?.[1]).toBe("400");
  });

  it("结算路由接受 taobao 这个通道", () => {
    const src = stripComments(read(ROUTE));
    expect(src).toContain("taobao");
  });
});

describe("复用上一张待付款单 —— 通道也要一样", () => {
  it("pending-order 拿**具体的通道**去比,不是 `inArray` 那一堆", () => {
    // 少了这一条:一笔支付宝的待付款单(同样的货 / 同样的合计 / 同样的地址)
    // 会被当成淘宝单复用 ⇒ 用户点了「去淘宝下单」拿到的却是支付宝链接。
    const src = stripComments(read(PENDING));
    expect(src).toContain("params.channel");
    expect(src).toMatch(
      /eq\(storefrontOrder\.paymentChannel,\s*params\.channel\)/
    );
    expect(src).not.toMatch(/inArray\(storefrontOrder\.paymentChannel/);
  });

  it("通道不在开放名单里 ⇒ 不复用", () => {
    const src = stripComments(read(PENDING));
    expect(src).toMatch(
      /if \(!channels\.includes\(params\.channel\)\) return null;/
    );
  });

  it("checkout 把通道一起传下去", () => {
    const src = stripComments(read(CHECKOUT));
    // `coupon-flow.test.ts` 也扫这个字面量 —— 不许改形状
    expect(src).toContain("findReusablePendingOrder({");
    const call = src.slice(src.indexOf("findReusablePendingOrder({"));
    expect(call.slice(0, 400)).toContain("channel,");
  });
});

describe("淘宝 provider —— 只是一个跳转地址", () => {
  const src = stripComments(read(PROVIDER));

  it("`createSession` 给的是 `redirectUrl`(跳转),不是二维码", () => {
    // 跳的是**拼出来的下单确认页**(2026-11-18)—— 拼不出来时才退回商品页,
    // 而退回的那个地址也是从 `buildTaobaoCheckoutUrl()` 里出来的。
    expect(src).toContain("redirectUrl: checkout.url");
    expect(src).toContain("qrCodeUrl: null");
    expect(src).toContain("expiresAt: null");
  });

  it("拼的是**淘宝的下单确认页**(不是商品详情页)", () => {
    // 工作室报的是「用户跳到淘宝后没有自动创建订单」⇒ 得跳淘宝那边的
    // 「确认订单」那一步,商品 / 件数 / 规格都替买家选好。
    expect(src).toContain("buildTaobaoCheckoutUrl(");
    expect(src).toContain("itemId: link.itemId");
    expect(src).toContain("skuMap: link.skuMap");
    expect(src).toContain("directOrder: link.directOrder");
  });

  it("拼不出来 ⇒ **永远退回商品页**(淘宝那个下单页没公开文档)", () => {
    // 内部 H5 接口,形状变了 / 后台关了开关 ⇒ 不许把这条路走死
    expect(src).toContain("checkout.fallback");
    expect(src).toMatch(/console\.warn\(/);
  });

  it("没有平台单号 —— 淘宝那边的单号是工作室从商家后台**抄**进来的", () => {
    expect(src).toContain("providerOrderId: null");
  });

  it("**不实现 `refund`** —— 退钱在淘宝那边退(工作室在淘宝后台操作)", () => {
    expect(src).not.toMatch(/\brefund\s*[:(]/);
  });

  it("「配好了」= 后台至少配了一条淘宝链接", () => {
    expect(src).toMatch(/countActiveTaobaoLinks\(\)\) > 0/);
  });

  it("读失败当「没配好」 —— 不让这个通道把清单接口带崩", () => {
    expect(src).toMatch(/catch \(error\)/);
    expect(src).toMatch(/return false;/);
  });

  it("这件设计没配链接 ⇒ PaymentNotConfiguredError(重试没用,得去后台配)", () => {
    expect(src).toContain("PaymentNotConfiguredError");
  });

  it("多件设计 ⇒ PaymentProviderError(不是配置问题)", () => {
    expect(src).toContain("PaymentProviderError");
    expect(src).toContain("MULTIPLE_DESIGNS");
  });

  it("一个网络请求都没有 —— 这个通道不碰任何接口", () => {
    expect(src).not.toContain("fetch(");
  });
});

describe("结算页 —— 「淘宝下单」那个按钮", () => {
  const src = stripComments(read(PANEL));

  it("摆的是淘宝的提交按钮文案,不是普通的那个", () => {
    expect(src).toContain("taobaoSubmit");
  });

  it("摆一条**明说金额可能不一样**的告知", () => {
    // 「逐分相等」在这一条路上按构造不成立 ⇒ 界面必须说出来
    expect(src).toContain("taobaoNotice");
  });
});
