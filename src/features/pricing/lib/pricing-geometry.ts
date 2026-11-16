/**
 * 几何工具 —— **客户端安全**(零成本口径、零依赖)
 *
 * ## 为什么单独拆出来
 *
 * 这两个函数是**纯几何**:跟材料单价一点关系都没有 ⇒ 浏览器可以算,也可以
 * 打包进客户端 bundle。
 *
 * 反过来,`pricing-engine.ts` 里有**成本口径**(材料单价 / 支撑分档单价)——
 * 那个文件**只能留在服务端**。两者的边界就是这一个文件:
 *
 * | 文件 | 谁能 import | 里面有什么 |
 * |---|---|---|
 * | `pricing-geometry.ts` | 客户端 / 服务端 | 体积、表面积、尺寸 |
 * | `material-weight.ts` | 客户端 / 服务端 | 密度 → 克重 |
 * | `pricing-engine.ts` | **只有服务端** | **单价 / 分档价 / 钱** |
 *
 * 工作室 2026-11-16 的要求:「不要展示 4.5 元/g 这种单价,避免暴露我们的
 * 成本」。**「不展示」不够** —— 只要客户端 bundle 里还留着那个字面量,
 * 看页面源码就能翻出来。所以客户端**整条链路都不许碰到那个文件**。
 */

/** 有限数判断 —— 到处都要用,单独一个函数免得每个文件抄一遍 */
export const isFiniteNum = (v: number): boolean =>
  typeof v === "number" && Number.isFinite(v);

/** 退化尺寸 —— 算不出来时的占位 */
export const DEFAULT_DIMS: [number, number, number] = [0, 0, 0];

/**
 * 按**均匀**系数缩放体积 / 表面积 / 尺寸
 *
 *   - 体积 × k³
 *   - 表面积 × k²
 *   - 尺寸 × k
 *
 * 「目标最大边(mm)」那档尺寸编辑走的就是它(体积是三次方)。
 */
export function scaleGeometry(
  volume: number,
  surface: number,
  dims: [number, number, number],
  k: number
): {
  volumeCM3: number;
  surfaceAreaCM2: number;
  dims: [number, number, number];
} {
  const safeK = isFiniteNum(k) ? k : 1;
  return {
    volumeCM3: volume * safeK * safeK * safeK,
    surfaceAreaCM2: surface * safeK * safeK,
    dims: [dims[0] * safeK, dims[1] * safeK, dims[2] * safeK],
  };
}

/**
 * 从**长方体包络盒**(L × W × H,mm)估几何
 *
 *   volumeCM3 = (L × W × H) / 1000 × (solidRatio / 100)
 *   surfaceAreaCM2 = 2 × (LW + LH + WH) / 100
 *
 * 「手动尺寸」那一档用 —— 假设模型把包络盒填满 `solidRatio`%。
 */
export function estimateEnvelopeGeometry(
  l: number,
  w: number,
  h: number,
  solidRatio: number
): {
  volumeCM3: number;
  surfaceAreaCM2: number;
  dims: [number, number, number];
} {
  const safeL = isFiniteNum(l) ? Math.max(0, l) : 0;
  const safeW = isFiniteNum(w) ? Math.max(0, w) : 0;
  const safeH = isFiniteNum(h) ? Math.max(0, h) : 0;
  const safeRatio = isFiniteNum(solidRatio)
    ? Math.min(100, Math.max(0, solidRatio))
    : 0;

  const envelopeMM3 = safeL * safeW * safeH;
  const envelopeCM3 = envelopeMM3 / 1000;
  const volumeCM3 = envelopeCM3 * (safeRatio / 100);

  const surfaceMM2 = 2 * (safeL * safeW + safeL * safeH + safeW * safeH);
  const surfaceAreaCM2 = surfaceMM2 / 100;

  const dims: [number, number, number] = [safeL, safeW, safeH];
  return { volumeCM3, surfaceAreaCM2, dims: dims.length ? dims : DEFAULT_DIMS };
}
