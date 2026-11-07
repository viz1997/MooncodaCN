/**
 * 网格自检摘要 —— **纯函数**(不碰 DOM、不碰 React、不碰 DB)
 *
 * ## 它解决什么
 *
 * 工作室拿到一个模型,要回答两个问题:
 *
 * 1. **能不能印?**(反转法向 / 破面 / 密封内腔)
 * 2. **要多少料?**(耗材克重 + 支撑克重)
 *
 * 以前这两个问题分在两个工具页里(`/tools/model-check` 和 `/tools/weight`),
 * 同一个文件要拖两次、解压两次。2026-11-07 起两个页面合成一个工作台
 * (`/tools/workbench`),模型只载入一次 —— 摘要就是工作台头部那枚徽标。
 *
 * 而克重工具那边其实**已经算出了完整拓扑** —— 摆盘 Worker 焊接的时候顺带
 * 做的(`weldAndAnalyzeTopology`),只是 `prepareSupportModel` 把除了网格和
 * 内腔标记之外的东西全扔了。这一份摘要就是把它**捡回来**。
 *
 * ## 一份口径(最重要的一条)
 *
 * 摘要里的每一个数、每一条结论,都跟模型检查工具**走同一套代码**:
 *
 * | 摘要 | 检查工具 |
 * |---|---|
 * | `classifyShells()` | `analyze.ts` 的壳体分类 |
 * | `buildCheckStats()` | `analyze.ts` 的 `stats` |
 * | `buildCheckWarnings()` | `analyze.ts` 的 `warnings` |
 * | `evaluateWjp()` | `wjp.ts` 的 WJP 工艺评估 |
 *
 * 所以两个工具**不可能**对同一个模型给出相反的结论 —— 摘要不是「另一套
 * 判定」,就是同一套判定的另一个出口。
 *
 * 行为由 `src/test/tools/pure/mesh-summary.test.ts` 守住。
 */

import { type AnalysisStats, FACE_FLAG, type MessageRef } from "./types";
import type { TopologyResult } from "./weld";
import { evaluateWjp, type WjpReport } from "./wjp";

/* -------------------------------------------------------------------------- */
/*  壳体分类                                                                   */
/* -------------------------------------------------------------------------- */

/** 连通分量的归类 */
export type ShellKind =
  /** 主壳体(面数 / 体积最大的那个) */
  | "primary"
  /** 噪声壳体(相对整体极小的碎片) */
  | "noise"
  /** 其余非主壳体(多余部件 / 密封内腔 / 被包裹的碎片) */
  | "extra";

export interface ShellClassification {
  /** 主壳体的连通分量号(-1 = 一个面都没有) */
  primaryComp: number;
  /**
   * 每个连通分量的归类 —— 下标 = 连通分量号
   *
   * `null` = 这个分量一个有效面都没有(焊接阶段就丢了),直接跳过。
   */
  kinds: (ShellKind | null)[];
  /** 噪声碎片壳体数 */
  noiseShellCount: number;
  /** 多余壳体数(不含噪声) */
  extraShellCount: number;
}

/**
 * 把连通分量分成「主壳体 / 噪声碎片 / 多余壳体」
 *
 * ## 判据(跟检查工具逐字一致 —— 这份判定被两边共用)
 *
 * - **主壳体** = 有向体积**绝对值**最大的那个连通分量
 *   (用绝对值:整体法线朝内的壳体积是负的,取绝对值才是「最大的那个」)
 * - **噪声壳体** = 不是主壳体、不是密封内腔、且包围盒对角线 <
 *   整体对角线的 5%
 * - **其余非主壳体** = 多余壳体(独立部件 / 密封内腔 / 被包裹的碎片)
 *
 * 密封内腔**不算**噪声 —— 它是「里面洗不掉的支撑」,得单独报给工作室。
 */
export function classifyShells(topo: TopologyResult): ShellClassification {
  const comps = topo.components;
  const compCount = topo.componentCount;
  const kinds: (ShellKind | null)[] = new Array(compCount).fill(null);

  // ---- 主壳体 ----
  let primaryComp = -1;
  let primaryVolume = -Infinity;
  for (let c = 0; c < compCount; c++) {
    const info = comps[c];
    if (!info || info.faceCount === 0) continue;
    const v = Math.abs(info.volume);
    if (v > primaryVolume) {
      primaryVolume = v;
      primaryComp = c;
    }
  }

  // ---- 噪声 / 多余 ----
  const noiseDiagLimit = topo.mesh.diag * 0.05;
  let noiseShellCount = 0;
  let extraShellCount = 0;
  for (let c = 0; c < compCount; c++) {
    const info = comps[c];
    if (!info || info.faceCount === 0) continue;

    const dx = info.bboxMax[0] - info.bboxMin[0];
    const dy = info.bboxMax[1] - info.bboxMin[1];
    const dz = info.bboxMax[2] - info.bboxMin[2];
    const bboxDiag = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (c === primaryComp) {
      kinds[c] = "primary";
      continue;
    }
    const isNoise = !info.isCavity && bboxDiag < noiseDiagLimit;
    if (isNoise) {
      kinds[c] = "noise";
      noiseShellCount++;
    } else {
      kinds[c] = "extra";
      extraShellCount++;
    }
  }

  return { primaryComp, kinds, noiseShellCount, extraShellCount };
}

/* -------------------------------------------------------------------------- */
/*  统计                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 从拓扑算出一份统计 —— **跟检查工具的 `stats` 同一个形状**
 *
 * 形状一样不是为了省事,是为了让 `evaluateWjp()` 之类的判定函数**不用**
 * 知道自己吃的是哪一份数据(检查工具的完整分析结果,还是这里的摘要)。
 */
export function buildCheckStats(
  topo: TopologyResult,
  shells: ShellClassification,
  options?: { fileName?: string; analysisMs?: number }
): AnalysisStats {
  const mesh = topo.mesh;
  const faceCount = mesh.faceCount;

  // 重复面:按标记位数一遍(退化面在焊接阶段就标上了)
  let duplicateFaceCount = 0;
  for (let f = 0; f < faceCount; f++) {
    if ((topo.flags[f] ?? 0) & FACE_FLAG.DUPLICATE) duplicateFaceCount++;
  }

  // 水密 = 没有开放边 + 没有非流形边
  const watertight =
    faceCount > 0 &&
    topo.openEdgeVerts.length === 0 &&
    topo.nonManifoldVerts.length === 0;

  return {
    fileName: options?.fileName ?? "",
    vertexCount: mesh.vertexCount,
    triangleCount: faceCount,
    componentCount: topo.componentCount,
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
    extraShellCount: shells.extraShellCount,
    noiseShellCount: shells.noiseShellCount,
    cavityShellCount: topo.cavityShellCount,
    enclosedOpenShellCount: topo.enclosedOpenShellCount,
    sealedHollow: topo.sealedHollow,
    analysisMs: options?.analysisMs ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  提示清单                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 提示清单 —— **跟检查工具的 `warnings` 同样的 key、同样的顺序**
 *
 * 文案不在这儿拼 —— 只给 i18n key + 参数,UI 层用 next-intl 渲染。
 * key 全部复用 `ModelInspector.warnings.*`,所以两个工具读到的是同一句话。
 */
export function buildCheckWarnings(stats: AnalysisStats): MessageRef[] {
  const warnings: MessageRef[] = [];

  if (stats.openEdgeCount > 0) {
    warnings.push({
      key: "warnings.openEdges",
      params: {
        openEdges: stats.openEdgeCount,
        planarHoles: stats.planarHoleCount,
        cracks: stats.crackChainCount,
      },
    });
  }
  if (stats.globalInvertedShellCount > 0) {
    warnings.push({
      key: "warnings.globalInverted",
      params: { count: stats.globalInvertedShellCount },
    });
  }
  if (stats.flippedFaceCount > 0) {
    warnings.push({
      key: "warnings.flippedFaces",
      params: { count: stats.flippedFaceCount },
    });
  }
  if (stats.sealedHollow) {
    warnings.push({
      key: "warnings.sealedHollow",
      params: { count: stats.cavityShellCount },
    });
  }
  if (stats.enclosedOpenShellCount > 0) {
    warnings.push({
      key: "warnings.enclosedOpenShells",
      params: { count: stats.enclosedOpenShellCount },
    });
  }
  if (stats.noiseShellCount > 0) {
    warnings.push({
      key: "warnings.noiseShells",
      params: { count: stats.noiseShellCount },
    });
  }
  if (stats.componentCount > 1) {
    warnings.push({
      key: "warnings.multipleShells",
      params: { count: stats.componentCount },
    });
  }

  return warnings;
}

/* -------------------------------------------------------------------------- */
/*  摘要                                                                       */
/* -------------------------------------------------------------------------- */

/** 总体结论 —— 跟检查工具的 `status.*` 同一套词汇 */
export type MeshCheckStatus = "pass" | "warn" | "fail";

export interface MeshCheckSummary {
  /** 总体结论 */
  status: MeshCheckStatus;
  /** WJP 全彩工艺评估 —— 跟检查工具那张卡是**同一个报告** */
  wjp: WjpReport;
  /** 提示清单 */
  warnings: MessageRef[];
  /** 统计 */
  stats: AnalysisStats;
}

/**
 * 从拓扑算出一份自检摘要
 *
 * **这是克重工具里那个徽标的唯一数据来源。** 摆盘 Worker 焊接的时候顺带
 * 算出来,不用再焊一次 —— 摘要几乎不花额外时间。
 */
export function summarizeTopology(
  topo: TopologyResult,
  options?: { fileName?: string; analysisMs?: number }
): MeshCheckSummary {
  const shells = classifyShells(topo);
  const stats = buildCheckStats(topo, shells, options);
  const warnings = buildCheckWarnings(stats);
  const wjp = evaluateWjp(stats);
  // WJP 的三档结论(fail / risk / pass)映射到「通过 / 需注意 / 发现问题」
  const status: MeshCheckStatus =
    wjp.tone === "fail" ? "fail" : wjp.tone === "risk" ? "warn" : "pass";
  return { status, wjp, warnings, stats };
}
