/**
 * 摆盘角度优化 —— 耗材克重报价计算器(PolyJet / WJP 全彩打印)
 *
 * 2026-11-02:**支撑体积改用模型检查工具的包裹支撑算法**
 * (`src/features/tools/lib/mesh/support-shell.ts`)。
 *
 * ## 之前的问题
 *
 * 这里原来有一套自己的「PolyJet 双体积公式」:
 *   总支撑克重 = (外壳包裹体积 + 底部填充体积) × 填充率 × 密度
 *   外壳包裹体积 = 下半部分表面积 × 壳厚
 *   底部填充体积 = max(0, 投影面积 × 包裹顶部Z − 模型体积)
 *
 * 而模型检查工具(`/tools/model-check`)画出来的包裹支撑是**另一套几何**
 * (平台 → 下朝向面之间的包裹体)。同一个模型,两个工具给两个数 ——
 * 用户在检测工具里看到的支撑体,和在克重工具里算出来的克重对不上。
 *
 * ## 现在的算法
 *
 * 两边共用 `support-shell.ts`:
 *   - 焊接 + 拓扑(姿态无关)→ 只做一次(`prepareSupportModel`)
 *   - 每个候选姿态:旋转顶点与法线 → 生成包裹外壳 → 按列算支撑体积
 *
 * 支撑体积按列(height field)算,但**列里的模型材料不一定是连续的一段**:
 * 一列穿过模型表面得到一串 z 交点,按奇偶配对,相邻两个交点之间是模型材料,
 * 空出来的那几段才是支撑。「蘑菇」(宽帽 + 细腿)算出来是帽子下面那圈空间,
 * 「宽底座 + 细身体」也不会因为底座盖住身体就漏掉悬空那圈。
 *
 * 体积走**真几何**(网格自己的顶点),跟模型克重同一口径 —— 检测工具
 * 画外壳时那圈间隙(对角线 2%,0.8~5mm)只是可视化,不进克重。
 *
 * ## 三个克重的关系(2026-11-04 改成双密度)
 *
 *   全包裹体积 = 平台到模型顶的整块(支撑 + 模型)—— `wrapVolumeMM3`
 *   支撑体积   = 全包裹体积 − 模型体积            —— `supportVolumeMM3`
 *
 *   耗材克重 = 模型体积 × 模型密度
 *   支撑克重 = 支撑体积 × **支撑密度**
 *   总克重   = 耗材克重 + 支撑克重
 *
 * **支撑跟模型不是一种材料**:工作室用的是**水溶性支撑**(PVA/BVOH,
 * 约 1.13~1.30 g/cm³),模型是光敏树脂(约 1.1~1.3 g/cm³)—— 两个密度
 * 分开算,所以两条老恒等式**不再成立**:
 *
 *   - 「总克重 = 全包裹体积 × 单一密度」—— 全包裹里是两种材料,乘不出来
 *   - 「支撑克重 = 全包裹克重 − 模型克重」—— 那个减法要同一个密度才成立
 *
 * 打印出来还没洗支撑时,整块称重就是「总克重」;洗掉支撑、只剩模型时就是
 * 「耗材克重」—— 两个一减 = 支撑材料的净重(这个减法跟密度无关,一直成立)。
 *
 * ## 尺寸缩放(2026-11-03)
 *
 * 用户调过尺寸之后,支撑计算必须跑在**缩放后**的网格上
 * (`scaleSupportModel`:只挪顶点,拓扑不变,不用重新焊接)。
 * 之前是拿原始网格的支撑体积乘一个缩放系数 —— 体积上恰好对(支撑区域
 * 在线性缩放下是自映射的,体积乘 det S),但**高度、投影、悬垂面全错**:
 * 非均匀缩放(比如只把 Z 拉高)时,模型真实高度翻倍,乘系数却只涨了
 * 立方根,50mm 高度限制会放行一堆立不住的姿态,摆出来的支撑克重也跟着错。
 *
 * ## 摆盘策略
 *
 *   1. 平面模型(Z ≤ 最短轴 × 0.5)→ 直接平放
 *   2. 其余:先剔除旋转后高度 > maxHeightMM 的候选(立着超过 50mm 不给印),
 *      再在剩下的里优先选「彩色面没被包裹」的姿态,其次选支撑克重最小的
 */

import {
  buildSupportShell,
  computeSupportVolume,
  prepareSupportModel,
  rotateSupportMesh,
  type SupportModel,
} from "@/features/tools/lib/mesh/support-shell";
import type { SupportShellData } from "@/features/tools/lib/mesh/types";

export type OptimalAngle = {
  /** 绕 X 轴旋转角度（度） */
  rotX: number;
  /** 绕 Y 轴旋转角度（度） */
  rotY: number;
  /** 本体支撑比例（无单位）：支撑克重 / 模型克重。>1 表示支撑比模型本身还重。 */
  selfSupportRatio: number;
  /** 支撑底面占地 (mm²)：平台上被支撑体占住的面积 */
  selfSupportArea: number;
  /** 总支撑比例（无单位）：与 selfSupportRatio 相同（保持兼容性） */
  totalSupportRatio: number;
  /** 总支撑克重 (g) */
  totalSupportWeight: number;
  /** 总表面积 (cm²) */
  totalArea: number;
  /** 旋转后的模型高度 (mm) */
  rotatedHeight: number;
  /** 是否躺平摆放 */
  laidFlat: boolean;
  /** 旋转后悬垂面面积 (mm²)：仅法线朝下且 >45° 的三角面面积之和 */
  overhangArea?: number;
  /** 旋转后被包裹的彩色表面面积 (mm²)：下朝向的彩色面(支撑体会盖住它们) */
  coloredDownArea?: number;
  /** 下朝向面总面积 (mm²)：支撑顶面与模型的接触面积 */
  wrapArea?: number;
  /** 包裹支撑体积 (mm³)：平台到下朝向面之间的支撑材料 */
  supportVolume?: number;
  /** 全包裹体积 (mm³)：平台到模型顶的整块(支撑 + 模型) */
  wrapVolume?: number;
  /** 原始姿态（rotX=0, rotY=0）的支撑克重 (g)：用于对比 */
  originalWeight?: number;
  /** 原始姿态的支撑克重与最优姿态的比值（>1 表示原始姿态支撑更多） */
  originalRatio?: number;
};

/**
 * 支撑计算参数 —— **两个密度**
 *
 * 支撑跟模型**不是一种材料**(2026-11-04 改):
 *
 *   模型 = 光敏树脂(约 1.1~1.3 g/cm³)
 *   支撑 = 水溶性支撑 PVA / BVOH(约 1.13~1.30 g/cm³),打印完水洗掉
 *
 * 所以克重是**双密度**的:
 *
 *   耗材克重 = 模型体积 × 模型密度
 *   支撑克重 = 支撑体积 × 支撑密度
 *   总克重   = 耗材克重 + 支撑克重
 *
 * 「总克重 = 全包裹体积 × 单一密度」这条老恒等式**不再成立** —— 全包裹
 * 里是两种材料,乘一个密度算不出总重。
 *
 * 支撑体积完全由几何决定(平台到模型下表面之间的空腔),跟密度无关。
 */
export type SupportParams = {
  /** 模型材料密度 (g/cm³) —— 耗材克重用这个 */
  modelDensity: number;
  /**
   * 支撑材料密度 (g/cm³)
   *
   * 省略 = 跟模型同一种材料(同材料支撑的老口径)。给了就是另一种材料,
   * 支撑克重按这个密度算。
   */
  supportDensity?: number | undefined;
  /**
   * 托底高度 (mm) —— 平台面在模型最低点下方多远
   *
   * 省略 = 用 `SUPPORT_LIFT_MM`(5mm)。**2026-11-06 起由工作室在
   * `/admin/print-pricing` 里配**,从这里一路传到 Worker。
   */
  liftMm?: number | undefined;
  /**
   * 底板留边 (mm) —— 底板比模型轮廓四周各留多宽
   *
   * 省略 = 用 `SUPPORT_BASE_MARGIN_MM`(5mm)。同上,后台可配。
   */
  baseMarginMm?: number | undefined;
};

export const DEFAULT_SUPPORT_PARAMS: SupportParams = {
  modelDensity: 1.2,
  // 支撑是另一种材料(水溶性支撑 PVA/BVOH),密度比模型高一点 ——
  // 默认 1.28,跟工作室对数用的口径一致(见 pricing-engine.ts 的 DEFAULT_CONFIG)
  supportDensity: 1.28,
};

/**
 * 实际生效的支撑密度 —— 没给支撑密度就当跟模型同一种材料
 *
 * 密度非法(≤0 / NaN)时也退回模型密度:克重算不出来不能变成 NaN。
 */
export function resolveSupportDensity(params: SupportParams): number {
  const d = params.supportDensity ?? params.modelDensity;
  return Number.isFinite(d) && d > 0 ? d : params.modelDensity;
}

/** 悬垂阈值：法线 z 分量 < -cos(45°) ≈ -0.707 时为悬垂面（>45° 倾斜朝下） */
const OVERHANG_NORMAL_Z_THRESHOLD = -Math.SQRT1_2;

/** 单个姿态下的支撑数据 */
export type SupportPoseResult = {
  /** 包裹支撑体积 (mm³) —— 支撑材料本身 */
  supportVolumeMM3: number;
  /**
   * 全包裹体积 (mm³) —— 平台到模型顶的整块(支撑 + 模型)
   *
   * 打印出来还没洗支撑时,整块就是这个体积。**里面是两种材料**
   * (模型 + 支撑),所以乘一个密度算不出总克重。
   */
  wrapVolumeMM3: number;
  /** 支撑克重 (g) */
  supportWeightG: number;
  /** 下朝向面总面积 (mm²)：支撑顶面与模型的接触面积 */
  wrapAreaMM2: number;
  /** 悬垂面面积 (mm²)：法线 z < -cos45° */
  overhangAreaMM2: number;
  /** 彩色面中被包裹(下朝向)的面积 (mm²) */
  coloredWrapAreaMM2: number;
  /** 模型 XY 投影面积 (mm²) */
  projectedAreaMM2: number;
  /** 有支撑的投影面积 (mm²)：支撑体在平台上的占地 */
  supportAreaMM2: number;
  /** 旋转后的模型高度 (mm) */
  rotatedHeightMM: number;
  /**
   * **画出来的**那圈支撑几何(外壳 / 顶面 / 外壁 / 底板留边)
   *
   * 3D 预览画的那圈支撑必须跟算克重的那块支撑是**同一块几何** —— 所以
   * 渲染用的外壳跟算体积用的外壳在同一次调用里建出来,不是各建一遍。
   *
   * 只有要画的时候才建(摆盘搜索 625 个姿态时不建,省掉大半开销),
   * 所以它是可选的。
   */
  shell?: SupportShellData | undefined;
};

/**
 * 模型总表面积 (mm²) —— 网格面片面积之和
 *
 * 直接从(已缩放的)网格算,不从外面传表面积进来:用户改了尺寸之后,
 * 解析阶段那个表面积就对不上了。
 */
export function totalSurfaceAreaMM2(model: SupportModel): number {
  const areas = model.mesh.faceAreas;
  let sum = 0;
  for (let f = 0; f < model.mesh.faceCount; f++) sum += areas[f]!;
  return sum;
}

/**
 * 计算单个姿态下的包裹支撑(检测工具算法)
 *
 * @param model 备好的模型(焊接一次,之后每个姿态只旋转)
 * @param rotXDeg X 轴旋转角度
 * @param rotYDeg Y 轴旋转角度
 * @param rotZDeg Z 轴旋转角度
 * @param params 两个密度:模型密度 + 支撑密度(支撑是另一种材料),
 *   外加托底高度 / 底板留边(后台配的几何参数)
 * @param opts.gridSizeMM 栅格精度(mm),默认 1
 * @param opts.baseMarginMM 底板留边(mm)—— 底板比模型轮廓四周各留多宽,
 *   默认取 `params.baseMarginMm`,再退回 `SUPPORT_BASE_MARGIN_MM`(5)。
 *   工作室的工艺:底板比模型大一圈。
 * @param opts.coloredFaceMask 每个面的彩色标记(1 = 有贴图)
 * @param opts.withShell 顺带把**画出来的**支撑几何带回去(外壳 / 顶面 /
 *   外壁 / 底板留边)。3D 预览画的那圈支撑必须跟算克重的是同一块几何 ——
 *   渲染用的外壳跟算体积用的外壳在**同一次调用**里建出来,不是各建一遍。
 *   摆盘搜索(625 个姿态)不传,省掉大半开销。
 */
export function computeSupportAtPose(
  model: SupportModel,
  rotXDeg: number,
  rotYDeg: number,
  rotZDeg: number,
  params: SupportParams = DEFAULT_SUPPORT_PARAMS,
  opts?: {
    gridSizeMM?: number | undefined;
    baseMarginMM?: number | undefined;
    coloredFaceMask?: Uint8Array | null | undefined;
    withShell?: boolean | undefined;
  }
): SupportPoseResult {
  const rotated = rotateSupportMesh(model.mesh, rotXDeg, rotYDeg, rotZDeg);
  // 克重只要体积 + 下朝向面:外壳的顶面 / 外壁 / 渲染索引都省掉。
  // 外壳间隙(可视化用的)不参与计算 —— 体积走真几何。
  //
  // 几何参数(托底 / 留边)来自后台 —— 一次调用里两处(外壳 + 体积)必须用
  // 同一份,否则外壳画的跟算出来的对不上。
  const liftMm = params.liftMm;
  const baseMarginMM = opts?.baseMarginMM ?? params.baseMarginMm;
  const withShell = opts?.withShell === true;
  const shell = buildSupportShell(rotated, model.faceEnclosed, {
    includeCurtain: withShell,
    includeTopIndex: withShell,
    liftMm,
    baseMarginMM,
    // 底板那一圈的栅格跟算体积用的是**同一个** —— 差半格到几格的话,
    // 画出来的底板跟算进去的底板就对不上了。
    gridSizeMM: opts?.gridSizeMM,
    includeBaseRing: withShell,
    // 外壳带上**算它时的姿态** —— 视口拿它摆平台之前要核对:
    // 姿态对不上的外壳(旧姿态算的那块)会把模型摆到平台下面去。
    pose: { rotX: rotXDeg, rotY: rotYDeg, rotZ: rotZDeg },
  });
  const volume = computeSupportVolume(shell, rotated, {
    gridSizeMM: opts?.gridSizeMM,
    baseMarginMM,
    liftMm,
  });

  // 下朝向面 = 支撑顶面(支撑材料贴着模型的那一面)
  const mask = opts?.coloredFaceMask;
  const faceAreas = rotated.faceAreas;
  let coloredWrapArea = 0;
  for (let i = 0; i < shell.downFaces.length; i++) {
    const f = shell.downFaces[i]!;
    if (mask && mask[f] === 1) coloredWrapArea += faceAreas[f]!;
  }

  // 悬垂面(>45° 朝下):只用于摆盘参考,不进克重公式
  let overhangArea = 0;
  for (let f = 0; f < rotated.faceCount; f++) {
    if (rotated.faceNormals[f * 3 + 2]! < OVERHANG_NORMAL_Z_THRESHOLD) {
      overhangArea += faceAreas[f]!;
    }
  }

  // mm³ × (g/cm³ → g/mm³)
  // 支撑是实心的(填充率跟模型一样 = 100%),但密度用**支撑材料**自己的 ——
  // 支撑跟模型不是一种材料(水溶性支撑),拿模型密度乘是错的
  const supportWeightG =
    volume.volumeMM3 * resolveSupportDensity(params) * 0.001;

  return {
    supportVolumeMM3: volume.volumeMM3,
    wrapVolumeMM3: volume.wrapVolumeMM3,
    supportWeightG,
    wrapAreaMM2: volume.contactAreaMM2,
    overhangAreaMM2: overhangArea,
    coloredWrapAreaMM2: coloredWrapArea,
    projectedAreaMM2: volume.footprintAreaMM2,
    supportAreaMM2: volume.supportAreaMM2,
    rotatedHeightMM: rotated.bboxMax[2] - rotated.bboxMin[2],
    shell: withShell ? shell : undefined,
  };
}

/**
 * 旧版 API 保留：兼容旧调用（返回结构与之前一致，但内部使用新算法）
 */
export function computeExternalSurfaceArea(positions: Float32Array): number {
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;
  const vertCount = positions.length / 3;
  for (let i = 0; i < vertCount; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const dimX = maxX - minX;
  const dimY = maxY - minY;
  const dimZ = maxZ - minZ;
  return 2 * (dimX * dimY + dimX * dimZ + dimY * dimZ);
}

/** @deprecated 保留兼容性 */
export function computeEffectiveExternalSurface(
  positions: Float32Array
): number {
  const triCount = positions.length / 9;
  let totalTriangleArea = 0;
  for (let i = 0; i < triCount; i++) {
    const base = i * 9;
    const ax = positions[base]!,
      ay = positions[base + 1]!,
      az = positions[base + 2]!;
    const bx = positions[base + 3]!,
      by = positions[base + 4]!,
      bz = positions[base + 5]!;
    const cx = positions[base + 6]!,
      cy = positions[base + 7]!,
      cz = positions[base + 8]!;
    const ex = bx - ax,
      ey = by - ay,
      ez = bz - az;
    const fx = cx - ax,
      fy = cy - ay,
      fz = cz - az;
    const crossX = ey * fz - ez * fy;
    const crossY = ez * fx - ex * fz;
    const crossZ = ex * fy - ey * fx;
    const len = Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
    totalTriangleArea += len / 2;
  }
  const bboxArea = computeExternalSurfaceArea(positions);
  return Math.min(totalTriangleArea, bboxArea);
}

/** @deprecated 保留兼容性 */
export function computeRotatedExternalSurface(
  positions: Float32Array,
  _rotXDeg: number,
  _rotYDeg: number,
  _rotZDeg: number = 0
): number {
  return computeEffectiveExternalSurface(positions);
}

/**
 * 计算给定角度下的支撑克重和本体支撑比例（用于手动角度调整时实时重算）
 *
 * @param model 备好的模型(焊接一次)—— **必须已经是实际尺寸**:用户调过尺寸
 *   之后支撑要按真实几何算(见 `scaleSupportModel`),这里不再乘任何缩放系数
 * @param rotXDeg X 轴旋转角度
 * @param rotYDeg Y 轴旋转角度
 * @param modelWeightG 模型本体克重（g,已按实际尺寸算）
 * @param rotZDeg Z 轴旋转角度
 * @param coloredFaceMask 彩色面标记
 * @param params 两个密度:模型密度 + 支撑密度(支撑是另一种材料)
 */
export function computeSupportAtAngle(
  model: SupportModel,
  rotXDeg: number,
  rotYDeg: number,
  modelWeightG: number,
  rotZDeg: number = 0,
  coloredFaceMask?: Uint8Array | null,
  params: SupportParams = DEFAULT_SUPPORT_PARAMS
): { supportWeight: number; supportRatio: number } {
  const pose = computeSupportAtPose(model, rotXDeg, rotYDeg, rotZDeg, params, {
    coloredFaceMask,
  });

  const supportRatio =
    modelWeightG > 0 ? pose.supportWeightG / modelWeightG : 0;

  return { supportWeight: pose.supportWeightG, supportRatio };
}

/**
 * 智能搜索最优打印角度（包裹支撑算法 + 彩色面硬保护）
 *
 * 策略：
 * 1. 平面模型（Z ≤ 最短轴×0.5）→ 直接平放
 * 2. 非平面模型 → 在高度合规（旋转后 ≤ maxHeightMM）的候选中：
 *    a. 首选彩色面没被包裹的姿态（支撑体不盖住贴图表面）
 *    b. 若无这样的姿态，选彩色被包裹面积最小的
 *    c. 同组内选支撑克重最小的
 *
 * @param model 备好的模型(焊接一次)—— **必须已经是实际尺寸**:高度限制
 *   要拿真实高度判,支撑克重也要按真实几何算(见 `scaleSupportModel`)
 * @param onProgress 进度回调
 * @param maxHeightMM 高度阈值：旋转后超过这个高度就不给印
 * @param modelWeightG 模型本体克重（g,已按实际尺寸算）
 * @param coloredFaceMask 每个面的彩色标记
 * @param coarseMode 拖拽中粗算模式：栅格 3mm，步长 30°
 * @param params 两个密度:模型密度 + 支撑密度(支撑是另一种材料)
 */
export function findOptimalAngle(
  model: SupportModel,
  onProgress?: (percent: number) => void,
  maxHeightMM: number = 50,
  modelWeightG: number = 0,
  coloredFaceMask?: Uint8Array | null,
  coarseMode: boolean = false,
  params: SupportParams = DEFAULT_SUPPORT_PARAMS
): OptimalAngle {
  // 候选角度范围：-180° 到 180°（覆盖完整 360° 旋转）
  // 这样可以找到「翻转」角度（如 180° X 翻转，让模型底部朝上）
  // 粗算步长 30°（13×13=169 候选），精算步长 15°（25×25=625 候选）
  const step = coarseMode ? 30 : 15;
  const angles: number[] = [];
  for (let a = -180; a <= 180; a += step) angles.push(a);
  const gridSize = coarseMode ? 3 : 1;
  const hasColoredMask = coloredFaceMask != null && coloredFaceMask.length > 0;

  type Candidate = {
    rotX: number;
    rotY: number;
    supportWeight: number;
    supportVolume: number;
    wrapVolume: number;
    projectedArea: number;
    supportArea: number;
    overhangArea: number;
    coloredWrapArea: number;
    wrapArea: number;
    rotatedHeight: number;
  };
  const candidates: Candidate[] = [];

  const totalCombos = angles.length * angles.length;
  let combo = 0;
  let lastPct = -1;

  for (const rotX of angles) {
    for (const rotY of angles) {
      const pose = computeSupportAtPose(model, rotX, rotY, 0, params, {
        gridSizeMM: gridSize,
        coloredFaceMask,
      });
      candidates.push({
        rotX,
        rotY,
        supportWeight: pose.supportWeightG,
        supportVolume: pose.supportVolumeMM3,
        wrapVolume: pose.wrapVolumeMM3,
        projectedArea: pose.projectedAreaMM2,
        supportArea: pose.supportAreaMM2,
        overhangArea: pose.overhangAreaMM2,
        coloredWrapArea: pose.coloredWrapAreaMM2,
        wrapArea: pose.wrapAreaMM2,
        rotatedHeight: pose.rotatedHeightMM,
      });
      combo++;
      const pct = Math.round((combo / totalCombos) * 100);
      // 只在百分比变化时回调：625 次 setState 会把 React 拖垮
      if (pct !== lastPct) {
        lastPct = pct;
        onProgress?.(pct);
      }
    }
  }

  // 模型原始包围盒
  let origMinX = Infinity,
    origMaxX = -Infinity;
  let origMinY = Infinity,
    origMaxY = -Infinity;
  let origMinZ = Infinity,
    origMaxZ = -Infinity;
  const vertCount = model.mesh.vertexCount;
  for (let i = 0; i < vertCount; i++) {
    const x = model.mesh.vertices[i * 3]!;
    const y = model.mesh.vertices[i * 3 + 1]!;
    const z = model.mesh.vertices[i * 3 + 2]!;
    if (x < origMinX) origMinX = x;
    if (x > origMaxX) origMaxX = x;
    if (y < origMinY) origMinY = y;
    if (y > origMaxY) origMaxY = y;
    if (z < origMinZ) origMinZ = z;
    if (z > origMaxZ) origMaxZ = z;
  }
  const dimX = origMaxX - origMinX;
  const dimY = origMaxY - origMinY;
  const dimZ = origMaxZ - origMinZ;
  const minDim = Math.min(dimX, dimY, dimZ);
  const isFlatModel = dimZ <= minDim * 0.5;

  /**
   * 在候选列表中选出指定指标最小的项（列表为空时返回 undefined）
   */
  const pickSmallest = (
    list: Candidate[],
    metric: (c: Candidate) => number
  ): Candidate | undefined => {
    if (list.length === 0) return undefined;
    return list.reduce(
      (min, c) => (metric(c) < metric(min) ? c : min),
      list[0]!
    );
  };

  let best: Candidate | undefined;

  if (isFlatModel) {
    best =
      candidates.find((c) => c.rotX === 0 && c.rotY === 0) ?? candidates[0]!;
  } else {
    // ───────────────────────────────────────────────────────────────
    // 硬约束：旋转后模型高度不得超过 maxHeightMM（默认 50mm）
    //   原因：用户要求「模型超过 50mm 的都不能立着」
    //         PolyJet 工艺下，立式摆放会让模型在 Z 方向过高，打印时间长、支撑消耗大、且容易失败
    //   实现：先剔除所有 rotatedHeight > maxHeightMM 的候选
    //         若全部候选都超过限制（模型所有方向都 >50mm），则按高度升序取最低的 10% 兜底
    // ───────────────────────────────────────────────────────────────
    let eligibleCandidates = candidates.filter(
      (c) => c.rotatedHeight <= maxHeightMM
    );
    if (eligibleCandidates.length === 0) {
      // 模型所有方向都超过 maxHeightMM → 选最低的姿态（最接近限制）
      console.warn(
        `[findOptimalAngle] All candidates exceed maxHeightMM=${maxHeightMM}mm, ` +
          `falling back to lowest-height candidates`
      );
      const sortedByH = [...candidates].sort(
        (a, b) => a.rotatedHeight - b.rotatedHeight
      );
      const fallbackCount = Math.max(1, Math.floor(sortedByH.length * 0.1));
      eligibleCandidates = sortedByH.slice(0, fallbackCount);

      // 在 fallback 中，优先选择「正交姿态」（rotX、rotY ∈ {-90, 0, 90}）
      //   原因：当所有姿态都超 50mm 时，模型本来就不可能完全平躺。
      //         此时选「正交」（贴在某个完整侧面上）比「略微倾斜」（如 -15°/120°）
      //         更稳定，打印质量也更好——倾斜会让模型底面只有一条线/一个点接触底板。
      const canonical = eligibleCandidates.filter(
        (c) => Math.abs(c.rotX % 90) < 1 && Math.abs(c.rotY % 90) < 1
      );
      if (canonical.length > 0) {
        eligibleCandidates = canonical;
      }
    }

    if (hasColoredMask) {
      // 优先选彩色面没被包裹的姿态（支撑体不盖住贴图表面）
      const zeroColored = eligibleCandidates.filter(
        (c) => c.coloredWrapArea < 1
      );
      if (zeroColored.length > 0) {
        best = pickSmallest(zeroColored, (c) => c.supportWeight);
      } else {
        // 次选：彩色被包裹面积最小的（并列时比支撑克重）
        best = eligibleCandidates.reduce((min, c) =>
          c.coloredWrapArea < min.coloredWrapArea ||
          (c.coloredWrapArea === min.coloredWrapArea &&
            c.supportWeight < min.supportWeight)
            ? c
            : min
        );
      }
    } else {
      // 无彩色标记：直接选支撑克重最小的
      best = pickSmallest(eligibleCandidates, (c) => c.supportWeight);
    }
  }

  // 兜底：候选集永不为空（angles 至少含 13 个角度）
  const chosen = best!;

  const selfSupportRatio =
    modelWeightG > 0 ? chosen.supportWeight / modelWeightG : 0;

  // 计算原始姿态（rotX=0, rotY=0）的支撑数据，用于 UI 对比展示
  const originalCandidate = candidates.find(
    (c) => c.rotX === 0 && c.rotY === 0
  );
  const originalWeight = originalCandidate
    ? originalCandidate.supportWeight
    : chosen.supportWeight;
  const originalRatio =
    chosen.supportWeight > 0 ? originalWeight / chosen.supportWeight : 1;

  return {
    rotX: chosen.rotX,
    rotY: chosen.rotY,
    selfSupportRatio,
    selfSupportArea: chosen.supportArea,
    totalSupportRatio: selfSupportRatio,
    totalSupportWeight: chosen.supportWeight,
    // 总表面积(cm²):直接取缩放后网格的面片面积和 —— 模型已是实际尺寸
    totalArea: totalSurfaceAreaMM2(model) / 100,
    rotatedHeight: chosen.rotatedHeight,
    laidFlat: true,
    overhangArea: chosen.overhangArea,
    coloredDownArea: chosen.coloredWrapArea,
    wrapArea: chosen.wrapArea,
    supportVolume: chosen.supportVolume,
    wrapVolume: chosen.wrapVolume,
    originalWeight,
    originalRatio,
  };
}

/**
 * 把三角汤备成摆盘用的模型
 *
 * 焊接 + 拓扑是姿态无关的,所以只做一次 —— 之后每个候选姿态只旋转。
 * 拖动角度滑块时每次都重算支撑克重,重焊会明显卡。
 */
export { prepareSupportModel };

/** 生成旋转角度（弧度）用于 three.js Object3D.rotation 设置 */
export function getRotationEuler(
  rotXDeg: number,
  rotYDeg: number
): { x: number; y: number; z: number } {
  return {
    x: (rotXDeg * Math.PI) / 180,
    y: (rotYDeg * Math.PI) / 180,
    z: 0,
  };
}
