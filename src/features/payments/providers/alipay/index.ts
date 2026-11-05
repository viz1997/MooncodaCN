/**
 * 支付宝通道 —— 电脑网站支付
 *
 * 实现 `PaymentProvider` 契约(见 `payments/lib/types.ts`)。工作室在「选择
 * 支付方式」那一步拿到这个对象,决定要不要显示「支付宝」这个选项,以及
 * 用户点了之后给他一个什么样的付款会话。
 *
 * ## 付款会话长什么样
 *
 * 支付宝这一路**不需要调接口**就能建会话 —— 拼一个带签名的网关地址就完事,
 * 浏览器整页跳过去。所以 `createSession()` 里没有网络请求,也就没有「这次
 * 调用挂了」这种失败 —— 唯一的失败是「通道压根没配好」。
 *
 * `providerOrderId` 是 `null`:支付宝的 `trade_no` 要等异步通知里才有。
 *
 * ## 收款确认靠回调,不是靠回跳
 *
 * 用户付完跳回 `return_url` 只说明「用户回来了」。收钱以支付宝的异步通知
 * 为准(`webhook.ts`),同步回跳之后要确认状态就查单(`query.ts`)。
 */

import {
  PaymentNotConfiguredError,
  type PaymentProvider,
  PaymentProviderError,
  type PaymentRequest,
  type PaymentSession,
} from "@/features/payments/lib/types";

import { getAlipayConfig, isAlipayConfigured } from "./env";
import { buildPagePayRedirectUrl } from "./page-pay";

/**
 * 支付宝通道
 *
 * `isConfigured()` 决定界面显不显示这个选项 —— 让用户点一个注定失败的按钮,
 * 比不给他这个选项更糟。
 */
export const alipayPayProvider: PaymentProvider = {
  channel: "alipay",

  isConfigured: isAlipayConfigured,

  async createSession(request: PaymentRequest): Promise<PaymentSession> {
    // 没配好 → PaymentNotConfiguredError(重试没用,得先配环境变量)
    const config = getAlipayConfig();

    try {
      const redirectUrl = buildPagePayRedirectUrl(config, request);
      return {
        channel: "alipay",
        // 支付宝的 trade_no 要等异步通知里才有
        providerOrderId: null,
        redirectUrl,
        qrCodeUrl: null,
        expiresAt: null,
      };
    } catch (error) {
      if (error instanceof PaymentNotConfiguredError) throw error;
      throw new PaymentProviderError("alipay", "拼支付宝跳转地址失败", {
        cause: error,
      });
    }
  },
};

export default alipayPayProvider;

export type { AlipayConfig } from "./env";
export { getAlipayConfig, isAlipayConfigured } from "./env";
export { buildBizContent, buildPagePayRedirectUrl } from "./page-pay";
export type { AlipayTradeQueryResult } from "./query";
export { queryTradeByOrderNo } from "./query";
