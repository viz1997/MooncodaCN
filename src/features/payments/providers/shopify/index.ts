/**
 * Shopify 支付通道
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

  isConfigured: isShopifyConfigured,

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
