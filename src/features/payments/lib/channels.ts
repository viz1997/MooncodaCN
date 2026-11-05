/**
 * 「开放了哪些通道」—— 纯常量 + 纯判断
 *
 * ## 为什么单独一个文件
 *
 * `registry.ts` 里还有各个通道的实现(`wechatPayProvider` 之类),而那些
 * provider 会一路拖到 `@/db`(收 webhook 要落库)—— 在没有 `DATABASE_URL`
 * 的环境里 import `registry.ts` 直接就炸(而且会拖着一堆 provider 的模块
 * 副作用一起跑)。
 *
 * 这份名单本身是**零依赖**的(只用到 `types.ts` 里的类型),所以单独放在
 * 这儿,能进 `unit` project 跑单测 —— 见
 * `src/test/payments/pure/payment-channels.test.ts`。
 *
 * ## 「开放了」管的是**摆不摆出来**
 *
 * 摆出来 ≠ 能付 —— 能付看「配好了没」(`provider.isConfigured()`,在
 * `registry.ts` 里)。两道闸各管一件事,详见 `registry.ts` 的文件头。
 */

import type { OnlinePaymentChannel, PaymentChannelMeta } from "./types";

/**
 * 现在**开放**的通道
 *
 * 2026-11-05:三个都开放(微信 / 支付宝 / Shopify)—— 工作室要在界面上把三种
 * 付款方式都摆出来。
 *
 * 「开放了」只是**摆出来**;能不能真付由「配好了」(`isConfigured()`)决定 ——
 * 没配好的那个在界面上是灰的、标着「暂未开放」、选不了,点了只会 503。
 *
 * 以后要关掉哪一个,把 id 从这份名单里拿掉就行 —— 剩下的(清单接口、结算默认
 * 通道、打印工单)全都跟着这份名单走。
 */
export const ENABLED_PAYMENT_CHANNELS: readonly OnlinePaymentChannel[] = [
  "wechat",
  "alipay",
  "shopify",
];

/**
 * 这个通道现在开放吗
 *
 * 「开放了」跟「配好了」是两道闸 —— 「开放了」管它**摆不摆出来**,
 * 「配好了」管它**能不能真付**。
 */
export function isPaymentChannelEnabled(
  channel: string | null | undefined
): boolean {
  if (!channel) return false;
  return ENABLED_PAYMENT_CHANNELS.includes(channel as OnlinePaymentChannel);
}

/**
 * 三个通道的静态信息(顺序 = 界面上的展示顺序)
 *
 * 「配好了没」不在这里 —— 那个要问 provider(要读环境变量),在
 * `registry.ts` 里现算。
 */
export const ALL_CHANNELS: readonly PaymentChannelMeta[] = [
  {
    channel: "wechat",
    label: "微信支付",
    description: "扫码支付,钱直接进我们的商户号",
  },
  {
    channel: "alipay",
    label: "支付宝",
    description: "跳转到支付宝付款",
  },
  {
    channel: "shopify",
    label: "银行卡 / Shop Pay",
    description: "跳转到 Shopify 收银台刷卡",
  },
];
