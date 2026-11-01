/**
 * 壁厚测量 —— 找出「过薄」的地方。
 *
 * ## 方法:沿法线向内打射线
 *
 * 在模型表面随机撒点(按面积加权,保证大面被采到的概率高),从每个采样点
 * 沿**面法线的反方向**向模型内部打一条射线,取第一次命中的距离 —— 那就是
 * 该处的壁厚。
 *
 *   ┌──────────┐ ← 表面 (法线朝外)
 *   │          │
 *   │  ← 射线  │   命中距离 = 壁厚
 *   │          │
 *   └──────────┘ ← 对面表面
 *
 * 采样点数是精度与耗时的折中:2000 个采样点在 13 万面的模型上大约 1-2 秒。
 *
 * ## 加速:均匀网格 + 3D DDA
 *
 * 暴力做法是每条射线测所有三角形 —— 2000 × 130000 = 2.6 亿次相交测试,
 * 在浏览器里要几十秒。这里把三角形按包围盒塞进一个均匀网格(默认 48³),
 * 射线用 3D DDA 逐格推进,只测当前格里的三角形。实测能快两个数量级。
 *
 * 跨度超过若干格的三角形(大平面)单独放一张表,每条射线都测 —— 它们数量少,
 * 但容易漏掉。
 *
 * ## 已知限制
 *
 *  - 网格不封闭(有开放边)时,部分射线会打空,此时壁厚结果不可信,
 *    结果里的 `missCount` 就是打空的条数,UI 会据此提示。
 *  - 法线朝向不一致(有翻面)时,那一小片区域的测量方向会反。
 *  - 测的是**局部**厚度 —— 针尖、尖角处天然偏薄,这是几何事实,不是缺陷。
 */

import type { TriangleData } from "./mesh-analysis";
import type { MeshData } from "./mesh-parse";

export type ThicknessOptions = {
  /** 采样点数 —— 越多越准也越慢 */
  samples?: number | undefined;
  /** 网格每轴的格数 */
  gridResolution?: number | undefined;
  /** 进度回调 0-100 */
  onProgress?: ((percent: number) => void) | undefined;
  /** 每批采样后调用,用于把主线程让给渲染 */
  yieldToUI?: (() => Promise<void>) | undefined;
};

export type ThicknessReport = {
  /** 实际采样点数 */
  sampledPoints: number;
  /** 射线命中对面表面的条数 */
  hitCount: number;
  /** 射线打空的条数 —— 网格不封闭时会很多 */
  missCount: number;
  /** 命中样本里的最小壁厚(mm) */
  minThicknessMM: number;
  /** 5% 分位 —— 比最小值稳健,更能代表「薄的地方有多薄」 */
  p05ThicknessMM: number;
  /** 中位数 */
  medianThicknessMM: number;
  /**
   * 原始采样 —— 三角形索引 + 壁厚(mm) + 该三角形面积(mm²)。
   *
   * 留着原始采样是为了让「过薄阈值」可以实时改:阈值一变,只需要重新分类,
   * 不用重新打一遍射线。
   */
  samples: ThicknessSample[];
  /** 最薄处的模型坐标 */
  thinnestPoint: [number, number, number] | null;
};

/** 单个厚度采样点 */
export type ThicknessSample = {
  /** 采样落在哪个三角形上 */
  triangle: number;
  /** 测得的壁厚(mm) */
  thickness: number;
  /** 该三角形的面积(mm²) —— 用来做面积口径的占比 */
  area: number;
};

/** 按阈值把采样分成「过薄」和「正常」 */
export type ThicknessClassification = {
  /** 过薄的三角形索引 */
  thinTriangles: number[];
  /** 采样点口径的过薄比例 */
  thinSampleRatio: number;
  /** 面积口径的过薄占比 */
  thinAreaRatio: number;
  /** 过薄总面积(mm²) */
  thinAreaMM2: number;
};

/**
 * 按阈值分类 —— 阈值是 UI 上的滑块,改阈值不该重跑射线。
 */
export function classifyThickness(
  report: ThicknessReport,
  thresholdMM: number
): ThicknessClassification {
  let thinCount = 0;
  let thinArea = 0;
  let sampledArea = 0;
  const thinTriangles = new Set<number>();

  for (const s of report.samples) {
    sampledArea += s.area;
    if (s.thickness < thresholdMM) {
      thinCount++;
      thinArea += s.area;
      thinTriangles.add(s.triangle);
    }
  }

  return {
    thinTriangles: Array.from(thinTriangles),
    thinSampleRatio:
      report.samples.length > 0 ? thinCount / report.samples.length : 0,
    thinAreaRatio: sampledArea > 0 ? thinArea / sampledArea : 0,
    thinAreaMM2: thinArea,
  };
}

/** 可复现的伪随机数发生器(mulberry32)—— 同样的模型每次结果一致 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Möller–Trumbore 射线-三角形相交;未命中返回 null */
function intersectTriangle(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number
): number | null {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;

  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;

  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return null; // 射线与三角形所在平面平行
  const invDet = 1 / det;

  const tx = ox - ax;
  const ty = oy - ay;
  const tz = oz - az;

  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < -1e-6 || u > 1 + 1e-6) return null;

  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;

  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;

  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  return t;
}

/** 均匀网格 —— 三角形按 AABB 落到格子里 */
type UniformGrid = {
  nx: number;
  ny: number;
  nz: number;
  cell: number;
  /** 格索引 → 三角形索引列表(只给非空格建) */
  buckets: Map<number, number[]>;
  /** 跨格太多的大三角形,每条射线都要测 */
  large: number[];
  min: [number, number, number];
};

function buildGrid(mesh: MeshData, resolution: number): UniformGrid {
  const maxDim = Math.max(mesh.size[0], mesh.size[1], mesh.size[2], 1e-6);
  const cell = maxDim / resolution;
  const nx = Math.max(1, Math.ceil(mesh.size[0] / cell));
  const ny = Math.max(1, Math.ceil(mesh.size[1] / cell));
  const nz = Math.max(1, Math.ceil(mesh.size[2] / cell));

  const buckets = new Map<number, number[]>();
  const large: number[] = [];
  const { indices, vertices } = mesh;

  for (let t = 0; t < mesh.triangleCount; t++) {
    const ia = (indices[t * 3] as number) * 3;
    const ib = (indices[t * 3 + 1] as number) * 3;
    const ic = (indices[t * 3 + 2] as number) * 3;

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const base of [ia, ib, ic]) {
      const x = vertices[base] as number;
      const y = vertices[base + 1] as number;
      const z = vertices[base + 2] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const x0 = Math.max(0, Math.floor((minX - mesh.min[0]) / cell));
    const x1 = Math.min(nx - 1, Math.floor((maxX - mesh.min[0]) / cell));
    const y0 = Math.max(0, Math.floor((minY - mesh.min[1]) / cell));
    const y1 = Math.min(ny - 1, Math.floor((maxY - mesh.min[1]) / cell));
    const z0 = Math.max(0, Math.floor((minZ - mesh.min[2]) / cell));
    const z1 = Math.min(nz - 1, Math.floor((maxZ - mesh.min[2]) / cell));

    const span = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (span > 64) {
      // 太大的三角形不适合进格子 —— 每条射线都单独测
      large.push(t);
      continue;
    }

    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const key = (z * ny + y) * nx + x;
          const list = buckets.get(key);
          if (list) list.push(t);
          else buckets.set(key, [t]);
        }
      }
    }
  }

  return { nx, ny, nz, cell, buckets, large, min: mesh.min };
}

/**
 * 沿射线做 3D DDA,逐格访问格子。
 *
 * `visit` 返回 false 时立刻停止遍历。
 */
function forEachCellAlongRay(
  grid: UniformGrid,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tMax: number,
  visit: (ix: number, iy: number, iz: number) => boolean
): void {
  const { nx, ny, nz, cell, min } = grid;

  let ix = Math.floor((ox - min[0]) / cell);
  let iy = Math.floor((oy - min[1]) / cell);
  let iz = Math.floor((oz - min[2]) / cell);
  ix = Math.min(nx - 1, Math.max(0, ix));
  iy = Math.min(ny - 1, Math.max(0, iy));
  iz = Math.min(nz - 1, Math.max(0, iz));

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;

  const tDeltaX = Math.abs(dx) > 1e-12 ? Math.abs(cell / dx) : Infinity;
  const tDeltaY = Math.abs(dy) > 1e-12 ? Math.abs(cell / dy) : Infinity;
  const tDeltaZ = Math.abs(dz) > 1e-12 ? Math.abs(cell / dz) : Infinity;

  let tMaxX =
    Math.abs(dx) > 1e-12
      ? (min[0] + (stepX > 0 ? ix + 1 : ix) * cell - ox) / dx
      : Infinity;
  let tMaxY =
    Math.abs(dy) > 1e-12
      ? (min[1] + (stepY > 0 ? iy + 1 : iy) * cell - oy) / dy
      : Infinity;
  let tMaxZ =
    Math.abs(dz) > 1e-12
      ? (min[2] + (stepZ > 0 ? iz + 1 : iz) * cell - oz) / dz
      : Infinity;

  let guard = 0;
  const maxSteps = (nx + ny + nz) * 4 + 16;
  while (guard++ < maxSteps) {
    if (!visit(ix, iy, iz)) return;
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      ix += stepX;
      if (ix < 0 || ix >= nx) return;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      iy += stepY;
      if (iy < 0 || iy >= ny) return;
      tMaxY += tDeltaY;
    } else {
      iz += stepZ;
      if (iz < 0 || iz >= nz) return;
      tMaxZ += tDeltaZ;
    }
    const tNext = Math.min(tMaxX, tMaxY, tMaxZ);
    if (tNext > tMax) return;
  }
}

/**
 * 测量壁厚。
 *
 * 网格不封闭时结果不可信 —— 用返回的 `missCount` 判断。
 */
export async function measureWallThickness(
  mesh: MeshData,
  triangleData: TriangleData,
  options: ThicknessOptions = {}
): Promise<ThicknessReport> {
  const {
    samples: requestedSamples = 2000,
    gridResolution = 48,
    onProgress,
    yieldToUI,
  } = options;

  const rand = mulberry32(0x5eed1234);
  const { indices, vertices, triangleCount } = mesh;

  // 整体法线朝里时,把射线方向反过来
  const flip = triangleData.signedVolume < 0;
  const eps = Math.max(mesh.diagonal * 1e-4, 1e-4);

  // 面积累积分布 —— 按面积加权采样
  const cdf = new Float64Array(triangleCount);
  let acc = 0;
  for (let t = 0; t < triangleCount; t++) {
    acc += triangleData.areas[t] as number;
    cdf[t] = acc;
  }
  const totalArea = acc;

  onProgress?.(0);
  const grid = buildGrid(mesh, gridResolution);
  onProgress?.(15);

  const sampleCount = Math.max(1, Math.min(requestedSamples, 4000));
  const thicknesses: number[] = [];
  const sampleRecords: ThicknessSample[] = [];
  let hitCount = 0;
  let missCount = 0;
  let minThickness = Infinity;
  let thinnestPoint: [number, number, number] | null = null;

  const batchSize = 100;

  for (let s = 0; s < sampleCount; s++) {
    // --- 按面积挑一个三角形 ---
    const target = rand() * totalArea;
    let lo = 0;
    let hi = triangleCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cdf[mid] as number) < target) lo = mid + 1;
      else hi = mid;
    }
    const t = lo;

    // --- 面内随机点(重心坐标) ---
    let u = rand();
    let v = rand();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const ia = (indices[t * 3] as number) * 3;
    const ib = (indices[t * 3 + 1] as number) * 3;
    const ic = (indices[t * 3 + 2] as number) * 3;
    const ax = vertices[ia] as number;
    const ay = vertices[ia + 1] as number;
    const az = vertices[ia + 2] as number;
    const bx = vertices[ib] as number;
    const by = vertices[ib + 1] as number;
    const bz = vertices[ib + 2] as number;
    const cx = vertices[ic] as number;
    const cy = vertices[ic + 1] as number;
    const cz = vertices[ic + 2] as number;

    const px = ax + u * (bx - ax) + v * (cx - ax);
    const py = ay + u * (by - ay) + v * (cy - ay);
    const pz = az + u * (bz - az) + v * (cz - az);

    // --- 射线方向 = -法线(朝内) ---
    let dx = -(triangleData.normals[t * 3] as number);
    let dy = -(triangleData.normals[t * 3 + 1] as number);
    let dz = -(triangleData.normals[t * 3 + 2] as number);
    if (flip) {
      dx = -dx;
      dy = -dy;
      dz = -dz;
    }
    const nLen = Math.hypot(dx, dy, dz);
    if (nLen < 1e-9) continue;
    dx /= nLen;
    dy /= nLen;
    dz /= nLen;

    const ox = px + dx * eps;
    const oy = py + dy * eps;
    const oz = pz + dz * eps;

    const v0 = indices[t * 3] as number;
    const v1 = indices[t * 3 + 1] as number;
    const v2 = indices[t * 3 + 2] as number;

    let best = Infinity;
    const tested = new Set<number>();

    const testTriangle = (cand: number) => {
      if (cand === t || tested.has(cand)) return;
      tested.add(cand);
      // 与源三角形共用顶点的面会紧贴起点,直接跳过
      const ca = indices[cand * 3] as number;
      const cb = indices[cand * 3 + 1] as number;
      const cc = indices[cand * 3 + 2] as number;
      if (
        ca === v0 ||
        ca === v1 ||
        ca === v2 ||
        cb === v0 ||
        cb === v1 ||
        cb === v2 ||
        cc === v0 ||
        cc === v1 ||
        cc === v2
      ) {
        return;
      }
      const ba = ca * 3;
      const bb = cb * 3;
      const bc = cc * 3;
      const hit = intersectTriangle(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        vertices[ba] as number,
        vertices[ba + 1] as number,
        vertices[ba + 2] as number,
        vertices[bb] as number,
        vertices[bb + 1] as number,
        vertices[bb + 2] as number,
        vertices[bc] as number,
        vertices[bc + 1] as number,
        vertices[bc + 2] as number
      );
      if (hit !== null && hit > eps * 2 && hit < best) best = hit;
    };

    // 网格里的候选
    forEachCellAlongRay(
      grid,
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      mesh.diagonal * 4,
      (ix, iy, iz) => {
        const key = (iz * grid.ny + iy) * grid.nx + ix;
        const list = grid.buckets.get(key);
        if (list) for (const cand of list) testTriangle(cand);
        return true;
      }
    );
    // 大三角形
    for (const cand of grid.large) testTriangle(cand);

    const area = triangleData.areas[t] as number;

    if (best === Infinity) {
      missCount++;
    } else {
      hitCount++;
      thicknesses.push(best);
      sampleRecords.push({ triangle: t, thickness: best, area });
      if (best < minThickness) {
        minThickness = best;
        thinnestPoint = [px, py, pz];
      }
    }

    if ((s + 1) % batchSize === 0) {
      onProgress?.(15 + Math.round(((s + 1) / sampleCount) * 80));
      await yieldToUI?.();
    }
  }

  onProgress?.(100);

  thicknesses.sort((a, b) => a - b);
  const quantile = (q: number) => {
    if (thicknesses.length === 0) return 0;
    const pos = (thicknesses.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const a = thicknesses[lo] as number;
    const b = thicknesses[hi] as number;
    return a + (b - a) * (pos - lo);
  };

  return {
    sampledPoints: sampleCount,
    hitCount,
    missCount,
    minThicknessMM: minThickness === Infinity ? 0 : minThickness,
    p05ThicknessMM: quantile(0.05),
    medianThicknessMM: quantile(0.5),
    samples: sampleRecords,
    thinnestPoint,
  };
}
