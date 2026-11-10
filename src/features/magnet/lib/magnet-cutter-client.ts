"use client";

/**
 * 磁吸孔切割 Worker 客户端
 *
 * 把「焊接 + 布尔运算」交给 Worker 跑,主线程只负责发指令、收结果 ——
 * 切割期间页面照样能点能拖。
 *
 * 浏览器不支持 Worker(或打包器没产出 worker chunk)时自动降级成主线程跑:
 * 功能不变,只是那几秒里页面会卡(跟以前一样)。
 *
 * ## 错误怎么回来
 *
 * Worker 回的错带一个**稳定的 code**(`MagnetErrorCode`)—— 界面按 code 查
 * 文案表,不给用户看「请稍后重试」那种废话。code 跟消息都原样传上去。
 */
import {
  analyzeModel,
  cutMagnetPocket,
  MagnetCutterError,
} from "@/features/magnet/lib/magnet-cutter-handler";
import type {
  MagnetAnalyzeOutcome,
  MagnetCutOutcome,
  MagnetErrorCode,
  MagnetWorkerIn,
  MagnetWorkerOut,
} from "@/features/magnet/lib/magnet-cutter-protocol";
import type { MagnetFaceId } from "@/features/magnet/lib/magnet-params";

type Pending = {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  /** 超时定时器 —— 结算时清掉 */
  timer?: ReturnType<typeof setTimeout> | undefined;
};

/** 联合类型上的 Omit 要逐个分支处理(普通 Omit 会把联合压成公共字段) */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * 每条指令的超时(ms)
 *
 * 为什么要超时:Worker 脚本加载失败会触发 `onerror`,能立刻降级;但
 * 「脚本起来了、但 `onmessage` 没接上」这种情况下 Worker 不会报错,只是
 * **永远不回复** —— 上游的 Promise 就永远不返回,界面上的「切磁吸孔」按钮
 * 一直转圈。
 *
 * 所以每条指令都带个超时:超时 = 这个 Worker 不可信 → 杀掉它、退回主线程算。
 *
 * 单独定一个类型(而不是 `as const` 的字面量类型):测试里要把超时调小。
 */
export type MagnetTimeoutMs = {
  /** 焊接 + 建流形 + 六条射线 */
  analyze: number;
  /** 布尔运算 */
  cut: number;
};

const TIMEOUT_MS: MagnetTimeoutMs = {
  analyze: 30_000,
  cut: 60_000,
};

/** 客户端参数(测试里用来把超时调小) */
export type MagnetCutterClientOptions = {
  timeoutMs?: Partial<MagnetTimeoutMs>;
};

/** 带 code 的错 —— Worker 和主线程两条路都产出这个形状 */
export class MagnetClientError extends Error {
  readonly code: MagnetErrorCode;

  constructor(code: MagnetErrorCode, message: string) {
    super(message);
    this.name = "MagnetClientError";
    this.code = code;
  }
}

export class MagnetCutterClient {
  private worker: Worker | null = null;
  private workerBroken = false;
  /** 已经 dispose 了 —— 之后的请求直接失败 */
  private disposed = false;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly timeouts: MagnetTimeoutMs;

  constructor(options: MagnetCutterClientOptions = {}) {
    this.timeouts = { ...TIMEOUT_MS, ...options.timeoutMs };
    this.worker = this.createWorker();
  }

  /** Worker 是不是真的在跑(false = 降级到主线程) */
  get usingWorker(): boolean {
    return this.worker !== null;
  }

  private createWorker(): Worker | null {
    if (typeof window === "undefined") return null;
    try {
      // ⚠️ `new URL(..., import.meta.url)` 必须是字面量,打包器才能静态分析出 worker 入口
      const worker = new Worker(
        new URL("../workers/magnet-cutter.worker.ts", import.meta.url)
      );
      worker.onmessage = (e: MessageEvent<MagnetWorkerOut>) => {
        const msg = e.data;
        const entry = this.pending.get(msg.seq);
        if (!entry) return; // 过期响应
        this.settle(msg.seq);
        if (msg.type === "error") {
          entry.reject(new MagnetClientError(msg.code, msg.message));
          return;
        }
        if (msg.type === "analyze") {
          entry.resolve(msg.result as never);
          return;
        }
        entry.resolve(msg.result as never);
      };
      worker.onerror = () => {
        // worker 崩了:这一轮的请求全部失败,后续降级到主线程
        this.killWorker(
          new MagnetClientError("BOOLEAN_FAILED", "切割 Worker 崩溃")
        );
      };
      return worker;
    } catch {
      // 浏览器不支持 Worker / 打包配置没产出 worker chunk
      this.workerBroken = true;
      return null;
    }
  }

  /** 结算一条请求:清超时定时器 + 从 pending 里摘掉 */
  private settle(seq: number): void {
    const entry = this.pending.get(seq);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(seq);
  }

  /**
   * Worker 不可信了:杀掉它,把在途的请求全部拒掉,后续一律走主线程。
   */
  private killWorker(reason: Error): void {
    this.workerBroken = true;
    this.worker?.terminate();
    this.worker = null;
    for (const [seq, entry] of this.pending) {
      this.settle(seq);
      entry.reject(reason);
    }
    this.pending.clear();
  }

  private send(
    msg: DistributiveOmit<MagnetWorkerIn, "seq">,
    timeoutMs: number
  ): Promise<never> {
    const worker = this.worker;
    if (!worker || this.workerBroken) {
      return Promise.reject(
        new MagnetClientError("BOOLEAN_FAILED", "Worker 不可用")
      );
    }
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(seq)) return;
        this.settle(seq);
        // 超时 = Worker 不再可信(可能压根没接上 onmessage)
        this.killWorker(
          new MagnetClientError(
            "BOOLEAN_FAILED",
            `切割 Worker ${timeoutMs / 1000}s 没响应,已退回主线程`
          )
        );
        reject(
          new MagnetClientError(
            "BOOLEAN_FAILED",
            `切割 Worker 超时(${timeoutMs / 1000}s)`
          )
        );
      }, timeoutMs);
      this.pending.set(seq, {
        resolve: resolve as (value: never) => void,
        reject,
        timer,
      });
      worker.postMessage({ ...msg, seq } as MagnetWorkerIn);
    });
  }

  /** 分析:挑面 + 报体积 */
  async analyze(positions: Float32Array): Promise<MagnetAnalyzeOutcome> {
    if (this.disposed) {
      throw new MagnetClientError("BOOLEAN_FAILED", "切割客户端已释放");
    }
    if (this.worker && !this.workerBroken) {
      try {
        return await this.send(
          { type: "analyze", positions },
          this.timeouts.analyze
        );
      } catch (err) {
        // Worker 半路挂了 → 退回主线程算,数字照样出得来
        console.warn("切割 Worker 分析失败,退回主线程:", err);
        this.workerBroken = true;
      }
    }
    try {
      return await analyzeModel(positions);
    } catch (err) {
      throw toClientError(err);
    }
  }

  /** 切一个磁吸孔 */
  async cut(
    positions: Float32Array,
    faceId: MagnetFaceId
  ): Promise<MagnetCutOutcome> {
    if (this.disposed) {
      throw new MagnetClientError("BOOLEAN_FAILED", "切割客户端已释放");
    }
    if (this.worker && !this.workerBroken) {
      try {
        return await this.send(
          { type: "cut", positions, faceId },
          this.timeouts.cut
        );
      } catch (err) {
        console.warn("切割 Worker 切割失败,退回主线程:", err);
        this.workerBroken = true;
      }
    }
    try {
      return await cutMagnetPocket(positions, faceId);
    } catch (err) {
      throw toClientError(err);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.workerBroken = true;
    // 在途的请求要拒掉 —— 不拒的话这些 Promise 永远不返回,
    // 上游 await 在那里一直挂着。
    for (const [seq, entry] of this.pending) {
      this.settle(seq);
      entry.reject(new MagnetClientError("BOOLEAN_FAILED", "切割客户端已释放"));
    }
    this.pending.clear();
  }
}

/** 主线程那条路抛的错 → 统一成带 code 的形状 */
function toClientError(err: unknown): MagnetClientError {
  if (err instanceof MagnetClientError) return err;
  if (err instanceof MagnetCutterError) {
    return new MagnetClientError(err.code, err.message);
  }
  return new MagnetClientError(
    "BOOLEAN_FAILED",
    err instanceof Error ? err.message : String(err)
  );
}
