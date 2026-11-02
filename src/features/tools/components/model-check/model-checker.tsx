"use client";

import {
  Boxes,
  CircleAlert,
  CircleCheck,
  Loader2,
  RotateCcw,
  Shell,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
/**
 * 模型检查 · 打印前自检 —— 主界面
 *
 * 左侧:检测卡片;中间:3D 视口(问题位置标色);底部:状态栏。
 *
 * 移植自 wjp-model-checker-source/src/components/model-checker/ModelChecker.tsx,
 * 改动:
 * - 文件读取改用克重工具的解压管线(`@/features/tools/lib/model-loader`);
 * - 去掉「下载全部源码」按钮(源项目用来打包自己源码的,本仓库没有这个路由);
 * - 顶层改成深色圆角面板(页面上面还有浅色 atelier 页头 + 全站 Header/Footer);
 * - 所有文案改成 next-intl。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ISSUE_COLORS,
  ISSUE_LABEL_KEYS,
  type IssueCluster,
  type MessageRef,
} from "@/features/tools/lib/mesh/types";
import {
  loadModelGeometry,
  MODEL_ACCEPT,
  ModelLoadError,
} from "@/features/tools/lib/model-loader";
import Sidebar from "./sidebar";
import { useAnalyzer } from "./use-analyzer";
import Viewport, { type ViewportVisibility } from "./viewport";

/**
 * 图层默认开关:对应参考软件检测面板
 * (反转法向 ✓ / 坏边:缝隙 ✓ 平面孔洞 ✓ 轮廓 ✗ / 壳体 ✓ / 噪声壳体 ✗)
 */
const ALL_VISIBILITY: ViewportVisibility = {
  flipped: true,
  degenerate: true,
  duplicate: true,
  shellExtra: true,
  shellNoise: false, // 噪声壳体默认不显示(对应参考软件未勾选)
  openEdge: true,
  planarHole: true,
  nonManifoldEdge: true,
  outline: false, // 轮廓默认不显示(对应参考软件未勾选)
};

const LEGEND_ITEMS: { key: keyof ViewportVisibility; color: string }[] = [
  { key: "flipped", color: ISSUE_COLORS.flipped },
  { key: "degenerate", color: ISSUE_COLORS.degenerate },
  { key: "duplicate", color: ISSUE_COLORS.duplicate },
  { key: "shellExtra", color: ISSUE_COLORS.shellExtra },
  { key: "shellNoise", color: ISSUE_COLORS.shellNoise },
  { key: "openEdge", color: ISSUE_COLORS.openEdge },
  { key: "planarHole", color: ISSUE_COLORS.planarHole },
  { key: "nonManifoldEdge", color: ISSUE_COLORS.nonManifoldEdge },
  { key: "outline", color: ISSUE_COLORS.outline },
];

type LoadedState = {
  /** 三角汤坐标(主线程持有,渲染要用) */
  positions: Float32Array;
  /** 展示用文件名 */
  fileName: string;
};

export function ModelChecker() {
  const t = useTranslations("ModelInspector");
  const [model, setModel] = useState<LoadedState | null>(null);
  const [visibility, setVisibility] =
    useState<ViewportVisibility>(ALL_VISIBILITY);
  const [showSupport, setShowSupport] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    seq: number;
    point: [number, number, number] | null;
    radius?: number;
    dir?: [number, number, number];
  } | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [loadError, setLoadError] = useState<MessageRef | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPct, setLoadingPct] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const focusSeq = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { state, run } = useAnalyzer();
  const { result, busy, stage, pct, error } = state;

  useEffect(() => {
    if (model) {
      run({ positions: model.positions, fileName: model.fileName });
    }
  }, [model, run]);

  const loadFile = useCallback(async (file: File) => {
    setLoadError(null);
    setLoading(true);
    setLoadingPct(0);
    try {
      const loaded = await loadModelGeometry(file, (p) =>
        setLoadingPct(p.percent)
      );
      setVisibility(ALL_VISIBILITY);
      setModel({ positions: loaded.positions, fileName: loaded.fileName });
    } catch (e) {
      setLoadError(
        e instanceof ModelLoadError ? e.ref : { key: "errors.parseFailed" }
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const focusCluster = useCallback((c: IssueCluster) => {
    focusSeq.current += 1;
    setFocusRequest({
      seq: focusSeq.current,
      point: c.centroid,
      dir: [0.9, -1.1, 0.75],
    });
  }, []);

  const focusPoint = useCallback(
    (p: [number, number, number], radius: number) => {
      focusSeq.current += 1;
      setFocusRequest({ seq: focusSeq.current, point: p, radius });
    },
    []
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void loadFile(file);
    },
    [loadFile]
  );

  const stats = result?.stats ?? null;

  // 有问题才需要显示:按实际检出的问题过滤图例,未检出的类别不展示开关
  const issuePresent = useMemo(() => {
    if (!result) return null;
    const s = result.stats;
    return {
      flipped: s.flippedFaceCount > 0 || s.globalInvertedShellCount > 0,
      degenerate: s.degenerateCount > 0,
      duplicate: s.duplicateFaceCount > 0,
      shellExtra: s.extraShellCount > 0,
      shellNoise: s.noiseShellCount > 0,
      openEdge: s.openEdgeCount > 0,
      planarHole: s.planarHoleCount > 0,
      nonManifoldEdge: s.nonManifoldEdgeCount > 0,
      outline: s.openEdgeCount > 0,
    } as Record<keyof ViewportVisibility, boolean>;
  }, [result]);
  const activeLegend = issuePresent
    ? LEGEND_ITEMS.filter((item) => issuePresent[item.key])
    : [];

  return (
    <div className="flex h-[min(820px,78vh)] min-h-[560px] flex-col overflow-hidden rounded-xl border border-border/70 bg-zinc-950 text-zinc-100 shadow-sm">
      {/* ---------- 顶栏 ---------- */}
      <header className="z-20 flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-950/95 px-4 py-2.5 backdrop-blur">
        <h1 className="mr-2 flex items-center gap-2 text-base font-bold tracking-tight">
          <Boxes className="h-5 w-5 text-emerald-400" aria-hidden />
          {t("app.title")}
          <span className="hidden text-sm font-normal text-zinc-500 sm:inline">
            {t("app.subtitle")}
          </span>
        </h1>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={MODEL_ACCEPT}
            className="sr-only"
            aria-label={t("app.fileLabel")}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadFile(f);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            <Upload className="h-4 w-4" />
            {t("app.upload")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
            onClick={() => setFitSignal((v) => v + 1)}
            disabled={!model}
          >
            <RotateCcw className="h-4 w-4" />
            {t("app.resetView")}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row md:overflow-hidden">
        {/* ---------- 侧栏 ---------- */}
        <aside className="order-2 min-h-0 w-full shrink-0 overflow-y-auto border-t border-zinc-800 p-3 md:order-1 md:w-[368px] md:border-t-0 md:border-r">
          {(loadError || error) && (
            <div
              className="mb-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
              role="alert"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t(
                  (loadError ?? error)?.key ?? "errors.parseFailed",
                  (loadError ?? error)?.params
                )}
              </span>
            </div>
          )}
          <Sidebar
            result={result}
            busy={busy || loading}
            onFocusCluster={focusCluster}
            onFocusPoint={focusPoint}
          />
        </aside>

        {/* ---------- 3D 视口 ---------- */}
        <main
          className="relative order-1 h-[48vh] min-h-[300px] flex-1 md:order-2 md:h-auto"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <Viewport
            result={result}
            meshPositions={model?.positions ?? null}
            visibility={visibility}
            showSupport={showSupport}
            focusRequest={focusRequest}
            fitSignal={fitSignal}
          />

          {/* 图例开关:只显示实际检出的问题类别;包裹支撑开关始终可用 */}
          {result && (
            <div className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 px-2.5 py-1.5 shadow-xl backdrop-blur">
              {activeLegend.map((item) => {
                const on = visibility[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setVisibility((v) => ({ ...v, [item.key]: !v[item.key] }))
                    }
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${on ? "bg-zinc-800/80 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full transition-opacity"
                      style={{ background: item.color, opacity: on ? 1 : 0.25 }}
                    />
                    {t(`legend.${ISSUE_LABEL_KEYS[item.key]}`)}
                  </button>
                );
              })}
              {activeLegend.length === 0 && (
                <span className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">
                  <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                  {t("legend.clean")}
                </span>
              )}
              <span
                className="mx-0.5 hidden h-4 w-px bg-zinc-700 sm:block"
                aria-hidden
              />
              <button
                type="button"
                aria-pressed={showSupport}
                title={t("legend.supportTitle")}
                onClick={() => setShowSupport((v) => !v)}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
                  showSupport
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <Shell className="h-3.5 w-3.5" aria-hidden />
                {t("legend.support")}
              </button>
            </div>
          )}

          {/* 进度条 */}
          {loading && (
            <output className="absolute left-1/2 top-3 z-10 block w-64 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-xl">
              <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("phases.loading")}
                <span className="ml-auto font-mono text-zinc-500">
                  {Math.round(loadingPct)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
                  style={{ width: `${loadingPct}%` }}
                />
              </div>
            </output>
          )}

          {busy && (
            <output className="absolute left-1/2 top-3 z-10 block w-64 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-xl">
              <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {stage ? t(`phases.${stage}`) : t("app.analyzing")}
                <span className="ml-auto font-mono text-zinc-500">
                  {Math.round(pct)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </output>
          )}

          {/* 拖拽遮罩 */}
          {dragOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-emerald-500/60 bg-emerald-500/10 backdrop-blur-sm">
              <p className="rounded-lg bg-zinc-900/90 px-4 py-2 text-sm text-emerald-300">
                {t("upload.dropOverlay")}
              </p>
            </div>
          )}

          {/* 空状态 */}
          {!model && !busy && !loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
              <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 text-center shadow-2xl backdrop-blur">
                <h2 className="text-lg font-bold">{t("empty.title")}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                  {t("empty.desc")}
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-900/60 px-4 py-6 transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/5"
                >
                  <Upload className="h-6 w-6 text-zinc-400" aria-hidden />
                  <span className="text-sm font-medium text-zinc-200">
                    {t("empty.drop")}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {t("empty.local")}
                  </span>
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ---------- 状态栏 ---------- */}
      <footer className="z-20 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-800 bg-zinc-950/95 px-4 py-1.5 text-[11px] text-zinc-500 backdrop-blur">
        <span className="max-w-48 truncate text-zinc-400">
          {stats?.fileName ?? t("stats.notLoaded")}
        </span>
        {stats && (
          <>
            <span>
              {t("stats.triangles")}{" "}
              <b className="font-mono text-zinc-300">
                {stats.triangleCount.toLocaleString()}
              </b>
            </span>
            <span>
              {t("stats.vertices")}{" "}
              <b className="font-mono text-zinc-300">
                {stats.vertexCount.toLocaleString()}
              </b>
            </span>
            <span>
              {t("stats.watertight")}{" "}
              <b
                className={
                  stats.watertight ? "text-emerald-400" : "text-rose-400"
                }
              >
                {stats.watertight
                  ? t("stats.watertightYes")
                  : t("stats.watertightNo")}
              </b>
            </span>
            <span>
              {t("stats.volume")}{" "}
              <b className="font-mono text-zinc-300">
                {stats.volumeMm3 >= 0 ? "" : "-"}
                {Math.abs(stats.volumeMm3) >= 1e6
                  ? `${(Math.abs(stats.volumeMm3) / 1000).toFixed(1)} cm³`
                  : `${Math.abs(stats.volumeMm3).toFixed(0)} mm³`}
              </b>
            </span>
            <span className="hidden sm:inline">
              {t("stats.analysisMs")}{" "}
              <b className="font-mono text-zinc-300">{stats.analysisMs} ms</b>
            </span>
            <span className="ml-auto hidden text-zinc-600 lg:inline">
              {t("stats.viewHint")}
            </span>
          </>
        )}
        {!stats && (
          <span className="text-zinc-600">{t("stats.localHint")}</span>
        )}
      </footer>
    </div>
  );
}
