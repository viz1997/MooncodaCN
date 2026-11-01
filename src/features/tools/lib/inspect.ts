/**
 * 模型检查 —— 把拓扑检查 + 壁厚测量 + 悬空分析串成一次完整的检查。
 *
 * 全部在浏览器本地跑:模型不上传,结果不入库(和克重计算器同一套原则)。
 */

import {
  analyzeTopology,
  computeOverhang,
  computeTriangleData,
  ISSUE_FLAGS,
  type MeshIssue,
  type TopologyReport,
} from "./mesh-analysis";
import { type MeshData, parseObjText } from "./mesh-parse";
import { measureWallThickness, type ThicknessReport } from "./wall-thickness";

export type InspectPhase =
  | "parse"
  | "topology"
  | "thickness"
  | "overhang"
  | "done";

export type InspectOptions = {
  /** 支撑角阈值(度) */
  supportAngleDeg?: number | undefined;
  /** 壁厚采样点数 */
  samples?: number | undefined;
  /** 是否测壁厚(网格不封闭时可跳过) */
  measureThickness?: boolean | undefined;
  onProgress?: ((percent: number, phase: InspectPhase) => void) | undefined;
  yieldToUI?: (() => Promise<void>) | undefined;
};

export type InspectReport = {
  mesh: MeshData;
  topology: TopologyReport;
  thickness: ThicknessReport | null;
  overhang: {
    areaRatio: number;
    overhangAreaMM2: number;
    triangles: number[];
    supportAngleDeg: number;
  };
  /** 汇总后的全部问题(拓扑 + 过薄 + 悬空) */
  issues: MeshIssue[];
  /** 每个三角形的问题位掩码 */
  faceFlags: Uint8Array;
  /** 汇总结论:能不能直接进切片 */
  verdict: "ok" | "warn" | "error";
};

/** 解析 OBJ 文本;失败返回 null */
export function parseModelText(objText: string): MeshData | null {
  return parseObjText(objText);
}

/**
 * 跑一次完整检查。
 *
 * 分阶段汇报进度,每阶段之间把主线程让给渲染 —— 13 万面的模型测厚要一两秒,
 * 不能把界面卡死。
 */
export async function inspectMesh(
  mesh: MeshData,
  options: InspectOptions = {}
): Promise<InspectReport> {
  const {
    supportAngleDeg = 45,
    samples = 2000,
    measureThickness = true,
    onProgress,
    yieldToUI,
  } = options;

  onProgress?.(5, "parse");
  await yieldToUI?.();

  // ---- 拓扑 ----
  onProgress?.(10, "topology");
  const triangleData = computeTriangleData(mesh);
  const topology = analyzeTopology(mesh, triangleData);
  onProgress?.(30, "topology");
  await yieldToUI?.();

  // ---- 壁厚 ----
  let thickness: ThicknessReport | null = null;
  if (measureThickness) {
    onProgress?.(35, "thickness");
    thickness = await measureWallThickness(mesh, triangleData, {
      samples,
      onProgress: (p) => onProgress?.(35 + Math.round(p * 0.55), "thickness"),
      yieldToUI,
    });
  }
  onProgress?.(92, "overhang");
  await yieldToUI?.();

  // ---- 悬空 ----
  const overhang = computeOverhang(
    triangleData.normals,
    triangleData.areas,
    mesh.triangleCount,
    supportAngleDeg
  );

  // ---- 汇总 ----
  // 「过薄」不在这里定级 —— 阈值是 UI 上的滑块,改阈值不该重跑射线。
  // 原始采样留在 report.thickness.samples 里,由前端按当前阈值重新分类。
  const faceFlags = topology.faceFlags;
  const issues: MeshIssue[] = [...topology.issues];

  if (overhang.triangles.length > 0 && overhang.areaRatio > 0.02) {
    for (const t of overhang.triangles) {
      faceFlags[t] = (faceFlags[t] as number) | ISSUE_FLAGS.overhang;
    }
    issues.push({
      id: "overhang",
      severity: "info",
      count: overhang.triangles.length,
      triangles: overhang.triangles,
      note: `${(overhang.areaRatio * 100).toFixed(1)}%`,
    });
  }

  const hasError = issues.some((i) => i.severity === "error");
  const hasWarning = issues.some((i) => i.severity === "warning");
  const verdict: InspectReport["verdict"] = hasError
    ? "error"
    : hasWarning
      ? "warn"
      : "ok";

  onProgress?.(100, "done");

  return {
    mesh,
    topology,
    thickness,
    overhang: {
      areaRatio: overhang.areaRatio,
      overhangAreaMM2: overhang.overhangAreaMM2,
      triangles: overhang.triangles,
      supportAngleDeg,
    },
    issues,
    faceFlags,
    verdict,
  };
}
