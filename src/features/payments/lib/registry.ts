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
 *
 * ## 「配好了」和「开放了」是两件事
 *
 * - **配好了**(`isConfigured()`)—— 环境变量齐了,技术上收得到钱
 * - **开放了**(`ENABLED_PAYMENT_CHANNELS`)—— 工作室说现在让用户用这个
 *
 * 微信 / 支付宝的代码都写好了,但商户号 / 应用还没走完开通流程 —— 那种
 * 情况下「配好了」是 false,用户看不到。但还有一种情况是**配好了也没开放**
 * (比如先只开 Shopify 收一段),那就是这份名单说了算。
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
 * 现在**开放**的通道
 *
 * 2026-11-05:先只开 Shopify —— 微信 / 支付宝的代码都在,但还没到能用的时候。
 * 先不让用户点一个注定失败的入口。
 *
 * 以后要开微信 / 支付宝,把 id 加进来就行 —— 剩下的(清单接口、结算默认
 * 通道、打印工单)全都跟着这份名单走。
 */
export const ENABLED_PAYMENT_CHANNELS: readonly OnlinePaymentChannel[] = [
  "shopify",
];

/**
 * 这个通道现在开放吗
 *
 * 「开放了」跟「配好了」是两道闸 —— 两道都过才给用户看。
 */
export function isPaymentChannelEnabled(
  channel: string | null | undefined
): boolean {
  if (!channel) return false;
  return ENABLED_PAYMENT_CHANNELS.includes(channel as OnlinePaymentChannel);
}

/**
 * 取一个通道的实现
 *
 * 没有实现的通道(比如过渡期的 `stripe`)返回 null —— 调用方自己决定
 * 「不支持这个通道」该怎么办。
 *
 * **不受「开放名单」限制** —— 「重新获取付款入口」那条路要能救回任何一张
 * 已经建好的单(哪怕那单走的是现在关掉的通道)。
 */
export function getPaymentProvider(
  channel: OnlinePaymentChannel
): PaymentProvider | null {
  return PROVIDERS[channel] ?? null;
}

/** 三个通道的界面信息(顺序 = 展示顺序) */
const ALL_CHANNELS: PaymentChannelInfo[] = [
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

/**
 * 列出**开放了**的通道,给界面选
 *
 * `available` 为 false 的通道前端不显示 —— 但这里还是返回了,是为了让
 * 前端能区分「不支持这个通道」和「通道挂了」。
 */
export function listPaymentChannels(): PaymentChannelInfo[] {
  return ALL_CHANNELS.filter((channel) =>
    isPaymentChannelEnabled(channel.channel)
  );
}

/** 配好了、能用的通道 */
export function listAvailablePaymentChannels(): PaymentChannelInfo[] {
  return listPaymentChannels().filter((channel) => channel.available);
}
