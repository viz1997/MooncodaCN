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
 *
 * ## 退回主线程的规则(2026-11-11 定的)
 *
 * 以前**任何** Worker 失败都退回主线程重算一遍。那在模型很重的时候是
 * 灾难:Worker 算了 60 秒没算完 → 主线程接着算 60 秒 → **整个页面冻住**,
 * 而且结果还是同一个(模型就是太重)。
 *
 * 现在按「Worker 到底活没活过」分两种:
 *
 * | Worker 的状态 | 判断 | 怎么办 |
 * |---|---|---|
 * | **从没回过话** | Worker 压根没起来 / 脚本没接上 | **退回主线程** —— 老路,能用 |
 * | **回过话,这会儿超时了** | 模型太重,Worker 是在算 | **不退回** —— 报 `WORKER_TIMEOUT` |
 * | **回过话,这会儿崩了** | 几何太复杂(自相交 / 面数太大) | **不退回** —— 报 `WORKER_CRASHED` |
 *
 * 判据是 `workerHealthy` —— Worker 回过一次包就算「活过」。
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
  MagnetTextureInput,
  MagnetWorkerIn,
  MagnetWorkerOut,
} from "@/features/magnet/lib/magnet-cutter-protocol";
import type {
  MagnetHoleParams,
  MagnetTargetId,
} from "@/features/magnet/lib/magnet-params";

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
 * 所以每条指令都带个超时。
 *
 * ## 超时定多少(2026-11-11 工作室报「切割出了意外」之后调的)
 *
 * - **切割 5 分钟** —— 以前 60 秒。真实模型(AI 生成的、几十万面的)跑
 *   manifold 的 EXACT 布尔运算**真的要好几分钟**,60 秒太紧:模型不是坏的,
 *   只是没算完。**宁可多等,别把一个能算出来的模型判成死的。**
 * - **分析 60 秒** —— 以前 30 秒。焊接 + 建拓扑在几十万面的模型上要好几秒,
 *   30 秒偶尔不够。
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
  analyze: 60_000,
  cut: 300_000,
};

/** 客户端参数(测试里用来把超时调小 / 换掉 Worker) */
export type MagnetCutterClientOptions = {
  timeoutMs?: Partial<MagnetTimeoutMs>;
  /**
   * 自己造 Worker(测试用)
   *
   * 默认走 `new Worker(new URL(...))` —— 打包器要静态分析才能找到 worker 入口,
   * 所以那个 URL **必须是字面量**,不能从这里传进去。
   */
  workerFactory?: () => Worker | null;
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
  /** 这个 Worker 实例是不是已经报废了(要换一个新的) */
  private workerBroken = false;
  /**
   * Worker 压根起不来(浏览器不支持 / 没产出 worker chunk)
   *
   * 这种情况下**只能**退回主线程 —— 没有别的路。
   */
  private workerUnavailable = false;
  /**
   * Worker 回过话 —— 它是活的
   *
   * 这是「退回主线程」那条规则的分水岭:活着的 Worker 超时 = 模型太重,
   * 不是 Worker 的问题 ⇒ 主线程再算一遍只会把页面冻住。
   */
  private workerHealthy = false;
  /** 已经 dispose 了 —— 之后的请求直接失败 */
  private disposed = false;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly timeouts: MagnetTimeoutMs;
  private readonly workerFactory?: (() => Worker | null) | undefined;

  constructor(options: MagnetCutterClientOptions = {}) {
    this.timeouts = { ...TIMEOUT_MS, ...options.timeoutMs };
    this.workerFactory = options.workerFactory;
    this.worker = this.createWorker();
  }

  /** Worker 是不是真的在跑(false = 降级到主线程) */
  get usingWorker(): boolean {
    return this.worker !== null;
  }

  /**
   * 造一个 Worker
   *
   * 三个来源:
   * - **测试注入的工厂** —— 优先(单测里 node 没有 `window`,但要能造 Worker)
   * - 浏览器里的 `new Worker(new URL(...))` —— 那个 URL **必须是字面量**,
   *   打包器要静态分析才能找到 worker 入口
   * - 什么都没有 ⇒ `null`(退回主线程)
   */
  private createWorker(): Worker | null {
    let worker: Worker | null = null;
    try {
      if (this.workerFactory) {
        worker = this.workerFactory();
      } else if (typeof window !== "undefined") {
        worker = new Worker(
          new URL("../workers/magnet-cutter.worker.ts", import.meta.url)
        );
      }
    } catch {
      // 浏览器不支持 Worker / 打包配置没产出 worker chunk
      worker = null;
    }
    if (!worker) {
      this.workerUnavailable = true;
      this.workerBroken = true;
      return null;
    }
    this.attachWorker(worker);
    return worker;
  }

  /** 装上回包 / 崩了的回调 */
  private attachWorker(worker: Worker): void {
    worker.onmessage = (e: MessageEvent<MagnetWorkerOut>) => {
      const msg = e.data;
      // 回过话 = 它是活的(哪怕回的是错)
      this.workerHealthy = true;
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
      // Worker 崩了:这一轮的请求全部失败。
      // 崩在重模型上是很常见的(自相交 / 面数太大)—— 报 `WORKER_CRASHED`,
      // 别再报「出了个预料之外的错」。
      this.killWorker(
        new MagnetClientError(
          "WORKER_CRASHED",
          "切割引擎在处理这个模型时崩了(几何可能自相交,或者面数太大)"
        )
      );
    };
  }

  /**
   * 拿一个能用的 Worker
   *
   * 三种情况:
   * - 现在的 Worker 还活着 → 用它
   * - 上一个 Worker 卡在重模型上被杀了 → **换一个干净的**(不是退回主线程)
   * - Worker 压根起不来 → null(调用方退回主线程)
   */
  private ensureWorker(): Worker | null {
    if (this.disposed) return null;
    if (this.worker && !this.workerBroken) return this.worker;
    if (this.workerBroken && !this.workerUnavailable) {
      // 上一个 Worker 死在重模型上 —— 换一个,别让下一次请求也去主线程。
      // **新 Worker 还没证明自己活着** ⇒ `workerHealthy` 归零(它是按实例算的)。
      this.workerHealthy = false;
      this.worker = this.createWorker();
      // `createWorker()` 失败时会自己把 `workerBroken` 置回 true —— 别覆盖它
      if (this.worker) this.workerBroken = false;
      return this.worker;
    }
    return null;
  }

  /** 结算一条请求:清超时定时器 + 从 pending 里摘掉 */
  private settle(seq: number): void {
    const entry = this.pending.get(seq);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(seq);
  }

  /**
   * Worker 不可信了:杀掉它,把在途的请求全部拒掉。
   *
   * `workerUnavailable = true` 表示「没有 Worker 可用」—— 下次请求退回主线程。
   * 默认 **不** 置这个标志:那意味着「Worker 只是卡在重模型上」,下次请求
   * 应该换一个 Worker,而不是把页面冻住。
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
        new MagnetClientError("WORKER_UNAVAILABLE", "切割 Worker 不可用")
      );
    }
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(seq)) return;
        this.settle(seq);
        if (this.workerHealthy) {
          // Worker 是活的 —— **模型太重**,不是 Worker 的问题。
          // 杀掉它(它还卡在那个模型上),下次请求换一个干净的。
          // **不退回主线程** —— 主线程算同样的模型只会把页面冻住同样久。
          reject(
            new MagnetClientError(
              "WORKER_TIMEOUT",
              `切割超过 ${timeoutMs / 1000} 秒还没算完 —— 这个模型对浏览器来说太重了`
            )
          );
          this.killWorker(
            new MagnetClientError(
              "WORKER_TIMEOUT",
              `切割超过 ${timeoutMs / 1000} 秒还没算完`
            )
          );
          return;
        }
        // 从没回过话 = Worker 压根不可用 → 退回主线程
        this.workerUnavailable = true;
        reject(
          new MagnetClientError(
            "WORKER_UNAVAILABLE",
            `切割 Worker ${timeoutMs / 1000}s 没响应,已退回主线程`
          )
        );
        this.killWorker(
          new MagnetClientError(
            "WORKER_UNAVAILABLE",
            `切割 Worker ${timeoutMs / 1000}s 没响应,已退回主线程`
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

  /**
   * 跑一条指令 —— 先试 Worker,不行再退回主线程
   *
   * **退回主线程的条件只有一个:Worker 从没回过话。**
   *
   * Worker 活过但这一条超时 / 崩了 ⇒ 模型太重 ⇒ 主线程再算一遍只会把
   * 页面冻住,而且结果还是同一个 ⇒ 原样把错抛出去。
   */
  private async run<T>(
    msg: DistributiveOmit<MagnetWorkerIn, "seq">,
    timeoutMs: number,
    onMainThread: () => Promise<T>
  ): Promise<T> {
    const worker = this.ensureWorker();
    if (worker) {
      try {
        return await this.send(msg, timeoutMs);
      } catch (err) {
        if (this.workerHealthy) {
          // Worker 活着但这条没成 → 模型太重。**不退回。**
          throw toClientError(err);
        }
        // Worker 从没回过话 → 老路:退回主线程算,数字照样出得来
        console.warn("切割 Worker 从未响应,退回主线程:", err);
        this.workerBroken = true;
      }
    }
    try {
      return await onMainThread();
    } catch (err) {
      throw this.mainThreadError(err);
    }
  }

  /** 主线程那条路失败的错 → 补一句「Worker 压根没起来」 */
  private mainThreadError(err: unknown): MagnetClientError {
    const e = toClientError(err);
    if (this.workerUnavailable && e.code === "UNEXPECTED") {
      return new MagnetClientError(
        "WORKER_UNAVAILABLE",
        `切割 Worker 起不来(或一直没响应),退回主线程也没成:${e.message}`
      );
    }
    return e;
  }

  /** 分析:挑面 + 智能识别背面 + 报体积 */
  async analyze(
    positions: Float32Array,
    hole?: MagnetHoleParams | null,
    texture?: MagnetTextureInput | null
  ): Promise<MagnetAnalyzeOutcome> {
    if (this.disposed) {
      throw new MagnetClientError("UNEXPECTED", "切割客户端已释放");
    }
    return this.run(
      {
        type: "analyze",
        positions,
        hole: hole ?? null,
        texture: texture ?? null,
      },
      this.timeouts.analyze,
      () => analyzeModel(positions, hole)
    );
  }

  /** 切一个磁吸孔 */
  async cut(
    positions: Float32Array,
    target: MagnetTargetId = "auto",
    hole?: MagnetHoleParams | null,
    texture?: MagnetTextureInput | null
  ): Promise<MagnetCutOutcome> {
    if (this.disposed) {
      throw new MagnetClientError("UNEXPECTED", "切割客户端已释放");
    }
    return this.run(
      {
        type: "cut",
        positions,
        target,
        hole: hole ?? null,
        texture: texture ?? null,
      },
      this.timeouts.cut,
      () => cutMagnetPocket(positions, target, hole, texture)
    );
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
      entry.reject(new MagnetClientError("UNEXPECTED", "切割客户端已释放"));
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
    "UNEXPECTED",
    err instanceof Error ? err.message : String(err)
  );
}
