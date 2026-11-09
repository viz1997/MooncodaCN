/**
 * 微信支付通道 —— Native(扫码)
 *
 * 实现 `PaymentProvider` 契约(见 `payments/lib/types.ts`)。工作室在「选择
 * 支付方式」那一步拿到这个对象,决定要不要显示「微信支付」这个选项,以及
 * 用户点了之后给他一个什么样的付款会话。
 *
 * ## 付款会话长什么样
 *
 * 微信 Native **要调接口**才能建会话 —— 下单接口返回 `code_url`,前端拿它
 * 渲染二维码。所以 `createSession()` 里**有**网络请求,也就有「这次调用挂
 * 了」这种失败:
 *
 * - 缺环境变量 → `PaymentNotConfiguredError`(重试没用,得先配)
 * - 微信返回错误 / 网络挂了 → `PaymentProviderError`(重试有意义)
 *
 * 跟支付宝那条通道正好相反 —— 支付宝拼个跳转地址就完事,没有网络请求。
 *
 * `redirectUrl` 是 `null`:微信不跳页面,给的是二维码。
 * `providerOrderId` 就是我们的订单号(`out_trade_no`)—— 微信侧用我们的
 * 订单号当商户订单号,所以下单时就知道了,不用等回调。
 *
 * ## 收款确认靠回调,不是靠前端轮询
 *
 * 用户扫码付完钱,微信往 `notify_url` 推一条通知(`webhook.ts`)。前端
 * 「我付好了吗」的轮询只是给用户看的,钱到没到以回调为准。
 */

import { computeTotalCents } from "@/features/payments/lib/total";
import {
  PaymentNotConfiguredError,
  type PaymentProvider,
  PaymentProviderError,
  type PaymentRequest,
  type PaymentSession,
} from "@/features/payments/lib/types";

import { getWechatPayConfig, isWechatPayConfigured } from "./env";
import { buildDescription, createNativeOrderWithConfig } from "./native";

/**
 * 算应付总额(分)
 *
 * **实现在 `payments/lib/total.ts`** —— 微信和支付宝共用同一份。
 *
 * ```
 * total = Σ(折后单价 × 数量) + 运费 − 订单级优惠
 *        = storefront_order.total_cents   ✅ 逐分相等
 * ```
 *
 * 这里只是**转出去**,免得别处 import 微信这一支的时候绕路。
 */
export { computeTotalCents };

/**
 * 拼商品描述
 *
 * 微信的付款页上就显示这一行 —— 也就是「买了什么」。多行用「、」连起来,
 * 微信限制 127 字符(见 `native.ts` 的 `buildDescription`)。
 */
export function buildOrderDescription(request: PaymentRequest): string {
  const titles = request.items
    .map((item) => item.title.trim())
    .filter((title) => title.length > 0);
  const base = titles.length > 0 ? titles.join("、") : "订单付款";
  return buildDescription(base);
}

/**
 * 微信支付通道
 *
 * `isConfigured()` 决定界面显不显示这个选项 —— 让用户点一个注定失败的
 * 按钮,比不给他这个选项更糟。
 */
export const wechatPayProvider: PaymentProvider = {
  channel: "wechat",

  isConfigured: isWechatPayConfigured,

  async createSession(request: PaymentRequest): Promise<PaymentSession> {
    // 没配好 → PaymentNotConfiguredError(重试没用,得先配环境变量)
    const config = getWechatPayConfig();

    try {
      const { codeUrl } = await createNativeOrderWithConfig(config, {
        outTradeNo: request.orderNo,
        description: buildOrderDescription(request),
        totalCents: computeTotalCents(request),
      });

      return {
        channel: "wechat",
        // 微信的商户订单号就是我们的订单号 —— 下单时就知道了
        providerOrderId: request.orderNo,
        // 微信 Native 不跳页面,给二维码
        redirectUrl: null,
        qrCodeUrl: codeUrl,
        expiresAt: null,
      };
    } catch (error) {
      // 配置错误原样抛 —— 它跟「这次调用挂了」是两件事
      if (error instanceof PaymentNotConfiguredError) throw error;
      throw new PaymentProviderError(
        "wechat",
        error instanceof Error ? error.message : "微信下单失败",
        { cause: error }
      );
    }
  },
};

export default wechatPayProvider;

export type { WechatPayConfig } from "./env";
export {
  getWechatPayConfig,
  isWechatPayConfigured,
  resolveVerifyPublicKey,
  WECHAT_PAY_API_BASE,
  WECHAT_PAY_NOTIFY_PATH,
} from "./env";
export {
  buildDescription,
  createNativeOrder,
  createNativeOrderWithConfig,
  WECHAT_NATIVE_PATH,
  type WechatNativeOrderParams,
  type WechatNativeOrderResult,
} from "./native";
export {
  buildAuthorizationHeader,
  buildNotifyVerifyMessage,
  buildSignMessage,
  decryptResource,
  isTimestampWithinTolerance,
  normalizePemKey,
  signWithPrivateKey,
  verifyNotifySignature,
  verifyWithPublicKey,
  WECHAT_GCM_AUTH_TAG_LENGTH,
  WECHAT_NOTIFY_TIMESTAMP_TOLERANCE_SECONDS,
  WECHAT_SIGN_TYPE,
  type WechatEncryptedResource,
} from "./signature";
export {
  decryptTransaction,
  handleWechatNotify,
  parseNotifyPayload,
  readNotifyHeaders,
  WECHAT_NOTIFY_SUCCESS,
  type WechatNotifyHeaders,
  type WechatNotifyOutcome,
  type WechatNotifyPayload,
  type WechatTransaction,
  wechatNotifyFailure,
} from "./webhook";
