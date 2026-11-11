/**
 * 磁吸孔切割客户端 —— **超时 / 崩了 / 退回主线程** 那几条规则
 *
 * 2026-11-11 工作室报「切割过程出了意外(不是模型的问题)」—— 根因是:
 *
 * 1. **所有**失败都归成 `UNEXPECTED`(一句话套话,什么线索都没有)
 * 2. **任何** Worker 失败都退回主线程重算 —— 模型重的时候,主线程会把
 *    整个页面冻住,而且算出来的还是同一个结果
 *
 * 这两条现在各有各的规则了,这里守住它们:
 *
 * | Worker 的状态 | 期望 |
 * |---|---|
 * | 回过话,这条超时 | 报 `WORKER_TIMEOUT`,**不退回主线程** |
 * | 回过话,这条崩了 | 报 `WORKER_CRASHED`,**不退回主线程** |
 * | 从没回过话 | **退回主线程** —— 老路,能用 |
 * | 压根没有 Worker | **退回主线程** |
 *
 * 「不退回主线程」怎么验?—— 主线程那条路会**真的把模型切了**(那是个
 * 40mm 的立方体,切得动)。所以只要 Promise **没有**带着 `WORKER_TIMEOUT`
 * 拒掉,就说明它偷偷回主线程了。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MagnetCutterClient } from "@/features/magnet/lib/magnet-cutter-client";
import type {
  MagnetAnalyzeOutcome,
  MagnetWorkerOut,
} from "@/features/magnet/lib/magnet-cutter-protocol";

/** 立方体的三角汤(法线朝外)—— 跟 `magnet-cut.test.ts` 同一个 */
function cubeSoup(size: number): Float32Array {
  const h = size / 2;
  const v: [number, number, number][] = [
    [-h, -h, -h],
    [h, -h, -h],
    [h, h, -h],
    [-h, h, -h],
    [-h, -h, h],
    [h, -h, h],
    [h, h, h],
    [-h, h, h],
  ];
  const faces: [number, number, number][] = [
    [0, 3, 2],
    [0, 2, 1],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  const out = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const p = v[f[k]!]!;
      out[i * 9 + k * 3] = p[0];
      out[i * 9 + k * 3 + 1] = p[1];
      out[i * 9 + k * 3 + 2] = p[2];
    }
  });
  return out;
}

/**
 * 一个假 Worker
 *
 * 只实现客户端用到的那几个口子:`postMessage` / `terminate` / `onmessage`
 * / `onerror`。回不回包由测试自己决定 —— 「不回」正是超时那条路要的。
 */
class FakeWorker {
  onmessage: ((e: MessageEvent<MagnetWorkerOut>) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  /** 收到过的指令 */
  readonly posted: { type: string; seq: number }[] = [];
  terminated = false;

  postMessage(msg: { type: string; seq: number }): void {
    this.posted.push({ type: msg.type, seq: msg.seq });
  }

  terminate(): void {
    this.terminated = true;
  }

  /** 回一个「分析成功」的包 */
  replyAnalyze(seq: number): void {
    const result: MagnetAnalyzeOutcome = {
      faces: [],
      backFace: null,
      patches: [],
      volume: 64000,
      bboxMin: [-20, -20, -20],
      bboxMax: [20, 20, 20],
      repair: null,
    };
    this.onmessage?.({
      data: { type: "analyze", seq, result },
    } as MessageEvent<MagnetWorkerOut>);
  }

  /** 模拟引擎崩了 */
  crash(): void {
    this.onerror?.();
  }
}

/** 把假 Worker 装成 Worker —— 只用了客户端碰的那几个口子 */
function asWorker(w: FakeWorker): Worker {
  return w as unknown as Worker;
}

describe("磁吸孔客户端 —— 退回主线程的规则", () => {
  it("Worker 回过话、这条超时 ⇒ 报 WORKER_TIMEOUT,**不退回主线程**", async () => {
    const worker = new FakeWorker();
    const client = new MagnetCutterClient({
      workerFactory: () => asWorker(worker),
      timeoutMs: { analyze: 50, cut: 50 },
    });

    // 先让 Worker 回一次包 —— 它就算「活过」了
    const analyzing = client.analyze(cubeSoup(40));
    await Promise.resolve();
    const seq = worker.posted[0]?.seq;
    expect(seq).toBeDefined();
    worker.replyAnalyze(seq!);
    await expect(analyzing).resolves.toBeTruthy();

    // 这一条不回包 ⇒ 超时
    await expect(client.cut(cubeSoup(40))).rejects.toMatchObject({
      code: "WORKER_TIMEOUT",
    });
    client.dispose();
  });

  it("Worker 回过话、这条崩了 ⇒ 报 WORKER_CRASHED,**不退回主线程**", async () => {
    const worker = new FakeWorker();
    const client = new MagnetCutterClient({
      workerFactory: () => asWorker(worker),
      timeoutMs: { analyze: 50, cut: 50 },
    });

    const analyzing = client.analyze(cubeSoup(40));
    await Promise.resolve();
    worker.replyAnalyze(worker.posted[0]!.seq);
    await expect(analyzing).resolves.toBeTruthy();

    const cutting = client.cut(cubeSoup(40));
    await Promise.resolve();
    worker.crash();
    await expect(cutting).rejects.toMatchObject({ code: "WORKER_CRASHED" });
    client.dispose();
  });

  it("Worker 从没回过话 ⇒ **退回主线程**,照样切得出来", async () => {
    const worker = new FakeWorker();
    const client = new MagnetCutterClient({
      workerFactory: () => asWorker(worker),
      timeoutMs: { analyze: 30, cut: 30 },
    });

    // 这个 Worker 从不说话 ⇒ 客户端该退回主线程自己算
    const result = await client.cut(cubeSoup(40));
    expect(result.triangleCount).toBeGreaterThan(0);
    expect(result.removedVolume).toBeGreaterThan(0);
    // 超时之后它该被杀掉
    expect(worker.terminated).toBe(true);
    client.dispose();
  });

  it("压根没有 Worker ⇒ 退回主线程", async () => {
    const client = new MagnetCutterClient({
      workerFactory: () => null,
      timeoutMs: { analyze: 30, cut: 30 },
    });
    const result = await client.cut(cubeSoup(40));
    expect(result.triangleCount).toBeGreaterThan(0);
    client.dispose();
  });

  it("Worker 报的是模型本身的错 ⇒ 原样带上来(不换成 UNEXPECTED)", async () => {
    const worker = new FakeWorker();
    const client = new MagnetCutterClient({
      workerFactory: () => asWorker(worker),
      timeoutMs: { analyze: 50, cut: 50 },
    });

    const analyzing = client.analyze(cubeSoup(40));
    await Promise.resolve();
    worker.onmessage?.({
      data: {
        type: "error",
        seq: worker.posted[0]!.seq,
        code: "NOT_MANIFOLD",
        message: "这个模型不是封闭流形",
      },
    } as MessageEvent<MagnetWorkerOut>);

    await expect(analyzing).rejects.toMatchObject({ code: "NOT_MANIFOLD" });
    client.dispose();
  });
});

describe("磁吸孔客户端 —— 超时定多少", () => {
  it("切割超时是 5 分钟(不是 60 秒)", () => {
    // 真实模型(AI 生成的、几十万面)跑 EXACT 布尔运算真的要好几分钟 ——
    // 60 秒太紧,会把一个能算出来的模型判成死的。
    const src = readSource();
    expect(src).toMatch(/cut:\s*300_000/);
    expect(src).toMatch(/analyze:\s*60_000/);
  });
});

/** 读客户端源码 —— 守住「超时是多少」这种写在代码里的数字 */
function readSource(): string {
  return readFileSync(
    join(process.cwd(), "src/features/magnet/lib/magnet-cutter-client.ts"),
    "utf8"
  );
}
