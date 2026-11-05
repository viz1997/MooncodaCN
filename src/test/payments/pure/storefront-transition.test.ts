import { describe, expect, it } from "vitest";

/**
 * 商城订单 webhook 状态转移测试。
 *
 * 纯函数:`decideStorefrontTransition`,零 DB、零网络、零 env。跑在 unit
 * project 里(`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个必须测
 *
 * 这里藏着两条**曾经真出过的 bug**:
 *
 * 1. **退款写成了「已取消」**。早先商城订单只有一列 `status`,`refund.created`
 *    事件把订单改成 `cancelled`,用户看到的是「已取消」而不是「已退款」——
 *    工作室也没法把退款单跟取消单区分开(退款单要退钱,取消单不用)。
 * 2. **迟到的 `order.paid` 把退过款的单改回「已支付」**。webhook 会重投,
 *    投递顺序也不保证。这条防线一撤,用户看到的和实际收到的钱就对不上。
 *
 * 两条都藏在 `if` 分支里,肉眼review 很容易漏 —— 而且它们**不报错**,只是
 * 悄悄地把单子写成另一个样子。所以得有测试钉住。
 *
 * ## 顺便钉住幂等
 *
 * webhook 重投是常态,「同样的输入 → 同样的输出」是硬要求:重投一次和重投
 * 十次,结果必须一样。
 */

import {
  decideStorefrontTransition,
  type StorefrontOrderState,
} from "@/features/payments/lib/transitions";

const unpaid: StorefrontOrderState = {
  status: "unpaid",
  paymentStatus: "unpaid",
};

const paid: StorefrontOrderState = {
  status: "paid",
  paymentStatus: "paid",
};

const refunded: StorefrontOrderState = {
  status: "paid",
  paymentStatus: "refunded",
};

const cancelled: StorefrontOrderState = {
  status: "cancelled",
  paymentStatus: "unpaid",
};

describe("decideStorefrontTransition", () => {
  describe("mark_paid", () => {
    it("未付的单 → 两个状态一起改,并记 paid_at", () => {
      const decision = decideStorefrontTransition(unpaid, "mark_paid");

      expect(decision).toEqual({
        kind: "apply",
        setStatus: "paid",
        setPaymentStatus: "paid",
        markPaidAt: true,
      });
    });

    it("已经付过 → 不动(幂等:webhook 重投)", () => {
      const decision = decideStorefrontTransition(paid, "mark_paid");

      expect(decision.kind).toBe("skip");
    });

    it("退过款的单 → 不改回已支付(迟到的 paid 事件)", () => {
      const decision = decideStorefrontTransition(refunded, "mark_paid");

      expect(decision.kind).toBe("skip");
    });

    it("已取消的单 → 不改回已支付", () => {
      const decision = decideStorefrontTransition(cancelled, "mark_paid");

      expect(decision.kind).toBe("skip");
    });

    it("先付后取消的单 → 重投的 paid 事件不改任何东西", () => {
      const decision = decideStorefrontTransition(
        { status: "cancelled", paymentStatus: "paid" },
        "mark_paid"
      );

      expect(decision.kind).toBe("skip");
    });
  });

  describe("mark_refunded", () => {
    it("退款只动支付状态,订单状态留在原地", () => {
      const decision = decideStorefrontTransition(paid, "mark_refunded");

      expect(decision).toEqual({
        kind: "apply",
        setPaymentStatus: "refunded",
        markPaidAt: false,
      });
      // 订单状态没被动过 —— 这一条就是「退款不能写成已取消」的全部要害
      expect(decision.kind === "apply" && decision.setStatus).toBeUndefined();
    });

    it("未付的单也能退款(先取消后到账的退款)", () => {
      const decision = decideStorefrontTransition(unpaid, "mark_refunded");

      expect(decision.kind).toBe("apply");
    });

    it("已取消的单也能退款 —— 钱退回来是另一件事", () => {
      const decision = decideStorefrontTransition(cancelled, "mark_refunded");

      expect(decision.kind).toBe("apply");
    });

    it("已经退过 → 不动(幂等)", () => {
      const decision = decideStorefrontTransition(refunded, "mark_refunded");

      expect(decision.kind).toBe("skip");
    });
  });

  describe("mark_cancelled", () => {
    it("取消只动订单状态,不动支付状态", () => {
      const decision = decideStorefrontTransition(unpaid, "mark_cancelled");

      expect(decision).toEqual({
        kind: "apply",
        setStatus: "cancelled",
        markPaidAt: false,
      });
    });

    it("已取消 → 不动(幂等)", () => {
      const decision = decideStorefrontTransition(cancelled, "mark_cancelled");

      expect(decision.kind).toBe("skip");
    });

    it("已付的单被取消 → 订单状态取消,支付状态还是 paid", () => {
      const decision = decideStorefrontTransition(paid, "mark_cancelled");

      expect(decision.kind).toBe("apply");
      expect(
        decision.kind === "apply" && decision.setPaymentStatus
      ).toBeUndefined();
    });
  });

  it("同样的输入永远得到同样的输出(重投不改变结果)", () => {
    for (const state of [unpaid, paid, refunded, cancelled]) {
      for (const action of [
        "mark_paid",
        "mark_refunded",
        "mark_cancelled",
      ] as const) {
        const first = decideStorefrontTransition(state, action);
        const second = decideStorefrontTransition(state, action);
        expect(second).toEqual(first);
      }
    }
  });
});
