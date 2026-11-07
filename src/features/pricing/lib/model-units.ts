/**
 * 模型文件的**单位**判定
 *
 * ## 为什么需要它
 *
 * 工具把模型文件的坐标**当成毫米**(`obj-parser.ts` 的
 * `// dimensions in mm (assuming OBJ is in mm)`)。但很多模型文件 —— AI 生成的
 * (Meshy)、Blender 默认导出的 —— 坐标是**归一化**的(±1),不是毫米。
 *
 * 托底 5mm 是**固定的毫米值**(`SUPPORT_LIFT_MM`),不跟着模型缩放。于是
 * 一个 1.9 单位高的模型,平台被拉到它下面 5 个**单位** —— 支撑有 6.78 单位
 * 高,比模型本身还高 3.5 倍,整个模型泡在支撑里。支撑比例算出来是几万倍
 * (实测 56,868%),克重和报价全错。
 *
 * 这个模块只回答一个问题:**这个文件的坐标要不要当成毫米?**
 * 要不要缩、缩多少,是调用方的事(缩放走的是「自选尺寸」那条已有的路)。
 *
 * ## 判据:看最大边
 *
 * 真实的手办打印件最大边在几十毫米到两百毫米之间,**不可能小于 10mm** ——
 * 小于这个数就说明文件用的不是毫米(要么归一化,要么是厘米/英寸没换算)。
 *
 * 用最大边而不是最小边:只要有一条边到了合理量级,整个文件就大概率是
 * 毫米;反过来说,三条边都小得离谱,才是真的不对。
 *
 * ## 归一化到哪:最大边 100mm
 *
 * 先给一个**能算的起点** —— 100mm 是常见手办的量级。归一化只是换一个
 * 起点,**不是替用户定尺寸**:用户在尺寸面板里改成实际尺寸就行,改完
 * 支撑、克重、报价一起跟着重算(那条路已经是自洽的)。
 */

import type { Vec3 } from "./obj-parser";

/**
 * 小于这个最大边就判定「文件坐标不是毫米」
 *
 * 10mm 是底线 —— 真的要做 10mm 见方的打印件,那是一颗米粒大小的零件,
 * 工作室这边不接这种活。
 */
export const IMPLAUSIBLE_MM_EXTENT = 10;

/**
 * 归一化之后的最大边(mm)
 *
 * 只是一个**占位起点**,用户可以在尺寸面板里改成任何实际尺寸。
 */
export const ASSUMED_MAX_EXTENT_MM = 100;

export type ModelUnitCheck = {
  /**
   * 要乘上的缩放系数 —— 1 表示「按毫米算,不用改」
   *
   * 调用方把它接到「自选尺寸」的缩放因子上:几何、支撑、3D 预览会一起
   * 按这个系数缩放(见 `pricing-calculator.tsx` 的 `appliedScales`)。
   */
  scale: number;
  /** 判成「不是毫米」了没有 */
  normalized: boolean;
  /** 文件里的原始最大边(按文件自己的单位算) */
  originalMaxExtent: number;
  /** 归一化之后的最大边(mm);没归一化时就是原始最大边 */
  assumedMaxExtentMm: number;
};

/**
 * 判定一个模型的坐标是不是毫米,不是的话给一个归一化系数
 *
 * 纯函数 —— 不碰 React、不碰 DB、不碰 Worker,所以能进 `unit` project
 * 跑单测。
 *
 * @param size 解析出来的包围盒尺寸(文件自己的单位)
 */
export function detectModelUnitScale(size: Vec3): ModelUnitCheck {
  const extents = [size.x, size.y, size.z];
  const valid = extents.filter((v) => Number.isFinite(v) && v > 0);
  const originalMaxExtent = valid.length > 0 ? Math.max(...valid) : 0;

  // 退化输入(空模型 / 某一轴是 0 或 NaN)→ 不动它
  // 「动一个算不出体积的模型」没有意义,让它按原样走,后面自然算不出克重。
  //
  // 注意这里要求**三条边都**有效:只看最大边的话,一条边正常就放行了,
  // 而另外两条是 NaN 的文件会被缩放 100 倍 —— 那是在给一个坏文件编数字。
  if (valid.length !== 3) {
    return {
      scale: 1,
      normalized: false,
      originalMaxExtent,
      assumedMaxExtentMm: originalMaxExtent,
    };
  }

  // 已经是毫米(或者至少是合理量级)→ 不动
  //
  // 扁平模型(冰箱贴那种 40×40×2mm)也在这一档:看的是**最大边**,不是最小边。
  if (originalMaxExtent >= IMPLAUSIBLE_MM_EXTENT) {
    return {
      scale: 1,
      normalized: false,
      originalMaxExtent,
      assumedMaxExtentMm: originalMaxExtent,
    };
  }

  // 文件坐标不是毫米 → 按最大边 100mm 归一化
  return {
    scale: ASSUMED_MAX_EXTENT_MM / originalMaxExtent,
    normalized: true,
    originalMaxExtent,
    assumedMaxExtentMm: ASSUMED_MAX_EXTENT_MM,
  };
}

/**
 * 从三角汤量出包围盒尺寸(文件自己的单位)
 *
 * 模型检查工具那条链路只有 `positions`,没有解析出来的 `boundingBox` ——
 * 要判断单位只能自己量一遍。
 */
export function measurePositionsSize(positions: Float32Array): Vec3 {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
}

/**
 * 均匀缩放一份三角汤(返回**新**数组,不改原来的)
 *
 * 只挪顶点,不碰拓扑 —— 跟 `scaleSupportModel` 是同一条口径。
 */
export function scalePositions(
  positions: Float32Array,
  scale: number
): Float32Array {
  if (!Number.isFinite(scale) || scale === 1) {
    return positions;
  }
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++) {
    out[i] = positions[i]! * scale;
  }
  return out;
}

/**
 * 按 XYZ 分别缩放一份三角汤(返回**新**数组,不改原来的)
 *
 * 克重工具的尺寸面板可以**只拉 Z**(比如把一个扁片立起来)—— 那时缩放因子
 * 不是均匀的,`scalePositions` 顶不住。
 *
 * 打印前工作台的「检查」栏要画的是**缩放后**的模型(支撑外壳的平台平面是
 * 绝对毫米值,不跟着缩放走),所以它拿到的必须是这份按轴缩放过的几何 ——
 * 跟克重工具 3D 预览里那份(共用的 model-viewport)是同一个数。
 */
export function scalePositionsXYZ(
  positions: Float32Array,
  scales: [number, number, number]
): Float32Array {
  const [sx, sy, sz] = scales;
  if (
    !Number.isFinite(sx) ||
    !Number.isFinite(sy) ||
    !Number.isFinite(sz) ||
    (sx === 1 && sy === 1 && sz === 1)
  ) {
    return positions;
  }
  const out = new Float32Array(positions.length);
  for (let i = 0; i + 2 < positions.length; i += 3) {
    out[i] = positions[i]! * sx;
    out[i + 1] = positions[i + 1]! * sy;
    out[i + 2] = positions[i + 2]! * sz;
  }
  return out;
}
