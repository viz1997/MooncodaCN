/**
 * 模型检查主流程:拓扑 → 壳体分类 → 聚类 → 汇总
 * 在 Web Worker 中运行。检测范围:反转法向 / 坏边(缝隙、平面孔洞、非流形、退化、重复)
 * / 壳体(多余壳体、噪声壳体);不检测悬空,不做壁厚检测。
 *
 * 移植自 wjp-model-checker-source/src/lib/mesh/analyze.ts
 */
// @ts-nocheck —— 同 weld.ts:全是 typedArray 下标访问,逐个加 `!` 会淹没移植 diff。
// 行为由 src/test/tools/pure/wjp-mesh.test.ts 守住。
import { buildSupportShell } from "./support-shell";
import {
  type AnalysisResult,
  FACE_FLAG,
  type IssueCluster,
  type MessageRef,
  type ProgressStage,
  type ShellInfo,
} from "./types";
import { type TopologyResult, weldAndAnalyzeTopology } from "./weld";

export interface WorkerState {
  topo: TopologyResult;
  fileName: string;
}

type ProgressFn = (stage: ProgressStage, pct: number) => void;

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
