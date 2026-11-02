/**
 * 模型检查主流程:拓扑 → 壳体分类 → 聚类 → 汇总
 * 在 Web Worker 中运行。检测范围:反转法向 / 坏边(缝隙、平面孔洞、非流形、退化、重复)
 * / 壳体(多余壳体、噪声壳体);不检测悬空,不做壁厚检测。
 *
 * 移植自 wjp-model-checker-source/src/lib/mesh/analyze.ts
 */
// @ts-nocheck —— 同 weld.ts:全是 typedArray 下标访问,逐个加 `!` 会淹没移植 diff。
// 行为由 src/test/tools/pure/wjp-mesh.test.ts 守住。
import {
  type AnalysisResult,
  FACE_FLAG,
  type IssueCluster,
  type MessageRef,
  type ProgressStage,
  type ShellInfo,
  type SupportShellData,
} from "./types";
import {
  type TopologyResult,
  type WeldedMesh,
  weldAndAnalyzeTopology,
} from "./weld";

export interface WorkerState {
  topo: TopologyResult;
  fileName: string;
}

type ProgressFn = (stage: ProgressStage, pct: number) => void;

/**
 * 包裹支撑几何:焊接顶点按相邻面面积加权平均出平滑法线,再沿法线整体外扩固定间隙。
 * WJP 全彩打印的水溶性支撑为整体包裹式(逐层喷射、包住模型),此几何即其包裹范围示意。
 * 间隙随模型尺寸自适应:对角线的 2%,限制在 0.8~5mm,保证任何尺寸下都看得清。
 *
 * 支撑体积(平台到模型之间全部为支撑材料)由三部分共同围合:
 * - underside:下朝向面片(支撑材料的上边界,贴着模型底面);
 * - curtain:下朝向区域的边界边竖直向下挤出至平台平面(支撑体外壁),内部共享边不挤出;
 * - 平台投影(主线程把全部面片压平到平台生成,支撑体的底面 / 占地区域)。
 *
 * 坐标基准:groundZ 取模型自身最低点略下方(非世界原点),主线程把整组几何再平移
 * -bboxMin.z 后,模型最低点恰好落在打印平台上。外壳顶点 z 不低于 groundZ:
 * 支撑材料落在平台上,不会下探到平台以下。
 *
 * faceEnclosed:被外壳包裹的内腔 / 碎片壳面片标记(1 = 封闭内部)。这些面片朝下也
 * 不生成支撑体(内部支撑无法清除的问题已由密封内腔告警覆盖),避免在模型实心内部
 * 出现误导性的支撑墙面。
 */
function buildSupportShell(
  mesh: WeldedMesh,
  faceEnclosed: Uint8Array
): SupportShellData {
  const vc = mesh.vertexCount;
  const normals = new Float32Array(vc * 3);
  for (let f = 0; f < mesh.faceCount; f++) {
    const w = mesh.faceAreas[f];
    const nx = mesh.faceNormals[f * 3] * w;
    const ny = mesh.faceNormals[f * 3 + 1] * w;
    const nz = mesh.faceNormals[f * 3 + 2] * w;
    if (nx === 0 && ny === 0 && nz === 0) continue; // 退化面不参与
    for (let k = 0; k < 3; k++) {
      const v = mesh.faceVertex[f * 3 + k];
      normals[v * 3] += nx;
      normals[v * 3 + 1] += ny;
      normals[v * 3 + 2] += nz;
    }
  }
  // 平台平面(模型坐标):模型最低点略下方,主线程整组平移后即为打印平台
  const groundZ = mesh.bboxMin[2] - Math.max(0.05, mesh.diag * 0.002);
  const gap = Math.min(5, Math.max(0.8, mesh.diag * 0.02));
  const positions = new Float32Array(vc * 3);
  for (let v = 0; v < vc; v++) {
    let nx = normals[v * 3],
      ny = normals[v * 3 + 1],
      nz = normals[v * 3 + 2];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0;
      ny = 0;
      nz = 1;
    }
    positions[v * 3] = mesh.vertices[v * 3] + nx * gap;
    positions[v * 3 + 1] = mesh.vertices[v * 3 + 1] + ny * gap;
    const pz = mesh.vertices[v * 3 + 2] + nz * gap;
    positions[v * 3 + 2] = pz < groundZ ? groundZ : pz; // 支撑落在平台上,不下探到平台以下
  }

  // ---- 下朝向面判定:z 分量略小于 0 即视为朝下(阈值贴近 0,使支撑体侧壁上沿
  // 贴到模型最宽轮廓,支撑填充看起来包裹到侧面中部);封闭内腔 / 包裹碎片除外 ----
  const DOWN_NZ = -1e-3;
  const isDownFace = (f: number) =>
    faceEnclosed[f] === 0 && mesh.faceNormals[f * 3 + 2] < DOWN_NZ;
  const GROUND_EPS = 0.02; // 贴地阈值:压平到平台的几何由平台投影负责,不再重复生成

  const topIndex: number[] = [];
  const underside: number[] = [];
  const curtain: number[] = [];
  const BUILD_CAP = 5_400_000; // ≈60 万面片,防御异常网格
  let capped = false;
  for (let f = 0; f < mesh.faceCount; f++) {
    const a = mesh.faceVertex[f * 3],
      b = mesh.faceVertex[f * 3 + 1],
      c = mesh.faceVertex[f * 3 + 2];
    if (!isDownFace(f)) {
      topIndex.push(a, b, c); // 外壳渲染索引:下朝向面由支撑体负责,避免两层面片叠加
      continue;
    }
    if (capped) continue;
    const za = positions[a * 3 + 2],
      zb = positions[b * 3 + 2],
      zc = positions[c * 3 + 2];
    // 支撑体顶面:下朝向面本身(贴着模型底面的支撑上边界)
    if (
      za - groundZ > GROUND_EPS ||
      zb - groundZ > GROUND_EPS ||
      zc - groundZ > GROUND_EPS
    ) {
      underside.push(
        positions[a * 3],
        positions[a * 3 + 1],
        za,
        positions[b * 3],
        positions[b * 3 + 1],
        zb,
        positions[c * 3],
        positions[c * 3 + 1],
        zc
      );
    }
    // 支撑体外壁:下朝向区域的边界边竖直向下挤出至平台,内部共享边不挤出
    const edges: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [u, v] of edges) {
      if (u === v) continue;
      const key = u < v ? u * vc + v : v * vc + u;
      const list = mesh.edgeFaceMap.get(key);
      let boundary = true;
      if (list) {
        for (const e of list) {
          const g = e >>> 1;
          if (g !== f && isDownFace(g)) {
            boundary = false;
            break;
          }
        }
      }
      if (!boundary) continue;
      const uz = positions[u * 3 + 2],
        vz = positions[v * 3 + 2];
      if (uz - groundZ < GROUND_EPS && vz - groundZ < GROUND_EPS) continue; // 贴地边,无侧壁
      curtain.push(
        positions[u * 3],
        positions[u * 3 + 1],
        uz,
        positions[v * 3],
        positions[v * 3 + 1],
        vz,
        positions[v * 3],
        positions[v * 3 + 1],
        groundZ,
        positions[u * 3],
        positions[u * 3 + 1],
        uz,
        positions[v * 3],
        positions[v * 3 + 1],
        groundZ,
        positions[u * 3],
        positions[u * 3 + 1],
        groundZ
      );
    }
    if (curtain.length >= BUILD_CAP || underside.length >= BUILD_CAP)
      capped = true;
  }

  return {
    positions,
    index: mesh.faceVertex,
    topIndex: new Uint32Array(topIndex),
    underside: new Float32Array(underside),
    gap,
    curtain: new Float32Array(curtain),
  };
}

export function analyzeNewMesh(
  positions: Float32Array,
  fileName: string,
  onProgress: ProgressFn
): { state: WorkerState | null; result: AnalysisResult } {
  const t0 = performance.now();
  onProgress("weld", 8);
  const topo = weldAndAnalyzeTopology(positions);
  const state: WorkerState = { topo, fileName };
  const result = runAnalysis(state, onProgress);
  result.stats.analysisMs = Math.round(performance.now() - t0);
  return { state, result };
}

export function runAnalysis(
  state: WorkerState,
  onProgress: ProgressFn
): AnalysisResult {
  const { topo, fileName } = state;
  const mesh = topo.mesh;
  const faceCount = mesh.faceCount;
  const t0 = performance.now();
  const warnings: MessageRef[] = [];

  // 基础标记:退化 + 重复 + 法线翻转(拓扑属性,由 weld 阶段完成)
  const flags = new Uint8Array(faceCount);
  let duplicateFaceCount = 0;
  for (let f = 0; f < faceCount; f++) {
    flags[f] =
      topo.flags[f] &
      (FACE_FLAG.DEGENERATE | FACE_FLAG.DUPLICATE | FACE_FLAG.FLIPPED);
    if (flags[f] & FACE_FLAG.DUPLICATE) duplicateFaceCount++;
  }

  // ---------- 壳体分类:主壳体 / 非主壳体 / 噪声壳体 ----------
  onProgress("shells", 30);
  const compCount = topo.componentCount;
  let primaryComp = -1;
  let primaryVolume = -Infinity;
  for (let c = 0; c < compCount; c++) {
    const info = topo.components[c];
    if (info.faceCount === 0) continue;
    const v = Math.abs(info.volume);
    if (v > primaryVolume) {
      primaryVolume = v;
      primaryComp = c;
    }
  }
  const modelDiag = mesh.diag;
  const noiseDiagLimit = modelDiag * 0.05;
  const shellInfos: ShellInfo[] = [];
  for (let c = 0; c < compCount; c++) {
    const info = topo.components[c];
    if (info.faceCount === 0) continue;
    const dx = info.bboxMax[0] - info.bboxMin[0];
    const dy = info.bboxMax[1] - info.bboxMin[1];
    const dz = info.bboxMax[2] - info.bboxMin[2];
    const bboxDiag = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const isNoise =
      !info.isCavity && c !== primaryComp && bboxDiag < noiseDiagLimit;
    shellInfos.push({
      index: c,
      faceCount: info.faceCount,
      volume: info.volume,
      closed: info.closed,
      openEdges: info.openEdges,
      nonManifoldEdges: info.nonManifoldEdges,
      bboxDiag,
      centroid: [
        (info.bboxMin[0] + info.bboxMax[0]) / 2,
        (info.bboxMin[1] + info.bboxMax[1]) / 2,
        (info.bboxMin[2] + info.bboxMax[2]) / 2,
      ],
      isPrimary: c === primaryComp,
      isCavity: info.isCavity,
      isDebris: info.isDebris,
      isNoise,
      globalInverted: info.globalInverted,
    });
  }
  let noiseShellCount = 0;
  let extraShellCount = 0;
  const shellIndexMap = new Map<number, ShellInfo>();
  for (const s of shellInfos) {
    shellIndexMap.set(s.index, s);
    if (s.isNoise) noiseShellCount++;
    else if (!s.isPrimary) extraShellCount++;
  }
  for (let f = 0; f < faceCount; f++) {
    if (flags[f] & FACE_FLAG.DEGENERATE) continue;
    const c = topo.faceComponent[f];
    if (c === -1) continue;
    const s = shellIndexMap.get(c);
    if (!s) continue;
    if (s.isNoise) flags[f] |= FACE_FLAG.SHELL_NOISE;
    else if (!s.isPrimary) flags[f] |= FACE_FLAG.SHELL_EXTRA;
  }

  onProgress("cluster", 86);

  // ---------- 聚类 ----------
  const clusters: IssueCluster[] = [];
  const queue = new Int32Array(faceCount);

  const buildClusters = (
    match: (f: number) => boolean,
    kind: IssueCluster["kind"],
    cap: number
  ) => {
    const visited = new Uint8Array(faceCount);
    for (let seed = 0; seed < faceCount; seed++) {
      if (!match(seed) || visited[seed]) continue;
      let head = 0,
        tail = 0;
      visited[seed] = 1;
      queue[tail++] = seed;
      let count = 0,
        area = 0,
        cx = 0,
        cy = 0,
        cz = 0;
      while (head < tail) {
        const f = queue[head++];
        count++;
        const a = mesh.faceAreas[f];
        area += a;
        cx += mesh.faceCentroids[f * 3] * a;
        cy += mesh.faceCentroids[f * 3 + 1] * a;
        cz += mesh.faceCentroids[f * 3 + 2] * a;
        for (let i = mesh.adjOffsets[f]; i < mesh.adjOffsets[f + 1]; i++) {
          const nb = mesh.adjList[i];
          if (!visited[nb] && match(nb)) {
            visited[nb] = 1;
            queue[tail++] = nb;
          }
        }
      }
      if (clusters.length < cap) {
        const inv = area > 0 ? 1 / area : 0;
        clusters.push({
          id: clusters.length,
          kind,
          count,
          area,
          centroid: [cx * inv, cy * inv, cz * inv],
        });
      }
    }
  };

  // 法线翻转面
  buildClusters((f) => (flags[f] & FACE_FLAG.FLIPPED) !== 0, "flipped", 150);

  // 退化面聚类(通常孤立,按邻接合并)
  {
    const degVisited = new Uint8Array(faceCount);
    let listed = 0;
    for (let seed = 0; seed < faceCount; seed++) {
      if (!(flags[seed] & FACE_FLAG.DEGENERATE) || degVisited[seed]) continue;
      let head = 0,
        tail = 0;
      degVisited[seed] = 1;
      queue[tail++] = seed;
      let count = 0,
        cx = 0,
        cy = 0,
        cz = 0;
      while (head < tail) {
        const f = queue[head++];
        count++;
        cx += mesh.faceCentroids[f * 3];
        cy += mesh.faceCentroids[f * 3 + 1];
        cz += mesh.faceCentroids[f * 3 + 2];
        for (let i = mesh.adjOffsets[f]; i < mesh.adjOffsets[f + 1]; i++) {
          const nb = mesh.adjList[i];
          if (!degVisited[nb] && flags[nb] & FACE_FLAG.DEGENERATE) {
            degVisited[nb] = 1;
            queue[tail++] = nb;
          }
        }
      }
      if (listed < 300) {
        clusters.push({
          id: clusters.length,
          kind: "degenerate",
          count,
          area: 0,
          centroid: [cx / count, cy / count, cz / count],
        });
        listed++;
      }
    }
  }

  // 重复面样本
  for (const dup of topo.duplicateSamples) {
    clusters.push({
      id: clusters.length,
      kind: "duplicate",
      count: 2,
      area: 0,
      centroid: dup.centroid,
    });
  }

  // ---------- 汇总 ----------
  const watertight =
    faceCount > 0 &&
    topo.openEdgeVerts.length === 0 &&
    topo.nonManifoldVerts.length === 0;

  if (topo.openEdgeVerts.length > 0) {
    warnings.push({
      key: "warnings.openEdges",
      params: {
        openEdges: topo.openEdgeVerts.length / 6,
        planarHoles: topo.planarHoleCount,
        cracks: topo.crackChainCount,
      },
    });
  }
  if (topo.globalInvertedShellCount > 0) {
    warnings.push({
      key: "warnings.globalInverted",
      params: { count: topo.globalInvertedShellCount },
    });
  }
  if (topo.flippedFaceCount > 0) {
    warnings.push({
      key: "warnings.flippedFaces",
      params: { count: topo.flippedFaceCount },
    });
  }
  if (topo.sealedHollow) {
    warnings.push({
      key: "warnings.sealedHollow",
      params: { count: topo.cavityShellCount },
    });
  }
  if (topo.enclosedOpenShellCount > 0) {
    warnings.push({
      key: "warnings.enclosedOpenShells",
      params: { count: topo.enclosedOpenShellCount },
    });
  }
  if (noiseShellCount > 0) {
    warnings.push({
      key: "warnings.noiseShells",
      params: { count: noiseShellCount },
    });
  }
  if (compCount > 1) {
    warnings.push({
      key: "warnings.multipleShells",
      params: { count: compCount },
    });
  }
  onProgress("support", 92);
  const faceEnclosed = new Uint8Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    const c = topo.faceComponent[f];
    if (c === -1) continue;
    const info = topo.components[c];
    if (info && (info.isCavity || info.isDebris)) faceEnclosed[f] = 1;
  }
  const supportShell = buildSupportShell(mesh, faceEnclosed);
  onProgress("done", 100);

  return {
    flags,
    faceComponent: topo.faceComponent,
    openEdges: topo.openEdgeVerts,
    nonManifoldEdges: topo.nonManifoldVerts,
    planarHoleEdges: topo.planarHoleVerts,
    holeLoops: topo.holeLoops,
    shells: shellInfos,
    clusters,
    warnings,
    supportShell,
    stats: {
      fileName,
      vertexCount: mesh.vertexCount,
      triangleCount: faceCount,
      componentCount: compCount,
      watertight,
      volumeMm3: topo.volume,
      bboxMin: mesh.bboxMin,
      bboxMax: mesh.bboxMax,
      flippedFaceCount: topo.flippedFaceCount,
      globalInvertedShellCount: topo.globalInvertedShellCount,
      degenerateCount: topo.degenerateCount,
      duplicateFaceCount,
      duplicatePairCount: topo.duplicatePairCount,
      openEdgeCount: topo.openEdgeVerts.length / 6,
      crackChainCount: topo.crackChainCount,
      holeCount: topo.holeCount,
      planarHoleCount: topo.planarHoleCount,
      nonManifoldEdgeCount: topo.nonManifoldVerts.length / 6,
      extraShellCount,
      noiseShellCount,
      cavityShellCount: topo.cavityShellCount,
      enclosedOpenShellCount: topo.enclosedOpenShellCount,
      sealedHollow: topo.sealedHollow,
      analysisMs: Math.round(performance.now() - t0),
    },
  };
}
