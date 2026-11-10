/**
 * 磁吸孔切割 Worker 的消息协议
 *
 * 形状照抄 `pricing/lib/angle-optimizer-protocol.ts` —— 那边是仓库里唯一
 * 一份「Worker 收/发消息类型」的样子,跟着它走省得再发明一套。
 *
 * ## 为什么要有 seq
 *
 * Worker 的回包**不保证按请求顺序回来**(主线程连发两条指令,第二条可能先回)。
 * 每条请求带一个自增序号,客户端只认自己那条 —— 过期回包直接丢掉。
 */
import type { MagnetFaceId, MagnetFaceVerdict } from "./magnet-params";

/** 一个候选面的体检结果 */
export type MagnetFaceReport = {
  faceId: MagnetFaceId;
  /** 这个面**朝外**的方向(单位向量) */
  direction: [number, number, number];
  /** 射线打中没有 */
  hit: boolean;
  /**
   * 平整度(度)—— 面的法线跟射线的夹角
   *
   * 0° = 面跟射线**完全垂直**(最平);180° = 完全平行(最斜)。
   */
  flatnessDeg: number;
  /** 命中点 */
  point: [number, number, number];
  /** 命中面的朝外单位法线 */
  normal: [number, number, number];
  /** 命中点的局部厚度(mm)—— 沿朝内方向量到下一个面 */
  thicknessMm: number | null;
  /** 命中点到面边缘的净空(mm)—— 孔要放得下就得 ≥ 孔半径 */
  clearanceMm: number | null;
  /** 能不能切 */
  verdict: MagnetFaceVerdict;
};

/** 切完之后的产物 */
export type MagnetCutOutcome = {
  /** 切完的三角汤(9 floats/tri)—— 拿去画 + 导出 */
  positions: Float32Array;
  /** 切之前的体积(mm³) */
  volumeBefore: number;
  /** 切之后的体积(mm³) */
  volumeAfter: number;
  /** 实际去掉多少(mm³) */
  removedVolume: number;
  /** 理论上去掉多少(mm³)—— 两者对不上就说明孔切到边上去了 */
  expectedRemovedVolume: number;
  /** 切完的三角形数 */
  triangleCount: number;
};

/** 分析(挑面)的结果 */
export type MagnetAnalyzeOutcome = {
  faces: MagnetFaceReport[];
  /** 切之前的体积(mm³) */
  volume: number;
  /** 包围盒 */
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
};

/** Worker 回的错 —— 带稳定的 code,界面按 code 查文案 */
export type MagnetErrorCode =
  /** 模型不是封闭流形(有开放边 / 非流形边) */
  | "NOT_MANIFOLD"
  /** 模型整体法线朝内 */
  | "INVERTED_WINDING"
  /** 模型是空的 / 退化 */
  | "EMPTY_MODEL"
  /** 布尔运算失败 */
  | "BOOLEAN_FAILED"
  /** 切完的面数锐减(切坏了) */
  | "FACE_COUNT_COLLAPSED"
  /** 切完的面数没变(没切进去) */
  | "NOTHING_CUT"
  /** 体积没减少(切了个寂寞) */
  | "VOLUME_UNCHANGED"
  /** 去掉量比理论值少太多 —— 孔切到边上去了 */
  | "HOLE_SPILLED"
  /** 那个面太薄 / 净空不够 */
  | "FACE_NOT_CUTTABLE";

export type MagnetWorkerIn =
  | {
      type: "analyze";
      seq: number;
      positions: Float32Array;
    }
  | {
      type: "cut";
      seq: number;
      positions: Float32Array;
      faceId: MagnetFaceId;
    };

export type MagnetWorkerOut =
  | { type: "analyze"; seq: number; result: MagnetAnalyzeOutcome }
  | { type: "cut"; seq: number; result: MagnetCutOutcome }
  | {
      type: "error";
      seq: number;
      code: MagnetErrorCode;
      message: string;
    };
