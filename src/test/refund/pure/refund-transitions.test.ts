/**
 * 退款申请状态机 —— `src/features/refund/lib/transitions.ts`
 *
 * ## 守住什么
 *
 * | 断言 | 为什么 |
 * |---|---|
 * | 允许的迁移**逐条**对上 | 状态规则有三处要用(后台按钮 / 服务端校验 / 买家文案),规则只定义一次 |
 * | 表里没有的 = 非法(返 null) | 服务端回 `INVALID_TRANSITION`,后台也不给那个按钮 |
 * | 同状态 = null | 重复点「保存」不刷时间线、不报错 |
 * | `rejected` **必须写备注** | 「为什么不退」工作室和买家都得知道 |
 * | 终态(`refunded` / `rejected`)不可再改 | 钱已经回到买家账上了,再改就是篡改记录 |
 *
 * 状态机是**纯函数** ⇒ 这份测试不需要 DB、不需要浏览器。
 */

import { describe, expect, it } from "vitest";

import {
  REFUND_STATUSES,
  allowedNextRefundStatuses,
  canRefundTransition,
  classifyRefundTransition,
  isTerminalRefundStatus,
  refundStatusLabelKey,
  refundTransitionRequiresNote,
} from "@/features/refund/lib/transitions";
import type { RefundStatus } from "@/features/refund/lib/types";

/** 全部状态 */
const ALL: RefundStatus[] = [...REFUND_STATUSES];

/**
 * **允许**的迁移 —— 逐条列出来,不是「所有非空都算合法」
 *
 * 这样加了一条新迁移、忘了改这里,测试当场失败。
 */
const ALLOWED: Array<[RefundStatus, RefundStatus, "forward" | "cancel"]> = [
  ["pending", "approved", "forward"],
  ["pending", "refunded", "forward"],
  ["pending", "rejected", "cancel"],
  ["approved", "refunded", "forward"],
  ["approved", "rejected", "cancel"],
];

describe("退款状态机:允许的迁移逐条对上", () => {
  it("REFUND_STATUSES 就是那四个", () => {
    expect([...REFUND_STATUSES]).toEqual([
      "pending",
      "approved",
      "refunded",
      "rejected",
    ]);
  });

  for (const [from, to, kind] of ALLOWED) {
    it(`${from} → ${to} 是「${kind}」`, () => {
      expect(classifyRefundTransition(from, to)).toBe(kind);
      expect(canRefundTransition(from, to)).toBe(true);
    });
  }

  it("允许的迁移一共就这么几条 —— 没有漏的", () => {
    const actual: string[] = [];
    for (const from of ALL) {
      for (const to of ALL) {
        if (classifyRefundTransition(from, to) !== null) {
          actual.push(`${from}->${to}`);
        }
      }
    }
    expect(actual.sort()).toEqual(ALLOWED.map(([f, t]) => `${f}->${t}`).sort());
  });
});

describe("退款状态机:不允许的迁移返 null", () => {
  it("pending → pending(同状态)= null", () => {
    expect(classifyRefundTransition("pending", "pending")).toBeNull();
    expect(canRefundTransition("pending", "pending")).toBe(false);
  });

  it("approved → approved = null", () => {
    expect(classifyRefundTransition("approved", "approved")).toBeNull();
  });

  it("approved → pending(往回退)= null", () => {
    expect(classifyRefundTransition("approved", "pending")).toBeNull();
  });

  it("refunded → 任何状态 = null(终态)", () => {
    for (const to of ALL) {
      expect(classifyRefundTransition("refunded", to)).toBeNull();
    }
  });

  it("rejected → 任何状态 = null(终态)", () => {
    for (const to of ALL) {
      expect(classifyRefundTransition("rejected", to)).toBeNull();
    }
  });

  it("pending → refunded 是合法的(平台同步回了 SUCCESS)", () => {
    expect(classifyRefundTransition("pending", "refunded")).toBe("forward");
  });
});

describe("退款状态机:终态", () => {
  it("refunded / rejected 是终态", () => {
    expect(isTerminalRefundStatus("refunded")).toBe(true);
    expect(isTerminalRefundStatus("rejected")).toBe(true);
  });

  it("pending / approved 不是终态", () => {
    expect(isTerminalRefundStatus("pending")).toBe(false);
    expect(isTerminalRefundStatus("approved")).toBe(false);
  });

  it("终态没有下一个状态", () => {
    expect(allowedNextRefundStatuses("refunded")).toEqual([]);
    expect(allowedNextRefundStatuses("rejected")).toEqual([]);
  });
});

describe("退款状态机:拒绝必须写备注", () => {
  it("pending → rejected 要备注", () => {
    expect(refundTransitionRequiresNote("pending", "rejected")).toBe(true);
  });

  it("approved → rejected 要备注", () => {
    expect(refundTransitionRequiresNote("approved", "rejected")).toBe(true);
  });

  it("往前推的两条不要备注(可选)", () => {
    expect(refundTransitionRequiresNote("pending", "approved")).toBe(false);
    expect(refundTransitionRequiresNote("pending", "refunded")).toBe(false);
    expect(refundTransitionRequiresNote("approved", "refunded")).toBe(false);
  });

  it("非法迁移不要求备注(压根不会发生)", () => {
    expect(refundTransitionRequiresNote("refunded", "pending")).toBe(false);
    expect(refundTransitionRequiresNote("pending", "pending")).toBe(false);
  });
});

describe("退款状态机:下一个状态清单(后台按钮的来源)", () => {
  it("pending → approved / refunded / rejected", () => {
    expect(allowedNextRefundStatuses("pending")).toEqual([
      "approved",
      "refunded",
      "rejected",
    ]);
  });

  it("approved → refunded / rejected", () => {
    expect(allowedNextRefundStatuses("approved")).toEqual([
      "refunded",
      "rejected",
    ]);
  });

  it("清单里不含自己", () => {
    for (const from of ALL) {
      expect(allowedNextRefundStatuses(from)).not.toContain(from);
    }
  });

  it("清单里的每一个都真的合法", () => {
    for (const from of ALL) {
      for (const to of allowedNextRefundStatuses(from)) {
        expect(canRefundTransition(from, to)).toBe(true);
      }
    }
  });
});

describe("退款状态机:显示名的 i18n 键", () => {
  it("键是相对 `Refund` 命名空间的", () => {
    expect(refundStatusLabelKey("pending")).toBe("status.pending");
    expect(refundStatusLabelKey("approved")).toBe("status.approved");
    expect(refundStatusLabelKey("refunded")).toBe("status.refunded");
    expect(refundStatusLabelKey("rejected")).toBe("status.rejected");
  });

  it("四个状态都有键", () => {
    for (const status of ALL) {
      expect(refundStatusLabelKey(status)).toBe(`status.${status}`);
    }
  });
});
