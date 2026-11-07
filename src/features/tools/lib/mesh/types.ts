/**
 * 模型检查 · 共享类型定义
 *
 * 移植自 wjp-model-checker-source/src/lib/mesh/types.ts
 *
 * 单位约定:模型坐标单位视为 mm(3D 打印惯例),打印方向为 +Z(Z-up)。
 *
 * 检测范围(按 WJP 全彩工艺标准):
 * - 反转法向(整体朝内 / 局部翻转面)
 * - 坏边:缝隙(开放边)、平面孔洞(平面上的闭合孔洞)、非流形边、退化面、重复面
 * - 壳体(连通分量 / 多余壳体 / 噪声壳体)
 *
 * 不检测悬空,不做壁厚检测 —— WJP 用水溶性包裹支撑,90° 水平悬空也能印;
 * 全彩是实心填充,不存在「壁薄会断」的问题。
 */

/** 原始三角面片(三角汤) */
export interface RawMesh {
  name: string;
  /** 9 floats per triangle: v0(x,y,z) v1 v2 */
  positions: Float32Array;
}

/** 每个三角形的标记位 */
export const FACE_FLAG = {
  DEGENERATE: 1, // 退化面(零面积 / 顶点重合)
  DUPLICATE: 2, // 重复面(与另一面顶点完全重合)
  FLIPPED: 4, // 法线翻转(局部绕向与周围不一致,或整体朝内的壳)
  SHELL_EXTRA: 8, // 非主壳体(多余 / 独立部件)
  SHELL_NOISE: 16, // 噪声壳体(微小碎片)
} as const;

/**
 * 可本地化的文案引用
 *
 * 分析层不拼字符串,只给 i18n key + 参数;UI 层用 next-intl 渲染,
 * 这样中文 / 英文页面读到的都是对应语言的文案。
 */
export interface MessageRef {
  /** i18n key,例如 "warnings.openEdges" */
  key: string;
  /** ICU 参数,例如 { count: 12 } */
  params?: Record<string, string | number>;
}

/** 问题区域聚类(点击可聚焦) */
export interface IssueCluster {
  id: number;
  kind: "flipped" | "degenerate" | "duplicate";
  /** 聚类中心(用于 3D 聚焦) */
  centroid: [number, number, number];
  /** 面片数量 */
  count: number;
  /** 表面积 mm² */
  area: number;
}

/** 边界环(孔洞 / 破口)信息 */
export interface BoundaryLoopInfo {
  id: number;
  /** 是否闭合(闭合 = 孔洞;不闭合 = 裂缝 / 破口) */
  closed: boolean;
  /** 闭合且整体位于一个平面内 → 平面孔洞,可用平面补丁修补 */
  planar: boolean;
  /** 环上边界边数量 */
  edgeCount: number;
  /** 环中心(用于 3D 聚焦) */
  centroid: [number, number, number];
}

/** 单个壳体(连通分量)信息 */
export interface ShellInfo {
  index: number;
  /** 有效(非退化)面片数 */
  faceCount: number;
  /** 有符号体积(法线朝外为正) */
  volume: number;
  /** 无开放边且无非流形边 */
  closed: boolean;
  openEdges: number;
  nonManifoldEdges: number;
  /** 包围盒对角线 mm */
  bboxDiag: number;
  /** 包围盒中心(用于 3D 聚焦) */
  centroid: [number, number, number];
  /** 面片数 / 体积最大的主壳体 */
  isPrimary: boolean;
  /** 被外壳包裹的封闭内壳(密封内腔,WJP 无法清除内部支撑) */
  isCavity: boolean;
  /** 被外壳包裹但不封闭的碎片壳 */
  isDebris: boolean;
  /** 噪声壳体(相对整体极小的碎片) */
  isNoise: boolean;
  /** 封闭壳整体法线朝内 */
  globalInverted: boolean;
}

export interface AnalysisStats {
  fileName: string;
  vertexCount: number; // 焊接后顶点数
  triangleCount: number;
  componentCount: number; // 壳体数
  watertight: boolean; // 水密(无开放边且无非流形边)
  volumeMm3: number; // 有符号体积,正值 = 法线朝外
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  // 反转法向
  flippedFaceCount: number; // 局部翻转面(不含整体反转整壳的面)
  globalInvertedShellCount: number; // 整体法线朝内的封闭壳数量
  // 破面 / 坏边
  degenerateCount: number;
  duplicateFaceCount: number;
  duplicatePairCount: number;
  openEdgeCount: number; // 缝隙:开放边数量
  crackChainCount: number; // 未闭合的边界链(裂缝 / 破口)
  holeCount: number; // 闭合孔洞
  planarHoleCount: number; // 平面孔洞
  nonManifoldEdgeCount: number;
  // 壳体
  extraShellCount: number; // 非主壳体数(不含噪声)
  noiseShellCount: number;
  cavityShellCount: number;
  enclosedOpenShellCount: number; // 被包裹的碎片壳
  sealedHollow: boolean; // 存在被外壳包裹的封闭内壳
  // 其它
  analysisMs: number;
}

export interface AnalysisResult {
  /** 每面标记位,见 FACE_FLAG */
  flags: Uint8Array;
  /** 每面所属壳体(连通分量)索引,-1 = 退化面 */
  faceComponent: Int32Array;
  /** 缝隙:开放边线段 [ax,ay,az,bx,by,az]*n(同时用作轮廓线数据) */
  openEdges: Float32Array;
  /** 非流形边线段 */
  nonManifoldEdges: Float32Array;
  /** 平面孔洞轮廓线段 */
  planarHoleEdges: Float32Array;
  /** 边界环信息(孔洞 / 裂缝) */
  holeLoops: BoundaryLoopInfo[];
  /** 壳体列表 */
  shells: ShellInfo[];
  clusters: IssueCluster[];
  stats: AnalysisStats;
  /** 提示文案(结构化,UI 层负责本地化) */
  warnings: MessageRef[];
  /** 包裹支撑外壳几何(用于「包裹支撑」开关显示) */
  supportShell: SupportShellData | null;
}

/**
 * 包裹支撑几何:沿焊接顶点平滑法线外扩 supportGap 后的网格(WJP 水溶性支撑示意)。
 * 顶点 z 已钳制在平台平面(模型自身最低点)之上:支撑材料落在平台上。
 */
export interface SupportShellData {
  /** 外扩后的顶点位置(vertexCount × 3) */
  positions: Float32Array;
  /** 完整三角形索引(3 × faceCount,含下朝向面),用于压平生成平台投影 / 占地区域 */
  index: Uint32Array;
  /** 外壳渲染索引(已剔除下朝向面):该区域由支撑体顶面负责,避免两层半透明面叠加 */
  topIndex: Uint32Array;
  /**
   * 支撑体顶面(三角汤,无索引):下朝向面片本身。
   * WJP 逐层喷射不存在悬空:平台到模型之间全部为支撑材料,下朝向面即支撑的上边界。
   */
  underside: Float32Array;
  /**
   * 支撑体外壁(三角汤,无索引):下朝向区域的边界边竖直向下挤出至平台平面,
   * 内部共享边不挤出,避免体积内部出现多层半透明墙面。
   */
  curtain: Float32Array;
  /** 外扩间隙 mm(随模型尺寸自适应) */
  gap: number;
  /**
   * 平台平面的 z(模型坐标):模型自身最低点略下方。
   * 主线程把整组几何平移 -bboxMin.z 后,模型最低点恰好落在打印平台上。
   * 2026-11-02:以前主线程自己重算一遍(`bb.min.z - max(0.05, diag*0.002)`),
   * 现在由生成方直接给出 —— 克重工具也算支撑,两边的平台平面必须一致。
   */
  groundZ: number;
  /**
   * 下朝向面索引(已剔除内腔 / 包裹碎片)。
   * 克重工具按列算支撑体积时用它标出「支撑材料的上边界」,
   * 判定口径和检测工具画支撑体时完全一致。
   */
  downFaces: Uint32Array;
  /**
   * 底板留边那一圈(三角汤,无索引):模型轮廓按欧氏距离外扩 `baseMarginMM`
   * 之后多出来的那圈格子,平铺在平台平面上。
   *
   * 工作室的工艺:底板比模型轮廓四周各留一圈边,那圈边也是实心支撑 ——
   * **克重那边算进去了**,画面上原来没画。两个视角并排看,差的就是这一圈。
   *
   * 跟算支撑体积用的是**同一张栅格 + 同一套外扩**,所以画出来的边界就是
   * 算克重时的边界。没有留边时是空数组。
   */
  baseRing: Float32Array;
}

/** 分析进度阶段(UI 层按 locale 显示) */
export type ProgressStage = "weld" | "shells" | "cluster" | "support" | "done";

export type WorkerInMessage =
  | {
      type: "analyze";
      seq: number;
      positions: Float32Array;
      fileName: string;
      /**
       * 托底高度 (mm) —— 支撑外壳的平台平面在模型最低点下方多远
       *
       * 不传 = `SUPPORT_LIFT_MM`(5mm)。**2026-11-06 起跟随后台**
       * (`/admin/print-pricing`)—— 模型检查页画的支撑跟克重工具算的
       * 必须是同一个几何。
       */
      liftMm?: number | undefined;
      /**
       * 底板留边 (mm) —— 底板比模型轮廓四周各留多宽
       *
       * 不传 = `SUPPORT_BASE_MARGIN_MM`(5mm)。**跟随后台**
       * (`/admin/print-pricing`)—— 检查视角画的底板跟克重工具算的支撑克重
       * 必须是同一个几何(那一圈边也是实心支撑,算进克重)。
       */
      baseMarginMm?: number | undefined;
    }
  | { type: "reset" };

export type WorkerOutMessage =
  | { type: "progress"; seq: number; stage: ProgressStage; pct: number }
  | { type: "result"; seq: number; result: AnalysisResult }
  | { type: "error"; seq: number; message: string };

export const ISSUE_COLORS = {
  flipped: "#ff2d55", // 法线翻转面
  degenerate: "#a78bfa", // 退化面
  duplicate: "#d946ef", // 重复面
  shellExtra: "#2dd4bf", // 非主壳体
  shellNoise: "#f472b6", // 噪声壳体
  openEdge: "#ff6b35", // 缝隙(开放边)
  planarHole: "#bf5af2", // 平面孔洞
  nonManifoldEdge: "#a3e635", // 非流形边
  outline: "#67e8f9", // 边界轮廓
} as const;

/** 图例 / 提示用的 i18n key 后缀(与 ISSUE_COLORS 一一对应) */
export const ISSUE_LABEL_KEYS = {
  flipped: "flipped",
  degenerate: "degenerate",
  duplicate: "duplicate",
  shellExtra: "shellExtra",
  shellNoise: "shellNoise",
  openEdge: "openEdge",
  planarHole: "planarHole",
  nonManifoldEdge: "nonManifoldEdge",
  outline: "outline",
} as const;

/** 非主壳体着色(按壳体索引循环) */
export const SHELL_COLORS = [
  "#2dd4bf",
  "#f97316",
  "#4ade80",
  "#38bdf8",
  "#e879f9",
  "#facc15",
  "#fb7185",
  "#a3e635",
] as const;
