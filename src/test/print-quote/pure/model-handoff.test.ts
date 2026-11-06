import { describe, expect, it, vi } from "vitest";

/**
 * 模型接力(工具页 → 报价台)—— 纯函数测试
 *
 * ## 为什么这个值得测
 *
 * 接力是「用户量好的模型,点一下就带到报价台」这件事的全部实现。它只有两条
 * 规矩,但写反了都不会报错,只会**安静地丢模型**:
 *
 *   1. **取走即清空** —— 报价台取第二次必须拿到 null。要是接力不清空,报价台
 *      刷新一下又会冒出个模型,用户会以为自己的文件「自己冒出来了」。
 *   2. **只留最新那一个** —— 用户在工具页换了模型,之前那个必须作废。留着旧的
 *      的话,报价台拿到的是**用户已经放弃的那个模型** —— 报价单上的尺寸跟
 *      用户最后选的对不上,这是会真的算错钱的错。
 *
 * 还有一条是**结构性**的:接力仓库挂在 globalThis 上,不是模块级变量 ——
 * App Router 给每个路由单独打 client bundle,同一个模块被打成两份是常事,
 * 那种情况下模块级变量就断了(接力静默失效)。见 `model-handoff.ts` 的说明。
 */

import type { PricingModelPayload } from "@/features/pricing/components/pricing-calculator-types";
import type { ModelFile } from "@/features/pricing/lib/zip-extractor";
import {
  stashPendingModel,
  takePendingModel,
} from "@/features/print-quote/lib/model-handoff";

/** 造一个假的模型载荷 —— 接力模块只搬运它,不碰里面的内容 */
function fakePayload(
  name: string,
  scales: [number, number, number] = [1, 1, 1]
): PricingModelPayload {
  return {
    model: { name } as unknown as ModelFile,
    scales,
  };
}

describe("模型接力", () => {
  it("存进去的能原样取回来", () => {
    const payload = fakePayload("测试模型.obj");
    stashPendingModel(payload);
    expect(takePendingModel()).toBe(payload);
  });

  it("取走即清空 —— 取第二次拿到 null", () => {
    stashPendingModel(fakePayload("测试模型.obj"));
    expect(takePendingModel()).not.toBeNull();
    expect(takePendingModel()).toBeNull();
  });

  it("只留最新那一个 —— 换过模型之后接力的是新的", () => {
    const old = fakePayload("旧模型.obj");
    const fresh = fakePayload("新模型.obj", [0.5, 0.5, 0.5]);
    stashPendingModel(old);
    stashPendingModel(fresh);
    expect(takePendingModel()).toBe(fresh);
  });

  it("存 null = 撤掉接力(用户清了模型)", () => {
    stashPendingModel(fakePayload("测试模型.obj"));
    stashPendingModel(null);
    expect(takePendingModel()).toBeNull();
  });

  it("没存过就是 null", () => {
    expect(takePendingModel()).toBeNull();
  });

  it("缩放因子一起带过去 —— 报价单上的尺寸要跟用户看到的一致", () => {
    const payload = fakePayload("缩过的模型.obj", [0.8, 0.6, 0.4]);
    stashPendingModel(payload);
    const taken = takePendingModel();
    expect(taken?.scales).toEqual([0.8, 0.6, 0.4]);
  });

  it("接力仓库挂在 globalThis 上 —— 模块被打成几份也共享一份", () => {
    // 模拟浏览器:生产环境走的就是这条分支(node 里没有 window)
    vi.stubGlobal("window", globalThis);
    try {
      const payload = fakePayload("跨副本模型.obj");
      stashPendingModel(payload);

      const store = (
        globalThis as {
          __mooncoda_print_model_handoff__?: {
            pending: PricingModelPayload | null;
          };
        }
      ).__mooncoda_print_model_handoff__;

      expect(store?.pending).toBe(payload);
      expect(takePendingModel()).toBe(payload);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
