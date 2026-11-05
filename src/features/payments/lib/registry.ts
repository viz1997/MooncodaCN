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
 * ## 「配好了才让选」
 *
 * `isConfigured()` 返回 false 的通道**界面上看得到,但选不了** —— 显示成
 * 灰的、标着「暂未开放」。让用户点一个注定失败的按钮比不给这个选项更糟,
 * 但把整个选项藏起来也不行:工作室要让人看见「我们支持这三种付款方式」。
 *
 * ## 「配好了」和「开放了」是两件事
 *
 * - **配好了**(`isConfigured()`)—— 环境变量齐了,技术上收得到钱
 * - **开放了**(`ENABLED_PAYMENT_CHANNELS`)—— 工作室说现在让用户用这个
 *
 * 微信 / 支付宝的代码都写好了,但商户号 / 应用还没走完开通流程 —— 那种
 * 情况下「配好了」是 false,用户看得见但选不了。
 */

import { alipayPayProvider } from "@/features/payments/providers/alipay";
import { shopifyPaymentProvider } from "@/features/payments/providers/shopify";
import { wechatPayProvider } from "@/features/payments/providers/wechat";

import { ALL_CHANNELS, isPaymentChannelEnabled } from "./channels";
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
 * 「开放了哪些通道」住在 `channels.ts`(纯文件,零依赖)
 *
 * 这里转出去一份 —— 别的地方 import `registry` 还是照旧能用;但要跑单测的
 * 地方 import `channels` 就不会把三个 provider 跟 `@/db` 一起拖进来。
 */
export { ENABLED_PAYMENT_CHANNELS, isPaymentChannelEnabled } from "./channels";

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

/** 三个通道的静态信息在 `channels.ts` —— 这里只补上「配好了没」 */
function isChannelConfigured(channel: OnlinePaymentChannel): boolean {
  return PROVIDERS[channel]?.isConfigured() ?? false;
}

/**
 * 每个通道的环境变量说明在哪儿
 *
 * 「配好了没」出问题时照着这个路径看就行 —— 变量名和去哪儿取都写在那个
 * 文件的头里。
 */
const ENV_DOCS: Record<OnlinePaymentChannel, string> = {
  wechat: "src/features/payments/providers/wechat/env.ts",
  alipay: "src/features/payments/providers/alipay/env.ts",
  shopify: "src/features/payments/providers/shopify/env.ts",
  // 旧路(Sellbase + Stripe)不在清单里 —— 但类型上它也算一个线上通道,
  // 万一以后有人把它加回 `ALL_CHANNELS`,日志也得指得对地方
  stripe: "architecture-sellbase-integration.md",
};

/** 已经提醒过的通道 —— 一个进程只提醒一次,别把日志刷爆 */
const warnedChannels = new Set<string>();

/**
 * 「开放了但没配好」的通道 → 记一条日志
 *
 * ## 为什么要有这条
 *
 * 2026-11-05 线上踩过一次:结算接口 503,日志里只有一行
 * `POST /api/store/checkout 503` —— **看不出为什么**。查下去是 Shopify 的
 * `SHOPIFY_ADMIN_ACCESS_TOKEN` 没配(只有 `SHOPIFY_CLIENT_ID` /
 * `SHOPIFY_CLIENT_SECRET`,那是 Storefront API 的客户端凭据,不是 Admin
 * API 的 token)。
 *
 * 这种「配置没配好」在服务端是**静默**的:界面把没配好的通道藏起来,用户
 * 看到的只是「支付方式」那一栏不见了,或者结算直接 503。这条日志让它在
 * 服务端**说话**。
 */
function warnUnconfiguredChannels(channels: PaymentChannelInfo[]): void {
  for (const channel of channels) {
    if (channel.available) continue;
    if (warnedChannels.has(channel.channel)) continue;
    warnedChannels.add(channel.channel);

    console.warn(
      `[payments] 通道 ${channel.channel}「开放了」但**没配好** —— ` +
        `界面上这个入口是选不了的,结算也会 503(PAYMENT_CHANNEL_UNAVAILABLE)。` +
        `需要的变量见 ${ENV_DOCS[channel.channel]} 的文件头。`
    );
  }
}

/**
 * 列出**开放了**的通道,给界面选
 *
 * `available` 为 false 的通道**也返回** —— 前端把它显示成灰的、标「暂未
 * 开放」,而不是藏起来:工作室要让人看见支持哪几种付款方式,但没配好的
 * 那几个不能点(点了只会 503)。
 */
export function listPaymentChannels(): PaymentChannelInfo[] {
  const channels = ALL_CHANNELS.filter((channel) =>
    isPaymentChannelEnabled(channel.channel)
  ).map((channel) => ({
    ...channel,
    available: isChannelConfigured(channel.channel),
  }));

  warnUnconfiguredChannels(channels);

  return channels;
}

/** 配好了、能用的通道 */
export function listAvailablePaymentChannels(): PaymentChannelInfo[] {
  return listPaymentChannels().filter((channel) => channel.available);
}
