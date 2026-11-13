/**
 * 支付通道注册表
 *
 * ## 现在开放的两个通道
 *
 * | 通道 | 谁收钱 | 钱去哪 |
 * |---|---|---|
 * | `wechat` | 微信支付 Native(我们自己的商户号) | 直接进我们的商户号 |
 * | `alipay` | 支付宝电脑网站支付(我们自己的应用) | 直接进我们的账户 |
 *
 * **为什么自己接**:钱直接进我们自己的账户,没有中间层抽成,而且定价完全
 * 由我们说了算(「本仓库算价」这条架构的前提)。两个通道都是**境内商户**,
 * 收人民币是它们的原生场景 —— 不需要跨境资质,也没有汇率。
 *
 * ## Shopify 已经下线(2026-11-05)
 *
 * 工作室决定只用微信 + 支付宝。Shopify 的 provider **代码还留在树里**
 * (`src/features/payments/providers/shopify/`),但:
 *
 * - 它**不在** `ENABLED_PAYMENT_CHANNELS` 里 → 界面上不摆出来、清单接口
 *   不返回、结算不接新单
 * - 它**仍然注册在下面的 `PROVIDERS` 里** → 「重新获取付款入口」那条路
 *   还能拿到它,老订单点进去会得到一句明确的报错(「本订单的币种是 USD,
 *   但这条通道的价一律是 CNY」—— 那条 Shopify 单是美元时代的单),而不是
 *   一个看不懂的 404
 *
 * 跟旧路 Sellbase / Stripe 一个待遇 —— 等确认没有待付的老单了,整个目录
 * 一起拆掉。
 *
 * ## 过渡期:旧的 Sellbase / Stripe 那条路还在
 *
 * `stripe` **不在这个注册表里** —— 它不是「通道」,是一条单独的旧链路
 * (Sellbase 建单 + Stripe 付款页),代码还住在 `src/features/sellbase/`。
 * 结算接口里走的是一条显式的旧分支,见
 * `src/features/storefront/lib/checkout.ts`。
 *
 * 跑通新的两个通道之后,那条分支连同整个 `src/features/sellbase/` 一起拆掉,
 * 届时 `stripe` 从 `PaymentChannel` 枚举里删掉。
 *
 * ## 「配好了才让选」
 *
 * `isConfigured()` 返回 false 的通道**界面上看得到,但选不了** —— 显示成
 * 灰的、标着「暂未开放」。让用户点一个注定失败的按钮比不给这个选项更糟,
 * 但把整个选项藏起来也不行:工作室要让人看见「我们支持这两种付款方式」。
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
import { getPaymentChannelRuntime } from "./sandbox-store";
import type {
  OnlinePaymentChannel,
  PaymentChannelInfo,
  PaymentProvider,
} from "./types";

/** 通道注册表 —— key 是通道 id */
const PROVIDERS: Partial<Record<OnlinePaymentChannel, PaymentProvider>> = {
  wechat: wechatPayProvider,
  alipay: alipayPayProvider,
  // Shopify 已下线(2026-11-05)—— 界面上不摆出来了,但**仍然注册**:
  // 「重新获取付款入口」要能对老订单说清楚「这条路走不通、为什么」,
  // 而不是返回一个看不懂的「通道不存在」。
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

/** 通道的静态信息在 `channels.ts` —— 这里只补上「配好了没」 */
async function isChannelConfigured(
  channel: OnlinePaymentChannel
): Promise<boolean> {
  const provider = PROVIDERS[channel];
  if (!provider) return false;
  try {
    return await provider.isConfigured();
  } catch {
    // 「配好了没」本身不该抛 —— provider 那一层已经把异常吞成 false 了。
    // 这里再兜一层:万一哪个 provider 忘了兜住,也不能让整个清单接口 500。
    return false;
  }
}

/**
 * 这个通道现在跑在**沙箱**还是**正式**
 *
 * 只有微信 / 支付宝有沙箱(Shopify / 旧路没有)⇒ 别的通道恒为 `false`。
 *
 * **认不出来一律当「正式」** —— 模式不明的时候通道本身是禁用的
 * (`modeInvalid`),`sandbox` 这个标志压根不会被界面用上;而「认不出来却
 * 摆一个沙箱徽章」会误导人。
 */
async function isChannelInSandbox(
  channel: OnlinePaymentChannel
): Promise<boolean> {
  if (channel !== "wechat" && channel !== "alipay") return false;
  const runtime = await getPaymentChannelRuntime(channel);
  if (runtime.modeInvalid) return false;
  return runtime.mode === "sandbox";
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
 * `POST /api/store/checkout 503` —— **看不出为什么**。查下去是 Shopify 换
 * 了凭据模型(2026-01-01 起给的是 Client ID / Client Secret,不再给永久
 * token),而代码只认旧的 `SHOPIFY_ADMIN_ACCESS_TOKEN`,于是「配了但用不上」。
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
 * 跑在**沙箱**模式的通道 → 记一条横幅
 *
 * ## 为什么要有这条
 *
 * 沙箱开关在后台 `/admin/payment-settings` 上,不在环境变量里 ⇒ **部署的
 * 那一刻看不出来**。上线忘了关沙箱开关 = **真客户的钱付到沙箱里**。
 *
 * 这条横幅让服务端**说话** —— 一个进程只打一次,别把日志刷爆。
 * 确切端点由 provider 自己打(`providers/<通道>/config.ts`),两边合起来能直接
 * 看出「现在打到哪儿去了」。
 */
function warnSandboxChannels(channels: PaymentChannelInfo[]): void {
  for (const channel of channels) {
    if (!channel.sandbox) continue;
    const key = `sandbox:${channel.channel}`;
    if (warnedChannels.has(key)) continue;
    warnedChannels.add(key);

    console.warn(
      `[payments] ⚠ 通道 ${channel.channel} 现在跑在**沙箱**模式 —— ` +
        `沙箱单不会真的扣钱,但**真单也会进沙箱**(钱收不到)。` +
        `上线前请到后台「支付设置」把沙箱开关关掉。`
    );
  }
}

/**
 * 列出**开放了**的通道,给界面选
 *
 * `available` 为 false 的通道**也返回** —— 前端把它显示成灰的、标「暂未
 * 开放」,而不是藏起来:工作室要让人看见支持哪几种付款方式,但没配好的
 * 那几个不能点(点了只会 503)。
 *
 * **为什么是 `Promise`** —— 沙箱模式的凭据在数据库里(后台
 * `/admin/payment-settings` 配的)⇒ 「配好了没」和「跑在沙箱还是正式」
 * 都得读库 ⇒ 天然是异步的。
 */
export async function listPaymentChannels(): Promise<PaymentChannelInfo[]> {
  const enabled = ALL_CHANNELS.filter((channel) =>
    isPaymentChannelEnabled(channel.channel)
  );

  const channels = await Promise.all(
    enabled.map(async (channel) => ({
      ...channel,
      available: await isChannelConfigured(channel.channel),
      sandbox: await isChannelInSandbox(channel.channel),
    }))
  );

  warnUnconfiguredChannels(channels);
  warnSandboxChannels(channels);

  return channels;
}

/** 配好了、能用的通道 */
export async function listAvailablePaymentChannels(): Promise<
  PaymentChannelInfo[]
> {
  const channels = await listPaymentChannels();
  return channels.filter((channel) => channel.available);
}
