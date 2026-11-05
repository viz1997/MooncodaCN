/**
 * 支付链接失败的分类 —— 纯函数测试
 *
 * ## 为什么这个分类重要
 *
 * 「收款通道没配好」和「这次调用挂了」对用户是两件完全不同的事:
 *
 * - 没配好 —— 重试**没用**。得等部署补上环境变量,用户在「我的订单」里点
 *   多少次「重新获取支付链接」都是同一个结果。
 * - 调用挂了 —— 重试就能好。
 *
 * 混成一句话的话,用户就在反复重试一件不会成功的事。2026-11-05 线上真实踩到
 * 过:一次部署刚加好 Sellbase 环境变量,但那一次构建没赶上,用户下了一单既
 * 没有 Sellbase 订单也没有支付链接。
 *
 * 纯计算:不碰 DB、不碰网络。跑在 unit project 里。
 */

import { describe, expect, it } from "vitest";

import { SellbaseNotConfiguredError } from "@/features/sellbase/lib/env";
import { SellbaseOrderCreationError } from "@/features/sellbase/lib/orders";
import { classifyPaymentIssue } from "@/features/storefront/lib/payment-issue";

describe("classifyPaymentIssue", () => {
  it("配置没配好 —— 直接抛的", () => {
    expect(
      classifyPaymentIssue(
        new SellbaseNotConfiguredError("Sellbase 未配置:缺少 SELLBASE_API_TOKEN")
      )
    ).toBe("SELLBASE_NOT_CONFIGURED");
  });

  it("配置没配好 —— 被建单那层包进了 SellbaseOrderCreationError", () => {
    const wrapped = new SellbaseOrderCreationError(
      "Sellbase 建单失败",
      new SellbaseNotConfiguredError("Sellbase 未配置:缺少 SELLBASE_API_TOKEN")
    );
    expect(classifyPaymentIssue(wrapped)).toBe("SELLBASE_NOT_CONFIGURED");
  });

  it("别的错误 —— 就算包了一层也不该认成配置问题", () => {
    const wrapped = new SellbaseOrderCreationError(
      "Sellbase 建单失败",
      new Error("fetch failed")
    );
    expect(classifyPaymentIssue(wrapped)).toBe("SELLBASE_FAILED");
  });

  it("普通异常 —— 一次调用挂了,重试有意义", () => {
    expect(classifyPaymentIssue(new Error("fetch failed"))).toBe(
      "SELLBASE_FAILED"
    );
  });

  it("不是 Error 的东西 —— 也归到「调用挂了」,不能炸", () => {
    expect(classifyPaymentIssue(undefined)).toBe("SELLBASE_FAILED");
    expect(classifyPaymentIssue(null)).toBe("SELLBASE_FAILED");
    expect(classifyPaymentIssue("boom")).toBe("SELLBASE_FAILED");
    expect(classifyPaymentIssue({ code: 500 })).toBe("SELLBASE_FAILED");
  });

  it("幂等 —— 同一个错误分类两次结果一样", () => {
    const error = new SellbaseNotConfiguredError("没配");
    expect(classifyPaymentIssue(error)).toBe(classifyPaymentIssue(error));
  });
});
