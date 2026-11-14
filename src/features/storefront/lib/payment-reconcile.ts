/**
 * 商城订单的**主动查单对账**
 *
 * ## 为什么要有它
 *
 * 收钱以**支付宝主动推过来的异步通知**为准。通知会丢:
 *
 * - `notify_url` 配错 / 指向本地地址 / 域名换过 → 支付宝推不到
 * - 通知验签失败(支付宝公钥贴错 / 不是同一个沙箱应用)→ 回 401,支付宝
 *   重投 8 次之后放弃
 * - `app_id` 对不上 → 代码回 `success`(认不出来的单号不算错误)⇒ 支付宝
 *   **不再重投**
 *
 * ⇒ 结果都是**钱到了、订单永远是 `unpaid`**。用户盯着「正在确认支付…」转圈
 * 到超时,工作室那边看到的是一张没付的单。
 *
 * ⇒ 补一条**我们自己查**的路:拿订单号去问支付宝「这单到底付了没」。
 *
 * ## 什么时候会查
 *
 * - 用户从支付宝**回跳**到成功页(第一件事就是查一次)
 * - 轮询订单状态时(**节流**后)
 * - 点「重新获取付款入口」时(先查,免得给一个已经付过的单再开一个入口)
 *
 * ## 什么时候**不**查
 *
 * - 订单已经 `paid` —— 不用查,也不该被改回去
 * - 订单已经 `refunded` —— **绝不**改回去(迟到的通知同理)
 * - 通道不是 `alipay` —— 微信那边还没实现查单(微信 Native 的「查单」是另一
 *   个接口,不在这次范围里)
 */

import type { StorefrontOrderItemRow, StorefrontOrderRow } from "@/db/schema";
import { computeTotalCents } from "@/features/payments/lib/total";
import { reconcileAlipayPayment } from "@/features/payments/providers/alipay/reconcile";
import type { AlipayReconcileCode } from "@/features/payments/providers/alipay/reconcile-rules";

import { buildStorefrontPaymentRequest } from "./payment-request";

/** 一次对账的结果 */
export interface StorefrontReconcileOutcome {
  /** 支付宝说这笔已经付成功了(验签 + 金额都对得上) */
  paid: boolean;
  /** 有没有真的落库 */
  settled: boolean;
  /** 原因码 */
  code: AlipayReconcileCode | "skipped";
  /** 人话 */
  message: string;
}

/**
 * 主动查一次支付宝,该付就落库
 *
 * @param order 订单行
 * @param items 订单行 —— 用来重算总额(核对「支付宝记的实付」)
 */
export async function reconcileStorefrontOrderPayment(params: {
  order: StorefrontOrderRow;
  items: StorefrontOrderItemRow[];
}): Promise<StorefrontReconcileOutcome> {
  const { order, items } = params;

  // ---- 已经付过 / 退过款 —— 不碰 ----
  if (order.paymentStatus === "paid" || order.status === "fulfilled") {
    return {
      paid: true,
      settled: false,
      code: "already_paid",
      message: "这笔订单已经是已付款",
    };
  }
  if (order.paymentStatus === "refunded") {
    return {
      paid: false,
      settled: false,
      code: "skipped",
      message: "这笔订单已经退过款 —— 不再查单",
    };
  }

  // ---- 只有支付宝这条腿现在能查 ----
  if (order.paymentChannel !== "alipay") {
    return {
      paid: false,
      settled: false,
      code: "skipped",
      message: "这个通道暂时不支持主动查单",
    };
  }

  // ---- 应付金额 ----
  //
  // 真理源是**订单上存下来的** `total_cents` —— 那是用户下单时同意的数。
  // 同时用共享的那份 `PaymentRequest` 重算一遍作对照 —— 两个数不一致说明
  // 「逐分相等」破了,得记一条日志(但**不**因此改订单)。
  const expectedAmountCents = order.totalCents;
  try {
    const recomputed = computeTotalCents(
      buildStorefrontPaymentRequest(order, items)
    );
    if (recomputed !== expectedAmountCents) {
      console.error(
        `[storefront] ${order.orderNo} 的订单合计跟重新算出来的不一致:` +
          `订单上 ${expectedAmountCents} 分,重算 ${recomputed} 分`
      );
    }
  } catch (error) {
    console.error(
      `[storefront] ${order.orderNo} 重算应付金额失败(用订单上存的那个)`,
      error
    );
  }

  const outcome = await reconcileAlipayPayment({
    orderNo: order.orderNo,
    expectedAmountCents,
    alreadyPaid: false,
  });

  return {
    paid: outcome.paid,
    settled: outcome.settled,
    code: outcome.code,
    message: outcome.message,
  };
}
