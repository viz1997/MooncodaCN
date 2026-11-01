/**
 * 网格拓扑检查 —— 找「破面」。
 *
 * 打印切片之前必须先确认模型本身是干净的。本模块做四类检查:
 *
 * | 问题 | 现象 | 切片后果 |
 * |---|---|---|
 * | 退化面 degenerate | 三个点几乎共线 / 面积≈0 | 切片器可能直接跳过或报崩 |
 * | 重复面 duplicateFace | 同一个三角形出现两次 | 表面出现 Z-fighting / 双层 |
 * | 开放边 openEdge | 一条边只被一个面共用 | 模型不封闭,切片出��有洞 |
 * | 非流形边 nonManifoldEdge | 一条边被 3 个以上面共用 | 切片器多半直接失败 |
 *
 * 外加两项:
 *  - **重复顶点 duplicateVertex**:坐标相同却是不同索引 → 没焊上的模型,
 *    视觉上连着,拓扑上却断开(开放边的常见成因)
 *  - **法线朝向 flippedNormal**:相邻两个面绕向相反 → 着色翻面、
 *    体积算成负数
 *
 * ## 边的方向怎么用
 *
 * 每个三角形按绕向贡献三条有向边 (a→b) (b→c) (c→a)。
 * 一个封闭且朝向一致的网格里,每条内部边会被两个面以**相反方向**各贡献一次。
 * 若两次方向相同(|dirSum| == 2),说明这两个面的绕向互相矛盾 —— 有一面翻面了。
 *
 * ## 阈值
 *
 * 所有阈值都相对包围盒对角线缩放,模型放大 100 倍结论不变。
 */

/** 问题标识 —— 同时用作面标记位掩码的 bit 位 */
export const ISSUE_FLAGS = {
  degenerate: 1 << 0,
  duplicateFace: 1 << 1,
  openEdge: 1 << 2,
  nonManifoldEdge: 1 << 3,
  flippedNormal: 1 << 4,
  duplicateVertex: 1 << 5,
  thinWall: 1 << 6,
  overhang: 1 << 7,
} as const;

export type MeshIssueId =
  | "degenerate"
  | "duplicateFace"
  | "openEdge"
  | "nonManifoldEdge"
  | "duplicateVertex"
  | "flippedNormal"
  | "thinWall"
  | "overhang";

export type IssueSeverity = "error" | "warning" | "info";

/** 单条检查结论 */
export type MeshIssue = {
  id: MeshIssueId;
  severity: IssueSeverity;
  /** 命中的数量(面数 / 边数 / 顶点数) */
  count: number;
  /** 命中的三角形索引 —— 3D 预览里高亮成红色 */
  triangles: number[];
  /** 补充说明,直接显示(可含数字) */
  note?: string;
};

/** 每个三角形的派生量 —— 面积 / 法线 / 重心 */
export type TriangleData = {
  /** 每个三角形的面积(mm²) */
  areas: Float64Array;
  /** 单位法线,3 float / 三角形 */
  normals: Float64Array;
  /** 重心,3 float / 三角形 */
  centroids: Float64Array;
  /** 面积总和(mm²) */
  totalArea: number;
  /** 有符号体积(mm³) —— 负数代表整体法线朝里 */
  signedVolume: number;
};

export type TopologyReport = {
  vertexCount: number;
  triangleCount: number;
  totalAreaMM2: number;
  signedVolumeMM3: number;
  /** 整体法线是否朝里(有符号体积为负) */
  inverted: boolean;
  degenerateCount: number;
  duplicateFaceCount: number;
  openEdgeCount: number;
  nonManifoldEdgeCount: number;
  flippedEdgeCount: number;
  duplicateVertexCount: number;
  /** 无洞且无非流形 —— 可以直接切片 */
  watertight: boolean;
  issues: MeshIssue[];
  /** 每个三角形的问题位掩码(见 ISSUE_FLAGS) */
  faceFlags: Uint8Array;
};

/**
 * 逐三角形算面积 / 法线 / 重心 / 有符号体积。
 *
 * 有符号体积用四面体法:Σ (v0 · (v1 × v2)) / 6。
 * 朝向一致的封闭网格得到正体积;整体翻转则得负数。
 */
export function computeTriangleData(mesh: {
  vertices: Float64Array;
  indices: Uint32Array;
  triangleCount: number;
}): TriangleData {
  const { vertices, indices, triangleCount } = mesh;
  const areas = new Float64Array(triangleCount);
  const normals = new Float64Array(triangleCount * 3);
  const centroids = new Float64Array(triangleCount * 3);
  let totalArea = 0;
  let signedVolume = 0;

  for (let t = 0; t < triangleCount; t++) {
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

    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;

    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);

    const area = len / 2;
    areas[t] = area;
    totalArea += area;

    if (len > 1e-20) {
      normals[t * 3] = nx / len;
      normals[t * 3 + 1] = ny / len;
      normals[t * 3 + 2] = nz / len;
    }

    centroids[t * 3] = (ax + bx + cx) / 3;
    centroids[t * 3 + 1] = (ay + by + cy) / 3;
    centroids[t * 3 + 2] = (az + bz + cz) / 3;

    // 四面体有符号体积
    signedVolume +=
      (ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx)) /
      6;
  }

  return { areas, normals, centroids, totalArea, signedVolume };
}

/** 边的聚合信息 */
type EdgeRecord = {
  /** 被几个面共用 */
  count: number;
  /** 方向和 —— 0 表示两次方向相反(一致),±2 表示方向相同(矛盾) */
  dirSum: number;
  /** 使用这条边的三角形(取前两个,用于高亮) */
  tris: number[];
};

export type TopologyInput = {
  vertices: Float64Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  size: [number, number, number];
  diagonal: number;
};

/**
 * 跑一遍拓扑检查,返回各类破面的数量、命中的三角形,以及面标记位掩码。
 */
export function analyzeTopology(
  mesh: TopologyInput,
  triangleData: TriangleData
): TopologyReport {
  const { indices, vertexCount, triangleCount } = mesh;
  const faceFlags = new Uint8Array(triangleCount);

  // 面积阈值:相对包围盒对角线的平方,再压一个绝对下限
  const scale = Math.max(mesh.diagonal, 1e-6);
  const degenerateArea = Math.max(scale * scale * 1e-10, 1e-12);

  // ---- 1. 退化面 ----------------------------------------------------------
  const degenerateTris: number[] = [];
  for (let t = 0; t < triangleCount; t++) {
    const a = indices[t * 3] as number;
    const b = indices[t * 3 + 1] as number;
    const c = indices[t * 3 + 2] as number;
    const dupIndex = a === b || b === c || a === c;
    if (dupIndex || (triangleData.areas[t] as number) <= degenerateArea) {
      degenerateTris.push(t);
      faceFlags[t] = (faceFlags[t] as number) | ISSUE_FLAGS.degenerate;
    }
  }

  // ---- 2. 重复面 ----------------------------------------------------------
  // key = 三个顶点索引排序后拼接(与绕向无关,才能抓到「同一个三角形两次」
  // 以及「同一个三角形一次正绕一次反绕」)
  const faceKeyMap = new Map<string, number[]>();
  for (let t = 0; t < triangleCount; t++) {
    const a = indices[t * 3] as number;
    const b = indices[t * 3 + 1] as number;
    const c = indices[t * 3 + 2] as number;
    const sorted = [a, b, c].sort((x, y) => x - y);
    const key = `${sorted[0]}_${sorted[1]}_${sorted[2]}`;
    const list = faceKeyMap.get(key);
    if (list) list.push(t);
    else faceKeyMap.set(key, [t]);
  }
  const duplicateFaceTris: number[] = [];
  let duplicateFaceCount = 0;
  for (const list of faceKeyMap.values()) {
    if (list.length < 2) continue;
    // 多出来的那些算重复(第一个不算)
    duplicateFaceCount += list.length - 1;
    for (let i = 1; i < list.length; i++) {
      const t = list[i] as number;
      duplicateFaceTris.push(t);
      faceFlags[t] = (faceFlags[t] as number) | ISSUE_FLAGS.duplicateFace;
    }
  }

  // ---- 3. 边:开放边 / 非流形边 / 朝向矛盾 ---------------------------------
  const edges = new Map<string, EdgeRecord>();
  const addEdge = (a: number, b: number, t: number) => {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = `${lo}_${hi}`;
    const dir = a < b ? 1 : -1;
    let rec = edges.get(key);
    if (!rec) {
      rec = { count: 0, dirSum: 0, tris: [] };
      edges.set(key, rec);
    }
    rec.count++;
    rec.dirSum += dir;
    if (rec.tris.length < 4) rec.tris.push(t);
  };

  for (let t = 0; t < triangleCount; t++) {
    const a = indices[t * 3] as number;
    const b = indices[t * 3 + 1] as number;
    const c = indices[t * 3 + 2] as number;
    addEdge(a, b, t);
    addEdge(b, c, t);
    addEdge(c, a, t);
  }

  const openEdgeTris: number[] = [];
  const nonManifoldTris: number[] = [];
  const flippedTris: number[] = [];
  let openEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  let flippedEdgeCount = 0;

  for (const rec of edges.values()) {
    if (rec.count === 1) {
      openEdgeCount++;
      for (const t of rec.tris) {
        if (!openEdgeTris.includes(t)) openEdgeTris.push(t);
        faceFlags[t] = (faceFlags[t] as number) | ISSUE_FLAGS.openEdge;
      }
      continue;
    }
    if (rec.count > 2) {
      nonManifoldEdgeCount++;
      for (const t of rec.tris) {
        if (!nonManifoldTris.includes(t)) nonManifoldTris.push(t);
        faceFlags[t] = (faceFlags[t] as number) | ISSUE_FLAGS.nonManifoldEdge;
      }
      continue;
    }
    // count === 2 —— 看方向
    if (Math.abs(rec.dirSum) === 2) {
      flippedEdgeCount++;
      for (const t of rec.tris) {
        if (!flippedTris.includes(t)) flippedTris.push(t);
        faceFlags[t] = (faceFlags[t] as number) | ISSUE_FLAGS.flippedNormal;
      }
    }
  }

  // ---- 4. 重复顶点(没焊上的模型) -----------------------------------------
  // 把坐标量化到 1e-5 × 对角线的网格里,同一格里的点视为几何上的同一点
  const weldTol = Math.max(scale * 1e-5, 1e-6);
  const weldMap = new Map<string, number[]>();
  for (let v = 0; v < vertexCount; v++) {
    const qx = Math.round((mesh.vertices[v * 3] as number) / weldTol);
    const qy = Math.round((mesh.vertices[v * 3 + 1] as number) / weldTol);
    const qz = Math.round((mesh.vertices[v * 3 + 2] as number) / weldTol);
    const key = `${qx},${qy},${qz}`;
    const list = weldMap.get(key);
    if (list) list.push(v);
    else weldMap.set(key, [v]);
  }
  let duplicateVertexCount = 0;
  const duplicateVertexSet = new Set<number>();
  for (const list of weldMap.values()) {
    if (list.length < 2) continue;
    duplicateVertexCount += list.length - 1;
    for (const v of list) duplicateVertexSet.add(v);
  }
  // 重复顶点涉及的三角形一并标记
  if (duplicateVertexSet.size > 0) {
    for (let t = 0; t < triangleCount; t++) {
      const a = indices[t * 3] as number;
      const b = indices[t * 3 + 1] as number;
      const c = indices[t * 3 + 2] as number;
      if (
        duplicateVertexSet.has(a) ||
        duplicateVertexSet.has(b) ||
        duplicateVertexSet.has(c)
      ) {
        faceFlags[t] = (faceFlags[t] as number) | ISSUE_FLAGS.duplicateVertex;
      }
    }
  }

  // ---- 5. 组装 issues -----------------------------------------------------
  const issues: MeshIssue[] = [];
  if (degenerateTris.length > 0) {
    issues.push({
      id: "degenerate",
      severity: "error",
      count: degenerateTris.length,
      triangles: degenerateTris,
    });
  }
  if (duplicateFaceCount > 0) {
    issues.push({
      id: "duplicateFace",
      severity: "error",
      count: duplicateFaceCount,
      triangles: duplicateFaceTris,
    });
  }
  if (nonManifoldEdgeCount > 0) {
    issues.push({
      id: "nonManifoldEdge",
      severity: "error",
      count: nonManifoldEdgeCount,
      triangles: nonManifoldTris,
    });
  }
  if (openEdgeCount > 0) {
    issues.push({
      id: "openEdge",
      severity: "error",
      count: openEdgeCount,
      triangles: openEdgeTris,
    });
  }
  if (flippedEdgeCount > 0) {
    issues.push({
      id: "flippedNormal",
      severity: "warning",
      count: flippedEdgeCount,
      triangles: flippedTris,
    });
  }
  if (duplicateVertexCount > 0) {
    issues.push({
      id: "duplicateVertex",
      severity: "warning",
      count: duplicateVertexCount,
      triangles: [],
    });
  }

  const inverted = triangleData.signedVolume < 0;

  return {
    vertexCount,
    triangleCount,
    totalAreaMM2: triangleData.totalArea,
    signedVolumeMM3: triangleData.signedVolume,
    inverted,
    degenerateCount: degenerateTris.length,
    duplicateFaceCount,
    openEdgeCount,
    nonManifoldEdgeCount,
    flippedEdgeCount,
    duplicateVertexCount,
    watertight: openEdgeCount === 0 && nonManifoldEdgeCount === 0,
    issues,
    faceFlags,
  };
}

/**
 * 悬空面积占比 —— 面法线朝下的部分。
 *
 * `supportAngleDeg` 是支撑角阈值(默认 45°):面法线与竖直方向的夹角超过
 * 这个值就意味着这块面需要支撑才能印出来。
 *
 * 判据:法线的 z 分量 < -sin(supportAngle)。45° 时 sin = 0.707 ——
 * 竖直侧壁(normal.z = 0)不需要支撑,水平朝下的面(normal.z = -1)需要。
 */
export function computeOverhang(
  normals: Float64Array,
  areas: Float64Array,
  triangleCount: number,
  supportAngleDeg: number
): { areaRatio: number; overhangAreaMM2: number; triangles: number[] } {
  const threshold = -Math.sin((supportAngleDeg * Math.PI) / 180);
  let overhangArea = 0;
  const triangles: number[] = [];
  for (let t = 0; t < triangleCount; t++) {
    const nz = normals[t * 3 + 2] as number;
    if (nz < threshold) {
      overhangArea += areas[t] as number;
      triangles.push(t);
    }
  }
  const total = areas.reduce((acc, v) => acc + v, 0);
  return {
    areaRatio: total > 0 ? overhangArea / total : 0,
    overhangAreaMM2: overhangArea,
    triangles,
  };
}
