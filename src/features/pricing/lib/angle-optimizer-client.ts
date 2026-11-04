"use client";

/**
 * 智能摆盘 Worker 客户端
 *
 * 把「焊接 + 625 个候选姿态的支撑体积搜索」交给 Worker 跑,主线程只负责
 * 发指令、收结果 —— 摆盘期间页面照样能点能拖。
 *
 * 浏览器不支持 Worker(或打包器没产出 worker chunk)时自动降级成主线程跑:
 * 功能不变,只是那几秒里页面会卡(跟以前一样)。
 */
import {
  computeSupportAtPose,
  findOptimalAngle,
  type OptimalAngle,
  type SupportParams,
  type SupportPoseResult,
} from "@/features/pricing/lib/angle-optimizer";
import type {
  AngleWorkerIn,
  AngleWorkerOut,
} from "@/features/pricing/lib/angle-optimizer-protocol";
import {
  prepareSupportModel,
  type SupportModel,
  scaleSupportModel,
} from "@/features/tools/lib/mesh/support-shell";

type Pending = {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  onProgress?: ((percent: number) => void) | undefined;
  /** 超时定时器 —— 结算时清掉 */
  timer?: ReturnType<typeof setTimeout> | undefined;
};

/** 联合类型上的 Omit 要逐个分支处理(普通 Omit 会把联合压成公共字段) */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** 单个姿态的支撑查询参数 */
export type AnglePoseQuery = {
  rotX: number;
  rotY: number;
  rotZ: number;
  scales: [number, number, number];
  params: SupportParams;
};

/** 智能摆盘搜索参数 */
export type AngleSearchQuery = {
  scales: [number, number, number];
  maxHeightMM: number;
  modelWeightG: number;
  params: SupportParams;
};

/**
 * 每条指令的超时(ms)配置
 *
 * 为什么要超时:Worker 脚本加载失败会触发 `onerror`,能立刻降级;但
 * 「脚本起来了、但 `onmessage` 没接上」(比如旧版本代码里回包类型漏了一个)
 * 这种情况下 Worker 不会报错,只是**永远不回复** —— 上游的 Promise 就永远
 * 不返回,页面上的支撑克重一直是「—」。
 *
 * 所以每条指令都带个超时:超时 = 这个 Worker 不可信 → 杀掉它、退回主线程算。
 * 宁可慢一点,也不能让数字永远出不来。
 *
 * 单独定一个类型(而不是 `as const` 的字面量类型):测试里要把超时调小
 * (比如 100ms),字面量类型会把这个写死成 30000,类型检查直接报错。
 */
export type AngleTimeoutMs = {
  /** 焊接 + 建拓扑:大模型要几秒 */
  load: number;
  /** 单个姿态的支撑体积 */
  pose: number;
  /** 625 个候选姿态的搜索:大模型十几秒 */
  search: number;
};

const TIMEOUT_MS: AngleTimeoutMs = {
  load: 30_000,
  pose: 30_000,
  search: 240_000,
};

/** 客户端参数(测试里用来把超时调小) */
export type AngleOptimizerOptions = {
  timeoutMs?: Partial<AngleTimeoutMs>;
};

export class AngleOptimizerClient {
  private worker: Worker | null = null;
  private workerBroken = false;
  /** 已经 dispose 了 —— 之后的请求直接失败,别再白焊一遍模型 */
  private disposed = false;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  /** 各条指令的超时 */
  private readonly timeouts: AngleTimeoutMs;
  /** 降级(主线程)时用的模型 */
  private localModel: SupportModel | null = null;
  /**
   * 主线程留一份原始几何 —— Worker 不可用时再在主线程焊一次。
   *
   * 几何本来就在主线程(解析阶段带出来的),postMessage 是**拷贝**,
   * 主线程这份不占额外的内存;焊接才是贵的那个,所以只在真降级时才做。
   */
  private localPositions: Float32Array | null = null;

  constructor(options: AngleOptimizerOptions = {}) {
    this.timeouts = { ...TIMEOUT_MS, ...options.timeoutMs };
    this.worker = this.createWorker();
  }

  /** Worker 是不是真的在跑(false = 降级到主线程) */
  get usingWorker(): boolean {
    return this.worker !== null;
  }

  /**
   * 主线程兜底的焊接模型 —— 降级时按需焊接(只焊一次)
   */
  private getLocalModel(): SupportModel {
    if (!this.localModel) {
      if (!this.localPositions) throw new Error("模型还没加载");
      this.localModel = prepareSupportModel(this.localPositions);
    }
    return this.localModel;
  }

  private createWorker(): Worker | null {
    if (typeof window === "undefined") return null;
    try {
      // ⚠️ `new URL(..., import.meta.url)` 必须是字面量,打包器才能静态分析出 worker 入口
      const worker = new Worker(
        new URL("../workers/angle-optimizer.worker.ts", import.meta.url)
      );
      worker.onmessage = (e: MessageEvent<AngleWorkerOut>) => {
        const msg = e.data;
        const entry = this.pending.get(msg.seq);
        if (!entry) return; // 过期响应
        if (msg.type === "progress") {
          entry.onProgress?.(msg.percent);
          return;
        }
        this.settle(msg.seq);
        if (msg.type === "error") {
          entry.reject(new Error(msg.message));
          return;
        }
        // ⚠️ "loaded" 也要 resolve —— 漏了这个,load() 永远不返回,
        // 上游等它才发下一步的地方(比如「模型进来就算初始角度的支撑」)
        // 就永远等不到,支撑数字一直是「—」。
        if (msg.type === "loaded") {
          entry.resolve(undefined as never);
          return;
        }
        if (msg.type === "pose") {
          entry.resolve(msg.result as never);
          return;
        }
        if (msg.type === "search") {
          entry.resolve(msg.result as never);
        }
      };
      worker.onerror = () => {
        // worker 崩了:这一轮的请求全部失败,后续降级到主线程
        this.killWorker(new Error("摆盘 Worker 崩溃"));
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
   *
   * 触发场景:脚本崩溃(onerror)、指令超时、发了不该发的消息。
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
    msg: DistributiveOmit<AngleWorkerIn, "seq">,
    onProgress?: (percent: number) => void,
    timeoutMs: number = this.timeouts.pose
  ): Promise<never> {
    const worker = this.worker;
    if (!worker || this.workerBroken) {
      return Promise.reject(new Error("Worker 不可用"));
    }
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(seq)) return;
        this.settle(seq);
        // 超时 = Worker 不再可信(可能压根没接上 onmessage)
        this.killWorker(
          new Error(`摆盘 Worker ${timeoutMs / 1000}s 没响应,已退回主线程`)
        );
        reject(new Error(`摆盘 Worker 超时(${timeoutMs / 1000}s)`));
      }, timeoutMs);
      this.pending.set(seq, {
        resolve: resolve as (value: never) => void,
        reject,
        onProgress,
        timer,
      });
      worker.postMessage({ ...msg, seq } as AngleWorkerIn);
    });
  }

  /**
   * 把模型几何交给客户端(焊接在 Worker 里做)
   *
   * `positions` 是三角汤(每个三角形 9 个 float)。
   */
  async load(modelId: string, positions: Float32Array): Promise<void> {
    if (this.disposed) throw new Error("摆盘客户端已释放");
    this.localPositions = positions;
    if (this.worker && !this.workerBroken) {
      try {
        await this.send(
          { type: "load", modelId, positions },
          undefined,
          this.timeouts.load
        );
        return;
      } catch (err) {
        // 已经释放了 → 别再退回主线程白焊一遍(大模型要卡好几秒)
        if (this.disposed) throw err;
        // Worker 那边焊接失败 / 崩了 / 超时 → 退回主线程再焊一次(功能不变,只是卡一下)
        console.warn("摆盘 Worker 加载模型失败,退回主线程:", err);
        this.workerBroken = true;
      }
    }
    // 降级:主线程焊接(会卡一下,只在没有 Worker 的环境里发生)
    this.localModel = prepareSupportModel(positions);
  }

  /** 算单个姿态的包裹支撑(初始角度 / 拖滑块都用它) */
  async pose(
    modelId: string,
    query: AnglePoseQuery
  ): Promise<SupportPoseResult> {
    if (this.worker && !this.workerBroken) {
      try {
        return await this.send(
          {
            type: "pose",
            modelId,
            rotX: query.rotX,
            rotY: query.rotY,
            rotZ: query.rotZ,
            scales: query.scales,
            params: query.params,
          },
          undefined,
          this.timeouts.pose
        );
      } catch (err) {
        // Worker 半路挂了 → 退回主线程算,数字照样出得来
        console.warn("摆盘 Worker 姿态计算失败,退回主线程:", err);
        this.workerBroken = true;
      }
    }
    const base = this.getLocalModel();
    const scaled = scaleSupportModel(
      base,
      query.scales[0],
      query.scales[1],
      query.scales[2]
    );
    return computeSupportAtPose(
      scaled,
      query.rotX,
      query.rotY,
      query.rotZ,
      query.params
    );
  }

  /**
   * 智能摆盘:搜索支撑克重最小的姿态
   *
   * @param onProgress 0~100 的进度(Worker 里每算完一批候选就报一次)
   */
  async search(
    modelId: string,
    query: AngleSearchQuery,
    onProgress?: (percent: number) => void
  ): Promise<OptimalAngle> {
    if (this.worker && !this.workerBroken) {
      try {
        return await this.send(
          {
            type: "search",
            modelId,
            scales: query.scales,
            maxHeightMM: query.maxHeightMM,
            modelWeightG: query.modelWeightG,
            params: query.params,
          },
          onProgress,
          this.timeouts.search
        );
      } catch (err) {
        console.warn("摆盘 Worker 搜索失败,退回主线程:", err);
        this.workerBroken = true;
      }
    }
    const base = this.getLocalModel();
    const scaled = scaleSupportModel(
      base,
      query.scales[0],
      query.scales[1],
      query.scales[2]
    );
    return findOptimalAngle(
      scaled,
      onProgress,
      query.maxHeightMM,
      query.modelWeightG,
      undefined,
      false,
      query.params
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
      entry.reject(new Error("摆盘客户端已释放"));
    }
    this.pending.clear();
    this.localModel = null;
    this.localPositions = null;
  }
}
