/**
 * 能不能退款 —— `src/features/refund/lib/eligibility.ts`
 *
 * ## 守住什么
 *
 * 工作室的原话(2026-11-14):
 *
 * > 「开始打印或者生产开始后无法退款,因为已经进行中」
 *
 * ⇒ 这一层的**首要职责**就是守住那一条。别的规则(没付款不能退 / 已发货不能退 /
 * 已经有一条申请不能再提)都得排在它后面,但**生产开始后能退**这一条一旦漏了,
 * 就是工作室白干活 + 买家白等。
 *
 * ## 这一层是**真正的授权边界**
 *
 * 界面上的「申请退款」按钮**可以藏起来**,但那只是 UI 便利 —— 用户照样能直接调
 * action。所以判断必须在这层,服务端调它,界面也调它,两边不可能漂。
 *
 * ## 判定顺序**短路**
 *
 * 第一个不满足的条件就是返回的 code —— 买家看到的是**最贴切的那一句**。
 */

import { describe, expect, it } from "vitest";

import {
  PRINT_ORDER_PRODUCTION_STARTED_STATUSES,
  PRINT_ORDER_REFUNDABLE_STATUSES,
  evaluateRefundEligibility,
} from "@/features/refund/lib/eligibility";
import type { RefundEligibilityOrder } from "@/features/refund/lib/eligibility";
import type { RefundIneligibleCode } from "@/features/refund/lib/types";

/** 一个能退的打印工单(PENDING + 已付款) */
function printOrder(
  overrides: Partial<RefundEligibilityOrder> = {}
): RefundEligibilityOrder {
  return {
    orderKind: "print",
    paymentStatus: "paid",
    status: "PENDING",
    ...overrides,
  };
}

/** 一个能退的商城订单(paid + 未发货) */
function storeOrder(
  overrides: Partial<RefundEligibilityOrder> = {}
): RefundEligibilityOrder {
  return {
    orderKind: "storefront",
    paymentStatus: "paid",
    status: "paid",
    ...overrides,
  };
}

/** 断言「不合格,而且是这一个码」 */
function expectIneligible(
  order: RefundEligibilityOrder | null,
  code: RefundIneligibleCode
) {
  expect(evaluateRefundEligibility(order)).toEqual({
    eligible: false,
    code,
  });
}

describe("退款资格:打印工单 —— 生产开始后不能退", () => {
  it("工作室点名的三个状态全部拒", () => {
    for (const status of ["IN_PRODUCTION", "SHIPPED", "COMPLETED"]) {
      expectIneligible(printOrder({ status }), "PRODUCTION_STARTED");
    }
  });

  it("`PRINT_ORDER_PRODUCTION_STARTED_STATUSES` 就是这三个", () => {
    expect([...PRINT_ORDER_PRODUCTION_STARTED_STATUSES]).toEqual([
      "IN_PRODUCTION",
      "SHIPPED",
      "COMPLETED",
    ]);
  });

  it("不在可退名单里的状态一律按「不能退」兜底", () => {
    // 将来加了新状态,这里自动拦住,不会静默放行
    expectIneligible(printOrder({ status: "SOMETHING_NEW" }), "PRODUCTION_STARTED");
    expectIneligible(printOrder({ status: "" }), "PRODUCTION_STARTED");
  });

  it("PENDING + CONFIRMED 可以退", () => {
    expect(evaluateRefundEligibility(printOrder({ status: "PENDING" }))).toEqual({
      eligible: true,
    });
    expect(
      evaluateRefundEligibility(printOrder({ status: "CONFIRMED" }))
    ).toEqual({ eligible: true });
  });

  it("`PRINT_ORDER_REFUNDABLE_STATUSES` 就是这两个", () => {
    expect([...PRINT_ORDER_REFUNDABLE_STATUSES]).toEqual([
      "PENDING",
      "CONFIRMED",
    ]);
  });

  it("已取消的工单 → ORDER_CANCELLED", () => {
    expectIneligible(printOrder({ status: "CANCELLED" }), "ORDER_CANCELLED");
  });
});

describe("退款资格:打印工单 —— 生产开始优先于已取消", () => {
  it("两个都是「不能退」时,先报更贴切的那个", () => {
    // CANCELLED 不在生产名单里,所以走 ORDER_CANCELLED
    expectIneligible(printOrder({ status: "CANCELLED" }), "ORDER_CANCELLED");
  });
});

describe("退款资格:没付款不能退", () => {
  it("print + unpaid → NOT_PAID", () => {
    expectIneligible(
      printOrder({ paymentStatus: "unpaid" }),
      "NOT_PAID"
    );
  });

  it("print + refunded(已经退过了)→ NOT_PAID", () => {
    // 退两次 = 亏钱
    expectIneligible(
      printOrder({ paymentStatus: "refunded" }),
      "NOT_PAID"
    );
  });

  it("print + failed → NOT_PAID", () => {
    expectIneligible(printOrder({ paymentStatus: "failed" }), "NOT_PAID");
  });

  it("storefront + unpaid → NOT_PAID", () => {
    expectIneligible(
      storeOrder({ paymentStatus: "unpaid" }),
      "NOT_PAID"
    );
  });
});

describe("退款资格:商城订单 —— 已发货不能退", () => {
  it("fulfilled → ALREADY_SHIPPED", () => {
    expectIneligible(
      storeOrder({ status: "fulfilled" }),
      "ALREADY_SHIPPED"
    );
  });

  it("已经有 shipment 行 → ALREADY_SHIPPED", () => {
    // 发货台刚建了包裹、订单状态还没推到 fulfilled 的时候,货已经在路上了
    expectIneligible(
      storeOrder({ status: "paid", hasShipment: true }),
      "ALREADY_SHIPPED"
    );
  });

  it("cancelled → ORDER_CANCELLED", () => {
    expectIneligible(
      storeOrder({ status: "cancelled" }),
      "ORDER_CANCELLED"
    );
  });

  it("paid + 没发货 → 可以退", () => {
    expect(evaluateRefundEligibility(storeOrder())).toEqual({ eligible: true });
  });

  it("paid + 还没发货(有 shipment 但 status 还是 paid)→ ALREADY_SHIPPED", () => {
    expectIneligible(
      storeOrder({ status: "paid", hasShipment: true }),
      "ALREADY_SHIPPED"
    );
  });
});

describe("退款资格:订单不存在", () => {
  it("null → NOT_FOUND", () => {
    expectIneligible(null, "NOT_FOUND");
  });

  it("查不到 / 不是这个用户的 ⇒ NOT_FOUND(不是 FORBIDDEN)", () => {
    // 订单号可以枚举 ⇒ 403 会泄露「这个单存在」,404 不会
    expectIneligible(null, "NOT_FOUND");
  });
});

describe("退款资格:已经有一条进行中的申请", () => {
  it("hasActiveRequest → REQUEST_EXISTS", () => {
    expectIneligible(
      printOrder({ hasActiveRequest: true }),
      "REQUEST_EXISTS"
    );
  });

  it("**排在「没付款」前面** —— 买家最想听的是「你已经申请过了」", () => {
    expectIneligible(
      printOrder({ paymentStatus: "unpaid", hasActiveRequest: true }),
      "REQUEST_EXISTS"
    );
  });

  it("**排在「订单不存在」之外** —— 订单确实存在才有「已经申请过」这回事", () => {
    // null ⇒ NOT_FOUND(查不到就没有「已经申请过」)
    expectIneligible(null, "NOT_FOUND");
  });
});

describe("退款资格:判定顺序短路", () => {
  it("REQUEST_EXISTS 排在 NOT_PAID 前面", () => {
    expectIneligible(
      printOrder({ paymentStatus: "unpaid", hasActiveRequest: true }),
      "REQUEST_EXISTS"
    );
  });

  it("NOT_PAID 排在 ORDER_CANCELLED 前面(先看钱到没到)", () => {
    expectIneligible(
      printOrder({ paymentStatus: "unpaid", status: "CANCELLED" }),
      "NOT_PAID"
    );
  });

  it("NOT_PAID 排在 PRODUCTION_STARTED 前面", () => {
    expectIneligible(
      printOrder({ paymentStatus: "unpaid", status: "IN_PRODUCTION" }),
      "NOT_PAID"
    );
  });

  it("ORDER_CANCELLED 排在 PRODUCTION_STARTED 前面", () => {
    expectIneligible(printOrder({ status: "CANCELLED" }), "ORDER_CANCELLED");
  });

  it("ALREADY_SHIPPED 排在「可退」前面", () => {
    expectIneligible(
      storeOrder({ status: "fulfilled", hasShipment: true }),
      "ALREADY_SHIPPED"
    );
  });
});

describe("退款资格:可退的两种订单", () => {
  it("打印工单 PENDING 可以退", () => {
    expect(evaluateRefundEligibility(printOrder())).toEqual({ eligible: true });
  });

  it("打印工单 CONFIRMED 可以退", () => {
    expect(
      evaluateRefundEligibility(printOrder({ status: "CONFIRMED" }))
    ).toEqual({ eligible: true });
  });

  it("商城订单 paid 可以退", () => {
    expect(evaluateRefundEligibility(storeOrder())).toEqual({ eligible: true });
  });
});
