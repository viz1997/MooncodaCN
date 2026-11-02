/**
 * 顶点焊接 + 网格拓扑构建 + 破面检测(退化面 / 重复面 / 开放边 / 非流形边)
 * + 法线方向检测(局部翻转面 BFS / 整体朝内的封闭壳)
 * + 边界环记录(闭合孔洞 / 裂缝,平面性判定 → 平面孔洞)
 *
 * 移植自 wjp-model-checker-source/src/lib/mesh/weld.ts
 */
// @ts-nocheck —— 本仓库 tsconfig 开了 noUncheckedIndexedAccess,而这个数值内核
// 全是 `typedArray[i]` 形式的下标访问(索引在数学上必然合法),逐个加 `!` 会把
// 300+ 处噪声灌进移植 diff 里。行为由 src/test/tools/pure/wjp-mesh.test.ts 的
// 6 个演示模型夹具守住(见 [[wjp-model-checker-port]])。
import { FACE_FLAG } from "./types";

export interface WeldedMesh {
  vertexCount: number;
  /** 3 floats per vertex(焊接后) */
  vertices: Float32Array;
  /** 3 indices per face */
  faceVertex: Uint32Array;
  faceCount: number;
  faceNormals: Float32Array; // 3 per face(单位法线,退化面为 0,0,0)
  faceAreas: Float32Array;
  faceCentroids: Float32Array; // 3 per face
  /** face → 相邻 face(扁平 CSR 数组) */
  adjOffsets: Uint32Array; // faceCount+1
  adjList: Uint32Array;
  /** edge key → 该边上的面列表,元素编码为 faceIndex*2 + dirBit(0 = 沿 min→max 方向) */
  edgeFaceMap: Map<number, number[]>;
  vertexCountOriginal: number;
  diag: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
}

/** 单个连通分量的统计信息 */
export interface MeshComponentInfo {
  /** 有效(非退化)面片数 */
  faceCount: number;
  /** 无开放边且无非流形边 */
  closed: boolean;
  openEdges: number;
  nonManifoldEdges: number;
  /** 有符号体积(法线朝外为正) */
  volume: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
  /** 被外壳完全包裹的封闭内壳(密封内腔) */
  isCavity: boolean;
  /** 被外壳包裹但不封闭的碎片壳 */
  isDebris: boolean;
  /** 封闭壳整体法线朝内 */
  globalInverted: boolean;
}

export interface TopologyResult {
  mesh: WeldedMesh;
  flags: Uint8Array; // DEGENERATE / DUPLICATE / FLIPPED 在此设置
  openEdgeVerts: Float32Array; // 每条开放边 2 个端点坐标
  nonManifoldVerts: Float32Array;
  planarHoleVerts: Float32Array; // 平面孔洞轮廓线段
  holeLoops: {
    id: number;
    closed: boolean;
    planar: boolean;
    edgeCount: number;
    centroid: [number, number, number];
  }[];
  holeCount: number; // 闭合孔洞数
  crackChainCount: number; // 未闭合边界链数
  planarHoleCount: number;
  /** 每面所属连通分量,-1 = 退化面 */
  faceComponent: Int32Array;
  componentCount: number;
  components: MeshComponentInfo[];
  /** 存在被外壳完全包裹的封闭内腔(WJP 无法排水洗去支撑) */
  sealedHollow: boolean;
  /** 被包裹的封闭内壳数量 */
  cavityShellCount: number;
  /** 被包裹但不封闭的多余碎片壳数量 */
  enclosedOpenShellCount: number;
  volume: number;
  duplicatePairCount: number;
  degenerateCount: number;
  flippedFaceCount: number; // 局部翻转面数(不含整体反转整壳)
  globalInvertedShellCount: number;
  duplicateSamples: { centroid: [number, number, number]; flipped: boolean }[];
}

function computeBBox(positions: Float32Array): {
  min: [number, number, number];
  max: [number, number, number];
  diag: number;
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (!Number.isFinite(v)) continue;
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const dx = max[0] - min[0],
    dy = max[1] - min[1],
    dz = max[2] - min[2];
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return { min, max, diag: Number.isFinite(diag) && diag > 0 ? diag : 1 };
}

/** 量化网格哈希焊接重复顶点(容差约为对角线的 1e-7) */
function weldVertices(
  positions: Float32Array,
  diag: number
): {
  vertices: Float32Array;
  faceVertex: Uint32Array;
  vertexCount: number;
  originalCount: number;
} {
  const n = positions.length / 3;
  const faceVertex = new Uint32Array(n);
  const map = new Map<number, number>();
  const vertList: number[] = [];
  const tol = Math.max(1e-9, diag * 1e-7);
  const q = 1 / tol;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3],
      y = positions[i * 3 + 1],
      z = positions[i * 3 + 2];
    const kx = Math.round(x * q),
      ky = Math.round(y * q),
      kz = Math.round(z * q);
    // 空间哈希:将三个 19bit 量化值打包为数字键
    const key =
      (kx & 0x7ffff) * 0x40000000000 +
      (ky & 0x7ffff) * 0x200000 +
      (kz & 0x7ffff);
    let idx = map.get(key);
    if (idx === undefined) {
      idx = vertList.length / 3;
      map.set(key, idx);
      vertList.push(x, y, z);
    }
    faceVertex[i] = idx;
  }
  return {
    vertices: new Float32Array(vertList),
    faceVertex,
    vertexCount: vertList.length / 3,
    originalCount: n,
  };
}

/** 对称 3×3 协方差矩阵的 Jacobi 特征分解,返回最小特征值对应的特征向量(拟合平面法向) */
function smallestEigenVector(m: number[]): [number, number, number] {
  // m = [xx, xy, xz, yy, yz, zz](对称矩阵上三角)
  const a: number[][] = [
    [m[0], m[1], m[2]],
    [m[1], m[3], m[4]],
    [m[2], m[4], m[5]],
  ];
  const v: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 24; sweep++) {
    // 找最大非对角元
    let p = 0,
      q = 1,
      max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) {
      max = Math.abs(a[0][2]);
      p = 0;
      q = 2;
    }
    if (Math.abs(a[1][2]) > max) {
      max = Math.abs(a[1][2]);
      p = 1;
      q = 2;
    }
    if (max < 1e-14) break;
    const app = a[p][p],
      aqq = a[q][q],
      apq = a[p][q];
    const theta = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(theta),
      s = Math.sin(theta);
    // 行列旋转
    for (let i = 0; i < 3; i++) {
      const aip = a[i][p],
        aiq = a[i][q];
      a[i][p] = c * aip - s * aiq;
      a[i][q] = s * aip + c * aiq;
    }
    for (let i = 0; i < 3; i++) {
      const api = a[p][i],
        aqi = a[q][i];
      a[p][i] = c * api - s * aqi;
      a[q][i] = s * api + c * aqi;
    }
    for (let i = 0; i < 3; i++) {
      const vip = v[i][p],
        viq = v[i][q];
      v[i][p] = c * vip - s * viq;
      v[i][q] = s * vip + c * viq;
    }
  }
  // 特征值 = 对角元;找最小者
  let k = 0;
  if (a[1][1] < a[k][k]) k = 1;
  if (a[2][2] < a[k][k]) k = 2;
  const e = [v[0][k], v[1][k], v[2][k]];
  const len = Math.hypot(e[0], e[1], e[2]) || 1;
  return [e[0] / len, e[1] / len, e[2] / len];
}

/** 判定闭合边界环是否位于一个平面内(平面孔洞) */
function loopIsPlanar(pts: number[][], tol: number): boolean {
  if (pts.length < 3) return false;
  let cx = 0,
    cy = 0,
    cz = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const inv = 1 / pts.length;
  cx *= inv;
  cy *= inv;
  cz *= inv;
  let xx = 0,
    xy = 0,
    xz = 0,
    yy = 0,
    yz = 0,
    zz = 0;
  for (const p of pts) {
    const dx = p[0] - cx,
      dy = p[1] - cy,
      dz = p[2] - cz;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }
  const n = smallestEigenVector([xx, xy, xz, yy, yz, zz]);
  let maxDev = 0;
  for (const p of pts) {
    const dev = Math.abs(
      (p[0] - cx) * n[0] + (p[1] - cy) * n[1] + (p[2] - cz) * n[2]
    );
    if (dev > maxDev) maxDev = dev;
  }
  return maxDev <= tol;
}

export function weldAndAnalyzeTopology(
  positions: Float32Array
): TopologyResult {
  const { min, max, diag } = computeBBox(positions);
  const { vertices, faceVertex, vertexCount, originalCount } = weldVertices(
    positions,
    diag
  );
  const faceCount = faceVertex.length / 3;

  const faceNormals = new Float32Array(faceCount * 3);
  const faceAreas = new Float32Array(faceCount);
  const faceCentroids = new Float32Array(faceCount * 3);
  const flags = new Uint8Array(faceCount);

  const areaEps = 1e-9 * diag * diag;
  let degenerateCount = 0;

  for (let f = 0; f < faceCount; f++) {
    const a = faceVertex[f * 3],
      b = faceVertex[f * 3 + 1],
      c = faceVertex[f * 3 + 2];
    const ax = vertices[a * 3],
      ay = vertices[a * 3 + 1],
      az = vertices[a * 3 + 2];
    const bx = vertices[b * 3],
      by = vertices[b * 3 + 1],
      bz = vertices[b * 3 + 2];
    const cx = vertices[c * 3],
      cy = vertices[c * 3 + 1],
      cz = vertices[c * 3 + 2];
    faceCentroids[f * 3] = (ax + bx + cx) / 3;
    faceCentroids[f * 3 + 1] = (ay + by + cy) / 3;
    faceCentroids[f * 3 + 2] = (az + bz + cz) / 3;
    const e1x = bx - ax,
      e1y = by - ay,
      e1z = bz - az;
    const e2x = cx - ax,
      e2y = cy - ay,
      e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    faceAreas[f] = len / 2;
    if (
      a === b ||
      b === c ||
      a === c ||
      len < areaEps * 2 ||
      !Number.isFinite(len)
    ) {
      flags[f] |= FACE_FLAG.DEGENERATE;
      degenerateCount++;
    } else {
      const inv = 1 / len;
      faceNormals[f * 3] = nx * inv;
      faceNormals[f * 3 + 1] = ny * inv;
      faceNormals[f * 3 + 2] = nz * inv;
    }
  }

  // ---- 边 → 面映射(退化面不参与拓扑);记录绕向位,用于法线一致性检测 ----
  const vc = vertexCount;
  const edgeFaceMap = new Map<number, number[]>();
  for (let f = 0; f < faceCount; f++) {
    if (flags[f] & FACE_FLAG.DEGENERATE) continue;
    const a = faceVertex[f * 3],
      b = faceVertex[f * 3 + 1],
      c = faceVertex[f * 3 + 2];
    const edges: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [u, v] of edges) {
      if (u === v) continue;
      // dirBit = 0:沿 min→max 遍历;1:沿 max→min
      const dirBit = u < v ? 0 : 1;
      const key = u < v ? u * vc + v : v * vc + u;
      let list = edgeFaceMap.get(key);
      if (!list) {
        list = [];
        edgeFaceMap.set(key, list);
      }
      list.push(f * 2 + dirBit);
    }
  }

  // ---- 重复面检测 ----
  const triMap = new Map<string, number[]>();
  for (let f = 0; f < faceCount; f++) {
    if (flags[f] & FACE_FLAG.DEGENERATE) continue;
    const a = faceVertex[f * 3],
      b = faceVertex[f * 3 + 1],
      c = faceVertex[f * 3 + 2];
    const s = [a, b, c].sort((x, y) => x - y);
    const key = `${s[0]}_${s[1]}_${s[2]}`;
    let list = triMap.get(key);
    if (!list) {
      list = [];
      triMap.set(key, list);
    }
    list.push(f);
  }
  const duplicateSamples: {
    centroid: [number, number, number];
    flipped: boolean;
  }[] = [];
  let duplicatePairCount = 0;
  for (const list of triMap.values()) {
    if (list.length < 2) continue;
    const pairs = (list.length * (list.length - 1)) / 2;
    duplicatePairCount += pairs;
    let flipped = false;
    for (const f of list) {
      flags[f] |= FACE_FLAG.DUPLICATE;
    }
    for (let i = 1; i < list.length; i++) {
      const n0 = list[0],
        n1 = list[i];
      const dot =
        faceNormals[n0 * 3] * faceNormals[n1 * 3] +
        faceNormals[n0 * 3 + 1] * faceNormals[n1 * 3 + 1] +
        faceNormals[n0 * 3 + 2] * faceNormals[n1 * 3 + 2];
      if (dot < 0) flipped = true;
    }
    if (duplicateSamples.length < 300) {
      const f0 = list[0];
      duplicateSamples.push({
        centroid: [
          faceCentroids[f0 * 3],
          faceCentroids[f0 * 3 + 1],
          faceCentroids[f0 * 3 + 2],
        ],
        flipped,
      });
    }
  }

  // ---- 边分类 + 邻接表 + 开放边 / 非流形边线段 ----
  const openSegs: number[] = [];
  const nmSegs: number[] = [];
  const adjTmp: number[][] = new Array(faceCount);
  const boundaryVerts = new Map<number, number[]>(); // 顶点 → 边界邻接顶点(用于边界环游走)
  const vertexNeighbors = new Map<number, number[]>(); // 顶点 → 邻接顶点(用于连通分量)

  for (const [key, list] of edgeFaceMap) {
    const v0 = Math.floor(key / vc);
    const v1 = key % vc;
    if (!vertexNeighbors.has(v0)) vertexNeighbors.set(v0, []);
    if (!vertexNeighbors.has(v1)) vertexNeighbors.set(v1, []);
    vertexNeighbors.get(v0)!.push(v1);
    vertexNeighbors.get(v1)!.push(v0);
    if (list.length === 1) {
      openSegs.push(
        vertices[v0 * 3],
        vertices[v0 * 3 + 1],
        vertices[v0 * 3 + 2],
        vertices[v1 * 3],
        vertices[v1 * 3 + 1],
        vertices[v1 * 3 + 2]
      );
      if (!boundaryVerts.has(v0)) boundaryVerts.set(v0, []);
      if (!boundaryVerts.has(v1)) boundaryVerts.set(v1, []);
      boundaryVerts.get(v0)!.push(v1);
      boundaryVerts.get(v1)!.push(v0);
    } else if (list.length > 2) {
      nmSegs.push(
        vertices[v0 * 3],
        vertices[v0 * 3 + 1],
        vertices[v0 * 3 + 2],
        vertices[v1 * 3],
        vertices[v1 * 3 + 1],
        vertices[v1 * 3 + 2]
      );
    }
    // 邻接:两面边互连;非流形边按链式连接(足够用于连通分量统计)
    for (let i = 0; i + 1 < list.length; i++) {
      const f0 = list[i] >>> 1,
        f1 = list[i + 1] >>> 1;
      if (!adjTmp[f0]) adjTmp[f0] = [];
      if (!adjTmp[f1]) adjTmp[f1] = [];
      adjTmp[f0].push(f1);
      adjTmp[f1].push(f0);
    }
  }

  const adjOffsets = new Uint32Array(faceCount + 1);
  let total = 0;
  for (let f = 0; f < faceCount; f++) {
    adjOffsets[f] = total;
    total += adjTmp[f] ? adjTmp[f].length : 0;
  }
  adjOffsets[faceCount] = total;
  const adjList = new Uint32Array(total);
  let w = 0;
  for (let f = 0; f < faceCount; f++) {
    const nb = adjTmp[f];
    if (nb) for (const n of nb) adjList[w++] = n;
  }

  // ---- 边界环游走:闭合孔洞 / 裂缝链 + 平面孔洞判定 ----
  const holeLoops: TopologyResult["holeLoops"] = [];
  const planarSegs: number[] = [];
  const planarTol = Math.max(0.02, diag * 5e-4);
  const usedEdge = new Set<number>();
  let holeCount = 0;
  let crackChainCount = 0;
  let planarHoleCount = 0;
  for (const startV of boundaryVerts.keys()) {
    if (boundaryVerts.get(startV)!.length === 0) continue;
    // 沿未使用的边界边游走
    const seq: number[] = [startV];
    let prev = -1;
    let cur = startV;
    let closed = false;
    let steps = 0;
    while (steps <= boundaryVerts.size + 1) {
      const nbs = boundaryVerts.get(cur)!;
      let next = -1;
      for (const nb of nbs) {
        const ek = cur < nb ? cur * vc + nb : nb * vc + cur;
        if (usedEdge.has(ek)) continue;
        if (nb === prev && nbs.length > 1) continue;
        next = nb;
        usedEdge.add(ek);
        break;
      }
      if (next === -1) break;
      seq.push(next);
      prev = cur;
      cur = next;
      steps++;
      if (cur === startV) {
        closed = true;
        break;
      }
    }
    const edgeCount = closed ? seq.length - 1 : seq.length - 1;
    if (edgeCount < 1) continue;
    let sumX = 0,
      sumY = 0,
      sumZ = 0;
    for (let i = 0; i + 1 < seq.length; i++) {
      const va = seq[i],
        vb = seq[i + 1];
      sumX += vertices[va * 3] + vertices[vb * 3];
      sumY += vertices[va * 3 + 1] + vertices[vb * 3 + 1];
      sumZ += vertices[va * 3 + 2] + vertices[vb * 3 + 2];
    }
    const cnt = edgeCount * 2;
    const centroid: [number, number, number] = [
      sumX / cnt,
      sumY / cnt,
      sumZ / cnt,
    ];
    let planar = false;
    if (closed && edgeCount >= 3) {
      const pts = seq
        .slice(0, -1)
        .map((v) => [
          vertices[v * 3],
          vertices[v * 3 + 1],
          vertices[v * 3 + 2],
        ]);
      planar = loopIsPlanar(pts, planarTol);
      if (planar) {
        for (let i = 0; i + 1 < seq.length; i++) {
          const va = seq[i],
            vb = seq[i + 1];
          planarSegs.push(
            vertices[va * 3],
            vertices[va * 3 + 1],
            vertices[va * 3 + 2],
            vertices[vb * 3],
            vertices[vb * 3 + 1],
            vertices[vb * 3 + 2]
          );
        }
        planarHoleCount++;
      }
      holeCount++;
    } else {
      crackChainCount++;
    }
    holeLoops.push({
      id: holeLoops.length,
      closed,
      planar,
      edgeCount,
      centroid,
    });
  }

  // ---- 连通分量(基于顶点图,退化面不单独成块) ----
  const vertComp = new Int32Array(vertexCount).fill(-1);
  let componentCount = 0;
  const vQueue = new Int32Array(vertexCount);
  for (const key of edgeFaceMap.keys()) {
    const v0 = Math.floor(key / vc);
    const v1 = key % vc;
    if (vertComp[v0] !== -1 && vertComp[v1] !== -1) continue;
    let head = 0,
      tail = 0;
    const seed = vertComp[v0] === -1 ? v0 : v1;
    vertComp[seed] = componentCount;
    vQueue[tail++] = seed;
    while (head < tail) {
      const v = vQueue[head++];
      const nbs = vertexNeighbors.get(v);
      if (!nbs) continue;
      for (const nb of nbs) {
        if (vertComp[nb] === -1) {
          vertComp[nb] = componentCount;
          vQueue[tail++] = nb;
        }
      }
    }
    componentCount++;
  }
  const faceComponent = new Int32Array(faceCount).fill(-1);
  for (let f = 0; f < faceCount; f++) {
    if (flags[f] & FACE_FLAG.DEGENERATE) continue;
    faceComponent[f] = vertComp[faceVertex[f * 3]];
  }

  // ---- 按连通分量统计:面数 / 体积 / 包围盒 / 开放边 / 非流形边 ----
  const compAcc = Array.from({ length: componentCount }, () => ({
    faceCount: 0,
    volume: 0,
    bboxMin: [Infinity, Infinity, Infinity] as [number, number, number],
    bboxMax: [-Infinity, -Infinity, -Infinity] as [number, number, number],
    openEdges: 0,
    nonManifoldEdges: 0,
  }));
  for (let v = 0; v < vertexCount; v++) {
    const c = vertComp[v];
    if (c === -1) continue;
    const acc = compAcc[c];
    const x = vertices[v * 3],
      y = vertices[v * 3 + 1],
      z = vertices[v * 3 + 2];
    if (x < acc.bboxMin[0]) acc.bboxMin[0] = x;
    if (y < acc.bboxMin[1]) acc.bboxMin[1] = y;
    if (z < acc.bboxMin[2]) acc.bboxMin[2] = z;
    if (x > acc.bboxMax[0]) acc.bboxMax[0] = x;
    if (y > acc.bboxMax[1]) acc.bboxMax[1] = y;
    if (z > acc.bboxMax[2]) acc.bboxMax[2] = z;
  }
  for (let f = 0; f < faceCount; f++) {
    if (flags[f] & FACE_FLAG.DEGENERATE) continue;
    const c = faceComponent[f];
    if (c === -1) continue;
    compAcc[c].faceCount++;
    const a = faceVertex[f * 3],
      b = faceVertex[f * 3 + 1],
      cc = faceVertex[f * 3 + 2];
    const ax = vertices[a * 3],
      ay = vertices[a * 3 + 1],
      az = vertices[a * 3 + 2];
    const bx = vertices[b * 3],
      by = vertices[b * 3 + 1],
      bz = vertices[b * 3 + 2];
    const cx = vertices[cc * 3],
      cy = vertices[cc * 3 + 1],
      cz = vertices[cc * 3 + 2];
    compAcc[c].volume +=
      (ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx)) /
      6;
  }
  for (const [key, list] of edgeFaceMap) {
    const c = vertComp[Math.floor(key / vc)];
    if (c === -1) continue;
    if (list.length === 1) compAcc[c].openEdges++;
    else if (list.length > 2) compAcc[c].nonManifoldEdges++;
  }

  // ---- 嵌套检测:某分量的包围盒完全落在另一封闭分量内部 ----
  // 封闭内壳 → 密封内腔(支撑无法清除);不封闭内壳 → 多余碎片壳体
  const nestEps = diag * 1e-3;
  const isCavity = new Array<boolean>(componentCount).fill(false);
  const isDebris = new Array<boolean>(componentCount).fill(false);
  for (let i = 0; i < componentCount; i++) {
    const inner = compAcc[i];
    if (inner.faceCount === 0) continue;
    for (let j = 0; j < componentCount; j++) {
      if (i === j) continue;
      const outer = compAcc[j];
      if (outer.faceCount === 0) continue;
      if (!(outer.openEdges === 0 && outer.nonManifoldEdges === 0)) continue;
      const inside =
        inner.bboxMin[0] >= outer.bboxMin[0] - nestEps &&
        inner.bboxMin[1] >= outer.bboxMin[1] - nestEps &&
        inner.bboxMin[2] >= outer.bboxMin[2] - nestEps &&
        inner.bboxMax[0] <= outer.bboxMax[0] + nestEps &&
        inner.bboxMax[1] <= outer.bboxMax[1] + nestEps &&
        inner.bboxMax[2] <= outer.bboxMax[2] + nestEps;
      if (inside) {
        if (inner.openEdges === 0 && inner.nonManifoldEdges === 0)
          isCavity[i] = true;
        else isDebris[i] = true;
        break;
      }
    }
  }

  // ---- 法线方向检测 ----
  // 1) 整体朝内的封闭壳:顶层封闭壳体积为负,或被包裹内腔体积为正(法线指向材料)
  const globalInverted = new Array<boolean>(componentCount).fill(false);
  let globalInvertedShellCount = 0;
  for (let c = 0; c < componentCount; c++) {
    const acc = compAcc[c];
    if (acc.faceCount === 0) continue;
    const closed = acc.openEdges === 0 && acc.nonManifoldEdges === 0;
    if (!closed) continue;
    const inverted = isCavity[c] ? acc.volume > 0 : acc.volume < 0;
    if (inverted) {
      globalInverted[c] = true;
      globalInvertedShellCount++;
    }
  }
  if (globalInvertedShellCount > 0) {
    for (let f = 0; f < faceCount; f++) {
      const c = faceComponent[f];
      if (c !== -1 && globalInverted[c]) flags[f] |= FACE_FLAG.FLIPPED;
    }
  }

  // 2) 局部翻转面:沿流形边做绕向一致性 BFS(整体反转的分量不再重复判定)
  let flippedFaceCount = 0;
  {
    const color = new Int8Array(faceCount).fill(-1); // -1 未访问,0 / 1 两种绕向
    const queue = new Int32Array(faceCount);
    const faceEdges = (f: number): [number, number][] => {
      const a = faceVertex[f * 3],
        b = faceVertex[f * 3 + 1],
        c = faceVertex[f * 3 + 2];
      return [
        [a, b],
        [b, c],
        [c, a],
      ];
    };
    for (let seed = 0; seed < faceCount; seed++) {
      if (color[seed] !== -1 || flags[seed] & FACE_FLAG.DEGENERATE) continue;
      if (faceComponent[seed] !== -1 && globalInverted[faceComponent[seed]]) {
        color[seed] = 0; // 整体反转壳已整体标记,跳过
        continue;
      }
      let head = 0,
        tail = 0;
      color[seed] = 0;
      queue[tail++] = seed;
      let c0 = 0,
        c1 = 0;
      while (head < tail) {
        const f = queue[head++];
        if (color[f] === 0) c0++;
        else c1++;
        const myColor = color[f];
        for (const [u, v] of faceEdges(f)) {
          if (u === v) continue;
          const key = u < v ? u * vc + v : v * vc + u;
          const list = edgeFaceMap.get(key);
          if (!list || list.length !== 2) continue; // 开放边 / 非流形边不参与
          const myEntry = list.find((e) => e >>> 1 === f)!;
          const otherEntry = list.find((e) => e >>> 1 !== f)!;
          const otherF = otherEntry >>> 1;
          if (color[otherF] !== -1) continue;
          // 绕向一致 ⇔ 同一条边上两个面的方向位相反
          const consistent = (myEntry & 1) !== (otherEntry & 1);
          color[otherF] = consistent ? myColor : 1 - myColor;
          queue[tail++] = otherF;
        }
      }
      // 少数派一侧为翻转面(只遍历本次 BFS 覆盖的面,避免跨分量误标)
      const flippedSide = c1 > c0 ? 0 : 1;
      if (c0 !== c1) {
        for (let i = 0; i < tail; i++) {
          const f = queue[i];
          if (color[f] === flippedSide) {
            flags[f] |= FACE_FLAG.FLIPPED;
            flippedFaceCount++;
          }
        }
      }
    }
  }

  // ---- 汇总分量信息 ----
  const components: MeshComponentInfo[] = compAcc.map((acc, i) => ({
    faceCount: acc.faceCount,
    closed: acc.openEdges === 0 && acc.nonManifoldEdges === 0,
    openEdges: acc.openEdges,
    nonManifoldEdges: acc.nonManifoldEdges,
    volume: acc.volume,
    bboxMin: acc.bboxMin,
    bboxMax: acc.bboxMax,
    isCavity: isCavity[i],
    isDebris: isDebris[i],
    globalInverted: globalInverted[i],
  }));

  // ---- 有符号体积(正值 = 法线朝外) ----
  let volume = 0;
  for (let f = 0; f < faceCount; f++) {
    const a = faceVertex[f * 3],
      b = faceVertex[f * 3 + 1],
      c = faceVertex[f * 3 + 2];
    const ax = vertices[a * 3],
      ay = vertices[a * 3 + 1],
      az = vertices[a * 3 + 2];
    const bx = vertices[b * 3],
      by = vertices[b * 3 + 1],
      bz = vertices[b * 3 + 2];
    const cx = vertices[c * 3],
      cy = vertices[c * 3 + 1],
      cz = vertices[c * 3 + 2];
    volume +=
      (ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx)) /
      6;
  }

  const cavityShellCount = isCavity.filter(Boolean).length;
  const enclosedOpenShellCount = isDebris.filter(Boolean).length;

  return {
    mesh: {
      vertexCount,
      vertices,
      faceVertex,
      faceCount,
      faceNormals,
      faceAreas,
      faceCentroids,
      adjOffsets,
      adjList,
      edgeFaceMap,
      vertexCountOriginal: originalCount,
      diag,
      bboxMin: min,
      bboxMax: max,
    },
    flags,
    openEdgeVerts: new Float32Array(openSegs),
    nonManifoldVerts: new Float32Array(nmSegs),
    planarHoleVerts: new Float32Array(planarSegs),
    holeLoops,
    holeCount,
    crackChainCount,
    planarHoleCount,
    faceComponent,
    componentCount,
    components,
    sealedHollow: cavityShellCount > 0,
    cavityShellCount,
    enclosedOpenShellCount,
    volume,
    duplicatePairCount,
    degenerateCount,
    flippedFaceCount,
    globalInvertedShellCount,
    duplicateSamples,
  };
}
