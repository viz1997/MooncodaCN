/**
 * 工单的「付款入口」能不能自己开一个 —— **纯函数**
 *
 * ## 这条规则管的是「收两次钱」
 *
 * 打印服务**直接建工单**(2026-11-08):工单是独立的一单
 * (`print_order.storefront_order_id` = null),钱由**工单自己**收 ——
 * 工单详情页给微信扫码 / 支付宝跳转的入口。
 *
 * 商城购物袋跟打印服务彻底分家了:车里只有目录商品,打印服务不进车。
 *
 * ## 但还留着「跟着商城订单结的账」那一种
 *
 * 2026-11-08 之前那一版(打印服务并进商城购物袋)建出来的工单**跟着商城
 * 订单**走 —— 钱由商城订单收,工单跟着标 paid。那些单子还在库里,用户还能
 * 点开它们的详情页。所以这一类工单**自己不再建支付会话**:不守这一条,
 * 用户在工单详情页点「去支付」,就会:
 *
 * ```
 * 工单详情页 → 付一次工单的价(¥55.81)
 * 回到商城订单 → 再付一次整车的价(¥55.81 + 别的)
 * ```
 *
 * **收两次钱。** 工作室那边看到两张已付的工单,用户那边多付了一份钱。
 *
 * ## 为什么单独抽一个纯函数
 *
 * 判断本身只有两行,但它是**收钱的规则** —— 改了它就可能多收一次钱。
 * 规则住在能进 unit project 的纯文件里,才有单测守得住:
 * `src/test/print-quote/pure/payment-entry.test.ts`。
 *
 * 真发请求的那一段在 `payment.ts`(它要碰 DB / 通道),不在这里。
 */

import type { PrintOrderPaymentStatus } from "./quote-types";

/**
 * 不给入口的两种原因
 *
 * - `ALREADY_PAID` —— 已经付过了,再给入口就是在引导重复付款
 * - `PAY_VIA_STOREFRONT` —— 跟着商城订单结的账(**旧单**),钱在**那张**订单上收
 */
export type PrintOrderPaymentEntryBlockCode =
  | "ALREADY_PAID"
  | "PAY_VIA_STOREFRONT";

/** 判断结果 */
export type PrintOrderPaymentEntryDecision =
  | { allowed: true }
  | { allowed: false; code: PrintOrderPaymentEntryBlockCode };

/**
 * 这一单能不能自己开一个付款入口
 *
 * @param input.paymentStatus —— 工单当前的收款状态
 * @param input.storefrontOrderId —— 关联的商城订单 id;null = 独立工单
 */
export function decidePrintOrderPaymentEntry(input: {
  paymentStatus: PrintOrderPaymentStatus;
  storefrontOrderId: string | null;
}): PrintOrderPaymentEntryDecision {
  // 已经付过了 —— 付完了还让人付一次是事故
  if (input.paymentStatus === "paid") {
    return { allowed: false, code: "ALREADY_PAID" };
  }

  // 跟着商城订单结的账 —— 钱由商城订单收,工单不建自己的支付会话
  if (input.storefrontOrderId) {
    return { allowed: false, code: "PAY_VIA_STOREFRONT" };
  }

  return { allowed: true };
}
