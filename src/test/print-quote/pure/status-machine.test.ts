import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 打印工单状态机测试。
 *
 * 纯计算:不需要 DB、不需要网络、不需要浏览器。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个值得测
 *
 * 状态机是**服务端唯一的授权边界**:后台的 `<Select>` 只是给人看的便利,
 * 真正的拒绝发生在 `transitionPrintOrderStatus()` 里。规则写错了会出现
 * 三种坏情况:
 *
 *   1. 已取消的工单被改回「待确认」—— 用户以为单子还活着,工作室不认
 *   2. 回退不写备注就放行 —— 时间线上留下一条「莫名其妙改了状态」
 *   3. 终态还能改 —— 「已签收」的单被改成「生产中」,单子永远签不掉
 *
 * 这些都是纯函数的判断,写反例比在 dev 环境手动点便宜得多。
 */

import { PRINT_ORDER_STATUSES } from "@/features/print-quote/lib/quote-types";
import {
  allowedNextStatuses,
  canTransition,
  classifyTransition,
  isLiveStatus,
  isTerminalStatus,
  isUserCancellable,
  PRINT_ORDER_FLOW,
  statusFlowIndex,
  transitionRequiresNote,
} from "@/features/print-quote/lib/status-machine";

describe("classifyTransition", () => {
  it("往前推进是 forward", () => {
    expect(classifyTransition("PENDING", "CONFIRMED")).toBe("forward");
    expect(classifyTransition("CONFIRMED", "IN_PRODUCTION")).toBe("forward");
    expect(classifyTransition("IN_PRODUCTION", "SHIPPED")).toBe("forward");
    expect(classifyTransition("SHIPPED", "COMPLETED")).toBe("forward");
  });

  it("允许跨级推进 —— 工作室可能一坐下就走完三步", () => {
    expect(classifyTransition("PENDING", "SHIPPED")).toBe("forward");
    expect(classifyTransition("PENDING", "COMPLETED")).toBe("forward");
  });

  it("往回退是 backward", () => {
    expect(classifyTransition("SHIPPED", "IN_PRODUCTION")).toBe("backward");
    expect(classifyTransition("IN_PRODUCTION", "PENDING")).toBe("backward");
  });

  it("取消是 cancel —— 任何非终态都能取消", () => {
    expect(classifyTransition("PENDING", "CANCELLED")).toBe("cancel");
    expect(classifyTransition("CONFIRMED", "CANCELLED")).toBe("cancel");
    expect(classifyTransition("IN_PRODUCTION", "CANCELLED")).toBe("cancel");
    expect(classifyTransition("SHIPPED", "CANCELLED")).toBe("cancel");
  });

  it("同状态是空转 —— 非法,不写事件", () => {
    for (const status of PRINT_ORDER_STATUSES) {
      expect(classifyTransition(status, status)).toBeNull();
    }
  });

  it("终态没有出边", () => {
    expect(classifyTransition("COMPLETED", "PENDING")).toBeNull();
    expect(classifyTransition("COMPLETED", "CANCELLED")).toBeNull();
    expect(classifyTransition("CANCELLED", "PENDING")).toBeNull();
    expect(classifyTransition("CANCELLED", "CONFIRMED")).toBeNull();
  });
});

describe("canTransition", () => {
  it("非法转换一律 false", () => {
    expect(canTransition("PENDING", "PENDING")).toBe(false);
    expect(canTransition("COMPLETED", "PENDING")).toBe(false);
    expect(canTransition("CANCELLED", "SHIPPED")).toBe(false);
  });

  it("合法转换一律 true", () => {
    expect(canTransition("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("PENDING", "CANCELLED")).toBe(true);
    expect(canTransition("SHIPPED", "PENDING")).toBe(true);
  });
});

describe("transitionRequiresNote", () => {
  it("只有回退必须写备注", () => {
    expect(transitionRequiresNote("SHIPPED", "IN_PRODUCTION")).toBe(true);
    expect(transitionRequiresNote("IN_PRODUCTION", "PENDING")).toBe(true);
  });

  it("推进和取消不用写备注", () => {
    expect(transitionRequiresNote("PENDING", "CONFIRMED")).toBe(false);
    expect(transitionRequiresNote("SHIPPED", "COMPLETED")).toBe(false);
    expect(transitionRequiresNote("PENDING", "CANCELLED")).toBe(false);
  });
});

describe("allowedNextStatuses", () => {
  it("待确认可以推到后面任何一档,也可以取消", () => {
    expect(allowedNextStatuses("PENDING")).toEqual([
      "CONFIRMED",
      "IN_PRODUCTION",
      "SHIPPED",
      "COMPLETED",
      "CANCELLED",
    ]);
  });

  it("已发货:往前只能完成,回退和取消都允许", () => {
    const next = allowedNextStatuses("SHIPPED");
    // 往前只有「完成」这一档
    expect(
      next.filter((s) => classifyTransition("SHIPPED", s) === "forward")
    ).toEqual(["COMPLETED"]);
    // 回退到哪一档都行(要备注)
    expect(
      next.filter((s) => classifyTransition("SHIPPED", s) === "backward")
    ).toEqual(["PENDING", "CONFIRMED", "IN_PRODUCTION"]);
    expect(next).toContain("CANCELLED");
  });

  it("终态没有任何可去的地方", () => {
    expect(allowedNextStatuses("COMPLETED")).toEqual([]);
    expect(allowedNextStatuses("CANCELLED")).toEqual([]);
  });

  it("选项里不含当前状态", () => {
    for (const status of PRINT_ORDER_STATUSES) {
      expect(allowedNextStatuses(status)).not.toContain(status);
    }
  });
});

describe("isUserCancellable", () => {
  it("只有待确认能自助取消", () => {
    expect(isUserCancellable("PENDING")).toBe(true);
    expect(isUserCancellable("CONFIRMED")).toBe(false);
    expect(isUserCancellable("IN_PRODUCTION")).toBe(false);
    expect(isUserCancellable("SHIPPED")).toBe(false);
    expect(isUserCancellable("COMPLETED")).toBe(false);
    expect(isUserCancellable("CANCELLED")).toBe(false);
  });
});

describe("isLiveStatus / isTerminalStatus", () => {
  it("已完成和已取消是终态", () => {
    expect(isTerminalStatus("COMPLETED")).toBe(true);
    expect(isTerminalStatus("CANCELLED")).toBe(true);
    expect(isTerminalStatus("PENDING")).toBe(false);
    expect(isTerminalStatus("SHIPPED")).toBe(false);
  });

  it("终态不再轮询", () => {
    expect(isLiveStatus("COMPLETED")).toBe(false);
    expect(isLiveStatus("CANCELLED")).toBe(false);
    expect(isLiveStatus("PENDING")).toBe(true);
    expect(isLiveStatus("SHIPPED")).toBe(true);
  });
});

describe("statusFlowIndex", () => {
  it("主流程上的状态按顺序排", () => {
    expect(statusFlowIndex("PENDING")).toBe(0);
    expect(statusFlowIndex("COMPLETED")).toBe(PRINT_ORDER_FLOW.length - 1);
  });

  it("取消不在主流程上", () => {
    expect(statusFlowIndex("CANCELLED")).toBe(-1);
  });
});

describe("i18n 状态文案齐全", () => {
  // 状态标签是用户和后台共用的同一组词 —— 少一个 key,那一格就渲染成
  // 原始 key 字符串(比如 "PrintQuote.status.SHIPPED")。
  const locales = ["zh", "en"] as const;

  for (const locale of locales) {
    it(`${locale} 的 PrintQuote.status 覆盖每一个状态`, () => {
      const messages = JSON.parse(
        readFileSync(resolve(process.cwd(), `messages/${locale}.json`), "utf8")
      ) as {
        PrintQuote?: { status?: Record<string, string> };
      };
      const status = messages.PrintQuote?.status ?? {};
      for (const value of PRINT_ORDER_STATUSES) {
        expect(
          status[value],
          `${locale} 缺 PrintQuote.status.${value}`
        ).toBeTruthy();
      }
    });
  }
});
