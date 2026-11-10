"use client";

/**
 * 磁吸孔切割工具 —— `/tools/magnet`
 *
 * ## 它做什么
 *
 * 把模型**最平的那个面**上挖一个**盲孔**(Ø20.7mm / 深 1.3mm),切完下载
 * OBJ 给打印用。工作室原来给的是一段 Blender Python 脚本,只能在工作室
 * 本地跑 —— 客户拿不到这个能力,工作室每单也要手工过一道。
 *
 * ## 三条边界
 *
 * - **不进工单** —— 切完只本地下载。下单时仍然传**原始模型**,工作室自己
 *   在 Blender 里切。所以这个工具**一行都不碰**报价 / 工单 / R2 上传 /
 *   支撑克重那条链路。
 * - **模型不上传** —— 解析、焊接、布尔运算全在浏览器里跑(Worker)。
 * - **孔径是固定实物尺寸** —— 磁铁是固定尺寸的实体,孔径**不跟模型缩放**。
 *   界面上的孔参数**不设旋钮**(那是给实物定的,不是给模型定的)。
 *
 * ## 用的都是仓库里已有的东西(别重写)
 *
 * | 要的 | 用哪个 |
 * |---|---|
 * | 拖放 | `useDropZone()` —— 自己写 `onDragOver` 那个写法就是会闪的那份 |
 * | 解析 OBJ | `pricing/lib/zip-extractor.ts` 的 `extractModelZip()` |
 * | 单位判定 | `pricing/lib/model-units.ts` 的 `detectModelUnitScale()` |
 * | 视口 | `shared/components/model-viewport/` —— **整个仓库只有这一份视口** |
 * | 焊接 / 拓扑 | `tools/lib/mesh/weld.ts` 的 `weldAndAnalyzeTopology()` |
 * | 布尔运算 | `manifold-3d`(WASM)—— Blender EXACT 求解器背后的那个引擎 |
 *
 * ## 深色外观
 *
 * 跟打印前工作台(`/tools/workbench`)一致(`bg-zinc-950 text-zinc-100`)——
 * 两个工具页长得一样,用户不用重新学。
 */

import {
  AlertCircle,
  Boxes,
  CircleDot,
  Download,
  Loader2,
  Magnet,
  RotateCcw,
  Ruler,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MagnetClientError,
  MagnetCutterClient,
} from "@/features/magnet/lib/magnet-cutter-client";
import type {
  MagnetAnalyzeOutcome,
  MagnetCutOutcome,
  MagnetFaceReport,
} from "@/features/magnet/lib/magnet-cutter-protocol";
import { magnetErrorMessageKey } from "@/features/magnet/lib/magnet-error";
import {
  MAGNET_FACE_IDS,
  MAGNET_FACE_LABELS,
  MAGNET_HOLE_DEPTH_MM,
  MAGNET_HOLE_DIA_MM,
  type MagnetFaceId,
  pickDefaultFace,
} from "@/features/magnet/lib/magnet-params";
import { objBlobFromSoup } from "@/features/magnet/lib/write-obj";
import {
  detectModelUnitScale,
  type ModelUnitCheck,
  measurePositionsSize,
  scalePositions,
} from "@/features/pricing/lib/model-units";
import {
  extractModelZip,
  type ModelFile,
  revokeModelTextureUrls,
} from "@/features/pricing/lib/zip-extractor";
import { ModelViewport } from "@/features/shared/components/model-viewport";
import { useDropZone } from "@/features/shared/hooks/use-drop-zone";

/** 尺寸改完停多久重算一次(毫秒)—— 别让滑块一直跳数字 */
const RECALC_DEBOUNCE_MS = 400;

/** 目标最大边的取值范围(mm)—— 低于这个数切不出 Ø20.7 的孔 */
const MIN_TARGET_MM = 25;
const MAX_TARGET_MM = 400;

type SizeMode = "auto" | "custom";

export function MagnetCutterTool() {
  const t = useTranslations("Magnet");

  /* ------------------------------------------------------------------ */
  /*  模型                                                                */
  /* ------------------------------------------------------------------ */

  const [model, setModel] = useState<ModelFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* ------------------------------------------------------------------ */
  /*  尺寸                                                                */
  /* ------------------------------------------------------------------ */

  /** 单位判定 —— 文件坐标是不是毫米 */
  const [unitCheck, setUnitCheck] = useState<ModelUnitCheck | null>(null);
  /** 「按文件单位算」还是「按我填的目标最大边算」 */
  const [sizeMode, setSizeMode] = useState<SizeMode>("auto");
  /** 目标最大边(mm)—— 只在 `custom` 模式下生效 */
  const [targetMaxEdgeMm, setTargetMaxEdgeMm] = useState(100);

  /* ------------------------------------------------------------------ */
  /*  分析 / 切割                                                          */
  /* ------------------------------------------------------------------ */

  const [analysis, setAnalysis] = useState<MagnetAnalyzeOutcome | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedFace, setSelectedFace] = useState<MagnetFaceId | null>(null);
  const [cutResult, setCutResult] = useState<MagnetCutOutcome | null>(null);
  const [cutting, setCutting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);

  /* ------------------------------------------------------------------ */
  /*  Worker 客户端                                                       */
  /* ------------------------------------------------------------------ */

  const clientRef = useRef<MagnetCutterClient | null>(null);
  if (clientRef.current === null && typeof window !== "undefined") {
    clientRef.current = new MagnetCutterClient();
  }
  const client = clientRef.current;

  useEffect(() => {
    return () => {
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, []);

  /**
   * 换模型时把上一个模型的贴图 blob URL 收掉
   *
   * `extractModelZip()` 会给每张贴图造一个 object URL —— 不 revoke 的话,
   * 换几次模型浏览器就把内存吃满了。这个工具**不显示贴图**(布尔运算不保留
   * UV),但那些 URL 照样被造出来了,照样得收。
   */
  const modelRef = useRef<ModelFile | null>(null);
  useEffect(() => {
    return () => {
      revokeModelTextureUrls(modelRef.current);
      modelRef.current = null;
    };
  }, []);

  /* ------------------------------------------------------------------ */
  /*  几何                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * 文件里的原始几何(文件自己的单位)
   *
   * `positions` 是三角汤(9 floats/tri)—— 解析阶段就带出来了,不用再解析一遍。
   */
  const rawPositions = model?.parseResult.positions ?? null;

  /**
   * 算完尺寸之后的几何(mm)
   *
   * 两步:① 文件单位 → mm(单位判定那一步,必要时归一化到最大边 100mm)
   * ② mm → 用户定的目标最大边(均匀缩放)
   *
   * **孔径是绝对毫米** ⇒ 厚度 / 净空这些数必须跑在**最终尺寸**上 ——
   * 拿缩放前的几何量厚度,量出来的数跟切出来的孔对不上。
   */
  const scaledPositions = useMemo(() => {
    if (!rawPositions || !unitCheck) return null;
    const base = scalePositions(rawPositions, unitCheck.scale);
    const baseSize = measurePositionsSize(base);
    const maxEdge = Math.max(baseSize.x, baseSize.y, baseSize.z);
    if (!Number.isFinite(maxEdge) || maxEdge <= 0) return base;
    const target =
      sizeMode === "custom" ? targetMaxEdgeMm : unitCheck.assumedMaxExtentMm;
    if (!Number.isFinite(target) || target <= 0) return base;
    return scalePositions(base, target / maxEdge);
  }, [rawPositions, unitCheck, sizeMode, targetMaxEdgeMm]);

  /** 最终尺寸下的包围盒(mm) */
  const scaledSize = useMemo(() => {
    if (!scaledPositions) return null;
    return measurePositionsSize(scaledPositions);
  }, [scaledPositions]);

  /* ------------------------------------------------------------------ */
  /*  载入模型                                                            */
  /* ------------------------------------------------------------------ */

  const loadFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setLoadError(null);
      setError(null);
      setAnalysis(null);
      setCutResult(null);
      setSelectedFace(null);
      try {
        const result = await extractModelZip(file, (p) => {
          // 进度只在「读文件」阶段有意义,解析在 worker 里
          if (p.phase === "unzip") {
            setLoadError(null);
          }
        });
        if (!result.model) {
          setLoadError(result.error ?? t("errors.generic"));
          revokeModelTextureUrls(modelRef.current);
          modelRef.current = null;
          setModel(null);
          setUnitCheck(null);
          return;
        }
        const positions = result.model.parseResult.positions;
        if (!positions || positions.length < 9) {
          setLoadError(t("errors.noGeometry"));
          revokeModelTextureUrls(modelRef.current);
          modelRef.current = null;
          setModel(null);
          setUnitCheck(null);
          return;
        }
        // 换模型 —— 上一个模型的贴图 URL 收掉(不然换几次就把浏览器内存吃满)
        revokeModelTextureUrls(modelRef.current);
        setModel(result.model);
        modelRef.current = result.model;
        const size = measurePositionsSize(positions);
        const check = detectModelUnitScale(size);
        setUnitCheck(check);
        setSizeMode("auto");
        setTargetMaxEdgeMm(check.assumedMaxExtentMm);
      } catch (err) {
        console.error("[Magnet] 解析模型失败", err);
        setLoadError(t("errors.generic"));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  const handleDroppedFiles = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      void loadFile(file);
    },
    [loadFile]
  );

  const { isDragOver: dragOver, dropHandlers } =
    useDropZone<HTMLDivElement>(handleDroppedFiles);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const handlePickFile = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) void loadFile(file);
    },
    [loadFile]
  );

  /* ------------------------------------------------------------------ */
  /*  分析(挑面)                                                          */
  /* ------------------------------------------------------------------ */

  /** 分析的序号 —— 过期回包直接丢(防抖期间连发两条) */
  const analyzeSeqRef = useRef(0);

  const runAnalyze = useCallback(
    async (positions: Float32Array) => {
      if (!client) return;
      const seq = ++analyzeSeqRef.current;
      setAnalyzing(true);
      try {
        const result = await client.analyze(positions);
        if (seq !== analyzeSeqRef.current) return; // 过期
        setAnalysis(result);
        setError(null);
        // 默认挑「最平且能切」的那个面 —— 用户可以自己改
        const fallback = pickDefaultFace(result.faces)?.faceId ?? null;
        setSelectedFace((prev) => {
          if (!prev) return fallback;
          const still = result.faces.find((f) => f.faceId === prev);
          if (still && still.verdict === "ok") return prev;
          return fallback;
        });
      } catch (err) {
        if (seq !== analyzeSeqRef.current) return;
        console.error("[Magnet] 分析失败", err);
        setAnalysis(null);
        setError(describeError(err, t));
      } finally {
        if (seq === analyzeSeqRef.current) setAnalyzing(false);
      }
    },
    [client, t]
  );

  /**
   * 尺寸变了就重算一遍 —— 但**防抖**
   *
   * 不重算的话,页面上的厚度 / 净空是**旧尺寸**的,用户照着它切,切出来的
   * 孔跟界面上写的对不上。
   *
   * 防抖是因为拖滑块会连着触发 —— 每拖一下就重算一遍,Worker 队列一直满。
   */
  useEffect(() => {
    if (!scaledPositions) return;
    // 尺寸变了 ⇒ 之前那个孔作废(它是按旧尺寸切的)
    setCutResult(null);
    const timer = setTimeout(() => {
      void runAnalyze(scaledPositions);
    }, RECALC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [scaledPositions, runAnalyze]);

  /* ------------------------------------------------------------------ */
  /*  切割                                                                */
  /* ------------------------------------------------------------------ */

  const selectedFaceReport: MagnetFaceReport | null = useMemo(() => {
    if (!analysis || !selectedFace) return null;
    return analysis.faces.find((f) => f.faceId === selectedFace) ?? null;
  }, [analysis, selectedFace]);

  const canCut =
    Boolean(scaledPositions) &&
    Boolean(selectedFace) &&
    selectedFaceReport?.verdict === "ok" &&
    !cutting &&
    !analyzing;

  const handleCut = useCallback(async () => {
    if (!client || !scaledPositions || !selectedFace) return;
    setCutting(true);
    setError(null);
    try {
      const result = await client.cut(scaledPositions, selectedFace);
      setCutResult(result);
      // 切完几何变了 —— 相机重新取景,不然孔可能落在画面外
      setFitSignal((v) => v + 1);
    } catch (err) {
      console.error("[Magnet] 切割失败", err);
      setCutResult(null);
      setError(describeError(err, t));
    } finally {
      setCutting(false);
    }
  }, [client, scaledPositions, selectedFace, t]);

  /* ------------------------------------------------------------------ */
  /*  下载                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * 下载 OBJ
   *
   * 切完就下载**切完的**那一份;没切的话下载原模型(用户自己拿去 Blender 切)。
   *
   * **不带贴图 / 材质** —— 布尔运算不保留 UV,导出来的是纯色件。
   */
  const handleDownload = useCallback(() => {
    const positions = cutResult?.positions ?? scaledPositions;
    if (!positions) return;
    const blob = objBlobFromSoup(positions, {
      header: [
        "Mooncoda magnet pocket cutter",
        `hole_dia_mm=${MAGNET_HOLE_DIA_MM}`,
        `depth_mm=${MAGNET_HOLE_DEPTH_MM}`,
        `face=${selectedFace ?? "none"}`,
        `target_max_edge_mm=${targetMaxEdgeMm.toFixed(2)}`,
      ],
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = cutResult ? "relief_final.obj" : "model.obj";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [cutResult, scaledPositions, selectedFace, targetMaxEdgeMm]);

  /* ------------------------------------------------------------------ */
  /*  渲染                                                                */
  /* ------------------------------------------------------------------ */

  /** 视口里画的那份几何 —— 切完之前是原模型,切完是带孔的那份 */
  const displayPositions = cutResult?.positions ?? scaledPositions;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 max-w-3xl">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-100">
          <Magnet className="size-6 text-amber-400" />
          {t("title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          {t("subtitle")}
        </p>
      </header>

      {/* ---------- 深色 3D 应用(跟打印前工作台一个样子) ---------- */}
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-sm">
        {/* 头部 —— 文件身份 */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Boxes className="size-4 shrink-0 text-amber-400" />
              <span className="truncate">
                {model ? model.name : t("file.noFile")}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              {model
                ? t("file.summary", {
                    faces: model.parseResult.triangleCount,
                    size: scaledSize
                      ? `${scaledSize.x.toFixed(1)} × ${scaledSize.y.toFixed(1)} × ${scaledSize.z.toFixed(1)}`
                      : "—",
                  })
                : t("file.hint")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".obj,.stl,.ply,.glb,.gltf,.zip,.rar,.cbr"
              className="hidden"
              onChange={handleInputChange}
            />
            <button
              type="button"
              onClick={handlePickFile}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              {model ? t("file.replace") : t("file.choose")}
            </button>
          </div>
        </div>

        {/* 解析中 */}
        {loading && (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-amber-500/15">
              <Loader2 className="size-8 animate-spin text-amber-400" />
            </div>
            <h3 className="mb-1 text-base font-semibold text-zinc-100">
              {t("file.parsing")}
            </h3>
            <p className="max-w-md text-sm text-zinc-400">
              {t("file.parsingHint")}
            </p>
          </div>
        )}

        {/* 解析失败 */}
        {!loading && loadError && (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-red-500/15">
              <AlertCircle className="size-8 text-red-400" />
            </div>
            <h3 className="mb-1 text-base font-semibold text-zinc-100">
              {t("file.loadFailed")}
            </h3>
            <p className="max-w-md text-sm text-red-400">{loadError}</p>
            <button
              type="button"
              onClick={handlePickFile}
              className="mt-4 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              {t("file.choose")}
            </button>
          </div>
        )}

        {/* ---------- 侧栏 + 展示区 ---------- */}
        {!loading && !loadError && (
          <div className="flex flex-col md:flex-row md:h-[620px]">
            {/* ---------- 左栏 ---------- */}
            <aside className="order-2 flex flex-col border-t border-zinc-800 md:order-1 md:w-[360px] md:shrink-0 md:border-r md:border-t-0">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
                {/* ---- 空状态:提示拖文件 ---- */}
                {!model && (
                  <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 p-4 text-center">
                    <p className="text-xs leading-relaxed text-zinc-400">
                      {t("drop.hint")}
                    </p>
                    <button
                      type="button"
                      onClick={handlePickFile}
                      className="mt-3 w-full rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
                    >
                      {t("drop.choose")}
                    </button>
                  </div>
                )}

                {/* ---- 单位横幅 ---- */}
                {unitCheck?.normalized && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                    <p className="text-xs leading-relaxed text-amber-200">
                      {t("unit.banner", {
                        extent: unitCheck.originalMaxExtent.toFixed(2),
                      })}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSizeMode("custom");
                        setTargetMaxEdgeMm(unitCheck.originalMaxExtent);
                      }}
                      className="mt-2 text-[11px] font-medium text-amber-300 underline underline-offset-2 hover:text-amber-200"
                    >
                      {t("unit.restore")}
                    </button>
                  </div>
                )}

                {/* ---- 尺寸 ---- */}
                {model && (
                  <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                      <Ruler className="size-3.5 text-zinc-400" />
                      {t("size.title")}
                    </h3>
                    <label
                      htmlFor="magnet-target-max-edge"
                      className="mb-1 block text-[11px] text-zinc-400"
                    >
                      {t("size.label")}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="magnet-target-max-edge"
                        type="number"
                        min={MIN_TARGET_MM}
                        max={MAX_TARGET_MM}
                        step={1}
                        value={
                          Number.isFinite(targetMaxEdgeMm)
                            ? targetMaxEdgeMm
                            : ""
                        }
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setSizeMode("custom");
                          setTargetMaxEdgeMm(
                            Number.isFinite(v)
                              ? Math.min(
                                  MAX_TARGET_MM,
                                  Math.max(MIN_TARGET_MM, v)
                                )
                              : MIN_TARGET_MM
                          );
                        }}
                        className="w-24 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                      />
                      <span className="text-[11px] text-zinc-500">mm</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSizeMode("auto");
                          if (unitCheck) {
                            setTargetMaxEdgeMm(unitCheck.assumedMaxExtentMm);
                          }
                        }}
                        className="ml-auto flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-400 transition-colors hover:text-zinc-200"
                      >
                        <RotateCcw className="size-3" />
                        {t("size.reset")}
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                      {t("size.hint")}
                    </p>
                  </section>
                )}

                {/* ---- 孔参数(固定,不给旋钮) ---- */}
                <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                    <CircleDot className="size-3.5 text-zinc-400" />
                    {t("hole.title")}
                  </h3>
                  <p className="text-[11px] leading-relaxed text-zinc-400">
                    {t("hole.fixed", {
                      dia: MAGNET_HOLE_DIA_MM,
                      depth: MAGNET_HOLE_DEPTH_MM,
                    })}
                  </p>
                </section>

                {/* ---- 六个面 ---- */}
                {model && (
                  <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                      <Ruler className="size-3.5 text-zinc-400" />
                      {t("faces.title")}
                    </h3>
                    {analyzing && !analysis && (
                      <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                        <Loader2 className="size-3 animate-spin" />
                        {t("faces.analyzing")}
                      </p>
                    )}
                    {analysis && (
                      <div className="overflow-hidden rounded-md border border-zinc-800">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-zinc-900 text-zinc-500">
                            <tr>
                              <th className="px-2 py-1.5 font-medium">
                                {t("faces.col.face")}
                              </th>
                              <th className="px-2 py-1.5 font-medium">
                                {t("faces.col.flatness")}
                              </th>
                              <th className="px-2 py-1.5 font-medium">
                                {t("faces.col.thickness")}
                              </th>
                              <th className="px-2 py-1.5 font-medium">
                                {t("faces.col.verdict")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {MAGNET_FACE_IDS.map((id) => {
                              const face = analysis.faces.find(
                                (f) => f.faceId === id
                              );
                              if (!face) return null;
                              const active = face.faceId === selectedFace;
                              return (
                                <tr
                                  key={id}
                                  onClick={() => setSelectedFace(id)}
                                  className={`cursor-pointer border-t border-zinc-800/80 transition-colors ${
                                    active
                                      ? "bg-amber-500/15 text-amber-200"
                                      : "text-zinc-400 hover:bg-zinc-800/60"
                                  }`}
                                >
                                  <td className="px-2 py-1.5 font-mono">
                                    {MAGNET_FACE_LABELS[id]}
                                  </td>
                                  <td className="px-2 py-1.5 font-mono">
                                    {face.hit
                                      ? `${face.flatnessDeg.toFixed(1)}°`
                                      : "—"}
                                  </td>
                                  <td className="px-2 py-1.5 font-mono">
                                    {face.thicknessMm == null
                                      ? "—"
                                      : `${face.thicknessMm.toFixed(1)}`}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    {t(`faces.verdict.${face.verdict}`)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {analysis && (
                      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                        {t("faces.hint")}
                      </p>
                    )}
                  </section>
                )}

                {/* ---- 切割结果 ---- */}
                {cutResult && (
                  <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
                    <h3 className="mb-2 text-xs font-bold text-emerald-200">
                      {t("cut.done")}
                    </h3>
                    <dl className="space-y-1 text-[11px] text-emerald-100/80">
                      <Row
                        label={t("cut.removed")}
                        value={`${cutResult.removedVolume.toFixed(1)} mm³`}
                      />
                      <Row
                        label={t("cut.expected")}
                        value={`${cutResult.expectedRemovedVolume.toFixed(1)} mm³`}
                      />
                      <Row
                        label={t("cut.volume")}
                        value={`${cutResult.volumeBefore.toFixed(1)} → ${cutResult.volumeAfter.toFixed(1)} mm³`}
                      />
                      <Row
                        label={t("cut.tris")}
                        value={String(cutResult.triangleCount)}
                      />
                    </dl>
                    <p className="mt-2 text-[11px] leading-relaxed text-emerald-200/70">
                      {t("cut.note")}
                    </p>
                  </section>
                )}

                {/* ---- 报错 ---- */}
                {error && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
                    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-red-300">
                      <AlertCircle className="mt-px size-3.5 shrink-0" />
                      {error}
                    </p>
                  </div>
                )}
              </div>

              {/* ---------- 底部固定条:主出口 ---------- */}
              <div className="shrink-0 space-y-2 border-t border-zinc-800 p-3">
                <button
                  type="button"
                  disabled={!canCut}
                  onClick={() => void handleCut()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-sm transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  {cutting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CircleDot className="size-4" />
                  )}
                  {cutting ? t("cut.working") : t("cut.button")}
                </button>
                <button
                  type="button"
                  disabled={!displayPositions}
                  onClick={handleDownload}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600"
                >
                  <Download className="size-3.5" />
                  {cutResult ? t("download.cut") : t("download.original")}
                </button>
                <p className="text-center text-[10px] leading-relaxed text-zinc-600">
                  {t("download.solidColor")}
                </p>
              </div>
            </aside>

            {/* ---------- 右:3D 展示区 ---------- */}
            <div className="order-1 flex min-w-0 flex-col md:order-2 md:flex-1">
              <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3 py-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
                  <Boxes className="size-3.5 text-amber-500" />
                  {t("viewport.title")}
                </span>
                <button
                  type="button"
                  onClick={() => setFitSignal((v) => v + 1)}
                  className="flex items-center gap-1 rounded border border-zinc-700 bg-white/10 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-white/20"
                >
                  <RotateCcw className="size-3" />
                  {t("viewport.reset")}
                </button>
              </div>

              <div
                className="relative h-[300px] bg-[#111418] sm:h-[380px] md:h-auto md:min-h-[300px] md:flex-1"
                {...dropHandlers}
              >
                <ModelViewport
                  /* 没有分析结果 —— 问题着色那一层压根不画 */
                  result={null}
                  /* 切完之前是原模型,切完是带孔的那份 */
                  meshPositions={displayPositions}
                  /* 布尔运算不保留 UV —— 视口跟导出都按纯色件处理 */
                  textures={null}
                  showTexture={false}
                  showSupport={false}
                  focusRequest={{ seq: 0, point: null }}
                  fitSignal={fitSignal}
                />

                {dragOver && (
                  <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-emerald-500/60 bg-emerald-500/10 backdrop-blur-sm">
                    <p className="rounded-lg bg-zinc-900/90 px-4 py-2 text-sm text-emerald-300">
                      {t("drop.overlay")}
                    </p>
                  </div>
                )}

                {!model && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <p className="rounded-lg bg-zinc-900/80 px-4 py-2 text-xs text-zinc-400">
                      {t("viewport.empty")}
                    </p>
                  </div>
                )}

                {analyzing && analysis && (
                  <output className="absolute left-1/2 top-3 z-10 block w-56 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 shadow-xl">
                    <span className="flex items-center gap-2 text-xs text-zinc-300">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t("faces.analyzing")}
                    </span>
                  </output>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 结果卡里的一行「标签 — 值」 */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt>{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

/**
 * 把一次失败变成一句**用户看得懂**的话
 *
 * 切割的失败都带稳定的 code —— 认得就摆具体的,认不出才退回笼统那句。
 * 映射表在 `features/magnet/lib/magnet-error.ts`(纯文件,有单测守着)。
 */
function describeError(err: unknown, t: (key: string) => string): string {
  const key = magnetErrorMessageKey(err);
  if (key) return t(key);
  if (err instanceof MagnetClientError) return err.message;
  return t("errors.generic");
}
