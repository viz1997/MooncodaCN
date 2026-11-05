/**
 * 挂在商城订单下的打印工单 —— webhook 状态转移(纯函数)
 *
 * ## 背景
 *
 * 打印服务进了商城购物车之后,一张商城订单可以包含**多张**打印工单,它们
 * 共用**一张** Sellbase 订单(收银台模式:一次结算一个支付链接)。所以工单
 * 挂 `print_order.storefront_order_id`,而不是 `sellbase_order_id`(那列是
 * 唯一索引,挂不上去)。
 *
 * 钱是**整单收**的:商城订单一付款,挂在它下面的所有工单必须一起变成已付款。
 * 工单还停在「未付款」的话,工作室点「开始生产」会被 PAYMENT_REQUIRED 挡住
 * —— 单子卡住。
 *
 * ## 口径必须跟另外两处一致
 *
 * - 独立的打印工单(`webhook-handler.ts` 的 `applyToPrintOrder`)
 * - 商城订单本身(`decideStorefrontTransition`)
 *
 * 三处都遵守同一条:**迟到的 `order.paid` 不能把退过款的单改回「已支付」**
 * (webhook 会重投,投递顺序不保证)。
 */

import { describe, expect, it } from "vitest";

import { decideLinkedPrintOrderTransition } from "@/features/sellbase/lib/storefront-transition";

describe("decideLinkedPrintOrderTransition", () => {
  describe("mark_paid", () => {
    it("未付款 → 标已付款,记 paid_at,渠道记 stripe", () => {
      const decision = decideLinkedPrintOrderTransition(
        { paymentStatus: "unpaid" },
        "mark_paid"
      );
      expect(decision).toEqual({
        kind: "apply",
        setPaymentStatus: "paid",
        markPaidAt: true,
        setPaymentChannel: true,
      });
    });

    it("已经付过了 → 不动(重投)", () => {
      const decision = decideLinkedPrintOrderTransition(
        { paymentStatus: "paid" },
        "mark_paid"
      );
      expect(decision.kind).toBe("skip");
    });

    it("退过款的 → 不改回已付款(迟到的 order.paid)", () => {
      const decision = decideLinkedPrintOrderTransition(
        { paymentStatus: "refunded" },
        "mark_paid"
      );
      expect(decision.kind).toBe("skip");
    });
  });

  describe("mark_refunded", () => {
    it("未付款 → 标已退款,不记 paid_at", () => {
      const decision = decideLinkedPrintOrderTransition(
        { paymentStatus: "unpaid" },
        "mark_refunded"
      );
      expect(decision).toEqual({
        kind: "apply",
        setPaymentStatus: "refunded",
        markPaidAt: false,
        setPaymentChannel: false,
      });
    });

    it("已经退过了 → 不动(重投)", () => {
      const decision = decideLinkedPrintOrderTransition(
        { paymentStatus: "refunded" },
        "mark_refunded"
      );
      expect(decision.kind).toBe("skip");
    });

    it("付过的单也能退 —— 只改支付状态,不改别的", () => {
      const decision = decideLinkedPrintOrderTransition(
        { paymentStatus: "paid" },
        "mark_refunded"
      );
      expect(decision.kind).toBe("apply");
    });
  });

  describe("mark_cancelled", () => {
    it("走状态机 —— 时间线上要留一条事件", () => {
      const decision = decideLinkedPrintOrderTransition(
        { paymentStatus: "unpaid" },
        "mark_cancelled"
      );
      expect(decision.kind).toBe("cancel_via_state_machine");
    });
  });

  it("幂等 —— 重投一次和重投十次结果一样", () => {
    const once = decideLinkedPrintOrderTransition(
      { paymentStatus: "unpaid" },
      "mark_paid"
    );
    const twice = decideLinkedPrintOrderTransition(
      { paymentStatus: "paid" },
      "mark_paid"
    );
    expect(once.kind).toBe("apply");
    expect(twice.kind).toBe("skip");
  });
});
