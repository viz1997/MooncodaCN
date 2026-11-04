import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SUPPORT_PARAMS } from "@/features/pricing/lib/angle-optimizer";
import { AngleOptimizerClient } from "@/features/pricing/lib/angle-optimizer-client";
import { handleAngleWorkerMessage } from "@/features/pricing/lib/angle-optimizer-handler";
import type {
  AngleWorkerIn,
  AngleWorkerOut,
} from "@/features/pricing/lib/angle-optimizer-protocol";
import {
  type BatchItem,
  type BatchResult,
  summarizeBatch,
} from "@/features/pricing/lib/batch-processor";
import { boxTriangles } from "@/test/tools/fixtures/mesh-fixtures";

/**
 * 初始角度的支撑(2026-11-03)
 *
 * 以前支撑克重要跑完「智能摆盘」才有 —— 模型刚进来时页面上是「—」。
 * 现在模型一进来就算**初始角度 (0°,0°)** 的支撑:改尺寸 / 拖角度
 * 都只改这一个姿态,数字始终对得上当前画面。
 *
 * 这里守住三件事:
 * 1. 客户端**走 Worker** 时 load → pose → search 整条链路能通(回包
 *    类型漏掉一个,Promise 就永远不返回,支撑数字一直是「—」);
 * 2. Worker 不可用时退回主线程算,数值必须一样;
 * 3. 批量模式的「总克重」把支撑算进去了(摆盘过 = 最优姿态,
 *    没摆盘 = 初始角度)。
 */

/** 立方体:20mm 见方,底面贴平台 */
const CUBE = boxTriangles([0, 0, 0], [20, 20, 20]);

/**
 * 假 Worker:在进程内跑真的 Worker 处理逻辑
 *
 * Node 里没有浏览器 Worker,但客户端的 Worker 通路必须有人盯 ——
 * 「回包类型漏一个 → Promise 永远不返回」这类问题只有真跑一遍才看得见。
 */
class InProcessWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  terminate() {}
  postMessage(data: AngleWorkerIn) {
    // 异步回包(跟真 Worker 一样是异步的)
    queueMicrotask(() => {
      handleAngleWorkerMessage(data, (out: AngleWorkerOut) => {
        this.onmessage?.({ data: out });
      });
    });
  }
}

/** Promise 卡住时给个能看懂的失败信息(而不是干等到 vitest 超时) */
async function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  const guard = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`${label} 超时:Promise 一直没返回`)),
      2000
    )
  );
  return Promise.race([p, guard]);
}

describe("AngleOptimizerClient —— Worker 通路", () => {
  beforeAll(() => {
    // 假装在浏览器里:客户端才会去 new Worker(...)
    (globalThis as { window?: unknown }).window = globalThis;
    (globalThis as { Worker?: unknown }).Worker = InProcessWorker;
  });
  afterAll(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { Worker?: unknown }).Worker;
  });

  it("load 要真的返回(漏掉 loaded 回包 → 支撑数字永远是「—」)", async () => {
    const client = new AngleOptimizerClient();
    try {
      expect(client.usingWorker).toBe(true);
      await withTimeout(client.load("m", CUBE), "load");
    } finally {
      client.dispose();
    }
  });

  it("Worker 通路也能问出初始角度 (0°,0°) 的支撑克重", async () => {
    const client = new AngleOptimizerClient();
    try {
      await withTimeout(client.load("m", CUBE), "load");
      const pose = await withTimeout(
        client.pose("m", {
          rotX: 0,
          rotY: 0,
          rotZ: 0,
          scales: [1, 1, 1],
          params: DEFAULT_SUPPORT_PARAMS,
        }),
        "pose"
      );

      // 平底立方体:支撑 = 5mm 托底,底板比轮廓外扩 5mm(876mm²)= 4380 mm³
      expect(pose.supportVolumeMM3).toBeCloseTo(4380, 0);
      // × 支撑密度 1.28 g/cm³ = 5.61 g
      expect(pose.supportWeightG).toBeCloseTo(5.61, 2);
    } finally {
      client.dispose();
    }
  });

  it("Worker 通路也能摆盘", async () => {
    const client = new AngleOptimizerClient();
    try {
      await withTimeout(client.load("m", CUBE), "load");
      const result = await withTimeout(
        client.search("m", {
          scales: [1, 1, 1],
          maxHeightMM: 50,
          modelWeightG: 1.25,
          params: DEFAULT_SUPPORT_PARAMS,
        }),
        "search"
      );
      expect(result.totalSupportWeight).toBeCloseTo(5.61, 1);
    } finally {
      client.dispose();
    }
  });

  it("Worker 通路跟主线程兜底算出同一个数", async () => {
    const client = new AngleOptimizerClient();
    try {
      await withTimeout(client.load("m", CUBE), "load");
      const viaWorker = await withTimeout(
        client.pose("m", {
          rotX: 0,
          rotY: 0,
          rotZ: 0,
          scales: [1, 1, 1],
          params: DEFAULT_SUPPORT_PARAMS,
        }),
        "pose"
      );
      client.dispose();

      // 同一份几何,换一条路(主线程)再算一遍
      const fallback = new AngleOptimizerClient();
      try {
        await fallback.load("m", CUBE);
        const viaMain = await fallback.pose("m", {
          rotX: 0,
          rotY: 0,
          rotZ: 0,
          scales: [1, 1, 1],
          params: DEFAULT_SUPPORT_PARAMS,
        });
        expect(viaWorker.supportWeightG).toBeCloseTo(viaMain.supportWeightG, 6);
      } finally {
        fallback.dispose();
      }
    } finally {
      client.dispose();
    }
  });
});

describe("AngleOptimizerClient —— 主线程兜底(Worker 不可用)", () => {
  beforeAll(() => {
    // Node 里没有 window → 客户端直接走主线程兜底
    delete (globalThis as { window?: unknown }).window;
  });

  it("不跑摆盘也能问出初始角度 (0°,0°) 的支撑克重", async () => {
    const client = new AngleOptimizerClient();
    try {
      await client.load("m", CUBE);
      const pose = await client.pose("m", {
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        scales: [1, 1, 1],
        params: DEFAULT_SUPPORT_PARAMS,
      });

      // 平底立方体:支撑 = 5mm 托底,底板比轮廓外扩 5mm(876mm²)= 4380 mm³
      expect(pose.supportVolumeMM3).toBeCloseTo(4380, 0);
      // 克重 = 体积 × 支撑密度 = 4380 mm³ × 1.28 g/cm³ = 5.61 g
      expect(pose.supportWeightG).toBeCloseTo(5.61, 2);
      // 全包裹 = 模型 8000 + 托底 4380(平台在底面下 5mm)
      expect(pose.wrapVolumeMM3).toBeCloseTo(12380, 0);
    } finally {
      client.dispose();
    }
  });

  it("尺寸变了,初始角度的支撑跟着变(缩放跑在真几何上)", async () => {
    const client = new AngleOptimizerClient();
    try {
      await client.load("m", CUBE);
      const base = await client.pose("m", {
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        scales: [1, 1, 1],
        params: DEFAULT_SUPPORT_PARAMS,
      });
      const scaled = await client.pose("m", {
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        scales: [2, 2, 2],
        params: DEFAULT_SUPPORT_PARAMS,
      });

      // 托底是固定的 5mm,底板比轮廓外扩 5mm —— 轮廓按 k² 涨,留边那 5mm 不涨
      // → 支撑体积按 2.83 倍走(不是精确的 k² = 4)
      expect(scaled.supportVolumeMM3 / base.supportVolumeMM3).toBeCloseTo(
        2.83,
        1
      );
    } finally {
      client.dispose();
    }
  });

  it("Worker 不可用时退回主线程,数值不变", async () => {
    const client = new AngleOptimizerClient();
    expect(client.usingWorker).toBe(false);
    try {
      await client.load("m", CUBE);
      const pose = await client.pose("m", {
        rotX: 0,
        rotY: 0,
        rotZ: 0,
        scales: [1, 1, 1],
        params: DEFAULT_SUPPORT_PARAMS,
      });
      expect(pose.supportWeightG).toBeCloseTo(5.61, 2);
    } finally {
      client.dispose();
    }
  });
});

describe("AngleOptimizerClient —— Worker 掉链子时不能卡死", () => {
  /**
   * 假 Worker:**永远不回包**
   *
   * 模拟「Worker 脚本起来了,但 onmessage 没接上」—— 比如页面开着没刷新,
   * 手里还是上一版客户端(回包类型漏了 "loaded")。这种 Worker 不会报错,
   * 只是永远不回复,上游的 Promise 就永远不返回 —— 页面上支撑克重一直是「—」。
   */
  class DeadWorker {
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;
    terminate() {}
    postMessage() {
      // 故意不回包
    }
  }

  beforeAll(() => {
    (globalThis as { window?: unknown }).window = globalThis;
    (globalThis as { Worker?: unknown }).Worker = DeadWorker;
  });
  afterAll(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { Worker?: unknown }).Worker;
  });

  it("Worker 不回包 → 超时降级到主线程,支撑克重照样出来", async () => {
    const client = new AngleOptimizerClient({
      timeoutMs: { load: 100, pose: 100 },
    });
    try {
      expect(client.usingWorker).toBe(true);
      // 超时后 load() 会退回主线程焊接,所以它**要返回**
      await withTimeout(client.load("m", CUBE), "load");
      const pose = await withTimeout(
        client.pose("m", {
          rotX: 0,
          rotY: 0,
          rotZ: 0,
          scales: [1, 1, 1],
          params: DEFAULT_SUPPORT_PARAMS,
        }),
        "pose"
      );
      expect(pose.supportWeightG).toBeCloseTo(5.61, 2);
    } finally {
      client.dispose();
    }
  });

  it("dispose() 要拒掉在途的请求(不然 await 永远挂着)", async () => {
    const client = new AngleOptimizerClient({
      timeoutMs: { load: 60_000 },
    });
    const pending = client.load("m", CUBE);
    client.dispose();
    await expect(pending).rejects.toThrow();
  });
});

describe("Worker 协议 —— load → pose → search", () => {
  /** 模拟 Worker 的收发:发一条指令,收一条回包 */
  function send(msg: AngleWorkerIn): AngleWorkerOut {
    const out: AngleWorkerOut[] = [];
    handleAngleWorkerMessage(msg, (m) => out.push(m));
    const last = out[out.length - 1];
    if (!last) throw new Error("Worker 没有回包");
    return last;
  }

  it("没 load 就问姿态 → 报错而不是崩", () => {
    const res = send({
      type: "pose",
      seq: 1,
      modelId: "missing",
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scales: [1, 1, 1],
      params: DEFAULT_SUPPORT_PARAMS,
    });

    expect(res.type).toBe("error");
  });

  it("load 之后能问出初始角度的支撑克重", () => {
    const loaded = send({
      type: "load",
      seq: 1,
      modelId: "m",
      positions: CUBE,
    });
    expect(loaded.type).toBe("loaded");

    const res = send({
      type: "pose",
      seq: 2,
      modelId: "m",
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scales: [1, 1, 1],
      params: DEFAULT_SUPPORT_PARAMS,
    });

    expect(res.type).toBe("pose");
    if (res.type !== "pose") return;
    // 平底立方体:5mm 托底(底板外扩 5mm)= 4380 mm³ → 5.61 g
    expect(res.result.supportVolumeMM3).toBeCloseTo(4380, 0);
    expect(res.result.supportWeightG).toBeCloseTo(5.61, 2);
  });

  it("摆盘能找到支撑最少的姿态(立方体躺平)", () => {
    const loaded = send({
      type: "load",
      seq: 1,
      modelId: "m",
      positions: boxTriangles([0, 0, 0], [20, 20, 20]),
    });
    expect(loaded.type).toBe("loaded");

    const res = send({
      type: "search",
      seq: 2,
      modelId: "m",
      scales: [1, 1, 1],
      maxHeightMM: 50,
      modelWeightG: 1.25,
      params: DEFAULT_SUPPORT_PARAMS,
    });

    expect(res.type).toBe("search");
    if (res.type !== "search") return;
    expect(res.result.totalSupportWeight).toBeCloseTo(5.61, 1);
  });
});

describe("批量汇总 —— 总克重 = 耗材克重 + 支撑克重", () => {
  /** 造一个只填了汇总要用到的字段的条目 */
  function doneItem(
    id: string,
    materialWeight: number,
    supportWeightG: number
  ): BatchItem {
    const result = {
      supportWeightG,
      supportRatio: 0.5,
      pricing: {
        materialWeight,
        totalPrice: 100,
      },
    } as unknown as BatchResult;
    return {
      id,
      file: new File([], `${id}.obj`),
      name: `${id}.obj`,
      status: "done",
      progress: 100,
      result,
    };
  }

  it("支撑克重(初始角度)要算进总克重", () => {
    const summary = summarizeBatch([
      doneItem("a", 100, 20),
      doneItem("b", 200, 30),
    ]);

    // (100+20) + (200+30) = 350
    expect(summary.totalWeight).toBeCloseTo(350, 6);
  });

  it("没算支撑的条目只算耗材那部分", () => {
    const summary = summarizeBatch([doneItem("a", 100, 0)]);

    expect(summary.totalWeight).toBeCloseTo(100, 6);
  });
});
