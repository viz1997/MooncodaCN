/**
 * 智能识别「背面」—— 找模型上**最大的一块平面区域**
 *
 * ## 这条要解决工作室 2026-11-11 提的那个问题
 *
 * > 「为什么没有按照原来脚本那样智能识别背面」
 *
 * 原话答案:**原来那段 Blender 脚本并没有真的「智能识别」**。它做的是:
 *
 * ```python
 * for direction in (X, Y, Z 的正负六个):
 *     hit = ray_cast(center, direction)
 *     score = hit.normal.dot(-direction)   # 越接近 1 越平
 * best = argmax(score)
 * ```
 *
 * 也就是说:**只在六个轴向上找**。它之所以「看起来智能」,是因为那个模型在
 * Blender 里是**轴对齐**的 —— 背面正好平行于某个轴。换个歪一点的模型(或者
 * 在 Blender 里转过 30°),它挑出来的就不是背面了。
 *
 * 网页端的六面表格跟它**等价**(甚至更准一点:表格给的是**局部**平整度和
 * 局部厚度,脚本给的是包围盒中心的单点)。但「六面」这个上限得打破 ——
 * 模型歪了,背面就不在任何一面上了。
 *
 * ## 这里的做法:最大平面区域
 *
 * 在**焊接好的 indexed 网格**上做**区域生长**:
 *
 * 1. 每个面算自己的法线、面积、质心
 * 2. 按面积从大到小取种子面(大面先当种子,避免被小面抢走)
 * 3. 广度优先扩展:相邻面跟**种子法线**的夹角 ≤ 容差(默认 12°)、
 *    跟**区域平均法线**的夹角也 ≤ 容差 ⇒ 收进这个区域
 *
 * **为什么要同时卡两个角度** —— 只卡「区域平均法线」的话,一个圆弧面上
 * 的三角形会一个接一个地串起来(每一步都只偏离平均值一点点),最后整个
 * 穹顶被当成一个「平面区域」。卡住种子法线就断了这条链。
 *
 * 结果按**面积**排序 —— 面积最大的那块平面就是浮雕的背面(正面是起伏的,
 * 只有边框那一圈是平的,面积小得多)。
 *
 * ## 零依赖
 *
 * 不引 manifold、不引 `@/db` —— 纯函数层,能进 `unit` project 跑单测。
 */

import {
  crossVec,
  dotVec,
  type MagnetVec3,
  normalizeVec,
  subtractVec,
  vecLength,
} from "./magnet-params";

/** indexed 网格 —— 跟仓库焊接输出的形状一致 */
export type MagnetIndexedMesh = {
  /** 顶点坐标 —— 3 floats/顶点 */
  vertices: Float32Array;
  /** 三角形顶点下标 —— 3 个/面 */
  faceVertex: Uint32Array;
};

/** 一块平面区域 */
export type MagnetFlatPatch = {
  /** 面积(mm²) */
  areaMm2: number;
  /** 面积加权平均法线(单位向量)—— 指向实体**外侧** */
  normal: MagnetVec3;
  /** 面积加权质心(mm)—— 切刀就开在这儿 */
  centroid: MagnetVec3;
  /** 组成这块区域的面数 */
  faceCount: number;
  /** 各面法线相对区域平均法线的**面积加权**平均夹角(度) */
  meanDeviationDeg: number;
  /** 最大夹角(度) */
  maxDeviationDeg: number;
};

export type MagnetFlatPatchOptions = {
  /**
   * 法线容差(度)—— 默认 12°
   *
   * 太小了平面被切碎(一个本来平的背会散成好几块);
   * 太大了曲面被算成平面(穹顶会变成一块「平面区域」)。
   */
  angleTolDeg?: number;
  /** 面积下限(mm²)—— 小于这个的区域直接丢掉 */
  minAreaMm2?: number;
};

const DEFAULT_ANGLE_TOL_DEG = 12;

/** 两个单位向量之间的夹角(度) */
export function angleBetweenDeg(a: MagnetVec3, b: MagnetVec3): number {
  const cosine = Math.min(1, Math.max(-1, dotVec(a, b)));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/**
 * 在 indexed 网格上找出所有「足够平」的面区域,按面积从大到小排
 *
 * @param mesh indexed 网格(绕序要**朝外** —— 反了的话法线会指向实体内部)
 */
export function detectFlatPatches(
  mesh: MagnetIndexedMesh,
  options: MagnetFlatPatchOptions = {}
): MagnetFlatPatch[] {
  const tolDeg = options.angleTolDeg ?? DEFAULT_ANGLE_TOL_DEG;
  const minAreaMm2 = options.minAreaMm2 ?? 0;
  const cosTol = Math.cos((tolDeg * Math.PI) / 180);

  const { vertices, faceVertex } = mesh;
  const vertCount = Math.floor(vertices.length / 3);
  const faceCount = Math.floor(faceVertex.length / 3);

  // --- 每面的法线 / 面积 / 质心(退化面直接剔掉) ---
  const normals: MagnetVec3[] = [];
  const areas: number[] = [];
  const centroids: MagnetVec3[] = [];
  /** 紧凑数组里的第 t 个面,对应的原始顶点下标 */
  const compactVerts: number[] = [];

  for (let f = 0; f < faceCount; f++) {
    const a = faceVertex[f * 3];
    const b = faceVertex[f * 3 + 1];
    const c = faceVertex[f * 3 + 2];
    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      a >= vertCount ||
      b >= vertCount ||
      c >= vertCount
    ) {
      continue;
    }
    const p0 = readVertex(vertices, a);
    const p1 = readVertex(vertices, b);
    const p2 = readVertex(vertices, c);
    const raw = crossVec(subtractVec(p1, p0), subtractVec(p2, p0));
    const len = vecLength(raw);
    const area = len / 2;
    if (!Number.isFinite(area) || area <= 1e-12) continue; // 退化面
    normals.push([raw[0] / len, raw[1] / len, raw[2] / len]);
    areas.push(area);
    centroids.push([
      (p0[0] + p1[0] + p2[0]) / 3,
      (p0[1] + p1[1] + p2[1]) / 3,
      (p0[2] + p1[2] + p2[2]) / 3,
    ]);
    compactVerts.push(a, b, c);
  }

  const count = normals.length;
  if (count === 0) return [];

  // --- 邻接表:按**边**把面连起来 ---
  const edgeMap = new Map<string, number[]>();
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const a = compactVerts[t * 3 + k]!;
      const b = compactVerts[t * 3 + ((k + 1) % 3)]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const bucket = edgeMap.get(key);
      if (bucket) bucket.push(t);
      else edgeMap.set(key, [t]);
    }
  }

  const neighborsOf = (t: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = compactVerts[t * 3 + k]!;
      const b = compactVerts[t * 3 + ((k + 1) % 3)]!;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const bucket = edgeMap.get(key);
      if (!bucket) continue;
      for (const other of bucket) {
        if (other !== t) out.push(other);
      }
    }
    return out;
  };

  // --- 区域生长 ---
  const visited = new Uint8Array(count);
  const order = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => (areas[b] ?? 0) - (areas[a] ?? 0)
  );

  const patches: MagnetFlatPatch[] = [];

  for (const seed of order) {
    if (visited[seed]) continue;
    const seedNormal = normals[seed]!;
    const seedArea = areas[seed]!;
    const seedCentroid = centroids[seed]!;

    let sumN: MagnetVec3 = [
      seedNormal[0] * seedArea,
      seedNormal[1] * seedArea,
      seedNormal[2] * seedArea,
    ];
    let sumArea = seedArea;
    let sumC: MagnetVec3 = [
      seedCentroid[0] * seedArea,
      seedCentroid[1] * seedArea,
      seedCentroid[2] * seedArea,
    ];
    const members: number[] = [seed];
    visited[seed] = 1;

    const stack: number[] = [];
    const consider = (from: number): void => {
      for (const nb of neighborsOf(from)) {
        if (visited[nb]) continue;
        const nbNormal = normals[nb]!;
        // ① 跟**种子**法线的夹角 —— 断掉「曲面一条链串上来」
        if (dotVec(nbNormal, seedNormal) < cosTol) continue;
        // ② 跟**区域平均**法线的夹角 —— 保证这块区域真的平
        if (dotVec(nbNormal, normalizeVec(sumN)) < cosTol) continue;
        visited[nb] = 1;
        stack.push(nb);
      }
    };

    consider(seed);
    while (stack.length > 0) {
      const t = stack.pop()!;
      members.push(t);
      const area = areas[t]!;
      const normal = normals[t]!;
      const centroid = centroids[t]!;
      sumN = [
        sumN[0] + normal[0] * area,
        sumN[1] + normal[1] * area,
        sumN[2] + normal[2] * area,
      ];
      sumArea += area;
      sumC = [
        sumC[0] + centroid[0] * area,
        sumC[1] + centroid[1] * area,
        sumC[2] + centroid[2] * area,
      ];
      consider(t);
    }

    if (sumArea < minAreaMm2) continue;

    const patchNormal = normalizeVec(sumN);
    const patchCentroid: MagnetVec3 = [
      sumC[0] / sumArea,
      sumC[1] / sumArea,
      sumC[2] / sumArea,
    ];
    let meanDev = 0;
    let maxDev = 0;
    for (const t of members) {
      const dev = angleBetweenDeg(normals[t]!, patchNormal);
      meanDev += dev * (areas[t] ?? 0);
      if (dev > maxDev) maxDev = dev;
    }
    meanDev /= sumArea;

    patches.push({
      areaMm2: sumArea,
      normal: patchNormal,
      centroid: patchCentroid,
      faceCount: members.length,
      meanDeviationDeg: meanDev,
      maxDeviationDeg: maxDev,
    });
  }

  patches.sort((a, b) => {
    if (b.areaMm2 !== a.areaMm2) return b.areaMm2 - a.areaMm2;
    return a.meanDeviationDeg - b.meanDeviationDeg;
  });
  return patches;
}

/**
 * 挑「背面」—— 面积最大的那块平面区域
 *
 * 面积一样时挑**更平**的那块。
 */
export function pickBackFace(
  patches: readonly MagnetFlatPatch[]
): MagnetFlatPatch | null {
  if (patches.length === 0) return null;
  return patches.reduce((best, patch) => {
    if (patch.areaMm2 !== best.areaMm2) {
      return patch.areaMm2 > best.areaMm2 ? patch : best;
    }
    return patch.meanDeviationDeg < best.meanDeviationDeg ? patch : best;
  });
}

function readVertex(vertices: Float32Array, index: number): MagnetVec3 {
  return [
    vertices[index * 3] ?? 0,
    vertices[index * 3 + 1] ?? 0,
    vertices[index * 3 + 2] ?? 0,
  ];
}
