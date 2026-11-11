/**
 * MCP 工具的**输出排版**
 *
 * ## 为什么单独一个文件
 *
 * MCP 工具的结果是一段**给 AI 客户端看的文本** —— 排得好不好,直接决定
 * 客户端能不能自己看懂、能不能接着往下干。
 *
 * 这份排版**是纯函数**(零 import)⇒ 能进 `unit` project 跑单测 ——
 * 「输出里有没有把关键数字漏掉」「失败的时候有没有说人话」都能守住。
 *
 * ## 口径跟网页那边**完全一致**
 *
 * 网页上那几个数(面积 / 平整度 / 厚度 / 净空 / 体积)是从同一份
 * `MagnetAnalyzeOutcome` / `MagnetCutOutcome` 来的 ⇒ **MCP 这边看到的数
 * 跟网页上看到的数是同一个数**。
 */

import type {
  MagnetAnalyzeOutcome,
  MagnetCutOutcome,
  MagnetFaceReport,
  MagnetPatchReport,
} from "./magnet-cutter-protocol";
import type { MagnetFaceVerdict } from "./magnet-params";
import type { MagnetRepairReport } from "./magnet-repair";

/** 一个数 → 固定两位小数(不是 null) */
function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

/** 判定 → 人话 */
export function verdictText(verdict: MagnetFaceVerdict): string {
  switch (verdict) {
    case "ok":
      return "可以切";
    case "no_hit":
      return "这个方向上没有面";
    case "too_thin":
      return "太薄 —— 切下去会捅穿";
    case "edge_spill":
      return "孔会切到边上 —— 净空不够";
    default:
      return String(verdict);
  }
}

/** 一个向量 → `(x, y, z)` */
function vec(v: readonly number[]): string {
  return `(${v.map((n) => num(n, 3)).join(", ")})`;
}

/** 三个数 → `X × Y × Z` */
function size3(v: readonly number[]): string {
  return `${num(v[0])} × ${num(v[1])} × ${num(v[2])}`;
}

/**
 * 「模型现在是什么状态」—— 一句话
 *
 * **「不需要修复用户的模型」那条口径的证据**(工作室 2026-11-11):
 *
 * - `changed === false` ⇒ 模型本来就是好的,**一个字节都没动**
 * - `cappedLoops > 0` ⇒ 模型有破口 ⇒ 切的时候**临时**封上,切完摘掉
 *   ⇒ 用户的模型上**没有**多出任何几何
 */
export function describeRepair(repair: MagnetRepairReport | null): string {
  if (!repair) return "模型状态:未知";
  if (!repair.changed && repair.cappedLoops === 0) {
    return "模型状态:本来就是封闭实体 —— 一个字节都没改";
  }
  const parts: string[] = [];
  if (repair.weldedNearDuplicates > 0) {
    parts.push(
      `焊上了 ${repair.weldedNearDuplicates} 个坐标只差一点的顶点` +
        `(容差 ${num(repair.weldToleranceMm, 6)}mm,几何没动)`
    );
  }
  if (repair.droppedDegenerate > 0) {
    parts.push(`剔掉了 ${repair.droppedDegenerate} 张退化面`);
  }
  if (repair.droppedDuplicate > 0) {
    parts.push(`剔掉了 ${repair.droppedDuplicate} 张重复面`);
  }
  if (repair.droppedNonManifold > 0) {
    parts.push(
      `剔掉了 ${repair.droppedNonManifold} 张非流形边上的面(切完会放回去)`
    );
  }
  if (repair.splitVertices > 0) {
    parts.push(`拆开了 ${repair.splitVertices} 个蝴蝶结顶点`);
  }
  if (repair.flippedFaces > 0) {
    parts.push(`翻了 ${repair.flippedFaces} 张绕序乱掉的面`);
  }
  if (repair.cappedLoops > 0) {
    parts.push(
      `临时封上了 ${repair.cappedLoops} 处破口(${repair.lidFaces} 张盖面)—— 切完摘掉,你的模型上不会多出几何`
    );
  }
  if (parts.length === 0) return "模型状态:没有动过";
  return `模型状态:${parts.join(";")}`;
}

/** 分析结果的补充信息(文件路径 / 孔参数 / 单位判定) */
export type MagnetAnalyzeContext = {
  /** 输入文件路径 */
  path: string;
  /** 孔径(mm) */
  holeDiaMm: number;
  /** 孔深(mm) */
  holeDepthMm: number;
  /**
   * 这个模型看起来**不是毫米**(坐标被归一化了)
   *
   * AI 生成的模型(Meshy / Tripo)导出来的坐标是 ±1 那种,不是毫米。
   * 那一行得提醒调用方:切之前先说清楚实际尺寸。
   */
  looksLikeNotMillimeters?: boolean;
  /** 模型的最大边(文件坐标单位) */
  maxEdge?: number | null;
};

/**
 * 分析结果 → 一段文本
 *
 * **先说结论**(能不能切、切哪儿),再说细节 ——
 * AI 客户端读的是第一段,人读的是后面那些表。
 */
export function formatAnalyzeReport(
  outcome: MagnetAnalyzeOutcome,
  context: MagnetAnalyzeContext
): string {
  const lines: string[] = [];

  const size = [
    outcome.bboxMax[0] - outcome.bboxMin[0],
    outcome.bboxMax[1] - outcome.bboxMin[1],
    outcome.bboxMax[2] - outcome.bboxMin[2],
  ];
  const maxEdge = context.maxEdge ?? Math.max(...size);

  lines.push(`模型:${context.path}`);
  lines.push(
    `体积:${num(outcome.volume)} mm³(${num(outcome.volume / 1000)} cm³)`
  );
  lines.push(`包围盒:${size3(size)}(最大边 ${num(maxEdge)})`);

  if (context.looksLikeNotMillimeters) {
    lines.push("");
    lines.push(
      `⚠️ 这个模型的最大边只有 ${num(maxEdge)}(文件坐标单位)—— ` +
        "看起来坐标不是毫米(AI 导出的模型常见)。" +
        "孔径是绝对毫米,直接切会比模型还大。切之前请确认实际尺寸。"
    );
  }

  lines.push("");
  lines.push(
    `孔参数:Ø${num(context.holeDiaMm)}mm × 深 ${num(context.holeDepthMm)}mm(绝对毫米,不跟模型缩放)`
  );

  // ---- 结论:智能识别出来的那块平面 ----
  lines.push("");
  const back = outcome.backFace;
  if (back) {
    lines.push(
      `智能识别出来的平面(第 0 块,面积最大):${verdictText(back.verdict)}`
    );
    lines.push(
      `  面积 ${num(back.areaMm2)} mm² · 平整度 ${num(back.meanDeviationDeg, 1)}° · ` +
        `厚度 ${num(back.thicknessMm)}mm · 净空 ${num(back.clearanceMm)}mm`
    );
    lines.push(`  法线 ${vec(back.normal)} · 下刀点 ${vec(back.point)}`);
  } else {
    lines.push("智能识别:这个模型上找不出一块像样的平面 —— 别指望能切。");
  }

  // ---- 候选平面(用户可以挑别的) ----
  if (outcome.patches.length > 0) {
    lines.push("");
    lines.push("候选平面(按面积从大到小,切的时候用 patch:N 指定):");
    outcome.patches.forEach((patch, index) => {
      lines.push(
        `  #${index}  面积 ${num(patch.areaMm2).padStart(10)} mm² · ` +
          `平整 ${num(patch.meanDeviationDeg, 1).padStart(5)}° · ` +
          `厚 ${num(patch.thicknessMm).padStart(8)}mm · ` +
          `净空 ${num(patch.clearanceMm).padStart(8)}mm · ${verdictText(patch.verdict)}`
      );
    });
  }

  // ---- 六个轴向面 ----
  lines.push("");
  lines.push("六个轴向面(切的时候用 posX / negX / … 指定):");
  for (const face of outcome.faces) {
    lines.push(
      `  ${face.faceId.padEnd(5)} ${face.hit ? "" : "(没打中) "}` +
        `平整 ${num(face.flatnessDeg, 1).padStart(5)}° · ` +
        `厚 ${num(face.thicknessMm).padStart(8)}mm · ` +
        `净空 ${num(face.clearanceMm).padStart(8)}mm · ${verdictText(face.verdict)}`
    );
  }

  lines.push("");
  lines.push(describeRepair(outcome.repair));

  return lines.join("\n");
}

/** 切割结果的补充信息 */
export type MagnetCutContext = {
  /** 输出文件路径 */
  outPath: string;
  /** 孔径(mm) */
  holeDiaMm: number;
  /** 孔深(mm) */
  holeDepthMm: number;
  /** 切的是哪一块 */
  targetText: string;
  /** 模型状态(焊接 / 清理 / 临时盖面) */
  repair?: MagnetRepairReport | null;
};

/**
 * 切割结果 → 一段文本
 *
 * **「逐分相等」那套口径不适用在这儿**(这是几何不是钱),
 * 但「实际去掉多少 vs 理论去掉多少」要摆出来 —— 两个数对不上就说明
 * 孔有一截跑到实体外面了。
 */
export function formatCutReport(
  outcome: MagnetCutOutcome,
  context: MagnetCutContext
): string {
  const lines: string[] = [];

  lines.push(`切好了 → ${context.outPath}`);
  lines.push(
    `孔:Ø${num(context.holeDiaMm)}mm × 深 ${num(context.holeDepthMm)}mm(绝对毫米)`
  );
  lines.push(`切在:${context.targetText}`);
  lines.push(
    `体积:${num(outcome.volumeBefore)} → ${num(outcome.volumeAfter)} mm³` +
      `(去掉 ${num(outcome.removedVolume)} mm³,理论 ${num(outcome.expectedRemovedVolume)} mm³)`
  );
  lines.push(`三角形:${outcome.triangleCount}`);

  if (outcome.materialNames && outcome.materialNames.length > 0) {
    lines.push(
      `材质/贴图:保留(${outcome.materialNames.length} 个材质 —— ${outcome.materialNames.join(", ")})`
    );
  } else {
    lines.push("材质/贴图:这个模型本来就没有");
  }

  if (context.repair) {
    lines.push(describeRepair(context.repair));
  }

  return lines.join("\n");
}

/** 一个面报告 → 一行(给别处复用) */
export function formatFaceLine(face: MagnetFaceReport): string {
  return (
    `${face.faceId} · 平整 ${num(face.flatnessDeg, 1)}° · ` +
    `厚 ${num(face.thicknessMm)}mm · 净空 ${num(face.clearanceMm)}mm · ` +
    `${verdictText(face.verdict)}`
  );
}

/** 一块平面 → 一行(给别处复用) */
export function formatPatchLine(
  patch: MagnetPatchReport,
  index: number
): string {
  return (
    `#${index} · 面积 ${num(patch.areaMm2)} mm² · ` +
    `平整 ${num(patch.meanDeviationDeg, 1)}° · ` +
    `厚 ${num(patch.thicknessMm)}mm · 净空 ${num(patch.clearanceMm)}mm · ` +
    `${verdictText(patch.verdict)}`
  );
}
