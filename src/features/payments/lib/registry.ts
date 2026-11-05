/**
 * 支付通道注册表
 *
 * ## 三个通道,三个角色
 *
 * | 通道 | 谁收钱 | 钱去哪 |
 * |---|---|---|
 * | `wechat` | 微信支付 Native(我们自己的商户号) | 直接进我们的商户号 |
 * | `alipay` | 支付宝电脑网站支付(我们自己的应用) | 直接进我们的账户 |
 * | `shopify` | Shopify 收银台 | 进 Shopify 店铺的结算账户 |
 *
 * **微信 / 支付宝为什么自己接**:钱直接进我们自己的账户,没有中间层抽成,
 * 而且定价完全由我们说了算(「本仓库算价」这条架构的前提)。
 *
 * **Shopify 为什么只做卡**:Shopify 的收银台认不了我们算出来的价(普通购物车
 * 没有价格字段、改价要 Plus 套餐),只有草稿订单能 —— 细节见
 * `@/features/payments/providers/shopify/env.ts`。
 *
 * ## 过渡期:旧的 Sellbase / Stripe 那条路还在
 *
 * `stripe` **不在这个注册表里** —— 它不是「通道」,是一条单独的旧链路
 * (Sellbase 建单 + Stripe 付款页),代码还住在 `src/features/sellbase/`。
 * 结算接口里走的是一条显式的旧分支,见
 * `src/features/storefront/lib/checkout.ts`。
 *
 * 跑通新的三个通道之后,那条分支连同整个 `src/features/sellbase/` 一起拆掉,
 * 届时 `stripe` 从 `PaymentChannel` 枚举里删掉。
 *
 * ## 「配好了才显示」
 *
 * `isConfigured()` 返回 false 的通道**不出现在「选择支付方式」里** ——
 * 让用户点一个注定失败的按钮,比不给这个选项更糟。
 */

import { alipayPayProvider } from "@/features/payments/providers/alipay";
import { shopifyPaymentProvider } from "@/features/payments/providers/shopify";
import { wechatPayProvider } from "@/features/payments/providers/wechat";

import type {
  OnlinePaymentChannel,
  PaymentChannelInfo,
  PaymentProvider,
} from "./types";

/** 通道注册表 —— key 是通道 id */
const PROVIDERS: Partial<Record<OnlinePaymentChannel, PaymentProvider>> = {
  wechat: wechatPayProvider,
  alipay: alipayPayProvider,
  shopify: shopifyPaymentProvider,
};

/**
 * 取一个通道的实现
 *
 * 没有实现的通道(比如过渡期的 `stripe`)返回 null —— 调用方自己决定
 * 「不支持这个通道」该怎么办。
 */
export function getPaymentProvider(
  channel: OnlinePaymentChannel
): PaymentProvider | null {
  return PROVIDERS[channel] ?? null;
}

/**
 * 列出所有通道,给界面选
 *
 * `available` 为 false 的通道前端不显示 —— 但这里还是返回了,是为了让
 * 前端能区分「不支持这个通道」和「通道挂了」。
 */
export function listPaymentChannels(): PaymentChannelInfo[] {
  return [
    {
      channel: "wechat",
      label: "微信支付",
      description: "扫码支付,钱直接进我们的商户号",
      available: wechatPayProvider.isConfigured(),
    },
    {
      channel: "alipay",
      label: "支付宝",
      description: "跳转到支付宝付款",
      available: alipayPayProvider.isConfigured(),
    },
    {
      channel: "shopify",
      label: "银行卡 / Shop Pay",
      description: "跳转到 Shopify 收银台刷卡",
      available: shopifyPaymentProvider.isConfigured(),
    },
  ];
}

/** 配好了、能用的通道 */
export function listAvailablePaymentChannels(): PaymentChannelInfo[] {
  return listPaymentChannels().filter((channel) => channel.available);
}
