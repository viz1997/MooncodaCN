"use client";

/**
 * 模型检查 —— 3D 打印前的自检工具。
 *
 * 回答两个问题:
 *  1. **模型本身有没有破面**(退化 / 重复 / 开放边 / 非流形边 / 翻面 / 重复顶点)
 *  2. **有没有过薄的地方**(壁厚低于阈值 —— 光敏树脂常见下限 1.0-1.2mm)
 *
 * 全部在浏览器本地跑:模型不上传,结果不入库。
 *
 * ## 版式
 *
 * 跟克重计算器一样是**一张卡片**:头部(文件名 + 标签 + 操作) / 左 3D 预览 /
 * 右检查结论。问题面在 3D 里染成红色 —— 光看数字不知道问题长什么样,看了图
 * 才知道要改哪儿。
 *
 * ## 阈值为什么可以实时改
 *
 * 壁厚测量要打几千条射线,一次要一两秒。阈值(过薄线)是个滑块,拖一下就重跑
 * 太浪费 —— 所以测量结果保留**原始采样**,阈值变化时只重新分类,不动射线。
 */

import {
  AlertTriangle,
  Box,
  CheckCircle2,
  FileUp,
  Loader2,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { extractModelZip } from "@/features/pricing/lib/zip-extractor";
import {
  type InspectPhase,
  type InspectReport,
  inspectMesh,
} from "@/features/tools/lib/inspect";
import {
  ISSUE_FLAGS,
  type MeshIssue,
} from "@/features/tools/lib/mesh-analysis";
import {
  classifyThickness,
  type ThicknessClassification,
} from "@/features/tools/lib/wall-thickness";
import { MeshPreview } from "./mesh-preview";

/** 高亮范围 —— 3D 里哪些面染红 */
type HighlightMode = "all" | "topology" | "thin" | "overhang" | "none";

const TOPOLOGY_MASK =
  ISSUE_FLAGS.degenerate |
  ISSUE_FLAGS.duplicateFace |
  ISSUE_FLAGS.openEdge |
  ISSUE_FLAGS.nonManifoldEdge |
  ISSUE_FLAGS.flippedNormal |
  ISSUE_FLAGS.duplicateVertex;

const ALL_MASK = TOPOLOGY_MASK | ISSUE_FLAGS.thinWall | ISSUE_FLAGS.overhang;

const HIGHLIGHT_MASKS: Record<HighlightMode, number> = {
  all: ALL_MASK,
  topology: TOPOLOGY_MASK,
  thin: ISSUE_FLAGS.thinWall,
  overhang: ISSUE_FLAGS.overhang,
  none: 0,
};

type Status = "idle" | "loading" | "ready" | "error";

const fmt = (n: number, digits = 2) =>
  Number.isFinite(n) ? n.toFixed(digits) : "—";

export function ModelInspector() {
  const t = useTranslations("ModelInspector");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<InspectPhase>("parse");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<InspectReport | null>(null);
  const [thresholdMM, setThresholdMM] = useState(1.2);
  const [highlight, setHighlight] = useState<HighlightMode>("all");
  const [dragging, setDragging] = useState(false);

  const yieldToUI = useCallback(
    () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    []
  );

  const runInspection = useCallback(
    async (objText: string) => {
      setStatus("loading");
      setProgress(2);
      setError(null);
      try {
        const { parseModelText } = await import("@/features/tools/lib/inspect");
        const mesh = parseModelText(objText);
        if (!mesh) {
          setStatus("error");
          setError(t("error.noGeometry"));
          return;
        }
        const result = await inspectMesh(mesh, {
          supportAngleDeg: 45,
          samples: 2000,
          onProgress: (p, ph) => {
            setProgress(p);
            setPhase(ph);
          },
          yieldToUI,
        });
        setReport(result);
        setStatus("ready");
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [t, yieldToUI]
  );

  const handleFile = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setReport(null);
      setStatus("loading");
      setProgress(1);
      setError(null);
      try {
        const result = await extractModelZip(file, (p) => {
          setProgress(Math.min(30, Math.round(p.percent * 0.3)));
          setPhase("parse");
        });
        if (!result.model) {
          setStatus("error");
          setError(result.error ?? t("error.parseFailed"));
          return;
        }
        await runInspection(result.model.objText);
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [runInspection, t]
  );

  const clearModel = useCallback(() => {
    setStatus("idle");
    setFileName(null);
    setReport(null);
    setProgress(0);
    setError(null);
  }, []);

  // ---- 派生:按当前阈值重新分类「过薄」 ----
  const derived = useMemo(() => {
    if (!report) return null;
    const issues: MeshIssue[] = [...report.issues];
    const faceFlags = report.faceFlags.slice();
    let classification: ThicknessClassification | null = null;

    if (report.thickness) {
      classification = classifyThickness(report.thickness, thresholdMM);
      if (classification.thinTriangles.length > 0) {
        for (const tIdx of classification.thinTriangles) {
          faceFlags[tIdx] = (faceFlags[tIdx] as number) | ISSUE_FLAGS.thinWall;
        }
        issues.push({
          id: "thinWall",
          severity: "warning",
          count: classification.thinTriangles.length,
          triangles: classification.thinTriangles,
          note: `min ${fmt(report.thickness.minThicknessMM)} mm`,
        });
      }
    }

    const hasError = issues.some((i) => i.severity === "error");
    const hasWarning = issues.some((i) => i.severity === "warning");
    const verdict: "ok" | "warn" | "error" = hasError
      ? "error"
      : hasWarning
        ? "warn"
        : "ok";

    return { issues, faceFlags, classification, verdict };
  }, [report, thresholdMM]);

  const issueLabel = (id: MeshIssue["id"]) => {
    switch (id) {
      case "degenerate":
        return t("issues.degenerate");
      case "duplicateFace":
        return t("issues.duplicateFace");
      case "openEdge":
        return t("issues.openEdge");
      case "nonManifoldEdge":
        return t("issues.nonManifoldEdge");
      case "duplicateVertex":
        return t("issues.duplicateVertex");
      case "flippedNormal":
        return t("issues.flippedNormal");
      case "thinWall":
        return t("issues.thinWall");
      case "overhang":
        return t("issues.overhang");
    }
  };

  const severityDot: Record<MeshIssue["severity"], string> = {
    error: "bg-red-500",
    warning: "bg-amber-500",
    info: "bg-stone-400",
  };

  // ---- 空状态 ----
  if (status !== "ready" && !report) {
    return (
      <div className="rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-200 bg-stone-50/60">
          <h3 className="text-sm font-semibold text-stone-800 flex items-center gap-2">
            <ShieldCheck className="size-4 text-amber-600 shrink-0" />
            {t("title")}
          </h3>
          <p className="text-xs text-stone-500 mt-0.5">{t("description")}</p>
        </div>
        <div className="p-6">
          {status === "error" && error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {status === "loading" ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-stone-500">
              <Loader2 className="size-6 animate-spin" />
              <p className="text-sm">{t("analyzing")}</p>
              <p className="text-xs text-stone-400">{t(`phases.${phase}`)}</p>
              <div className="h-1.5 w-56 overflow-hidden rounded-full bg-stone-200">
                <div
                  className="h-full bg-amber-600 transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="font-mono text-xs text-stone-400">{progress}%</p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFile(f);
              }}
              className={`flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-16 transition-colors ${
                dragging
                  ? "border-amber-400 bg-amber-50/60"
                  : "border-stone-300 bg-stone-50/40 hover:border-stone-400"
              }`}
            >
              <FileUp className="size-8 text-stone-400" />
              <span className="text-sm font-medium text-stone-700">
                {t("upload.dropzone")}
              </span>
              <span className="text-xs text-stone-500">{t("upload.hint")}</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.rar,.7z,.obj,.stl,.ply,.glb,.gltf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
            className="hidden"
          />
        </div>
      </div>
    );
  }

  if (!report || !derived) return null;

  const { mesh, topology, thickness } = report;
  const dims = mesh.size;

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
      {/* ---- 头部:文件身份 + 标签 + 操作 ---- */}
      <div className="px-4 py-3 border-b border-stone-200 bg-stone-50/60 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Box className="size-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-stone-800 truncate">
              {fileName}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-mono">
                {fmt(dims[0], 1)} × {fmt(dims[1], 1)} × {fmt(dims[2], 1)} mm
              </Badge>
              <Badge variant="outline" className="font-mono">
                {t("stats.triangleCount")} {mesh.triangleCount.toLocaleString()}
              </Badge>
              <Badge variant="outline" className="font-mono">
                {t("stats.vertexCount")} {mesh.vertexCount.toLocaleString()}
              </Badge>
              <Badge variant="outline" className="font-mono">
                {t("stats.volume")}{" "}
                {fmt(Math.abs(topology.signedVolumeMM3) / 1000)} cm³
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="text-stone-500 hover:text-stone-700"
          >
            <UploadCloud className="size-3.5" />
            <span className="hidden sm:inline">{t("upload.reupload")}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={clearModel}
            className="text-stone-400 hover:text-red-600 hover:bg-red-50"
            title={t("upload.removeModel")}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* ---- 主体:左预览 / 右结论 ---- */}
      <div className="grid lg:grid-cols-2">
        <div className="border-b lg:border-b-0 lg:border-r border-stone-200 flex flex-col">
          <div className="relative h-[360px] lg:h-[460px] bg-white">
            <MeshPreview
              positions={mesh.positions}
              faceFlags={derived.faceFlags}
              highlightMask={HIGHLIGHT_MASKS[highlight]}
              className="h-full w-full overflow-hidden bg-white"
            />
          </div>
          {/* 高亮范围切换 + 图例 */}
          <div className="px-4 py-3 border-t border-stone-200 bg-stone-50/40 flex flex-wrap items-center gap-2">
            <span className="text-xs text-stone-500">
              {t("preview.highlight")}
            </span>
            {(["all", "topology", "thin", "overhang"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setHighlight(mode)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  highlight === mode
                    ? "bg-stone-800 text-white"
                    : "bg-stone-200/70 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {t(`preview.modes.${mode}`)}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-1.5 text-xs text-stone-500">
              <span className="size-2.5 rounded-sm bg-red-600" />
              {t("preview.legend.problem")}
              <span className="ml-2 size-2.5 rounded-sm bg-stone-300" />
              {t("preview.legend.normal")}
            </span>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* 结论横幅 */}
          <div
            className={`rounded-lg border px-3.5 py-3 ${
              derived.verdict === "error"
                ? "border-red-200 bg-red-50/70"
                : derived.verdict === "warn"
                  ? "border-amber-200 bg-amber-50/70"
                  : "border-emerald-200 bg-emerald-50/70"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {derived.verdict === "ok" ? (
                <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-emerald-600" />
              ) : (
                <AlertTriangle
                  className={`size-4 shrink-0 mt-0.5 ${
                    derived.verdict === "error"
                      ? "text-red-600"
                      : "text-amber-600"
                  }`}
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-800">
                  {t(`verdict.${derived.verdict}.title`)}
                </p>
                <p className="mt-0.5 text-xs text-stone-600 leading-relaxed">
                  {t(`verdict.${derived.verdict}.hint`)}
                </p>
              </div>
            </div>
          </div>

          {/* 壁厚 */}
          <div className="rounded-lg border border-stone-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-stone-800">
                {t("thickness.title")}
              </h4>
              <span className="font-mono text-xs text-stone-500">
                {t("thickness.threshold")} {fmt(thresholdMM, 1)} mm
              </span>
            </div>

            {thickness && thickness.hitCount > 0 ? (
              <>
                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[11px] text-stone-500">
                      {t("thickness.min")}
                    </p>
                    <p
                      className={`font-mono text-lg font-semibold ${
                        thickness.minThicknessMM < thresholdMM
                          ? "text-red-600"
                          : "text-stone-800"
                      }`}
                    >
                      {fmt(thickness.minThicknessMM)} mm
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-stone-500">
                      {t("thickness.p05")}
                    </p>
                    <p className="font-mono text-lg font-semibold text-stone-800">
                      {fmt(thickness.p05ThicknessMM)} mm
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-stone-500">
                      {t("thickness.median")}
                    </p>
                    <p className="font-mono text-lg font-semibold text-stone-800">
                      {fmt(thickness.medianThicknessMM)} mm
                    </p>
                  </div>
                </div>

                <div className="mt-3">
                  <Slider
                    value={[thresholdMM]}
                    onValueChange={(v) => setThresholdMM(v[0] ?? 1.2)}
                    min={0.4}
                    max={3}
                    step={0.1}
                  />
                </div>

                {derived.classification && (
                  <p className="mt-2 text-xs text-stone-600">
                    {t("thickness.thinArea", {
                      ratio: (
                        derived.classification.thinAreaRatio * 100
                      ).toFixed(1),
                      count: derived.classification.thinTriangles.length,
                    })}
                  </p>
                )}

                {thickness.missCount > thickness.hitCount * 0.3 && (
                  <p className="mt-2 text-[11px] text-amber-700">
                    {t("thickness.unreliable", {
                      miss: thickness.missCount,
                      total: thickness.sampledPoints,
                    })}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-stone-500">
                {t("thickness.unavailable")}
              </p>
            )}
          </div>

          {/* 检查项 */}
          <div className="rounded-lg border border-stone-200">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-stone-200">
              <h4 className="text-sm font-medium text-stone-800">
                {t("checks.title")}
              </h4>
              <Badge
                variant="outline"
                className={
                  topology.watertight
                    ? "font-mono border-emerald-300 text-emerald-700 bg-emerald-50"
                    : "font-mono border-red-300 text-red-700 bg-red-50"
                }
              >
                {topology.watertight ? t("watertight.yes") : t("watertight.no")}
              </Badge>
            </div>
            <ul className="divide-y divide-stone-100">
              {derived.issues.length === 0 && (
                <li className="px-3 py-3 text-xs text-stone-500">
                  {t("checks.clean")}
                </li>
              )}
              {derived.issues.map((issue) => (
                <li
                  key={issue.id}
                  className="px-3 py-2.5 flex items-start gap-2.5"
                >
                  <span
                    className={`mt-1.5 size-2 rounded-full shrink-0 ${severityDot[issue.severity]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-stone-800">
                      {issueLabel(issue.id)}
                    </p>
                    <p className="text-[11px] text-stone-500 mt-0.5">
                      {issue.id === "overhang"
                        ? t("issues.overhangHint", {
                            angle: report.overhang.supportAngleDeg,
                          })
                        : issue.id === "thinWall"
                          ? t("issues.thinWallHint")
                          : t(`issues.${issue.id}Hint`)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-sm font-semibold text-stone-800">
                      {issue.count.toLocaleString()}
                    </p>
                    {issue.note && (
                      <p className="font-mono text-[11px] text-stone-500">
                        {issue.note}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* 悬空 */}
          <div className="rounded-lg border border-stone-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-stone-800">
                {t("overhang.title")}
              </h4>
              <span className="font-mono text-sm font-semibold text-stone-800">
                {(report.overhang.areaRatio * 100).toFixed(1)}%
              </span>
            </div>
            <p className="mt-1 text-[11px] text-stone-500">
              {t("overhang.hint", {
                angle: report.overhang.supportAngleDeg,
              })}
            </p>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.rar,.7z,.obj,.stl,.ply,.glb,.gltf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
        className="hidden"
      />
    </div>
  );
}
