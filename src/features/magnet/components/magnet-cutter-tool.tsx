"use client";

/**
 * 磁吸孔切割工具 —— `/tools/magnet`
 *
 * ## 它做什么
 *
 * 把模型**最平的那个面**上挖一个**盲孔**(默认 Ø20.7mm / 深 1.3mm),切完下载
 * 模型给打印用。工作室原来给的是一段 Blender Python 脚本,只能在工作室
 * 本地跑 —— 客户拿不到这个能力,工作室每单也要手工过一道。
 *
 * ## 工作室 2026-11-11 提的三条
 *
 * 1. **磁吸沉孔需要可调** —— 孔径 / 深度能填了(默认仍是实物磁铁的尺寸)。
 *    「不跟模型缩放」这条**不变** —— 孔径是实物尺寸,不是模型的比例。
 * 2. **智能识别背面** —— 原来只在六个轴向里找,模型一歪就找不着。现在改成
 *    **按面积找模型上最大的平面区域**(跟朝向无关),用户也能在候选列表里
 *    换一块。
 * 3. **导出要保留原来的材质贴图** —— Manifold3D 的属性通道能保住 UV,
 *    材质分组也保得住。导出的是 ZIP(OBJ + MTL + 纹理),不是纯色件。
 *
 * ## 三条边界
 *
 * - **不进工单** —— 切完只本地下载。下单时仍然传**原始模型**,工作室自己
 *   在 Blender 里切。所以这个工具**一行都不碰**报价 / 工单 / R2 上传 /
 *   支撑克重那条链路。
 * - **模型不上传** —— 两条引擎都在用户自己这台机器上跑(见下面「两条引擎」),
 *   **没有服务器**。
 * - **孔径是实物尺寸** —— 磁铁是固定尺寸的实体,孔径**不跟模型缩放**。
 *
 * ## 两条引擎(用户自己选,2026-11-11 加)
 *
 * | 引擎 | 干什么 | 适合谁 |
 * |---|---|---|
 * | **浏览器**(默认) | Manifold3D(WASM)在 Worker 里跑,模型破了自己修 | 大多数模型 |
 * | **本地 Blender** | 装一个插件,切孔在**用户自己电脑上**跑 | 自相交 / 修不好的模型 |
 *
 * - **浏览器那条路会先「修」再切**(2026-11-11)—— 工作室的原话:
 *   「不用装任何东西 —— 但模型不是封闭实体(有开放边 / 非流形边)时会切不了 /
 *   不要因为这个问题切不了」。所以现在**不因为「不是封闭实体」就拒收**:
 *   缺的面补上、重复的面剔掉、非流形边上的多余面删掉、绕序翻乱的翻过来、
 *   蝴蝶结顶点拆开(`magnet-repair.ts`)。**修完还是破的才报错。**
 * - **本地 Blender 那条路不跑浏览器的分析** —— 浏览器那套分析在**修复之后**
 *   仍然拿不出结果时,插件自己挑面(最大的平面)照样能切。
 * - **只跟 `127.0.0.1` 说话** —— 走回环地址,**不是**我们的服务器。没有
 *   上传、没有登录、没有 API 路由。模型不出用户自己的电脑。
 * - **插件在仓库里**(`public/magnet/blender_bridge.py`)—— 页面直接给下载
 *   链接;页面同时指引用户去下**便携版 Blender**(官网上每个版本都有
 *   Windows 便携版 .zip,解压就能用,不用装)。
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
 * | 导出 ZIP | `pricing/lib/obj-exporter.ts` 的 `downloadModelZip()` |
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
  Cpu,
  Download,
  ExternalLink,
  Layers,
  Loader2,
  Magnet,
  Plug,
  RotateCcw,
  Ruler,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type BlenderCutStats,
  BlenderLocalError,
  cutWithLocalBlender,
  MAGNET_BLENDER_ADDON_URL,
  MAGNET_BLENDER_DEFAULT_PORT,
  MAGNET_BLENDER_PORTABLE_URL,
  type MagnetEngine,
  normalizeBlenderPort,
  pingLocalBlender,
} from "@/features/magnet/lib/blender-local";
import {
  MagnetClientError,
  MagnetCutterClient,
} from "@/features/magnet/lib/magnet-cutter-client";
import type {
  MagnetAnalyzeOutcome,
  MagnetCutOutcome,
  MagnetFaceReport,
  MagnetPatchReport,
  MagnetTextureInput,
} from "@/features/magnet/lib/magnet-cutter-protocol";
import { magnetErrorMessageKey } from "@/features/magnet/lib/magnet-error";
import {
  MAGNET_FACE_IDS,
  MAGNET_FACE_LABELS,
  MAGNET_HOLE_DEPTH_MAX_MM,
  MAGNET_HOLE_DEPTH_MIN_MM,
  MAGNET_HOLE_DEPTH_MM,
  MAGNET_HOLE_DIA_MAX_MM,
  MAGNET_HOLE_DIA_MIN_MM,
  MAGNET_HOLE_DIA_MM,
  MAGNET_TARGET_AUTO,
  type MagnetHoleParams,
  type MagnetTargetId,
  normalizeHoleParams,
  parsePatchTarget,
  patchTargetId,
} from "@/features/magnet/lib/magnet-params";
import { writeObjFromSoup } from "@/features/magnet/lib/write-obj";
import {
  detectModelUnitScale,
  type ModelUnitCheck,
  measurePositionsSize,
  scalePositions,
} from "@/features/pricing/lib/model-units";
import {
  buildModelZipBlob,
  downloadModelZip,
} from "@/features/pricing/lib/obj-exporter";
import {
  extractModelZip,
  type ModelFile,
  revokeModelTextureUrls,
} from "@/features/pricing/lib/zip-extractor";
import {
  type MeshTextureInfo,
  ModelViewport,
} from "@/features/shared/components/model-viewport";
import { useDropZone } from "@/features/shared/hooks/use-drop-zone";

/** 尺寸改完停多久重算一次(毫秒)—— 别让滑块一直跳数字 */
const RECALC_DEBOUNCE_MS = 400;

/** 目标最大边的取值范围(mm)—— 低于这个数切不出 Ø20.7 的孔 */
const MIN_TARGET_MM = 25;
const MAX_TARGET_MM = 400;

/** 目标最大边的默认值(mm)—— 归一化之后的标准尺寸 */
const DEFAULT_TARGET_MM = 100;

/** 导出的文件名(跟工作室脚本一致 —— `relief_final.obj`) */
const CUT_OBJ_NAME = "relief_final.obj";
const CUT_MTL_NAME = "relief_final.mtl";
const CUT_ZIP_NAME = "relief_final.zip";
const ORIGINAL_OBJ_NAME = "model.obj";
const ORIGINAL_ZIP_NAME = "model.zip";

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
  const [targetMaxEdgeMm, setTargetMaxEdgeMm] = useState(DEFAULT_TARGET_MM);
  /**
   * 输入框里正在敲的那串字
   *
   * **为什么单独存一份字符串** —— 受控的 `type="number"` 每敲一个键就夹一次
   * 值:输「150」会先变成「1」(夹到下限 25)再变成「15」,根本敲不进去 ——
   * 工作室报的「无法直接改数字」就是这条。
   *
   * 字符串 + **失焦时**归一化才靠谱(跟下面那个 `NumberField` 一个路子)。
   */
  const [targetMaxEdgeText, setTargetMaxEdgeText] = useState(
    String(DEFAULT_TARGET_MM)
  );

  /* ------------------------------------------------------------------ */
  /*  孔参数(可调)                                                        */
  /* ------------------------------------------------------------------ */

  const [holeDiaText, setHoleDiaText] = useState(String(MAGNET_HOLE_DIA_MM));
  const [holeDepthText, setHoleDepthText] = useState(
    String(MAGNET_HOLE_DEPTH_MM)
  );

  /* ------------------------------------------------------------------ */
  /*  切割引擎(浏览器内 / 本地 Blender)                                   */
  /* ------------------------------------------------------------------ */

  /**
   * 用哪条引擎切孔
   *
   * - `browser` —— 浏览器里的 Manifold3D(默认,什么都不用装)
   * - `blender` —— **用户自己电脑上的** Blender(要装插件)
   *
   * 两条路**都不上传模型** —— 后者走 `127.0.0.1`,模型压根不出那台电脑。
   */
  const [engine, setEngine] = useState<MagnetEngine>("browser");

  /** 本地 Blender 的端口(输入框里那串字) */
  const [blenderPortText, setBlenderPortText] = useState(
    String(MAGNET_BLENDER_DEFAULT_PORT)
  );

  /** 探活的结果 —— 「连上了 / 连不上」要说人话 */
  const [blenderPing, setBlenderPing] = useState<BlenderPingState>({
    status: "idle",
  });

  /** 本地 Blender 切完的结果(它导回来的 zip + 报回来的数 + 预览用的模型) */
  const [blenderResult, setBlenderResult] = useState<BlenderCutOutcome | null>(
    null
  );

  /**
   * 设目标最大边 —— 数字和输入框里那串字**一起**改
   *
   * 两份状态必须同步:一份是几何用的数字,一份是输入框显示的字。
   * 只改其中一份 ⇒ 输入框里显示的跟实际用的不是一个数(工作室看不出模型
   * 到底按多大算的)。
   */
  const applyTargetMaxEdge = useCallback((mm: number) => {
    const clamped = Math.min(MAX_TARGET_MM, Math.max(MIN_TARGET_MM, mm));
    setTargetMaxEdgeMm(clamped);
    setTargetMaxEdgeText(formatMm(clamped));
  }, []);

  /**
   * 孔参数(收敛到合法范围)
   *
   * **不跟模型缩放** —— 孔径是实物磁铁的尺寸,不是模型的比例。
   */
  const holeParams: MagnetHoleParams = useMemo(
    () =>
      normalizeHoleParams({
        holeDiaMm: Number(holeDiaText),
        holeDepthMm: Number(holeDepthText),
      }),
    [holeDiaText, holeDepthText]
  );

  /* ------------------------------------------------------------------ */
  /*  分析 / 切割                                                          */
  /* ------------------------------------------------------------------ */

  const [analysis, setAnalysis] = useState<MagnetAnalyzeOutcome | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  /** 切哪儿 —— `"auto"` = 智能识别出来的那块平面 */
  const [target, setTarget] = useState<MagnetTargetId>(MAGNET_TARGET_AUTO);
  const [cutResult, setCutResult] = useState<MagnetCutOutcome | null>(null);
  const [cutting, setCutting] = useState(false);
  const [error, setError] = useState<MagnetErrorReport | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [showTexture, setShowTexture] = useState(true);

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
   * 换几次模型浏览器就把内存吃满了。
   */
  const modelRef = useRef<ModelFile | null>(null);
  useEffect(() => {
    return () => {
      revokeModelTextureUrls(modelRef.current);
      modelRef.current = null;
    };
  }, []);

  /**
   * 本地 Blender 导回来的那个模型
   *
   * 它的贴图也是 object URL(`extractModelZip` 造的)—— 换一次要收一次,
   * 不收的话浏览器内存就漏了。
   */
  const blenderModelRef = useRef<ModelFile | null>(null);
  useEffect(() => {
    return () => {
      revokeModelTextureUrls(blenderModelRef.current);
      blenderModelRef.current = null;
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
      setTarget(MAGNET_TARGET_AUTO);
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
        applyTargetMaxEdge(check.assumedMaxExtentMm);
      } catch (err) {
        console.error("[Magnet] 解析模型失败", err);
        setLoadError(t("errors.generic"));
      } finally {
        setLoading(false);
      }
    },
    [t, applyTargetMaxEdge]
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
  /*  贴图信息(给布尔运算 + 视口 + 导出用)                                 */
  /* ------------------------------------------------------------------ */

  /**
   * 原模型的贴图信息 —— **逐三角形对齐** `positions`
   *
   * 布尔运算靠它保住 UV 与材质分组(见 `magnet-cutter-handler.ts` 的
   * `buildTexturedMeshInput`)。没有贴图的模型传 `null` —— 走纯几何那条路。
   */
  const sourceTexture = useMemo<MagnetTextureInput | null>(() => {
    if (!model) return null;
    const uvs = model.parseResult.uvs ?? null;
    const materialIndex = model.parseResult.materialIndex ?? null;
    const materialNames = model.parseResult.materialNames ?? null;
    if (!uvs && !materialIndex) return null;
    return { uvs, materialIndex, materialNames };
  }, [model]);

  /* ------------------------------------------------------------------ */
  /*  分析(挑面 + 智能识别背面)                                            */
  /* ------------------------------------------------------------------ */

  /** 分析的序号 —— 过期回包直接丢(防抖期间连发两条) */
  const analyzeSeqRef = useRef(0);

  const runAnalyze = useCallback(
    async (positions: Float32Array) => {
      if (!client) return;
      const seq = ++analyzeSeqRef.current;
      setAnalyzing(true);
      try {
        const result = await client.analyze(positions, holeParams);
        if (seq !== analyzeSeqRef.current) return; // 过期
        setAnalysis(result);
        setError(null);
        // 目标失效了(候选列表变了)⇒ 退回「智能识别」那块
        setTarget((prev) => {
          if (prev === MAGNET_TARGET_AUTO) return prev;
          const idx = parsePatchTarget(prev);
          if (idx !== null) {
            return result.patches[idx] ? prev : MAGNET_TARGET_AUTO;
          }
          return result.faces.some((f) => f.faceId === prev)
            ? prev
            : MAGNET_TARGET_AUTO;
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
    [client, holeParams, t]
  );

  /**
   * 尺寸 / 孔参数变了就重算一遍 —— 但**防抖**
   *
   * 不重算的话,页面上的厚度 / 净空是**旧参数**的,用户照着它切,切出来的
   * 孔跟界面上写的对不上。
   *
   * 防抖是因为拖滑块会连着触发 —— 每拖一下就重算一遍,Worker 队列一直满。
   */
  useEffect(() => {
    if (!scaledPositions) return;
    // 尺寸变了 ⇒ 之前那个孔作废(它是按旧尺寸切的)
    setCutResult(null);
    setBlenderResult(null);
    // 本地 Blender 那条路**不跑浏览器的分析** ——
    // ① 浏览器那套分析(修完还是修不好的模型)会失败,而本地 Blender 正是
    //   为了切这种模型
    // ② 插件自己挑面(最大的平面),浏览器的候选面表格用不着
    if (engine === "blender") return;
    const timer = setTimeout(() => {
      void runAnalyze(scaledPositions);
    }, RECALC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `holeParams` 不必单列 —— `runAnalyze` 的依赖里就有它,它一变
    // `runAnalyze` 的身份就变,这个 effect 照样会重跑(等价,少一个依赖)。
  }, [scaledPositions, runAnalyze, engine]);

  /* ------------------------------------------------------------------ */
  /*  切割                                                                */
  /* ------------------------------------------------------------------ */

  /** 当前选中的那个面(轴向面或候选平面)—— 用来判「能不能切」 */
  const selectedReport: MagnetFaceReport | MagnetPatchReport | null =
    useMemo(() => {
      if (!analysis) return null;
      if (target === MAGNET_TARGET_AUTO) return analysis.backFace;
      const idx = parsePatchTarget(target);
      if (idx !== null) return analysis.patches[idx] ?? null;
      return analysis.faces.find((f) => f.faceId === target) ?? null;
    }, [analysis, target]);

  const canCut =
    Boolean(scaledPositions) &&
    (engine === "blender" ||
      (selectedReport?.verdict === "ok" && !analyzing)) &&
    !cutting;

  /* ------------------------------------------------------------------ */
  /*  本地 Blender 那条路                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * 换引擎 —— **两边的结果都清掉**
   *
   * 不清的话:浏览器切的那个孔还摆在视口里,用户以为本地 Blender 也切了。
   */
  const switchEngine = useCallback((next: MagnetEngine) => {
    setEngine(next);
    setCutResult(null);
    setBlenderResult(null);
    revokeModelTextureUrls(blenderModelRef.current);
    blenderModelRef.current = null;
    setError(null);
  }, []);

  /**
   * 探一下本地 Blender 在不在
   *
   * **探活不是「能不能用本地那条路」的判据** —— 用户没装插件很正常,
   * 界面要能一边探一边说人话,不能因此把「浏览器那条路」也堵上。
   */
  const checkBlender = useCallback(async () => {
    setBlenderPing({ status: "checking" });
    try {
      const result = await pingLocalBlender({ port: blenderPortText });
      setBlenderPing({ status: "online", version: result.blender });
    } catch (err) {
      console.warn("[Magnet] 连不上本地 Blender", err);
      setBlenderPing({
        status: "offline",
        detail: err instanceof Error ? err.message : undefined,
      });
    }
  }, [blenderPortText]);

  /**
   * 让**用户本机的 Blender**切一刀
   *
   * 发过去的是**已经按打印尺寸缩放好的**几何 —— 浏览器缩的,跟视口里
   * 看到的是同一份。「看到的」跟「切的」一致,两个引擎对尺寸的判断才不会
   * 打架(工作室拿到的孔径得跟页面上一模一样)。
   *
   * 送过去的包 = OBJ + MTL + 纹理(跟导给用户的那份一样)—— 插件那边要靠
   * MTL 认材质,纹理也要跟着走,切完导回来才带得回去。
   */
  const cutWithBlender = useCallback(async (): Promise<BlenderCutOutcome> => {
    if (!scaledPositions) {
      throw new Error("没有模型");
    }
    const uvs = model?.parseResult.uvs ?? null;
    const materialIndex = model?.parseResult.materialIndex ?? null;
    const materialNames = model?.parseResult.materialNames ?? null;
    const mtlText = model?.mtlText;
    const hasMaterials =
      Boolean(mtlText) && Boolean(materialNames && materialNames.length > 0);

    const objText = writeObjFromSoup(scaledPositions, {
      header: [
        "Mooncoda magnet pocket cutter (local Blender)",
        `hole_dia_mm=${holeParams.holeDiaMm}`,
        `depth_mm=${holeParams.holeDepthMm}`,
        `target_max_edge_mm=${targetMaxEdgeMm.toFixed(2)}`,
      ],
      uvs,
      materialIndex,
      materialNames: hasMaterials ? materialNames : null,
      mtlFileName: hasMaterials ? CUT_MTL_NAME : null,
    });

    const zip = await buildModelZipBlob(
      objText,
      hasMaterials ? mtlText : undefined,
      model?.textureBlobs,
      CUT_OBJ_NAME,
      hasMaterials ? CUT_MTL_NAME : undefined
    );

    const result = await cutWithLocalBlender({
      port: blenderPortText,
      zip,
      hole: holeParams,
    });

    // 解开它导回来的 zip —— 视口要预览切完的那份
    const file = new File([result.blob], CUT_ZIP_NAME);
    const extracted = await extractModelZip(file);

    return { blob: result.blob, stats: result.stats, model: extracted.model };
  }, [scaledPositions, model, holeParams, targetMaxEdgeMm, blenderPortText]);

  const handleCut = useCallback(async () => {
    if (!scaledPositions) return;
    setCutting(true);
    setError(null);
    try {
      if (engine === "blender") {
        const outcome = await cutWithBlender();
        // 换模型的时候要把上一个的贴图 URL 收掉
        revokeModelTextureUrls(blenderModelRef.current);
        blenderModelRef.current = outcome.model;
        setBlenderResult(outcome);
        setCutResult(null);
      } else {
        if (!client) return;
        const result = await client.cut(
          scaledPositions,
          target,
          holeParams,
          sourceTexture
        );
        setCutResult(result);
        setBlenderResult(null);
      }
      // 切完几何变了 —— 相机重新取景,不然孔可能落在画面外
      setFitSignal((v) => v + 1);
    } catch (err) {
      console.error("[Magnet] 切割失败", err);
      setCutResult(null);
      setBlenderResult(null);
      setError(describeError(err, t));
    } finally {
      setCutting(false);
    }
  }, [
    client,
    scaledPositions,
    target,
    holeParams,
    sourceTexture,
    engine,
    cutWithBlender,
    t,
  ]);

  /* ------------------------------------------------------------------ */
  /*  下载                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * 下载切好的模型
   *
   * **带材质贴图的导 ZIP**(OBJ + MTL + 纹理),没材质的导纯 OBJ。
   *
   * MTL 直接**沿用原模型的那份** —— 材质名、`map_Kd` 引用全都不变,切出来
   * 的 UV 直接对得上原贴图。纹理按 basename 平铺到 zip 根目录,MTL 里的
   * 引用同步改写(`buildModelZipBlob` 干的)。
   */
  const handleDownload = useCallback(async () => {
    // 本地 Blender 切完的那份 —— **直接下载它导回来的那个 zip**
    // (材质、纹理、MTL 都是它那边的原件,不该再过一遍我们的导出)
    if (blenderResult?.blob) {
      downloadBlob(blenderResult.blob, CUT_ZIP_NAME);
      return;
    }

    const positions = cutResult?.positions ?? scaledPositions;
    if (!positions) return;

    const uvs = cutResult ? cutResult.uvs : (model?.parseResult.uvs ?? null);
    const materialIndex = cutResult
      ? cutResult.materialIndex
      : (model?.parseResult.materialIndex ?? null);
    const materialNames = cutResult
      ? cutResult.materialNames
      : (model?.parseResult.materialNames ?? null);
    const mtlText = model?.mtlText;
    const hasMaterials =
      Boolean(mtlText) && Boolean(materialNames && materialNames.length > 0);

    const objText = writeObjFromSoup(positions, {
      header: [
        "Mooncoda magnet pocket cutter",
        `hole_dia_mm=${holeParams.holeDiaMm}`,
        `depth_mm=${holeParams.holeDepthMm}`,
        `target=${target}`,
        `target_max_edge_mm=${targetMaxEdgeMm.toFixed(2)}`,
      ],
      uvs,
      materialIndex,
      materialNames: hasMaterials ? materialNames : null,
      mtlFileName: hasMaterials ? CUT_MTL_NAME : null,
    });

    if (hasMaterials) {
      await downloadModelZip(
        objText,
        mtlText,
        model?.textureBlobs,
        cutResult ? CUT_OBJ_NAME : ORIGINAL_OBJ_NAME,
        CUT_MTL_NAME,
        cutResult ? CUT_ZIP_NAME : ORIGINAL_ZIP_NAME
      );
      return;
    }

    const blob = new Blob([objText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = cutResult ? CUT_OBJ_NAME : ORIGINAL_OBJ_NAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [
    cutResult,
    blenderResult,
    scaledPositions,
    model,
    holeParams,
    target,
    targetMaxEdgeMm,
  ]);

  /* ------------------------------------------------------------------ */
  /*  渲染                                                                */
  /* ------------------------------------------------------------------ */

  /** 视口里画的那份几何 —— 切完之前是原模型,切完是带孔的那份 */
  const displayPositions =
    blenderResult?.model?.parseResult.positions ??
    cutResult?.positions ??
    scaledPositions;

  /**
   * 视口的贴图信息
   *
   * 切完的 UV / 材质分组是**布尔运算带回来的** —— 视口直接吃,不用再算一遍。
   */
  const viewportTextures: MeshTextureInfo | null = useMemo(() => {
    // 本地 Blender 切完的那份 —— 贴图是它导回来的
    if (blenderResult?.model) {
      const src = blenderResult.model;
      const uvs = src.parseResult.uvs ?? null;
      const materialIndex = src.parseResult.materialIndex ?? null;
      const materialNames = src.parseResult.materialNames ?? null;
      if (!uvs && !materialIndex) return null;
      return {
        uvs,
        materialNames: materialNames ?? [],
        materialIndex,
        mtlText: src.mtlText ?? null,
        textureUrls: src.textureUrls ?? null,
      };
    }
    if (!model) return null;
    const uvs = cutResult ? cutResult.uvs : (model.parseResult.uvs ?? null);
    const materialIndex = cutResult
      ? cutResult.materialIndex
      : (model.parseResult.materialIndex ?? null);
    const materialNames = cutResult
      ? cutResult.materialNames
      : (model.parseResult.materialNames ?? null);
    if (!uvs && !materialIndex) return null;
    return {
      uvs: uvs ?? null,
      materialNames: materialNames ?? [],
      materialIndex: materialIndex ?? null,
      mtlText: model.mtlText ?? null,
      textureUrls: model.textureUrls ?? null,
    };
  }, [model, cutResult, blenderResult]);

  const hasTexture = Boolean(
    model?.textureBlobs && model.textureBlobs.length > 0
  );

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
                {/* ---- 切割引擎(浏览器内 / 本地 Blender)---- */}
                <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                    <Cpu className="size-3.5 text-zinc-400" />
                    {t("engine.title")}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => switchEngine("browser")}
                      className={`rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                        engine === "browser"
                          ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                          : "border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {t("engine.browser")}
                    </button>
                    <button
                      type="button"
                      onClick={() => switchEngine("blender")}
                      className={`rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                        engine === "blender"
                          ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                          : "border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {t("engine.blender")}
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                    {engine === "blender"
                      ? t("engine.blenderHint")
                      : t("engine.browserHint")}
                  </p>

                  {engine === "blender" && (
                    <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                      {/* ---- 端口 + 探活 ---- */}
                      <div className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <label
                            htmlFor="magnet-blender-port"
                            className="mb-1 block text-[11px] text-zinc-400"
                          >
                            {t("engine.portLabel")}
                          </label>
                          <input
                            id="magnet-blender-port"
                            type="number"
                            inputMode="numeric"
                            value={blenderPortText}
                            onChange={(e) => setBlenderPortText(e.target.value)}
                            onBlur={() =>
                              setBlenderPortText(
                                String(normalizeBlenderPort(blenderPortText))
                              )
                            }
                            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void checkBlender()}
                          disabled={blenderPing.status === "checking"}
                          className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-300 transition-colors hover:text-zinc-100 disabled:opacity-50"
                        >
                          {blenderPing.status === "checking" ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Plug className="size-3" />
                          )}
                          {blenderPing.status === "checking"
                            ? t("engine.checking")
                            : t("engine.check")}
                        </button>
                      </div>

                      {blenderPing.status === "online" && (
                        <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                          <span className="size-1.5 rounded-full bg-emerald-400" />
                          {t("engine.online", { version: blenderPing.version })}
                        </p>
                      )}
                      {blenderPing.status === "offline" && (
                        <p className="text-[11px] leading-relaxed text-amber-300/90">
                          {t("engine.offline")}
                        </p>
                      )}

                      {/* ---- 指引:下便携版 Blender + 插件 ---- */}
                      <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
                        <a
                          href={MAGNET_BLENDER_PORTABLE_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] font-medium text-amber-300 underline underline-offset-2 hover:text-amber-200"
                        >
                          <ExternalLink className="size-3" />
                          {t("engine.downloadBlender")}
                        </a>
                        <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                          {t("engine.downloadBlenderHint")}
                        </p>
                        <a
                          href={MAGNET_BLENDER_ADDON_URL}
                          download
                          className="mt-2 flex items-center gap-1 text-[11px] font-medium text-amber-300 underline underline-offset-2 hover:text-amber-200"
                        >
                          <Download className="size-3" />
                          {t("engine.addon")}
                        </a>
                        <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                          {t("engine.addonHint")}
                        </p>
                      </div>
                    </div>
                  )}
                </section>

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
                        applyTargetMaxEdge(unitCheck.originalMaxExtent);
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
                        inputMode="decimal"
                        min={MIN_TARGET_MM}
                        max={MAX_TARGET_MM}
                        step={1}
                        value={targetMaxEdgeText}
                        onChange={(e) => {
                          const text = e.target.value;
                          setSizeMode("custom");
                          // **先存字,别急着夹** —— 受控的 number 输入每敲一个键
                          // 就夹一次的话,「150」会先变成「1」再变成「15」。
                          setTargetMaxEdgeText(text);
                          const v = Number(text);
                          // 敲到一半(空 / 非法)先不动几何 —— 免得模型在眼前乱跳
                          if (
                            text.trim() !== "" &&
                            Number.isFinite(v) &&
                            v > 0
                          ) {
                            setTargetMaxEdgeMm(v);
                          }
                        }}
                        onBlur={() => {
                          // 失焦才归一化 —— 范围、类型都对上了才落定
                          const v = Number(targetMaxEdgeText);
                          applyTargetMaxEdge(
                            Number.isFinite(v) ? v : MIN_TARGET_MM
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
                            applyTargetMaxEdge(unitCheck.assumedMaxExtentMm);
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

                {/* ---- 孔参数(可调) ---- */}
                <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                    <CircleDot className="size-3.5 text-zinc-400" />
                    {t("hole.title")}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      id="magnet-hole-dia"
                      label={t("hole.diaLabel")}
                      value={holeDiaText}
                      min={MAGNET_HOLE_DIA_MIN_MM}
                      max={MAGNET_HOLE_DIA_MAX_MM}
                      step={0.1}
                      onChange={setHoleDiaText}
                    />
                    <NumberField
                      id="magnet-hole-depth"
                      label={t("hole.depthLabel")}
                      value={holeDepthText}
                      min={MAGNET_HOLE_DEPTH_MIN_MM}
                      max={MAGNET_HOLE_DEPTH_MAX_MM}
                      step={0.1}
                      onChange={setHoleDepthText}
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setHoleDiaText(String(MAGNET_HOLE_DIA_MM));
                        setHoleDepthText(String(MAGNET_HOLE_DEPTH_MM));
                      }}
                      className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-200"
                    >
                      <RotateCcw className="size-3" />
                      {t("hole.reset")}
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                    {t("hole.hint")}
                  </p>
                </section>

                {/* ---- 自动修复的告知(模型不是封闭实体时)---- */}
                {analysis?.repair?.changed && (
                  <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <h3 className="mb-1 flex items-center gap-1.5 text-xs font-bold text-amber-200">
                      <Wrench className="size-3.5 text-amber-400" />
                      {t("repair.title")}
                    </h3>
                    <p className="text-[11px] leading-relaxed text-amber-100/80">
                      {t("repair.detail", {
                        holes: analysis.repair.filledLoops,
                        dropped:
                          analysis.repair.droppedDegenerate +
                          analysis.repair.droppedDuplicate +
                          analysis.repair.droppedNonManifold,
                        flipped: analysis.repair.flippedFaces,
                        split: analysis.repair.splitVertices,
                      })}
                    </p>
                  </section>
                )}

                {/* ---- 智能识别背面(本地 Blender 那条路不用)---- */}
                {model && engine === "browser" && (
                  <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                      <Layers className="size-3.5 text-zinc-400" />
                      {t("back.title")}
                    </h3>
                    {analyzing && !analysis && (
                      <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                        <Loader2 className="size-3 animate-spin" />
                        {t("faces.analyzing")}
                      </p>
                    )}
                    {analysis && analysis.patches.length === 0 && (
                      <p className="text-[11px] leading-relaxed text-zinc-500">
                        {t("back.none")}
                      </p>
                    )}
                    {analysis && analysis.patches.length > 0 && (
                      <div className="overflow-hidden rounded-md border border-zinc-800">
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-zinc-900 text-zinc-500">
                            <tr>
                              <th className="px-2 py-1.5 font-medium">
                                {t("back.col.area")}
                              </th>
                              <th className="px-2 py-1.5 font-medium">
                                {t("back.col.flatness")}
                              </th>
                              <th className="px-2 py-1.5 font-medium">
                                {t("back.col.thickness")}
                              </th>
                              <th className="px-2 py-1.5 font-medium">
                                {t("back.col.verdict")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {analysis.patches.map((patch, index) => {
                              const id = patchTargetId(index);
                              const active =
                                target === id ||
                                (index === 0 && target === MAGNET_TARGET_AUTO);
                              return (
                                <tr
                                  key={id}
                                  onClick={() => setTarget(id)}
                                  className={`cursor-pointer border-t border-zinc-800/80 transition-colors ${
                                    active
                                      ? "bg-amber-500/15 text-amber-200"
                                      : "text-zinc-400 hover:bg-zinc-800/60"
                                  }`}
                                >
                                  <td className="px-2 py-1.5 font-mono">
                                    {index === 0 ? t("back.auto") : `#${index}`}
                                    <span className="ml-1 text-zinc-500">
                                      {patch.areaMm2.toFixed(0)}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5 font-mono">
                                    {patch.meanDeviationDeg.toFixed(1)}°
                                  </td>
                                  <td className="px-2 py-1.5 font-mono">
                                    {patch.thicknessMm == null
                                      ? "—"
                                      : `${patch.thicknessMm.toFixed(1)}`}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    {t(`faces.verdict.${patch.verdict}`)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {analysis && analysis.patches.length > 0 && (
                      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                        {t("back.hint")}
                      </p>
                    )}
                  </section>
                )}

                {/* ---- 六个面(本地 Blender 那条路不用)---- */}
                {model && engine === "browser" && (
                  <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                      <Ruler className="size-3.5 text-zinc-400" />
                      {t("faces.title")}
                    </h3>
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
                              const active = face.faceId === target;
                              return (
                                <tr
                                  key={id}
                                  onClick={() => setTarget(id)}
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

                {/* ---- 本地 Blender:它自己挑面,不用候选面表格 ---- */}
                {model && engine === "blender" && (
                  <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <p className="text-[11px] leading-relaxed text-zinc-400">
                      {t("engine.faceNote")}
                    </p>
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

                {/* ---- 切割结果(本地 Blender)---- */}
                {blenderResult && (
                  <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
                    <h3 className="mb-2 text-xs font-bold text-emerald-200">
                      {t("cut.done")}
                    </h3>
                    <dl className="space-y-1 text-[11px] text-emerald-100/80">
                      {blenderResult.stats.removedVolumeMm3 != null && (
                        <Row
                          label={t("cut.removed")}
                          value={`${blenderResult.stats.removedVolumeMm3.toFixed(1)} mm³`}
                        />
                      )}
                      {blenderResult.stats.expectedRemovedVolumeMm3 != null && (
                        <Row
                          label={t("cut.expected")}
                          value={`${blenderResult.stats.expectedRemovedVolumeMm3.toFixed(1)} mm³`}
                        />
                      )}
                      {blenderResult.stats.volumeBeforeMm3 != null &&
                        blenderResult.stats.volumeAfterMm3 != null && (
                          <Row
                            label={t("cut.volume")}
                            value={`${blenderResult.stats.volumeBeforeMm3.toFixed(1)} → ${blenderResult.stats.volumeAfterMm3.toFixed(1)} mm³`}
                          />
                        )}
                      {blenderResult.stats.triangleCount != null && (
                        <Row
                          label={t("cut.tris")}
                          value={String(blenderResult.stats.triangleCount)}
                        />
                      )}
                      {blenderResult.stats.solver && (
                        <Row
                          label={t("engine.solver")}
                          value={blenderResult.stats.solver}
                        />
                      )}
                    </dl>
                    {blenderResult.stats.warnings.length > 0 && (
                      <div className="mt-2 border-t border-emerald-500/20 pt-2">
                        <p className="text-[11px] font-medium text-emerald-200">
                          {t("engine.warnings")}
                        </p>
                        <ul className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-emerald-100/70">
                          {blenderResult.stats.warnings.map((warning) => (
                            <li key={warning}>· {warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="mt-2 text-[11px] leading-relaxed text-emerald-200/70">
                      {t("engine.resultNote")}
                    </p>
                  </section>
                )}

                {/* ---- 报错 ---- */}
                {error && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
                    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-red-300">
                      <AlertCircle className="mt-px size-3.5 shrink-0" />
                      {error.headline}
                    </p>
                    {error.detail ? (
                      <p className="mt-1.5 break-words border-t border-red-500/20 pt-1.5 font-mono text-[10px] leading-relaxed text-red-300/70">
                        {error.detail}
                      </p>
                    ) : null}
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
                  onClick={() => void handleDownload()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:text-zinc-600"
                >
                  <Download className="size-3.5" />
                  {cutResult || blenderResult
                    ? t("download.cut")
                    : t("download.original")}
                </button>
                <p className="text-center text-[10px] leading-relaxed text-zinc-600">
                  {hasTexture
                    ? t("download.withTexture")
                    : t("download.solidColor")}
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
                <div className="flex items-center gap-2">
                  {hasTexture && (
                    <button
                      type="button"
                      onClick={() => setShowTexture((v) => !v)}
                      className="flex items-center gap-1 rounded border border-zinc-700 bg-white/10 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-white/20"
                    >
                      <Layers className="size-3" />
                      {t("viewport.texture")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setFitSignal((v) => v + 1)}
                    className="flex items-center gap-1 rounded border border-zinc-700 bg-white/10 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-white/20"
                  >
                    <RotateCcw className="size-3" />
                    {t("viewport.reset")}
                  </button>
                </div>
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
                  /* 贴图跟材质分组 —— 布尔运算带回来的 */
                  textures={viewportTextures}
                  showTexture={showTexture}
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

/**
 * 一个数字输入框
 *
 * **输入框存的是字符串** —— 受控的 `type="number"` 每敲一个键就夹一次值,
 * 输「0.5」会变成「0.3」再变成「0.35」,根本没法输。字符串 + 失焦时
 * 归一化才靠谱。
 */
function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] text-zinc-400">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            const n = Number(value);
            const clamped = Number.isFinite(n)
              ? Math.min(max, Math.max(min, n))
              : min;
            onChange(String(clamped));
          }}
          className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
        />
        <span className="shrink-0 text-[11px] text-zinc-500">mm</span>
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
 * 探活的结果
 *
 * `offline` **不是错误状态** —— 用户没装插件很正常,界面要能一边探一边
 * 说人话,不能因此把「浏览器那条路」也堵上。
 */
type BlenderPingState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "online"; version: string }
  | { status: "offline"; detail?: string | undefined };

/** 本地 Blender 切完的结果 */
type BlenderCutOutcome = {
  /** 它导回来的 zip(下载时直接用它) */
  blob: Blob;
  /** 它报回来的数 */
  stats: BlenderCutStats;
  /** 解开 zip 解析出来的模型 —— 给视口预览用 */
  model: ModelFile | null;
};

/** 下载一个 blob —— 建 object URL → 点一下 → 收回 */
function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 一次失败的**两段话**
 *
 * - `headline` —— 一句人话,给用户看
 * - `detail` —— 引擎返回的原始信息,给工作室看
 *
 * 以前只有 headline,**原始信息全被丢掉**了 —— 工作室看到的只有一句
 * 「切割过程出了意外(不是模型的问题)」,什么线索都没有,连「是超时了还是
 * 崩了了」都分不出来。2026-11-11 起把原始信息摆出来。
 */
type MagnetErrorReport = {
  headline: string;
  detail?: string | undefined;
};

/**
 * 把一次失败变成**一段用户看得懂的话 + 一行原始信息**
 *
 * 切割的失败都带稳定的 code —— 认得就摆具体的,认不出才退回笼统那句。
 * 映射表在 `features/magnet/lib/magnet-error.ts`(纯文件,有单测守着)。
 *
 * ⚠️ **原始信息不能丢** —— code 只说「哪一类」,原始信息才说「哪一步、
 * 什么原因」。两个都摆出来,工作室才查得动。
 */
function describeError(
  err: unknown,
  t: (key: string) => string
): MagnetErrorReport {
  const key = magnetErrorMessageKey(err);
  // 本地 Blender 那边带回来的详情比 message 更有用 —— message 是我们自己
  // 写的通用句,detail 才是插件说的真原因(「面太薄 1.2mm,切 1.3mm 会捅穿」)
  const detail =
    err instanceof BlenderLocalError
      ? (err.detail ?? (err.message ? err.message : undefined))
      : err instanceof Error && err.message
        ? err.message
        : undefined;
  if (key) {
    return { headline: t(key), detail };
  }
  if (err instanceof MagnetClientError) {
    return { headline: err.message, detail: undefined };
  }
  return { headline: t("errors.generic"), detail };
}

/** 毫米数 → 输入框里显示的字(最多两位小数,别拖一堆 0) */
function formatMm(mm: number): string {
  return String(Math.round(mm * 100) / 100);
}
