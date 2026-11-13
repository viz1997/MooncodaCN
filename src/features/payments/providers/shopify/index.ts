/**
 * Shopify 支付通道
 *
 * ## ⚠️ 这条路已经下线(2026-11-05)
 *
 * 工作室决定**只用微信 + 支付宝**(人民币结算,境内商户的原生场景)。
 * Shopify **不在 `ENABLED_PAYMENT_CHANNELS` 里** —— 界面上不摆出来、清单
 * 接口不返回、结算不接新单。
 *
 * **代码留着**,跟旧路 Sellbase / Stripe 一个待遇:「重新获取付款入口」那条
 * 路要能对已经建好的 Shopify 单说清楚「这条路走不通、为什么」,而不是一个
 * 看不懂的 404。确认没有待付的老单了,整个 `providers/shopify/` 一起拆掉。
 *
 * 下面的内容原样保留 —— 哪天又要开这条路了,直接把它加回
 * `ENABLED_PAYMENT_CHANNELS` 就行(**但要先确认 `currency.ts` 那套
 * 展示币种的前提还成立** —— 现在本仓库的价是人民币,店铺得能收人民币)。
 *
 * ## 定位
 *
 * **只当银行卡的收银台**。微信支付 / 支付宝是我们自己直连的(见
 * `@/features/payments/providers/wechat`、`.../alipay`),钱直接进我们自己的
 * 商户号,没有中间层抽成。
 *
 * Shopify 这条路负责「银行卡 / Shop Pay」,用户点完之后跳到 Shopify 的收银台
 * 页刷卡。
 *
 * ## 价格由我们给
 *
 * 草稿订单的行价是**我们算出来的价**,不是 Shopify 商品目录里的价 —— 见
 * `draft-order.ts` 的文件头(为什么不用普通购物车)。
 */

import {
  PaymentNotConfiguredError,
  type PaymentProvider,
  type PaymentRequest,
  type PaymentSession,
} from "@/features/payments/lib/types";

import { asNotConfigured } from "./client";
import { createShopifyDraftOrder } from "./draft-order";
import { isShopifyConfigured } from "./env";

/** Shopify 支付通道 */
export const shopifyPaymentProvider: PaymentProvider = {
  channel: "shopify",

  // Shopify 那条路没有沙箱 —— 凭据只从环境变量读,所以判断还是同步的。
  // 契约已经改成异步(`isConfigured(): Promise<boolean>`)⇒ 这里包一层。
  isConfigured: async () => isShopifyConfigured(),

  async createSession(request: PaymentRequest): Promise<PaymentSession> {
    try {
      const draft = await createShopifyDraftOrder(request);
      return {
        channel: "shopify",
        providerOrderId: draft.id,
        // 草稿单的收银台地址 —— 用户跳过去刷卡
        redirectUrl: draft.invoiceUrl,
        qrCodeUrl: null,
        expiresAt: null,
      };
    } catch (error) {
      // 「没配好」跟「这次挂了」要分得开:前者重试没用,后者重试就能好
      const notConfigured = asNotConfigured(error);
      if (notConfigured) {
        throw new PaymentNotConfiguredError("shopify", notConfigured.message);
      }
      throw error;
    }
  },
};
