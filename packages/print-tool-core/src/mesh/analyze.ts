/**
 * 模型检查主流程:拓扑 → 壳体分类 → 聚类 → 汇总
 * 在 Web Worker 中运行。检测范围:反转法向 / 坏边(缝隙、平面孔洞、非流形、退化、重复)
 * / 壳体(多余壳体、噪声壳体);不检测悬空,不做壁厚检测。
 *
 * 移植自 wjp-model-checker-source/src/lib/mesh/analyze.ts
 */
// @ts-nocheck —— 同 weld.ts:全是 typedArray 下标访问,逐个加 `!` 会淹没移植 diff。
// 行为由 src/test/tools/pure/wjp-mesh.test.ts 守住。

import { buildCheckStats, buildCheckWarnings, classifyShells } from "./summary";
import { buildSupportShell } from "./support-shell";
import {
  type AnalysisResult,
  FACE_FLAG,
  type IssueCluster,
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
  onProgress: ProgressFn,
  liftMm?: number,
  baseMarginMm?: number
): { state: WorkerState | null; result: AnalysisResult } {
  const t0 = performance.now();
  onProgress("weld", 8);
  const topo = weldAndAnalyzeTopology(positions);
  const state: WorkerState = { topo, fileName };
  const result = runAnalysis(state, onProgress, liftMm, baseMarginMm);
  result.stats.analysisMs = Math.round(performance.now() - t0);
  return { state, result };
}

export function runAnalysis(
  state: WorkerState,
  onProgress: ProgressFn,
  liftMm?: number,
  baseMarginMm?: number
): AnalysisResult {
  const { topo, fileName } = state;
  const mesh = topo.mesh;
  const faceCount = mesh.faceCount;
  const t0 = performance.now();

  // 基础标记:退化 + 重复 + 法线翻转(拓扑属性,由 weld 阶段完成)
  const flags = new Uint8Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    flags[f] =
      topo.flags[f] &
      (FACE_FLAG.DEGENERATE | FACE_FLAG.DUPLICATE | FACE_FLAG.FLIPPED);
  }

  // ---------- 壳体分类:主壳体 / 非主壳体 / 噪声壳体 ----------
  //
  // 分类口径在 `summary.ts` 的 `classifyShells()` 里 —— 克重工具的自检
  // 摘要走的是**同一个函数**,所以两个工具不可能给出相反的结论。
  onProgress("shells", 30);
  const compCount = topo.componentCount;
  const shells = classifyShells(topo);
  const shellInfos: ShellInfo[] = [];
  const shellIndexMap = new Map<number, ShellInfo>();
  for (let c = 0; c < compCount; c++) {
    const info = topo.components[c];
    if (info.faceCount === 0) continue;
    const kind = shells.kinds[c] ?? "extra";
    const dx = info.bboxMax[0] - info.bboxMin[0];
    const dy = info.bboxMax[1] - info.bboxMin[1];
    const dz = info.bboxMax[2] - info.bboxMin[2];
    const shellInfo: ShellInfo = {
      index: c,
      faceCount: info.faceCount,
      volume: info.volume,
      closed: info.closed,
      openEdges: info.openEdges,
      nonManifoldEdges: info.nonManifoldEdges,
      bboxDiag: Math.sqrt(dx * dx + dy * dy + dz * dz),
      centroid: [
        (info.bboxMin[0] + info.bboxMax[0]) / 2,
        (info.bboxMin[1] + info.bboxMax[1]) / 2,
        (info.bboxMin[2] + info.bboxMax[2]) / 2,
      ],
      isPrimary: kind === "primary",
      isCavity: info.isCavity,
      isDebris: info.isDebris,
      isNoise: kind === "noise",
      globalInverted: info.globalInverted,
    };
    shellInfos.push(shellInfo);
    shellIndexMap.set(c, shellInfo);
  }
  // 噪声 / 多余壳体的计数在 `shells` 里 —— 统计和提示都由 `buildCheckStats`
  // / `buildCheckWarnings` 统一取,这里不重复数一遍。
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
  onProgress("support", 92);
  const faceEnclosed = new Uint8Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    const c = topo.faceComponent[f];
    if (c === -1) continue;
    const info = topo.components[c];
    if (info && (info.isCavity || info.isDebris)) faceEnclosed[f] = 1;
  }
  // 支撑外壳 —— **带底板留边那一圈**
  //
  // 工作室的工艺:底板比模型轮廓四周各留一圈边(默认 5mm),那圈边也是实心
  // 支撑 —— 克重那边**算进去了**(`computeSupportVolume` 的 baseMargin),
  // 画面上原来没画。两个视角并排看,差的就是这一圈。
  //
  // 外扩走欧氏距离(不是八邻域),跟算克重那一条路共用同一张栅格。
  const supportShell = buildSupportShell(mesh, faceEnclosed, {
    liftMm,
    baseMarginMM: baseMarginMm,
    includeBaseRing: true,
  });
  onProgress("done", 100);

  /**
   * 统计 —— **跟克重工具的自检摘要同一个来源**(`buildCheckStats`)
   *
   * 两边吃的是同一个函数,所以「检查工具说 3 处破面、克重工具徽标说 3 处
   * 破面」这件事是**结构上保证**的,不是靠两边手写一致。
   */
  const stats = buildCheckStats(topo, shells, {
    fileName,
    analysisMs: Math.round(performance.now() - t0),
  });
  // 提示清单 —— 同样共用(`buildCheckWarnings`)
  const warnings = buildCheckWarnings(stats);

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
    stats,
  };
}
