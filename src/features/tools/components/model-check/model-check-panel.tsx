"use client";

/**
 * 打印前工作台 —— 「检查」视角
 *
 * ## 它是什么
 *
 * 2026-11-07 起,模型检查工具**并进**克重工具(`/tools/weight`):两个工具页
 * 合成一个工作台,模型只载入一次,里面用 **检查 / 克重 / 摆盘** 三个视角
 * 看同一个模型。
 *
 * 本组件就是那个工作台的「检查」视角 —— 它以前是独立的一页
 * (`model-checker.tsx`,已删),现在由父组件把模型和当前尺寸喂进来。
 *
 * ## 一份口径(结构上保证)
 *
 * - **几何只有一份** —— 父组件传的 `model.parseResult.positions` 就是克重
 *   工具那份(同一个 `ModelFile`,同一个 `parseResult`)。以前检查工具会
 *   **再解析一遍 OBJ** 才能拿到 UV / 材质分组,现在不用了。
 * - **尺寸跟着当前缩放走** —— `scales` 是克重工具那份生效的缩放因子,
 *   检查面板按它缩放顶点后再分析,所以画出来的支撑外壳跟克重那一栏的
 *   支撑克重是**同一个几何**。
 * - **托底高度跟随后台** —— `clientConfig.supportLiftMm`,跟克重工具、
 *   跟服务端报价用的是同一个值。
 *
 * ## 为什么分析器跑在 Worker 里
 *
 * 焊接 + 拓扑分析对大模型要几秒 —— 跑在主线程上整页会卡死。`useAnalyzer()`
 * 在 Worker 不可用时自动退回主线程(功能不缺,只是会卡一下)。
 */
import {
  Boxes,
  CircleAlert,
  CircleCheck,
  Loader2,
  Palette,
  RotateCcw,
  Shell,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type ModelUnitCheck,
  scalePositionsXYZ,
} from "@/features/pricing/lib/model-units";
import type { ModelFile } from "@/features/pricing/lib/zip-extractor";
import type { ClientPrintConfig } from "@/features/print-quote/lib/pricing-settings";
import { useDropZone } from "@/features/shared/hooks/use-drop-zone";
import {
  ISSUE_COLORS,
  ISSUE_LABEL_KEYS,
  type IssueCluster,
} from "@/features/tools/lib/mesh/types";
import Sidebar from "./sidebar";
import { useAnalyzer } from "./use-analyzer";
import Viewport, {
  type MeshTextureInfo,
  type ViewportVisibility,
} from "./viewport";

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

export function ModelCheckPanel({
  model,
  scales,
  clientConfig,
  unitCheck,
  onFiles,
}: {
  /** 当前模型 —— 跟克重工具是**同一个** `ModelFile`(只解析了一遍) */
  model: ModelFile | null;
  /** 当前生效的缩放因子 —— 检查面板按它缩放后再分析 */
  scales: [number, number, number];
  /** 后台配的打印参数(托底高度等)—— 跟克重工具、服务端报价同一份 */
  clientConfig?: ClientPrintConfig | undefined;
  /** 单位判定结果 —— 文件坐标不是毫米时才有值 */
  unitCheck?: ModelUnitCheck | null | undefined;
  /** 拖文件进视口 —— 交给上层那个上传管线 */
  onFiles?: ((files: File[]) => void) | undefined;
}) {
  const t = useTranslations("ModelInspector");
  const [visibility, setVisibility] =
    useState<ViewportVisibility>(ALL_VISIBILITY);
  const [showSupport, setShowSupport] = useState(false);
  const [showTexture, setShowTexture] = useState(true);
  const [focusRequest, setFocusRequest] = useState<{
    seq: number;
    point: [number, number, number] | null;
    radius?: number;
    dir?: [number, number, number];
  } | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const focusSeq = useRef(0);

  /** 托底高度 —— 跟随后台,跟克重工具同一个值 */
  const liftMm = clientConfig?.supportLiftMm;

  /**
   * 缩放后的几何 —— 分析器跟视口都吃这一份
   *
   * 支撑外壳的平台平面是**绝对毫米值**(托底 5mm),不跟着模型缩放走 ——
   * 所以这里必须按当前尺寸缩放顶点,否则画出来的支撑跟克重那一栏对不上。
   */
  const positions = useMemo(() => {
    const raw = model?.parseResult.positions;
    if (!raw) return null;
    return scalePositionsXYZ(raw, scales);
  }, [model, scales]);

  /** 贴图与材质分组 —— 全部来自同一个 `ModelFile`(不用再解析一遍 OBJ) */
  const textures = useMemo<MeshTextureInfo | null>(() => {
    if (!model) return null;
    const r = model.parseResult;
    return {
      uvs: r.uvs ?? null,
      materialNames: r.materialNames ?? [],
      materialIndex: r.materialIndex ?? null,
      mtlText: model.mtlText ?? null,
      textureUrls: model.textureUrls ?? null,
    };
  }, [model]);

  const { state, run } = useAnalyzer();
  const { result, busy, stage, pct, error } = state;

  useEffect(() => {
    if (!positions || !model) return;
    run({
      positions,
      fileName: model.objFileName || model.name,
      liftMm,
    });
  }, [positions, model, run, liftMm]);

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

  /**
   * 拖文件进视口 —— **用共享的那一套**
   *
   * 计数版的口径见 `features/shared/hooks/use-drop-zone.ts`。
   */
  const handleDroppedFiles = useCallback(
    (files: File[]) => {
      onFiles?.(files);
    },
    [onFiles]
  );
  const { isDragOver: dragOver, dropHandlers } =
    useDropZone<HTMLElement>(handleDroppedFiles);

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
  // 模型自带贴图时才显示「显示贴图 / 纯色」开关
  const hasTexture = useMemo(
    () => Object.keys(model?.textureUrls ?? {}).length > 0,
    [model]
  );

  return (
    <div className="flex h-[min(820px,78vh)] min-h-[560px] flex-col overflow-hidden bg-zinc-950 text-zinc-100">
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
          <Button
            size="sm"
            variant="outline"
            className="border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
            onClick={() => setFitSignal((v) => v + 1)}
          >
            <RotateCcw className="h-4 w-4" />
            {t("app.resetView")}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row md:overflow-hidden">
        {/* ---------- 侧栏 ---------- */}
        <aside className="order-2 min-h-0 w-full shrink-0 overflow-y-auto border-t border-zinc-800 p-3 md:order-1 md:w-[368px] md:border-t-0 md:border-r">
          {error && (
            <div
              className="mb-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
              role="alert"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t(error.key, error.params)}</span>
            </div>
          )}
          {/* 单位判定 —— 文件坐标不是毫米时,支撑外壳按归一化后的真实尺寸画 */}
          {unitCheck?.normalized && (
            <output className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {t("units.notMillimeters", {
                  extent: unitCheck.originalMaxExtent.toFixed(2),
                })}
                <span className="mt-1 block text-amber-400/80">
                  {t("units.treatedAs", {
                    size: unitCheck.assumedMaxExtentMm,
                  })}
                </span>
              </span>
            </output>
          )}
          <Sidebar
            result={result}
            busy={busy}
            onFocusCluster={focusCluster}
            onFocusPoint={focusPoint}
          />
        </aside>

        {/* ---------- 3D 视口 ---------- */}
        <main
          className="relative order-1 h-[48vh] min-h-[300px] flex-1 md:order-2 md:h-auto"
          {...dropHandlers}
        >
          <Viewport
            result={result}
            meshPositions={positions}
            textures={textures}
            showTexture={showTexture}
            visibility={visibility}
            showSupport={showSupport}
            supportLiftMm={liftMm}
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
              {hasTexture && (
                <button
                  type="button"
                  aria-pressed={showTexture}
                  title={t("legend.textureTitle")}
                  onClick={() => setShowTexture((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
                    showTexture
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <Palette className="h-3.5 w-3.5" aria-hidden />
                  {t("legend.texture")}
                </button>
              )}
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

          {/* 分析进度 */}
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
            /**
             * `pointer-events-none` —— **必须**
             *
             * 遮罩盖在指针下面,它就成了拖放的事件目标:浏览器把「进入遮罩」
             * 算成一次 dragenter、把「离开容器」算成一次 dragleave,容器跟着
             * 撤遮罩 → 遮罩没了 → 又 dragover …… 一直闪。
             *
             * 遮罩只是给人看的,不吃事件。
             */
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-emerald-500/60 bg-emerald-500/10 backdrop-blur-sm">
              <p className="rounded-lg bg-zinc-900/90 px-4 py-2 text-sm text-emerald-300">
                {t("upload.dropOverlay")}
              </p>
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
