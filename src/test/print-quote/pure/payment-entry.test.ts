/**
 * 工单的付款入口 —— 纯函数测试
 *
 * ## 守住什么
 *
 * **工单不许自己开一个付款入口**(当它跟着商城订单结的账时)。
 *
 * 打印服务并进商城购物袋之后(2026-11-08),打印服务行是购物袋里的一行,
 * 工单跟着商城订单建(`print_order.storefront_order_id`),钱由**商城订单**收。
 * 工单自己再开一个会话 = 用户在工单详情页付一次、回商城订单再付一次 ——
 * **收两次钱**。
 *
 * 这条规则住在纯文件里(`print-quote/lib/payment-entry.ts`),不碰 DB、不碰
 * 通道,跑在 unit project 里(`pnpm test:run --project=unit`)。
 */

import { describe, expect, it } from "vitest";

import { decidePrintOrderPaymentEntry } from "@/features/print-quote/lib/payment-entry";

describe("decidePrintOrderPaymentEntry", () => {
  it("独立工单(没挂商城订单)→ 可以自己开入口", () => {
    expect(
      decidePrintOrderPaymentEntry({
        paymentStatus: "unpaid",
        storefrontOrderId: null,
      })
    ).toEqual({ allowed: true });
  });

  it("跟着商城订单结的账 → 不给入口", () => {
    // 这是 2026-11-08 合并之后**唯一**的建单路径 —— 不守这条就收两次钱
    expect(
      decidePrintOrderPaymentEntry({
        paymentStatus: "unpaid",
        storefrontOrderId: "so_123",
      })
    ).toEqual({ allowed: false, code: "PAY_VIA_STOREFRONT" });
  });

  it("已经付过了 → 不给入口(早于商城订单那条)", () => {
    expect(
      decidePrintOrderPaymentEntry({
        paymentStatus: "paid",
        storefrontOrderId: null,
      })
    ).toEqual({ allowed: false, code: "ALREADY_PAID" });
  });

  it("退过款的**独立**工单 → 还是给入口(它自己收的钱)", () => {
    // 退款只改收款状态,不动订单状态(见 `payments/lib/transitions.ts`)。
    // 独立工单的钱是自己收的 —— 退完之后还能再付一次,这是它本来的行为。
    expect(
      decidePrintOrderPaymentEntry({
        paymentStatus: "refunded",
        storefrontOrderId: null,
      })
    ).toEqual({ allowed: true });
  });

  it("支付失败的单 → 还能重试(独立工单)", () => {
    expect(
      decidePrintOrderPaymentEntry({
        paymentStatus: "failed",
        storefrontOrderId: null,
      })
    ).toEqual({ allowed: true });
  });

  it("跟着商城订单结的账,就算状态不是 unpaid 也不给入口", () => {
    // 失败的商城订单 → 用户回商城订单那张去重试,不是在工单这边重开一个
    expect(
      decidePrintOrderPaymentEntry({
        paymentStatus: "failed",
        storefrontOrderId: "so_123",
      })
    ).toEqual({ allowed: false, code: "PAY_VIA_STOREFRONT" });
  });
});
