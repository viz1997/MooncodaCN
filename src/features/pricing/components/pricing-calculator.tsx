"use client";

import {
  AlertCircle,
  Beaker,
  Box,
  Calculator,
  Compass,
  Download,
  FileArchive,
  ListChecks,
  Pencil,
  RotateCcw,
  Scale,
  UploadCloud,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
/**
 * 移植自 wjp-source-code/src/app/page.tsx —— 3D 打印克重计算器主组件。
 *
 * ## 边界
 *
 * **只算不存**：所有解析 / 摆盘 / 克重计算都在浏览器本地完成，模型文件不上传服务器，
 * 计算结果不写数据库。唯一的网络请求是「材料参数是否需要密码」（见
 * `/api/image-gen/pricing/materials-auth`），且只传密码字符串。
 *
 * **只展示克重**：页面对外只呈现体积 / 表面积 / 本体克重 / 支撑克重 / 摆盘角度，
 * 不呈现任何价格。计价相关状态（`unitPrice` 等）仍保留在底层 `pricing-engine.ts`
 * 里 —— `calculatePrice()` 是克重的唯一来源，`unitPrice` 非法会让它返回 null，
 * 连克重一起消失，所以这些 state 绝不删，只是不再渲染。
 *
 * ## 与源实现的差异
 *
 *  - 「模型设置」从弹窗改成**页面内的一张卡**（`ModelSettingsPanel`，见该文件
 *    说明）：结果卡与模型设置卡合并成同一张 —— 头部是文件身份 + 几何标签，
 *    左栏 3D 预览，右栏克重 + 摆盘结果 + 尺寸调节；
 *  - 材料参数密码校验改为服务端环境变量（源实现把哈希硬编码在客户端）；
 *  - 文案全部改为 t() 调用（i18n）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BatchModeSection } from "@/features/pricing/components/batch-mode-section";
import {
  type DimMode,
  type LoadStatus,
  type ModelGeometry,
  ModelSettingsPanel,
} from "@/features/pricing/components/model-settings-panel";
import { ObjThumbnail } from "@/features/pricing/components/obj-thumbnail";
import {
  type InfoDialogKind,
  PricingInfoDialogs,
} from "@/features/pricing/components/pricing-info-dialogs";
import {
  DimInput,
  fmt,
  PRODUCT_TYPES,
  SOLID_PRESETS,
  scaleGeometryXYZ,
} from "@/features/pricing/components/shared";
import {
  SupportCalibration,
  type SupportParams,
} from "@/features/pricing/components/support-calibration";
import {
  computeSupportAtAngle,
  findOptimalAngle,
  type OptimalAngle,
} from "@/features/pricing/lib/angle-optimizer";
import {
  type BatchItem,
  type BatchOptions,
  initBatch,
  processBatch,
} from "@/features/pricing/lib/batch-processor";
import {
  downloadModelZip,
  downloadObjFile,
  exportRotatedObj,
} from "@/features/pricing/lib/obj-exporter";
import { parseObjInWorker } from "@/features/pricing/lib/obj-worker-client";
import {
  calculatePrice,
  DEFAULT_CONFIG,
  estimateEnvelopeGeometry,
  type PricingConfig,
  type PricingInput,
  type RepairMode,
} from "@/features/pricing/lib/pricing-engine";
import {
  extractModelZip,
  type ModelFile,
} from "@/features/pricing/lib/zip-extractor";

type Mode = "upload" | "manual" | "batch";

const yieldToUI = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export function PricingCalculator({
  showChrome = true,
}: {
  /**
   * 是否渲染工具自带的页头 / 页脚。
   *
   * true  —— 独立成页（源项目的形态），自带 header + footer。
   * false —— 挂在站点自己的 layout 里（公开页 `/pricing`）：页头 / 页脚 /
   *         标题块 / 工具按钮一律不渲染，避免双 Header 双 Footer 和页面里
   *         重复出现一遍标题。
   */
  showChrome?: boolean;
}) {
  const t = useTranslations("MaterialPricing");

  const [mode, setMode] = useState<Mode>("upload");
  const [infoDialog, setInfoDialog] = useState<InfoDialogKind>(null);

  // ---- 模型 ----
  const [model, setModel] = useState<ModelFile | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [loadProgress, setLoadProgress] = useState("");
  const [loadPercent, setLoadPercent] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** 正在解析的文件名 —— 解析完成前 `model` 还是 null，头部要靠它显示文件名 */
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // ---- 手动模式尺寸 ----
  const [length, setLength] = useState(68.3);
  const [width, setWidth] = useState(80);
  const [height, setHeight] = useState(43.6);

  // ---- 尺寸调节（页面内直接改，改完即生效）----
  const [dimMode, setDimMode] = useState<DimMode>("original");
  const [uniformScale, setUniformScale] = useState(true);
  const [scaleFactor, setScaleFactor] = useState(1);
  const [scaleX, setScaleX] = useState(1);
  const [scaleY, setScaleY] = useState(1);
  const [scaleZ, setScaleZ] = useState(1);

  // ---- 计算参数 ----
  const [solidRatio, setSolidRatio] = useState(30);
  const [coverage, setCoverage] = useState(50);
  const [repairMode, setRepairMode] = useState<RepairMode>("none");
  const [repairPrice, setRepairPrice] = useState(0);
  const repairEnabled = repairMode !== "none";
  const [materialDensity, setMaterialDensity] = useState(
    DEFAULT_CONFIG.materialDensity
  );
  // ↓↓↓ 价格相关 state：UI 不再展示，但**绝不能删** ↓↓↓
  // `calculatePrice()` 是 `materialWeight`（克重）的唯一来源，它在
  // `unitPrice` 非法时返回 null —— 一旦 null，整个克重界面连同体积一起消失。
  // 所以这些值保持合法且恒为默认，只是不渲染。
  const [unitPrice, setUnitPrice] = useState(DEFAULT_CONFIG.unitPrice);
  const [varnishEnabled, setVarnishEnabled] = useState(true);
  const varnishFee = DEFAULT_CONFIG.varnishFee;
  const [supportPrice, setSupportPrice] = useState(DEFAULT_CONFIG.supportPrice);
  const supportThreshold = DEFAULT_CONFIG.supportThreshold;
  const [supportEnabled, setSupportEnabled] = useState(false);
  const [productId, setProductId] = useState("pet");

  // ---- 支撑校准参数 ----
  const [supportParams, setSupportParams] = useState<SupportParams>({
    fillRate: 0.37,
    shellThickness: 1.0,
    density: 1.15,
  });
  const [realWeightInput, setRealWeightInput] = useState("");

  // ---- 智能摆盘 ----
  const [optimalAngle, setOptimalAngle] = useState<OptimalAngle | null>(null);
  const [angleOptimizing, setAngleOptimizing] = useState(false);
  const [angleProgress, setAngleProgress] = useState(0);
  const [showSupport, setShowSupport] = useState(true);
  const [viewerRotX, setViewerRotX] = useState(0);
  const [viewerRotY, setViewerRotY] = useState(0);
  const [viewerRotZ, setViewerRotZ] = useState(0);
  const [manualRotX, setManualRotX] = useState(0);
  const [manualRotY, setManualRotY] = useState(0);
  const [manualRotZ, setManualRotZ] = useState(0);
  const positionsRef = useRef<Float32Array | null>(null);

  // ---- 批量 ----
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchConcurrency, setBatchConcurrency] = useState(4);
  const [batchApplyAngle, setBatchApplyAngle] = useState(true);
  const batchFileInputRef = useRef<HTMLInputElement>(null);
  const batchAbortRef = useRef<AbortController | null>(null);

  const pricingConfig: PricingConfig = useMemo(
    () => ({
      ...DEFAULT_CONFIG,
      materialDensity,
      unitPrice,
      varnishFee,
      varnishEnabled,
      repairMode,
      productId,
      supportPrice,
      supportThreshold,
      supportEnabled,
    }),
    [
      materialDensity,
      unitPrice,
      varnishFee,
      varnishEnabled,
      repairMode,
      productId,
      supportPrice,
      supportThreshold,
      supportEnabled,
    ]
  );

  /** 当前已应用的缩放因子（XYZ） */
  const appliedScales = useMemo((): [number, number, number] => {
    if (dimMode !== "custom") return [1, 1, 1];
    if (uniformScale) return [scaleFactor, scaleFactor, scaleFactor];
    return [scaleX, scaleY, scaleZ];
  }, [dimMode, uniformScale, scaleFactor, scaleX, scaleY, scaleZ]);

  const geometry = useMemo((): ModelGeometry | null => {
    if (mode === "upload") {
      if (!model) return null;
      const r = model.parseResult;
      // 坐标系约定：X=长, Y=宽, Z=高（与 OBJ 原始坐标一致）
      const origDims: [number, number, number] = [
        r.boundingBox.size.x,
        r.boundingBox.size.y,
        r.boundingBox.size.z,
      ];
      const [sx, sy, sz] = appliedScales;
      const scaled = scaleGeometryXYZ(
        r.volumeCM3,
        r.surfaceAreaCM2,
        origDims,
        sx,
        sy,
        sz
      );
      return {
        volumeCM3: scaled.volumeCM3,
        surfaceAreaCM2: scaled.surfaceAreaCM2,
        dims: scaled.dims,
        originalDims: origDims,
      };
    }
    const env = estimateEnvelopeGeometry(length, width, height, solidRatio);
    return {
      volumeCM3: env.volumeCM3,
      surfaceAreaCM2: env.surfaceAreaCM2,
      dims: env.dims,
      originalDims: [length, width, height] as [number, number, number],
    };
  }, [mode, model, length, width, height, solidRatio, appliedScales]);

  const calc = useMemo(() => {
    if (!geometry) return null;
    const input: PricingInput = {
      volumeCM3: geometry.volumeCM3,
      surfaceAreaCM2: geometry.surfaceAreaCM2,
      mode: mode === "batch" ? "upload" : mode,
      solidRatio,
      dims: geometry.dims,
      supportWeight: supportEnabled
        ? Math.ceil(optimalAngle?.totalSupportWeight ?? 0)
        : 0,
      selfSupportRatio: supportEnabled
        ? (optimalAngle?.selfSupportRatio ?? 0)
        : 0,
    };
    const result = calculatePrice(pricingConfig, input);
    if (!result) return null;
    const fee = repairEnabled ? repairPrice : 0;
    return {
      ...result,
      repairFee: fee,
      totalPrice: result.totalPrice + fee,
      coveredArea: geometry.surfaceAreaCM2 * (coverage / 100),
    };
  }, [
    geometry,
    pricingConfig,
    mode,
    solidRatio,
    coverage,
    repairEnabled,
    repairPrice,
    optimalAngle,
    supportEnabled,
  ]);

  // ---- 文件上传 ----
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setFileName(file.name);
    setLoadPercent(0);
    setDimMode("original");
    setScaleFactor(1);
    setUniformScale(true);
    setScaleX(1);
    setScaleY(1);
    setScaleZ(1);
    setOptimalAngle(null);
    setViewerRotX(0);
    setViewerRotY(0);
    setViewerRotZ(0);
    setManualRotX(0);
    setManualRotY(0);
    setManualRotZ(0);
    positionsRef.current = null;
    setLoadStatus("uploading");
    setLoadProgress(t("upload.reading"));
    await yieldToUI();
    try {
      setLoadStatus("parsing");
      setLoadProgress(t("upload.parsing"));
      setLoadPercent(10);
      await yieldToUI();
      const result = await extractModelZip(file, (p) => {
        setLoadProgress(
          p.phase === "unzip"
            ? t("upload.extracting")
            : `${t("upload.parsingProgress")} ${p.percent}%`
        );
        setLoadPercent(p.percent);
      });
      if (result.error) {
        setUploadError(result.error);
        setModel(null);
        setLoadStatus("error");
        setLoadProgress("");
        setLoadPercent(0);
      } else if (result.model) {
        if (model?.previewUrl) URL.revokeObjectURL(model.previewUrl);
        setModel(result.model);
        setLoadStatus("loading-3d");
        setLoadProgress(t("upload.rendering"));
        setLoadPercent(95);
      }
    } catch (err) {
      setUploadError(
        `${t("upload.failed")}${err instanceof Error ? err.message : String(err)}`
      );
      setLoadStatus("error");
      setLoadProgress("");
      setLoadPercent(0);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const clearModel = () => {
    if (model?.previewUrl) URL.revokeObjectURL(model.previewUrl);
    setModel(null);
    setUploadError(null);
    setFileName(null);
    setLoadStatus("idle");
    setLoadProgress("");
    setLoadPercent(0);
    setDimMode("original");
    setScaleFactor(1);
    setUniformScale(true);
    setScaleX(1);
    setScaleY(1);
    setScaleZ(1);
    setOptimalAngle(null);
    positionsRef.current = null;
  };

  const applyProduct = (id: string) => {
    const p = PRODUCT_TYPES.find((x) => x.id === id);
    if (!p) return;
    setProductId(p.id);
    setSolidRatio(p.solidRatio);
    setCoverage(p.coverage);
  };

  // ---- 智能摆盘 ----
  const optimizeAngle = async (pendingScales: [number, number, number]) => {
    if (!model) return;
    setAngleOptimizing(true);
    setAngleProgress(0);
    await yieldToUI();
    try {
      const outcome = await parseObjInWorker(model.objText, {
        sendGeometry: true,
        onProgress: (p) => setAngleProgress(Math.round(p.percent * 0.5)),
      });
      if (outcome.positions) {
        positionsRef.current = outcome.positions;
        await yieldToUI();
        const [sx, sy, sz] = pendingScales;
        const modelVolumeCM3 = model.parseResult.volumeCM3 * sx * sy * sz;
        const modelWeightG = modelVolumeCM3 * materialDensity;
        const avgK = Math.cbrt(sx * sy * sz);
        const result = findOptimalAngle(
          outcome.positions,
          model.parseResult.surfaceAreaMM2,
          (p) => setAngleProgress(50 + Math.round(p * 0.5)),
          50,
          modelWeightG,
          avgK,
          model.parseResult.volumeMM3,
          undefined,
          false,
          supportParams.fillRate,
          supportParams.shellThickness,
          supportParams.density
        );
        setOptimalAngle(result);
        setViewerRotX(result.rotX);
        setViewerRotY(result.rotY);
        setViewerRotZ(0);
        setManualRotX(result.rotX);
        setManualRotY(result.rotY);
        setManualRotZ(0);
      }
    } catch (err) {
      console.error("Angle optimization failed:", err);
    } finally {
      setAngleOptimizing(false);
    }
  };

  const resetAngle = () => {
    setOptimalAngle(null);
    setViewerRotX(0);
    setViewerRotY(0);
    setViewerRotZ(0);
    setManualRotX(0);
    setManualRotY(0);
    setManualRotZ(0);
  };

  /** 手动调整角度：实时重算支撑克重和本体支撑比例 */
  const handleManualAngleChange = (
    axis: "X" | "Y" | "Z",
    value: number,
    scales: [number, number, number]
  ) => {
    if (!model) return;
    if (axis === "X") {
      setManualRotX(value);
      setViewerRotX(value);
    } else if (axis === "Y") {
      setManualRotY(value);
      setViewerRotY(value);
    } else {
      setManualRotZ(value);
      setViewerRotZ(value);
    }
    if (positionsRef.current && optimalAngle) {
      const [sx, sy, sz] = scales;
      const modelVolumeCM3 = model.parseResult.volumeCM3 * sx * sy * sz;
      const modelWeightG = modelVolumeCM3 * materialDensity;
      const avgK = Math.cbrt(sx * sy * sz);
      const newRotX = axis === "X" ? value : manualRotX;
      const newRotY = axis === "Y" ? value : manualRotY;
      const newRotZ = axis === "Z" ? value : manualRotZ;
      const { supportWeight, supportRatio } = computeSupportAtAngle(
        positionsRef.current,
        newRotX,
        newRotY,
        modelWeightG,
        avgK,
        newRotZ,
        model.parseResult.volumeMM3,
        undefined,
        supportParams.fillRate,
        supportParams.shellThickness,
        supportParams.density
      );
      setOptimalAngle({
        ...optimalAngle,
        rotX: newRotX,
        rotY: newRotY,
        selfSupportRatio: supportRatio,
        totalSupportRatio: supportRatio,
        totalSupportWeight: supportWeight,
      });
    }
  };

  /** 支撑参数变化 → 立即重算当前角度的支撑克重 */
  const recomputeSupport = (
    params: SupportParams,
    scales: [number, number, number]
  ) => {
    setSupportParams(params);
    if (!positionsRef.current || !optimalAngle || !model) return;
    const [sx, sy, sz] = scales;
    const modelVolumeCM3 = model.parseResult.volumeCM3 * sx * sy * sz;
    const modelWeightG = modelVolumeCM3 * materialDensity;
    const avgK = Math.cbrt(sx * sy * sz);
    const { supportWeight, supportRatio } = computeSupportAtAngle(
      positionsRef.current,
      manualRotX,
      manualRotY,
      modelWeightG,
      avgK,
      manualRotZ,
      model.parseResult.volumeMM3,
      undefined,
      params.fillRate,
      params.shellThickness,
      params.density
    );
    setOptimalAngle((prev) =>
      prev
        ? {
            ...prev,
            totalSupportWeight: supportWeight,
            selfSupportRatio: supportRatio,
            totalSupportRatio: supportRatio,
          }
        : prev
    );
  };

  /** 一键校准：用实测支撑克重反算蜂窝填充率 */
  const calibrateFromMeasured = () => {
    const realG = parseFloat(realWeightInput);
    if (
      !Number.isFinite(realG) ||
      realG <= 0 ||
      !positionsRef.current ||
      !model ||
      !optimalAngle
    ) {
      return;
    }
    const [sx, sy, sz] = appliedScales;
    const mW = model.parseResult.volumeCM3 * sx * sy * sz * materialDensity;
    const ak = Math.cbrt(sx * sy * sz);
    // 先用 fillRate=1 计算最大理论克重
    const { supportWeight: maxW } = computeSupportAtAngle(
      positionsRef.current,
      manualRotX,
      manualRotY,
      mW,
      ak,
      manualRotZ,
      model.parseResult.volumeMM3,
      undefined,
      1.0,
      supportParams.shellThickness,
      supportParams.density
    );
    if (!(maxW > 0)) return;
    const newRate = Math.max(0.05, Math.min(0.95, realG / maxW));
    recomputeSupport({ ...supportParams, fillRate: newRate }, [sx, sy, sz]);
  };

  // ---- 导出 ----
  const exportRotatedModel = (scales: [number, number, number]) => {
    if (!model) return;
    const [sx, sy, sz] = scales;
    const useRotX = viewerRotX;
    const useRotY = viewerRotY;
    const useRotZ = viewerRotZ;
    const isUniform = sx === sy && sy === sz;
    const hasRotation = useRotX !== 0 || useRotY !== 0 || useRotZ !== 0;
    const hasMtlOrTextures =
      !!model.mtlText || (model.textureBlobs && model.textureBlobs.length > 0);

    const objText = exportRotatedObj(
      model.objText,
      { rotX: useRotX, rotY: useRotY, rotZ: useRotZ },
      {
        scaleX: sx,
        scaleY: sy,
        scaleZ: sz,
        comment: `WJP${hasRotation ? " laid-out" : ""} export · ${model.name} · X=${useRotX}° Y=${useRotY}° Z=${useRotZ}° · ${isUniform ? `scale=${sx.toFixed(3)}` : `scaleX=${sx.toFixed(3)} Y=${sy.toFixed(3)} Z=${sz.toFixed(3)}`}`,
      }
    );
    const scaleSuffix = isUniform
      ? Math.abs(sx - 1) > 0.001
        ? `_s${sx.toFixed(3)}`
        : ""
      : `_sX${sx.toFixed(2)}_Y${sy.toFixed(2)}_Z${sz.toFixed(2)}`;
    const zSuffix = useRotZ !== 0 ? `_Z${useRotZ}` : "";
    const rotSuffix = hasRotation
      ? `_rotated_X${useRotX}_Y${useRotY}${zSuffix}`
      : "";
    const baseName = `${model.name}${rotSuffix}${scaleSuffix}`;

    if (hasMtlOrTextures) {
      downloadModelZip(
        objText,
        model.mtlText,
        model.textureBlobs,
        model.objFileName,
        model.mtlFileName,
        baseName
      );
    } else {
      downloadObjFile(objText, baseName);
    }
  };

  // ---- 批量 ----
  const handleBatchFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setBatchItems((prev) => [...prev, ...initBatch(arr)]);
    if (batchFileInputRef.current) batchFileInputRef.current.value = "";
  };

  const runBatch = async () => {
    const pending = batchItems.filter(
      (i) => i.status === "pending" || i.status === "error"
    );
    if (pending.length === 0) return;
    setBatchItems((prev) =>
      prev.map((i) =>
        i.status === "error"
          ? {
              ...i,
              status: "pending",
              progress: 0,
              error: undefined,
              message: undefined,
              result: undefined,
            }
          : i
      )
    );

    const controller = new AbortController();
    batchAbortRef.current = controller;
    setBatchRunning(true);

    const options: BatchOptions = {
      concurrency: batchConcurrency,
      pricingConfig,
      solidRatio,
      repairEnabled,
      repairPrice,
      optimizeAngle: batchApplyAngle,
      onItemUpdate: (id, patch) => {
        setBatchItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
        );
      },
      signal: controller.signal,
    };

    const snapshot = batchItems.filter(
      (i) => i.status === "pending" || i.status === "error"
    );
    await processBatch(snapshot, options);
    setBatchRunning(false);
    batchAbortRef.current = null;
  };

  const cancelBatch = () => {
    batchAbortRef.current?.abort();
    setBatchRunning(false);
  };

  const clearBatch = () => {
    if (batchRunning) cancelBatch();
    setBatchItems([]);
  };

  const removeBatchItem = (id: string) => {
    setBatchItems((prev) => prev.filter((it) => it.id !== id));
  };

  const exportBatchItem = (item: BatchItem) => {
    if (!item.result) return;
    const angle = item.result.optimalAngle;
    if (!angle) return;
    const objText = exportRotatedObj(
      item.result.objText,
      { rotX: angle.rotX, rotY: angle.rotY },
      {
        comment: `WJP batch export · ${item.name} · X=${angle.rotX}° Y=${angle.rotY}°`,
      }
    );
    downloadObjFile(
      objText,
      `${item.name}_rotated_X${angle.rotX}_Y${angle.rotY}.obj`
    );
  };

  const reset = () => {
    clearModel();
    setLength(68.3);
    setWidth(80);
    setHeight(43.6);
    setSolidRatio(30);
    setCoverage(50);
    setRepairMode("none");
    setRepairPrice(0);
    setMaterialDensity(DEFAULT_CONFIG.materialDensity);
    // 价格相关 state 一并复位（UI 不展示，但引擎仍读它们算克重）
    setUnitPrice(DEFAULT_CONFIG.unitPrice);
    setVarnishEnabled(true);
    setProductId("pet");
    setSupportEnabled(false);
    setSupportPrice(DEFAULT_CONFIG.supportPrice);
    setSupportParams({
      fillRate: 0.37,
      shellThickness: 1.0,
      density: 1.15,
    });
    setRealWeightInput("");
    setMode("upload");
    setDimMode("original");
    setScaleFactor(1);
    setUniformScale(true);
    setScaleX(1);
    setScaleY(1);
    setScaleZ(1);
    setInfoDialog(null);
    setBatchItems([]);
  };

  // 组件卸载时回收 blob URL
  useEffect(() => {
    return () => {
      if (model?.previewUrl) URL.revokeObjectURL(model.previewUrl);
    };
  }, [model?.previewUrl]);

  const titleBlock = (
    <div className="flex items-center gap-3">
      <div className="size-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-sm">
        <Scale className="size-5 text-white" />
      </div>
      <div>
        <h1 className="text-base sm:text-lg font-semibold tracking-tight">
          {t("header.title")}
        </h1>
        <p className="text-xs text-stone-500">{t("header.subtitle")}</p>
      </div>
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setInfoDialog("algorithm")}
            className="size-8 text-stone-500 hover:text-amber-600"
            title={t("info.algorithm.title")}
          >
            <Calculator className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("info.algorithm.title")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setInfoDialog("products")}
            className="size-8 text-stone-500 hover:text-amber-600"
            title={t("info.products.title")}
          >
            <Box className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("info.products.title")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setInfoDialog("materials")}
            className="size-8 text-stone-500 hover:text-amber-600"
            title={t("info.materials.title")}
          >
            <Beaker className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("info.materials.title")}</TooltipContent>
      </Tooltip>
      <Button
        variant="ghost"
        size="sm"
        onClick={reset}
        className="text-stone-600 hover:text-stone-900"
      >
        <RotateCcw className="size-4" />
        <span className="hidden sm:inline">{t("common.reset")}</span>
      </Button>
    </div>
  );

  /**
   * 卡片头部 —— 文件身份（缩略图 / 名称 / 几何标签）+ 操作按钮。
   *
   * 这是整页唯一的「模型身份」出口：体积 / 表面积 / 顶点 / 三角面 四个数
   * 以**标签**形式各出现一次，别的面板不再重复。
   */
  const modelHeader = (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {model && <ObjThumbnail objText={model.objText} size={80} />}
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-stone-800 flex items-center gap-2">
            <Box className="size-4 text-amber-600 shrink-0" />
            <span className="truncate">{model?.name ?? fileName ?? ""}</span>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {geometry && (
              <Badge variant="outline" className="font-mono">
                {fmt(geometry.dims[0], 1)} × {fmt(geometry.dims[1], 1)} ×{" "}
                {fmt(geometry.dims[2], 1)} mm
              </Badge>
            )}
            {geometry && (
              <Badge variant="outline" className="font-mono">
                {t("stats.realVolume")} {fmt(geometry.volumeCM3, 2)} cm³
              </Badge>
            )}
            {geometry && (
              <Badge variant="outline" className="font-mono">
                {t("stats.surfaceArea")} {fmt(geometry.surfaceAreaCM2, 2)} cm²
              </Badge>
            )}
            {model && (
              <Badge variant="outline" className="font-mono">
                {t("stats.vertexCount")}{" "}
                {model.parseResult.vertexCount.toLocaleString()}
              </Badge>
            )}
            {model && (
              <Badge variant="outline" className="font-mono">
                {t("stats.triangleCount")}{" "}
                {model.parseResult.triangleCount.toLocaleString()}
              </Badge>
            )}
            {dimMode === "custom" && (
              <Badge
                variant="outline"
                className="font-mono border-amber-300 text-amber-700 bg-amber-50"
              >
                {t("upload.scaledBy", { k: fmt(scaleFactor, 3) })}
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {loadStatus === "ready" && optimalAngle && (
          <Button
            variant="outline"
            size="sm"
            onClick={resetAngle}
            className="text-violet-600 hover:text-violet-700 border-violet-300 hover:bg-violet-50"
          >
            <RotateCcw className="size-3.5" />
            {t("angle.resetAngle")}
          </Button>
        )}
        {loadStatus === "ready" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportRotatedModel(appliedScales)}
            className="text-emerald-700 hover:text-emerald-800 border-emerald-300 hover:bg-emerald-50"
            title={
              optimalAngle
                ? t("dialog.exportRotatedTitle")
                : t("dialog.exportPlainTitle")
            }
          >
            <Download className="size-3.5" />
            {optimalAngle ? t("dialog.exportRotated") : t("dialog.exportModel")}
          </Button>
        )}
        {model && (
          <>
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
          </>
        )}
      </div>
    </div>
  );

  /**
   * 右栏底部 —— 克重（主角）+ 摆盘结果 + 支撑克重校准。
   *
   * 克重是这一页唯一的主角：耗材克重大字号，支撑克重次一级，
   * 摆盘结果和校准收在下面。其余数字（体积 / 表面积 / 顶点 / 三角面）
   * 都在头部以标签出现，这里不重复。
   *
   * 2026-11-01:从右栏顶部挪到底部。克重是尺寸调的**结论**,尺寸是**输入** ——
   * 放在上面时,读者先看到两个大数字,再往下找才能改尺寸,真正要操作的
   * 输入被压在视线之外。现在顺序是「调尺寸 → 看克重」。
   */
  const weightPanel = calc ? (
    <>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-stone-500">
            <Scale className="size-3.5" />
            <span>{t("stats.materialWeight")}</span>
          </div>
          <div className="mt-0.5 font-mono text-3xl font-semibold tracking-tight text-amber-700">
            {Math.ceil(calc.materialWeight)} g
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-xs text-stone-500">
            <Compass className="size-3.5" />
            <span>{t("stats.supportWeight")}</span>
          </div>
          <div className="mt-0.5 font-mono text-lg font-medium text-stone-700">
            {optimalAngle
              ? `${Math.ceil(optimalAngle.totalSupportWeight)} g`
              : "—"}
          </div>
        </div>
      </div>

      {!optimalAngle && (
        <p className="mt-1 text-[11px] text-stone-400">
          {t("stats.supportWeightHint")}
        </p>
      )}

      {/* 智能摆盘结果 */}
      {optimalAngle && (
        <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/50 p-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Compass className="size-3.5 text-violet-600" />
            <span className="text-xs text-stone-600">
              {t("angle.best", {
                x: viewerRotX,
                y: viewerRotY,
                z: viewerRotZ,
              })}
            </span>
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-violet-300 text-violet-700 bg-violet-50"
            >
              {t("angle.selfSupport", {
                ratio: fmt(optimalAngle.selfSupportRatio * 100, 0),
              })}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-stone-300 text-stone-600"
            >
              {t("angle.supportWeight", {
                weight: Math.ceil(optimalAngle.totalSupportWeight),
              })}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-stone-300 text-stone-600"
            >
              {t("angle.height", {
                h: fmt(optimalAngle.rotatedHeight, 0),
              })}
            </Badge>
            {optimalAngle.laidFlat && (
              <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100">
                {t("angle.laidFlat")}
              </Badge>
            )}
            {optimalAngle.originalWeight !== undefined &&
              optimalAngle.originalRatio !== undefined &&
              optimalAngle.originalRatio > 1.05 && (
                <Badge
                  variant="outline"
                  className="text-[10px] font-mono border-emerald-300 text-emerald-700 bg-emerald-50"
                  title={t("angle.savingTitle", {
                    before: Math.ceil(optimalAngle.originalWeight),
                    after: Math.ceil(optimalAngle.totalSupportWeight),
                    pct: Math.max(
                      0,
                      100 - Math.round(100 / optimalAngle.originalRatio)
                    ),
                  })}
                >
                  {t("angle.savingBadge", {
                    pct: Math.max(
                      0,
                      100 - Math.round(100 / optimalAngle.originalRatio)
                    ),
                  })}
                </Badge>
              )}
          </div>

          {/* 支撑克重校准 */}
          <details className="mt-1.5 group">
            <summary className="cursor-pointer text-[10px] text-stone-500 hover:text-stone-700 select-none flex items-center gap-1">
              <span className="group-open:hidden">▸</span>
              <span className="hidden group-open:inline">▾</span>
              {t("calibration.collapseLabel")}
            </summary>
            <div className="mt-2 space-y-2">
              {/* 一键校准 */}
              <div className="p-2 bg-amber-50 rounded border border-amber-200">
                <div className="text-[10px] font-semibold text-amber-800 mb-1">
                  {t("calibration.oneClickTitle")}
                </div>
                <div className="text-[10px] text-stone-600 mb-1.5">
                  {t("calibration.oneClickDesc")}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder={t("calibration.placeholder")}
                    value={realWeightInput}
                    onChange={(e) => setRealWeightInput(e.target.value)}
                    className="font-mono h-7 text-xs w-24 px-2 border border-stone-300 rounded"
                  />
                  <span className="text-[10px] text-stone-500">g</span>
                  <button
                    type="button"
                    disabled={
                      !realWeightInput || !positionsRef.current || !optimalAngle
                    }
                    onClick={calibrateFromMeasured}
                    className="text-[10px] px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:bg-stone-300 disabled:cursor-not-allowed"
                  >
                    {t("calibration.calibrate")}
                  </button>
                  {realWeightInput && optimalAngle && (
                    <MeasuredRatioHint
                      realWeightInput={realWeightInput}
                      currentWeight={optimalAngle.totalSupportWeight}
                    />
                  )}
                </div>
              </div>

              <SupportCalibration
                params={supportParams}
                onParamsChange={(p) => recomputeSupport(p, appliedScales)}
                accent="amber"
                columns={2}
              />
            </div>
          </details>
        </div>
      )}
    </>
  ) : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="text-stone-900">
        {/* ---------- 顶部工具条 ---------- */}
        {showChrome && (
          <header className="border-b border-stone-200/80 bg-white/70 backdrop-blur sticky top-0 z-10">
            <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
              {titleBlock}
              {toolbar}
            </div>
          </header>
        )}

        <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {/* ---------- 介绍 ---------- */}
          <section className="mb-6">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {t("intro.title")}
            </h2>
            <p className="mt-2 text-sm text-stone-600 max-w-3xl leading-relaxed">
              {t.rich("intro.body", {
                strong: (chunks) => (
                  <strong className="text-stone-800">{chunks}</strong>
                ),
              })}
            </p>
          </section>

          {/* ---------- 模式切换 ---------- */}
          <section className="mb-6">
            <div className="inline-flex rounded-lg border border-stone-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setMode("upload")}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === "upload" ? "bg-amber-500 text-white shadow-sm" : "text-stone-600 hover:text-stone-900 hover:bg-stone-50"}`}
              >
                <UploadCloud className="size-4" />
                {t("modes.upload")}
              </button>
              <button
                type="button"
                onClick={() => setMode("manual")}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === "manual" ? "bg-amber-500 text-white shadow-sm" : "text-stone-600 hover:text-stone-900 hover:bg-stone-50"}`}
              >
                <Pencil className="size-4" />
                {t("modes.manual")}
              </button>
              <button
                type="button"
                onClick={() => setMode("batch")}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${mode === "batch" ? "bg-amber-500 text-white shadow-sm" : "text-stone-600 hover:text-stone-900 hover:bg-stone-50"}`}
              >
                <ListChecks className="size-4" />
                {t("modes.batch")}
              </button>
            </div>
          </section>

          {/* ---------- 上传模式 ---------- */}
          {mode === "upload" && (
            <section className="mb-6">
              {!model && loadStatus === "idle" ? (
                <Card
                  className={`border-2 border-dashed transition-colors cursor-pointer bg-stone-50/40 ${isDragging ? "border-amber-500 bg-amber-50/60 ring-2 ring-amber-200" : "border-stone-300 hover:border-amber-400"}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragging(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragging(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragging(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDragging(false);
                    const files = e.dataTransfer.files;
                    if (files && files.length > 0) {
                      const fakeEvent = {
                        target: { files },
                      } as unknown as React.ChangeEvent<HTMLInputElement>;
                      handleFileChange(fakeEvent);
                    }
                  }}
                >
                  <CardContent className="p-10 flex flex-col items-center text-center">
                    <div
                      className={`size-16 rounded-full flex items-center justify-center mb-4 transition-colors ${isDragging ? "bg-amber-200" : "bg-amber-100"}`}
                    >
                      <UploadCloud
                        className={`size-8 ${isDragging ? "text-amber-700" : "text-amber-600"}`}
                      />
                    </div>
                    <h3 className="text-base font-semibold text-stone-800 mb-1">
                      {isDragging ? t("upload.dropNow") : t("upload.dropTitle")}
                    </h3>
                    <p className="text-sm text-stone-500 max-w-md">
                      {isDragging ? t("upload.dropSoon") : t("upload.dropHint")}
                    </p>
                    {uploadError && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-md">
                        <AlertCircle className="size-4 shrink-0" />
                        <span>{uploadError}</span>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".zip,.rar,.7z,.obj,.stl,.ply,.glb,.gltf"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    {!isDragging && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-4 border-amber-300 text-amber-700 hover:bg-amber-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                      >
                        <FileArchive className="size-4" />
                        {t("upload.pickFile")}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <>
                  <ModelSettingsPanel
                    model={model}
                    loadStatus={loadStatus}
                    loadProgress={loadProgress}
                    loadPercent={loadPercent}
                    uploadError={uploadError}
                    header={modelHeader}
                    weight={weightPanel}
                    dimMode={dimMode}
                    uniformScale={uniformScale}
                    scaleFactor={scaleFactor}
                    scaleX={scaleX}
                    scaleY={scaleY}
                    scaleZ={scaleZ}
                    onDimModeChange={setDimMode}
                    onUniformScaleChange={setUniformScale}
                    onScaleFactorChange={setScaleFactor}
                    onScaleXChange={setScaleX}
                    onScaleYChange={setScaleY}
                    onScaleZChange={setScaleZ}
                    geometry={geometry}
                    optimalAngle={optimalAngle}
                    viewerRotX={viewerRotX}
                    viewerRotY={viewerRotY}
                    viewerRotZ={viewerRotZ}
                    manualRotX={manualRotX}
                    manualRotY={manualRotY}
                    manualRotZ={manualRotZ}
                    onManualAngleChange={handleManualAngleChange}
                    onOptimizeAngle={optimizeAngle}
                    angleOptimizing={angleOptimizing}
                    angleProgress={angleProgress}
                    showSupport={showSupport}
                    onToggleSupport={() => setShowSupport((s) => !s)}
                    onClearModel={clearModel}
                    onViewerReady={() => {
                      setLoadStatus("ready");
                      setLoadPercent(100);
                    }}
                    onViewerProgress={(p) => setLoadPercent(p)}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip,.rar,.7z,.obj,.stl,.ply,.glb,.gltf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </>
              )}
            </section>
          )}

          {/* ---------- 手动模式 ---------- */}
          {mode === "manual" && (
            <Card className="border-stone-200 shadow-sm">
              <CardContent className="pt-5 space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-stone-600">
                    {t("manual.dimsLabel")}
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    <DimInput
                      label={t("axis.lengthFull")}
                      value={length}
                      onChange={setLength}
                    />
                    <DimInput
                      label={t("axis.widthFull")}
                      value={width}
                      onChange={setWidth}
                    />
                    <DimInput
                      label={t("axis.heightFull")}
                      value={height}
                      onChange={setHeight}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-stone-600">
                      {t("manual.solidRatio")}
                    </Label>
                    <span className="text-xs font-mono font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      {solidRatio}%
                    </span>
                  </div>
                  <Slider
                    value={[solidRatio]}
                    min={1}
                    max={100}
                    step={1}
                    onValueChange={(v) => setSolidRatio(v[0] ?? 30)}
                    className="[&_[data-slot=slider-range]]:bg-amber-500 [&_[data-slot=slider-thumb]]:border-amber-500"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {SOLID_PRESETS.map((p) => (
                      <button
                        key={p.labelKey}
                        type="button"
                        onClick={() => setSolidRatio(p.ratio)}
                        className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${solidRatio === p.ratio ? "bg-amber-500 text-white border-amber-500" : "bg-white text-stone-500 border-stone-200 hover:border-amber-400"}`}
                      >
                        {t(p.labelKey)} {p.ratio}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* 支撑克重 —— 手动模式没有模型，支撑要上传模型后由智能摆盘算出 */}
                <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 p-2.5">
                  <div className="flex items-center gap-2">
                    <Compass className="size-3.5 text-stone-400" />
                    <span className="text-sm text-stone-800">
                      {t("stats.supportWeight")}
                    </span>
                    <span className="text-xs text-stone-400">
                      {t("stats.supportNeedsModel")}
                    </span>
                  </div>
                </div>

                {/* 预估克重 —— 手动模式原本只显示总价，去掉价格后改为只给克重 */}
                {calc && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-stone-700">
                        {t("manual.weightTitle")}
                      </span>
                      <span className="text-3xl font-bold tracking-tight text-amber-700 font-mono">
                        {Math.ceil(calc.materialWeight)} g
                      </span>
                    </div>
                    {/* 次要数据 —— 体积 / 表面积 收成一行小字 */}
                    <p className="text-[11px] text-stone-400">
                      {t("stats.realVolume")} {fmt(calc.volumeCM3, 2)} cm³ ·{" "}
                      {t("stats.surfaceArea")} {fmt(calc.surfaceAreaCM2, 2)} cm²
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ---------- 批量模式 ---------- */}
          {mode === "batch" && (
            <BatchModeSection
              batchItems={batchItems}
              batchRunning={batchRunning}
              batchConcurrency={batchConcurrency}
              batchApplyAngle={batchApplyAngle}
              batchFileInputRef={batchFileInputRef}
              onPickFiles={() => batchFileInputRef.current?.click()}
              onFilesChange={handleBatchFiles}
              onRun={runBatch}
              onCancel={cancelBatch}
              onClear={clearBatch}
              onRemoveItem={removeBatchItem}
              onExportItem={exportBatchItem}
              onConcurrencyChange={setBatchConcurrency}
              onApplyAngleChange={setBatchApplyAngle}
              onDropFiles={(files) => {
                setBatchItems((prev) => [
                  ...prev,
                  ...initBatch(Array.from(files)),
                ]);
              }}
              solidRatio={solidRatio}
              materialDensity={materialDensity}
            />
          )}
        </main>

        {/* ---------- 说明弹窗 ---------- */}
        <PricingInfoDialogs
          infoDialog={infoDialog}
          onInfoDialogChange={setInfoDialog}
          materialDensity={materialDensity}
          onMaterialDensityChange={setMaterialDensity}
          onApplyProduct={applyProduct}
        />

        {showChrome && (
          <footer className="border-t border-stone-200 bg-white/60 backdrop-blur mt-auto">
            <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500">
              <span>{t("footer.tagline")}</span>
              <span className="font-mono">{t("footer.version")}</span>
            </div>
          </footer>
        )}
      </div>
    </TooltipProvider>
  );
}

/** 一键校准旁的「当前 → 目标」提示 */
function MeasuredRatioHint({
  realWeightInput,
  currentWeight,
}: {
  realWeightInput: string;
  currentWeight: number;
}) {
  const t = useTranslations("MaterialPricing.calibration");
  const realG = parseFloat(realWeightInput);
  if (!Number.isFinite(realG) || realG <= 0 || currentWeight <= 0) return null;
  const ratio = realG / currentWeight;
  return (
    <span className="text-[10px] text-amber-700 font-mono">
      {t("ratioHint", {
        current: currentWeight.toFixed(0),
        target: realG,
        ratio: ratio.toFixed(2),
      })}
    </span>
  );
}
