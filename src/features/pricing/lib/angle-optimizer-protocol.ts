/**
 * 智能摆盘 Worker 的消息协议(主线程 ↔ Worker 共用)
 *
 * 摆盘要在 625 个候选姿态上各算一遍包裹支撑体积(每个姿态都要旋转网格 +
 * 按列求交),主线程跑这个循环会**冻结页面几秒**(大模型更久)—— 用户点一下
 * 「智能摆盘」,整页点不动。所以搜索搬到 Worker 里跑,主线程只收进度和结果。
 *
 * 消息里带 `seq`:主线程用序号认领响应,过期的一律丢掉(拖滑块时会有
 * 多个请求排队)。
 */

import type {
  OptimalAngle,
  SupportParams,
  SupportPoseResult,
} from "@/features/pricing/lib/angle-optimizer";
import type { MeshCheckSummary } from "@/features/tools/lib/mesh/summary";

/** 主线程 → Worker */
export type AngleWorkerIn =
  /** 交几何:Worker 里焊接 + 建拓扑(这一步最吃 CPU,别放主线程) */
  | {
      type: "load";
      seq: number;
      modelId: string;
      positions: Float32Array;
      /** 文件名 —— 自检摘要里要显示,不带就空着 */
      fileName?: string | undefined;
    }
  /** 算单个姿态的支撑(拖角度滑块 / 初始角度都用它) */
  | {
      type: "pose";
      seq: number;
      modelId: string;
      rotX: number;
      rotY: number;
      rotZ: number;
      scales: [number, number, number];
      params: SupportParams;
    }
  /** 智能摆盘:搜索支撑克重最小的姿态 */
  | {
      type: "search";
      seq: number;
      modelId: string;
      scales: [number, number, number];
      maxHeightMM: number;
      modelWeightG: number;
      params: SupportParams;
    };

/** Worker → 主线程 */
export type AngleWorkerOut =
  /**
   * 焊接完成
   *
   * `summary` 是**网格自检摘要** —— 焊接时顺手算出来的,主线程拿来显示
   * 「打印前检查」徽标(用户不用把同一个文件再拖进检查工具)。
   */
  | {
      type: "loaded";
      seq: number;
      modelId: string;
      summary: MeshCheckSummary;
    }
  | { type: "pose"; seq: number; result: SupportPoseResult }
  | { type: "progress"; seq: number; percent: number }
  | { type: "search"; seq: number; result: OptimalAngle }
  | { type: "error"; seq: number; message: string };
