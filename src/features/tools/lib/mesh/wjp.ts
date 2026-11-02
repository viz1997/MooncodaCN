/**
 * WJP 全彩工艺规则引擎 —— 打印前自检评估
 *
 * 移植自 wjp-model-checker-source/src/lib/mesh/wjp.ts
 *
 * 检测范围:反转法向 / 坏边(缝隙、平面孔洞、退化、重复、非流形)/ 壳体。
 * 不评估悬空(WJP 使用水溶性支撑,90° 水平悬空也可打印),不做壁厚检测。
 *
 * **本文件不拼字符串** —— 每条结论只给 i18n key + 参数,文案在 messages/*.json
 * 里各写一份,UI 层用 next-intl 渲染。这样中文 / 英文页面读到的都是对应语言。
 */
import type { AnalysisResult } from "./types";

export const WJP_RULES = {
  /** 尺寸精度:100mm 以内公差 mm */
  tolSmall: 0.2,
  /** 尺寸精度:100mm 以上公差比例 */
  tolLargeRatio: 0.003,
  /** 热变形温度下限 ℃ */
  heatDeflectMinC: 50,
  /** 热变形温度上限 ℃ */
  heatDeflectMaxC: 55,
  /** 静态装配间隙 mm */
  assemblyGap: 0.2,
  /** 活动 / 转动间隙 mm */
  movingGap: 1.5,
} as const;

export type WjpSeverity = "critical" | "warning" | "info" | "pass";

export interface WjpFinding {
  /** i18n key,例如 "normals.critical.globalInverted" */
  key: string;
  severity: WjpSeverity;
  /** ICU 参数,例如 { count: 12 } */
  params?: Record<string, string | number>;
}

export type WjpTone = "fail" | "risk" | "pass";

export interface WjpReport {
  tone: WjpTone;
  /** 结论文案 key,例如 "wjp.tone.fail.verdict" */
  verdictKey: string;
  /** 结论摘要 key,例如 "wjp.tone.fail.summary" */
  summaryKey: string;
  summaryParams?: Record<string, string | number>;
  criticalCount: number;
  warningCount: number;
  findings: WjpFinding[];
}

/** 依据分析结果,评估模型对 WJP 全彩工艺的适配性 */
export function evaluateWjp(result: AnalysisResult): WjpReport {
  const s = result.stats;
  const findings: WjpFinding[] = [];

  // ---------- 1. 反转法向 ----------
  if (s.globalInvertedShellCount > 0) {
    findings.push({
      key: "normals.critical.globalInverted",
      severity: "critical",
      params: { count: s.globalInvertedShellCount },
    });
  } else if (s.flippedFaceCount > 0) {
    findings.push({
      key: "normals.critical.localFlipped",
      severity: "critical",
      params: { count: s.flippedFaceCount },
    });
  } else {
    findings.push({ key: "normals.pass.ok", severity: "pass" });
  }

  // ---------- 2. 缝隙 / 开放边(封闭性) ----------
  if (s.openEdgeCount > 0) {
    findings.push({
      key: "gaps.critical.notClosed",
      severity: "critical",
      params: {
        openEdges: s.openEdgeCount,
        planarHoles: s.planarHoleCount,
        cracks: s.crackChainCount,
      },
    });
  } else {
    findings.push({ key: "gaps.pass.ok", severity: "pass" });
  }

  // ---------- 3. 坏面:退化 / 重复 / 非流形 ----------
  if (
    s.degenerateCount > 0 ||
    s.duplicatePairCount > 0 ||
    s.nonManifoldEdgeCount > 0
  ) {
    findings.push({
      key: "badfaces.warning.issues",
      severity: "warning",
      params: {
        degenerate: s.degenerateCount,
        duplicate: s.duplicatePairCount,
        nonManifold: s.nonManifoldEdgeCount,
      },
    });
  } else {
    findings.push({ key: "badfaces.pass.ok", severity: "pass" });
  }

  // ---------- 4. 壳体 ----------
  if (s.sealedHollow) {
    findings.push({
      key: "shells.critical.sealedHollow",
      severity: "critical",
      params: { count: s.cavityShellCount },
    });
  } else if (s.enclosedOpenShellCount > 0) {
    findings.push({
      key: "shells.warning.enclosedOpen",
      severity: "warning",
      params: { count: s.enclosedOpenShellCount },
    });
  } else {
    findings.push({ key: "shells.pass.ok", severity: "pass" });
  }
  if (s.noiseShellCount > 0) {
    findings.push({
      key: "shells.warning.noise",
      severity: "warning",
      params: { count: s.noiseShellCount, components: s.componentCount },
    });
  }
  if (s.componentCount >= 2) {
    findings.push({
      key: "assembly.info.multiple",
      severity: "info",
      params: {
        count: s.componentCount,
        assemblyGap: WJP_RULES.assemblyGap,
        movingGap: WJP_RULES.movingGap,
      },
    });
  }

  // ---------- 5. 尺寸精度 ----------
  {
    const dx = s.bboxMax[0] - s.bboxMin[0];
    const dy = s.bboxMax[1] - s.bboxMin[1];
    const dz = s.bboxMax[2] - s.bboxMin[2];
    const maxDim = Math.max(dx, dy, dz);
    const tol =
      maxDim <= 100
        ? WJP_RULES.tolSmall
        : Number((maxDim * WJP_RULES.tolLargeRatio * 100).toFixed(1));
    findings.push({
      key: "precision.info.size",
      severity: "info",
      params: {
        dx: Number(dx.toFixed(1)),
        dy: Number(dy.toFixed(1)),
        dz: Number(dz.toFixed(1)),
        tol,
        heatMin: WJP_RULES.heatDeflectMinC,
        heatMax: WJP_RULES.heatDeflectMaxC,
      },
    });
  }

  // ---------- 总体结论 ----------
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  if (critical > 0) {
    return {
      tone: "fail",
      verdictKey: "wjp.tone.fail.verdict",
      summaryKey: "wjp.tone.fail.summary",
      summaryParams: { critical },
      criticalCount: critical,
      warningCount: warning,
      findings,
    };
  }
  if (warning > 0) {
    return {
      tone: "risk",
      verdictKey: "wjp.tone.risk.verdict",
      summaryKey: "wjp.tone.risk.summary",
      summaryParams: { warning },
      criticalCount: critical,
      warningCount: warning,
      findings,
    };
  }
  return {
    tone: "pass",
    verdictKey: "wjp.tone.pass.verdict",
    summaryKey: "wjp.tone.pass.summary",
    criticalCount: critical,
    warningCount: warning,
    findings,
  };
}
