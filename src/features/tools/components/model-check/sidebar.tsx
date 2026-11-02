"use client";

import {
  Boxes,
  CircleCheck,
  Info,
  Layers,
  Lightbulb,
  Loader2,
  OctagonAlert,
  RefreshCcw,
  SprayCan,
  TriangleAlert,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
/**
 * 检查侧栏:WJP 全彩工艺评估 + 反转法向 / 坏边 / 壳体 三张卡片,问题可点击聚焦。
 *
 * 移植自 wjp-model-checker-source/src/components/model-checker/Sidebar.tsx,
 * 所有文案改成 next-intl(分析层只给 key + 参数,文案在 messages/*.json)。
 */
import { useMemo } from "react";
import {
  type AnalysisResult,
  ISSUE_COLORS,
  type IssueCluster,
} from "@/features/tools/lib/mesh/types";
import {
  evaluateWjp,
  type WjpSeverity,
  type WjpTone,
} from "@/features/tools/lib/mesh/wjp";

interface SidebarProps {
  result: AnalysisResult | null;
  busy: boolean;
  onFocusCluster: (c: IssueCluster) => void;
  onFocusPoint: (p: [number, number, number], radius: number) => void;
}

export type CheckStatus = "pass" | "warn" | "fail" | "idle";

const STATUS_CLS: Record<CheckStatus, string> = {
  pass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  warn: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  fail: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  idle: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const SEVERITY_BADGE: Record<WjpSeverity, string> = {
  critical:
    "bg-rose-500/15 text-rose-400 border-rose-500/30 border-rose-500/30",
  warning: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  info: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  pass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

const TONE_BORDER: Record<WjpTone, string> = {
  fail: "border-rose-500/40",
  risk: "border-amber-500/40",
  pass: "border-emerald-500/40",
};

const TONE_BADGE: Record<WjpTone, string> = {
  fail: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  risk: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  pass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
};

function WjpCard({ result }: { result: AnalysisResult }) {
  const t = useTranslations("ModelInspector");
  const wjp = useMemo(() => evaluateWjp(result), [result]);

  return (
    <section
      className={`rounded-xl border bg-zinc-900/60 ${TONE_BORDER[wjp.tone]} ${wjp.tone !== "pass" ? "bg-zinc-900/30" : ""}`}
      aria-label={t("sidebar.wjpTitle")}
    >
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <SprayCan className="h-4 w-4 text-zinc-400" aria-hidden />
        <h2 className="text-sm font-semibold text-zinc-100">
          {t("sidebar.wjpTitle")}
        </h2>
        <span className="ml-auto">
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE_BADGE[wjp.tone]}`}
          >
            {t(wjp.verdictKey)}
          </span>
        </span>
      </header>
      <div className="px-4 pb-4">
        <p className="mb-2.5 text-xs leading-relaxed text-zinc-400">
          {t(wjp.summaryKey, wjp.summaryParams)}
        </p>
        <div className="space-y-2">
          {wjp.findings.map((f) => {
            const badge = SEVERITY_BADGE[f.severity];
            const icon =
              f.severity === "critical" ? (
                <OctagonAlert
                  className="h-3.5 w-3.5 text-rose-400"
                  aria-hidden
                />
              ) : f.severity === "warning" ? (
                <TriangleAlert
                  className="h-3.5 w-3.5 text-amber-400"
                  aria-hidden
                />
              ) : f.severity === "info" ? (
                <Info className="h-3.5 w-3.5 text-teal-300" aria-hidden />
              ) : (
                <CircleCheck
                  className="h-3.5 w-3.5 text-emerald-400"
                  aria-hidden
                />
              );
            return (
              <div
                key={f.key}
                className={`rounded-lg border ${badge.split(" ").pop()} bg-zinc-900/60 p-2.5`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">{icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded border px-1.5 py-px text-[10px] font-medium ${badge}`}
                      >
                        {t(`severity.${f.severity}`)}
                      </span>
                      <p className="text-xs font-medium text-zinc-100">
                        {t(`wjp.findings.${f.key}.title`, f.params)}
                      </p>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                      {t(`wjp.findings.${f.key}.detail`, f.params)}
                    </p>
                    {f.severity !== "pass" && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-200/90">
                        <Lightbulb
                          className="mt-0.5 h-3 w-3 shrink-0 text-amber-400"
                          aria-hidden
                        />
                        <span>
                          {t(`wjp.findings.${f.key}.advice`, f.params)}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-500">
          {t("wjp.scope")}
        </p>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: CheckStatus }) {
  const t = useTranslations("ModelInspector");
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLS[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}

function CardShell({
  icon,
  title,
  status,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  status: CheckStatus;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border border-zinc-800 bg-zinc-900/60"
      aria-label={title}
    >
      <header className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <span className="text-zinc-400">{icon}</span>
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        <span className="ml-auto">
          <StatusBadge status={status} />
        </span>
      </header>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

function MetricRow({
  label,
  value,
  dot,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  dot?: string | undefined;
  onClick?: (() => void) | undefined;
}) {
  const clickable = Boolean(onClick);
  const className = `flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${clickable ? "cursor-pointer hover:bg-zinc-800/70" : ""}`;
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-zinc-400">
        {dot && (
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: dot }}
          />
        )}
        {label}
      </span>
      <span
        className={`font-mono ${clickable ? "text-zinc-200 underline decoration-zinc-600 underline-offset-2" : "text-zinc-200"}`}
      >
        {value}
      </span>
    </>
  );
  // 可点击的行用真正的 <button>(键盘可达、语义正确),不可点击的用 <div>
  if (!clickable || !onClick) {
    return <div className={className}>{body}</div>;
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  );
}

function ClusterList({
  clusters,
  color,
  onFocus,
  emptyText,
  renderMeta,
}: {
  clusters: IssueCluster[];
  color: string;
  onFocus: (c: IssueCluster) => void;
  emptyText: string;
  renderMeta: (c: IssueCluster) => string;
}) {
  const t = useTranslations("ModelInspector");
  if (clusters.length === 0) {
    if (!emptyText) return null;
    return <p className="px-2 py-1.5 text-xs text-zinc-500">{emptyText}</p>;
  }
  return (
    <div className="mt-1 max-h-44 overflow-y-auto pr-1 [scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin]">
      {clusters.map((c, i) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onFocus(c)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800/70"
        >
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: color }}
          />
          <span className="shrink-0 text-zinc-500">#{i + 1}</span>
          <span className="truncate">{renderMeta(c)}</span>
          <span className="ml-auto shrink-0 font-mono text-zinc-500">
            {t("cluster.focus")}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function Sidebar({
  result,
  busy,
  onFocusCluster,
  onFocusPoint,
}: SidebarProps) {
  const t = useTranslations("ModelInspector");
  const locale = useLocale();

  const fmtInt = (n: number) => n.toLocaleString(locale);
  const fmtVolume = (mm3: number) => {
    const abs = Math.abs(mm3);
    if (abs >= 1e6) return `${(abs / 1000).toFixed(1)} cm³`;
    return `${abs.toFixed(0)} mm³`;
  };
  const fmtDim = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(2));

  if (!result) {
    return (
      <div className="flex h-full flex-col gap-3">
        {busy ? (
          <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("sidebar.analyzing")}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-500">
            <Info className="h-4 w-4" />
            {t("sidebar.idle")}
          </div>
        )}
      </div>
    );
  }

  const s = result.stats;
  const diag = Math.hypot(
    s.bboxMax[0] - s.bboxMin[0],
    s.bboxMax[1] - s.bboxMin[1],
    s.bboxMax[2] - s.bboxMin[2]
  );
  const focusRadius = Math.max(5, diag * 0.4);

  const clusters = result.clusters;
  const flippedClusters = clusters.filter((c) => c.kind === "flipped");
  const degenerateClusters = clusters.filter((c) => c.kind === "degenerate");
  const duplicateClusters = clusters.filter((c) => c.kind === "duplicate");

  // 反转法向状态
  const normalsStatus: CheckStatus =
    s.globalInvertedShellCount > 0 || s.flippedFaceCount > 0 ? "fail" : "pass";
  // 坏边状态
  const badEdgeCount =
    s.degenerateCount +
    s.duplicatePairCount +
    s.openEdgeCount +
    s.nonManifoldEdgeCount;
  const badEdgeStatus: CheckStatus = badEdgeCount === 0 ? "pass" : "fail";
  // 壳体状态
  const shellStatus: CheckStatus =
    s.sealedHollow || s.noiseShellCount > 0
      ? "fail"
      : s.enclosedOpenShellCount > 0
        ? "warn"
        : s.componentCount > 1
          ? "warn"
          : "pass";

  const firstLoop = result.holeLoops[0]?.centroid ?? null;
  const firstOpenMid = (): [number, number, number] | null => {
    const o = result.openEdges;
    if (o.length < 6) return null;
    return [(o[0]! + o[3]!) / 2, (o[1]! + o[4]!) / 2, (o[2]! + o[5]!) / 2];
  };
  const firstNmMid = (): [number, number, number] | null => {
    const o = result.nonManifoldEdges;
    if (o.length < 6) return null;
    return [(o[0]! + o[3]!) / 2, (o[1]! + o[4]!) / 2, (o[2]! + o[5]!) / 2];
  };

  const secondaryShells = result.shells.filter((sh) => !sh.isPrimary);

  const dims = [
    s.bboxMax[0] - s.bboxMin[0],
    s.bboxMax[1] - s.bboxMin[1],
    s.bboxMax[2] - s.bboxMin[2],
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* ---------- 0. WJP 全彩工艺评估 ---------- */}
      <WjpCard result={result} />

      {/* ---------- 1. 反转法向 ---------- */}
      <CardShell
        icon={<RefreshCcw className="h-4 w-4" />}
        title={t("sidebar.normalsTitle")}
        status={normalsStatus}
      >
        <div className="space-y-0.5">
          <MetricRow
            label={t("sidebar.normals.globalInverted")}
            dot={ISSUE_COLORS.flipped}
            value={
              s.globalInvertedShellCount > 0
                ? t("value.fail", { count: s.globalInvertedShellCount })
                : t("value.none")
            }
            onClick={
              s.globalInvertedShellCount > 0
                ? () => {
                    const shell = result.shells.find((sh) => sh.globalInverted);
                    if (shell) onFocusPoint(shell.centroid, focusRadius);
                  }
                : undefined
            }
          />
          <MetricRow
            label={t("sidebar.normals.localFlipped")}
            dot={ISSUE_COLORS.flipped}
            value={
              s.flippedFaceCount > 0
                ? fmtInt(s.flippedFaceCount)
                : t("value.none")
            }
            onClick={
              flippedClusters.length > 0
                ? () => onFocusCluster(flippedClusters[0]!)
                : undefined
            }
          />
          <MetricRow
            label={t("sidebar.normals.volume")}
            value={`${s.volumeMm3 >= 0 ? "" : "-"}${fmtVolume(s.volumeMm3)}`}
          />
        </div>
        <ClusterList
          clusters={flippedClusters}
          color={ISSUE_COLORS.flipped}
          onFocus={onFocusCluster}
          emptyText={t("sidebar.normals.empty")}
          renderMeta={(c) =>
            t("sidebar.normals.clusterMeta", { count: c.count })
          }
        />
        {(s.globalInvertedShellCount > 0 || s.flippedFaceCount > 0) && (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-200/80">
            {t("sidebar.normals.note")}
          </p>
        )}
      </CardShell>

      {/* ---------- 2. 坏边(缝隙 / 平面孔洞 / 退化 / 重复 / 非流形) ---------- */}
      <CardShell
        icon={<TriangleAlert className="h-4 w-4" />}
        title={t("sidebar.badEdgesTitle")}
        status={badEdgeStatus}
      >
        <div className="space-y-0.5">
          <MetricRow
            label={t("sidebar.badEdges.openEdges")}
            dot={ISSUE_COLORS.openEdge}
            value={
              s.openEdgeCount > 0
                ? t("value.edges", { count: s.openEdgeCount })
                : t("value.none")
            }
            onClick={
              firstOpenMid()
                ? () => onFocusPoint(firstOpenMid()!, focusRadius)
                : undefined
            }
          />
          <MetricRow
            label={t("sidebar.badEdges.planarHoles")}
            dot={ISSUE_COLORS.planarHole}
            value={
              s.planarHoleCount > 0
                ? t("value.places", { count: s.planarHoleCount })
                : t("value.none")
            }
            onClick={
              s.planarHoleCount > 0 && firstLoop
                ? () => onFocusPoint(firstLoop, focusRadius)
                : undefined
            }
          />
          {s.crackChainCount > 0 && (
            <MetricRow
              label={t("sidebar.badEdges.cracks")}
              value={t("value.places", { count: s.crackChainCount })}
            />
          )}
          <MetricRow
            label={t("sidebar.badEdges.degenerate")}
            dot={ISSUE_COLORS.degenerate}
            value={
              s.degenerateCount > 0
                ? fmtInt(s.degenerateCount)
                : t("value.none")
            }
            onClick={
              degenerateClusters.length > 0
                ? () => onFocusCluster(degenerateClusters[0]!)
                : undefined
            }
          />
          <MetricRow
            label={t("sidebar.badEdges.duplicate")}
            dot={ISSUE_COLORS.duplicate}
            value={
              s.duplicatePairCount > 0
                ? t("value.pairs", { count: s.duplicatePairCount })
                : t("value.none")
            }
            onClick={
              duplicateClusters.length > 0
                ? () => onFocusCluster(duplicateClusters[0]!)
                : undefined
            }
          />
          <MetricRow
            label={t("sidebar.badEdges.nonManifold")}
            dot={ISSUE_COLORS.nonManifoldEdge}
            value={
              s.nonManifoldEdgeCount > 0
                ? fmtInt(s.nonManifoldEdgeCount)
                : t("value.none")
            }
            onClick={
              firstNmMid()
                ? () => onFocusPoint(firstNmMid()!, focusRadius)
                : undefined
            }
          />
        </div>
        <ClusterList
          clusters={degenerateClusters}
          color={ISSUE_COLORS.degenerate}
          onFocus={onFocusCluster}
          emptyText=""
          renderMeta={(c) => t("value.faces", { count: c.count })}
        />
        {s.openEdgeCount > 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-200/80">
            {t("sidebar.badEdges.note")}
          </p>
        )}
      </CardShell>

      {/* ---------- 3. 壳体 ---------- */}
      <CardShell
        icon={<Boxes className="h-4 w-4" />}
        title={t("sidebar.shellsTitle")}
        status={shellStatus}
      >
        <div className="space-y-0.5">
          <MetricRow
            label={t("sidebar.shells.total")}
            value={t("value.count", { count: s.componentCount })}
          />
          <MetricRow
            label={t("sidebar.shells.cavity")}
            value={
              s.sealedHollow
                ? t("value.fail", { count: s.cavityShellCount })
                : t("value.none")
            }
          />
          {s.enclosedOpenShellCount > 0 && (
            <MetricRow
              label={t("sidebar.shells.enclosed")}
              value={t("value.warn", { count: s.enclosedOpenShellCount })}
            />
          )}
          <MetricRow
            label={t("sidebar.shells.noise")}
            dot={ISSUE_COLORS.shellNoise}
            value={
              s.noiseShellCount > 0
                ? t("value.count", { count: s.noiseShellCount })
                : t("value.none")
            }
          />
          <MetricRow
            label={t("sidebar.shells.watertight")}
            value={
              s.watertight
                ? t("sidebar.shells.watertightYes")
                : t("sidebar.shells.watertightNo")
            }
          />
        </div>
        {secondaryShells.length > 0 && (
          <div className="mt-1 max-h-44 overflow-y-auto pr-1 [scrollbar-color:#3f3f46_transparent] [scrollbar-width:thin]">
            {secondaryShells.map((sh, i) => (
              <button
                key={sh.index}
                type="button"
                onClick={() =>
                  onFocusPoint(sh.centroid, Math.max(6, sh.bboxDiag * 1.6))
                }
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800/70"
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: sh.isNoise
                      ? ISSUE_COLORS.shellNoise
                      : ISSUE_COLORS.shellExtra,
                  }}
                />
                <span className="shrink-0 text-zinc-500">#{i + 1}</span>
                <span className="truncate">
                  {t("sidebar.shells.item", {
                    kind: t(
                      sh.isNoise
                        ? "sidebar.shells.kind.noise"
                        : sh.isCavity
                          ? "sidebar.shells.kind.cavity"
                          : sh.isDebris
                            ? "sidebar.shells.kind.debris"
                            : "sidebar.shells.kind.independent"
                    ),
                    faces: fmtInt(sh.faceCount),
                    state: sh.closed
                      ? t("sidebar.shells.state.closed")
                      : t("sidebar.shells.state.open", {
                          count: fmtInt(sh.openEdges),
                        }),
                  })}
                </span>
                <span className="ml-auto shrink-0 font-mono text-zinc-500">
                  {t("cluster.focus")}
                </span>
              </button>
            ))}
          </div>
        )}
        {s.sealedHollow && (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-200/80">
            {t("sidebar.shells.cavityNote")}
          </p>
        )}
        {!s.sealedHollow && s.noiseShellCount > 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-200/80">
            {t("sidebar.shells.noiseNote")}
          </p>
        )}
      </CardShell>

      {/* ---------- 模型概览 ---------- */}
      <section
        className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3"
        aria-label={t("sidebar.overviewTitle")}
      >
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
          <Layers className="h-4 w-4 text-zinc-400" aria-hidden />
          {t("sidebar.overviewTitle")}
        </h2>
        <div className="space-y-0.5">
          <MetricRow
            label={t("sidebar.overview.file")}
            value={<span className="max-w-40 truncate">{s.fileName}</span>}
          />
          <MetricRow
            label={t("sidebar.overview.trisVerts")}
            value={`${fmtInt(s.triangleCount)} / ${fmtInt(s.vertexCount)}`}
          />
          <MetricRow
            label={t("sidebar.overview.dims")}
            value={`${fmtDim(dims[0]!)} × ${fmtDim(dims[1]!)} × ${fmtDim(dims[2]!)} mm`}
          />
          <MetricRow
            label={t("sidebar.overview.elapsed")}
            value={`${s.analysisMs} ms`}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          {t("sidebar.overview.note")}
        </p>
      </section>

      {/* ---------- 提示 ---------- */}
      {result.warnings.length > 0 && (
        <section
          className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3"
          aria-label={t("sidebar.warningsTitle")}
        >
          <h2 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-amber-400">
            <Info className="h-4 w-4" />
            {t("sidebar.warningsTitle")}
          </h2>
          <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-amber-200/80">
            {result.warnings.map((w) => (
              <li key={w.key}>{t(w.key, w.params)}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-amber-200/50">
            {t("sidebar.unitsNote")}
          </p>
        </section>
      )}
    </div>
  );
}
