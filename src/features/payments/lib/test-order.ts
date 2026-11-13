/**
 * 沙箱自检单 —— 一笔 **¥0.01** 的单子(2026-11-13)
 *
 * ## 为什么单独一个文件
 *
 * 「跑一笔 1 分钱的测试单」有两处会做:
 *
 * - 后台那一页那颗按钮(`/admin/payment-settings`)
 * - 命令行自检(`scripts/payment-sandbox-check.ts`)
 *
 * 两处**必须建出同一笔单子** —— 订单号规则、金额、币种、备注全一样。
 * 各写一份的话,后台能跑通而命令行跑不通(或者反过来),排查时根本分不清
 * 是「凭据不对」还是「这两笔单子压根不是一回事」。
 *
 * ⇒ 订单号 + 请求体**只有这一份实现**,两处都 import 它。
 *
 * ## 这一笔**不落本地订单**
 *
 * 只在平台上建一个 1 分钱的单子,验的是「凭据对不对 / 端点对不对 / 签名对不对」。
 * 本地**不写** `storefront_order` —— 写进去就是一张永远不发货的僵尸单。
 *
 * ## 订单号的规则
 *
 * 微信的 `out_trade_no`:**6~32 个字符**,只能是数字 / 字母 / 下划线 /
 * 连字符 / 点。`SBX` + base36 时间戳 + 4 位随机 ⇒ 15 个字符,合法且几乎
 * 不会撞(同一个单号再建一次微信会回 `ORDERPAID`)。
 */

import { PRICE_CURRENCY } from "@/config/currency";

import type { PaymentRequest } from "./types";

/**
 * 自检单的订单号
 *
 * `SBX` + base36 时间戳 + 4 位随机 ⇒ 15 个字符,微信的规则里合法。
 */
export function buildTestOrderNo(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SBX${stamp}${rand}`;
}

/**
 * 造一笔 **1 分钱** 的自检单
 *
 * @param siteUrl 站点地址 —— 留空就退回通道自己的默认回跳地址
 * @param note 备注 —— 写清楚是哪儿跑的那笔,工作室在平台后台能认出来
 */
export function buildTestPaymentRequest(options: {
  siteUrl: string | null;
  title?: string;
  note?: string;
  successPath?: string;
}): PaymentRequest {
  const successPath = options.successPath ?? "/checkout/success";
  return {
    orderNo: buildTestOrderNo(),
    email: "sandbox@example.com",
    items: [
      {
        title: options.title ?? "沙箱测试单",
        quantity: 1,
        unitPriceCents: 1,
      },
    ],
    shippingCents: 0,
    shippingAddress: null,
    note: options.note ?? "支付设置的沙箱自检单",
    successUrl: options.siteUrl ? `${options.siteUrl}${successPath}` : "",
    currency: PRICE_CURRENCY,
  };
}
