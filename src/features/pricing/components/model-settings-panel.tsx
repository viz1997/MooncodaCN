"use client";

import {
  AlertCircle,
  Boxes,
  Compass,
  Info,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
/**
 * Mooncoda 克重计算器的「模型设置」面板 —— 也就是**整页唯一那张卡片**。
 *
 * 2026-11-01 的三次改版：
 *  1. 原先是 `ModelSettingsDialog` 弹窗（Radix Dialog）。改成**页面内直接
 *     处理** —— 尺寸调节不再弹窗，改完即时生效。
 *  2. 去掉「待应用 / 已应用」两套状态。尺寸状态只有一份，由父组件持有，
 *     面板直接改（`onScale*Change` 一类回调）。
 *  3. **和结果卡合并成一张卡**。之前是「上面一张结果卡 + 下面一张模型设置
 *     卡」，同一个模型被劈成两个区域，文件名、体积、摆盘结果各出现两遍。
 *     现在这一张卡就是全部：头部是文件身份 + 几何标签（`header` 插槽，
 *     父组件渲染），左栏 3D 预览，右栏克重 + 摆盘结果（`weight` 插槽，
 *     父组件渲染）+ 尺寸调节。
 *
 * 几何由父组件算好后传进来（`geometry`）—— 面板不自己重算一遍，
 * 拆成两处只会各自漂移。
 *
 * i18n 沿用 `MaterialPricing.dialog.*` 命名空间（文案与旧弹窗一致），只是
 * 调用位置从弹窗换成了面板 —— 整个命名空间的重命名留给单独的清理。
 */
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ObjViewer } from "@/features/pricing/components/obj-viewer";
import {
  AngleInput,
  DimDisplay,
  DimEditor,
  fmt,
} from "@/features/pricing/components/shared";
import type { OptimalAngle } from "@/features/pricing/lib/angle-optimizer";
import type { ModelFile } from "@/features/pricing/lib/zip-extractor";

export type LoadStatus =
  | "idle"
  | "uploading"
  | "parsing"
  | "loading-3d"
  | "ready"
  | "error";

export type DimMode = "original" | "custom";

/** 几何数据（父组件算好 —— 面板不再自己算一份） */
export type ModelGeometry = {
  volumeCM3: number;
  surfaceAreaCM2: number;
  dims: [number, number, number];
  originalDims: [number, number, number];
};

export type ModelSettingsPanelProps = {
  model: ModelFile | null;
  loadStatus: LoadStatus;
  loadProgress: string;
  loadPercent: number;
  uploadError: string | null;

  /**
   * 卡片头部 —— 文件身份（缩略图 / 名称 / 几何标签）+ 操作按钮。
   * 由父组件渲染：这个面板是**整页唯一一张卡片**，头部要放什么由外面决定。
   */
  header?: ReactNode;

  /**
   * 右栏顶部的内容 —— 克重 + 摆盘结果 + 支撑克重校准。
   * 由父组件渲染（它持有 `calc` / `optimalAngle` / 校准回调）。
   */
  weight?: ReactNode;

  /** 尺寸调节状态 —— 父组件持有，改动即时生效 */
  dimMode: DimMode;
  uniformScale: boolean;
  scaleFactor: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  onDimModeChange: (mode: DimMode) => void;
  onUniformScaleChange: (checked: boolean) => void;
  onScaleFactorChange: (value: number) => void;
  onScaleXChange: (value: number) => void;
  onScaleYChange: (value: number) => void;
  onScaleZChange: (value: number) => void;

  /** 父组件算好的几何 */
  geometry: ModelGeometry | null;

  optimalAngle: OptimalAngle | null;
  viewerRotX: number;
  viewerRotY: number;
  viewerRotZ: number;
  manualRotX: number;
  manualRotY: number;
  manualRotZ: number;
  /** 手动微调角度；第三个参数是当前生效的缩放因子（克重要按它算） */
  onManualAngleChange: (
    axis: "X" | "Y" | "Z",
    value: number,
    scales: [number, number, number]
  ) => void;
  /** 触发智能摆盘；传入当前生效的缩放因子 */
  onOptimizeAngle: (scales: [number, number, number]) => void;
  angleOptimizing: boolean;
  angleProgress: number;
  showSupport: boolean;
  onToggleSupport: () => void;

  onClearModel: () => void;
  onViewerReady: () => void;
  onViewerProgress: (p: number) => void;
};

export function ModelSettingsPanel({
  model,
  loadStatus,
  loadProgress,
  loadPercent,
  uploadError,
  header,
  weight,
  dimMode,
  uniformScale,
  scaleFactor,
  scaleX,
  scaleY,
  scaleZ,
  onDimModeChange,
  onUniformScaleChange,
  onScaleFactorChange,
  onScaleXChange,
  onScaleYChange,
  onScaleZChange,
  geometry,
  optimalAngle,
  viewerRotX,
  viewerRotY,
  viewerRotZ,
  manualRotX,
  manualRotY,
  manualRotZ,
  onManualAngleChange,
  onOptimizeAngle,
  angleOptimizing,
  angleProgress,
  showSupport,
  onToggleSupport,
  onClearModel,
  onViewerReady,
  onViewerProgress,
}: ModelSettingsPanelProps) {
  const t = useTranslations("MaterialPricing");

  /** 当前生效的缩放因子（XYZ）—— 由父组件持有的尺寸状态推导 */
  const scales = useMemo((): [number, number, number] => {
    if (dimMode !== "custom") return [1, 1, 1];
    if (uniformScale) return [scaleFactor, scaleFactor, scaleFactor];
    return [scaleX, scaleY, scaleZ];
  }, [dimMode, uniformScale, scaleFactor, scaleX, scaleY, scaleZ]);

  /** 切换「统一缩放」：开时取 XYZ 缩放的几何平均，关时把三轴拉到同一值 */
  const toggleUniformScale = (checked: boolean) => {
    onUniformScaleChange(checked);
    if (checked) {
      onScaleFactorChange(Math.cbrt(scaleX * scaleY * scaleZ));
    } else {
      onScaleXChange(scaleFactor);
      onScaleYChange(scaleFactor);
      onScaleZChange(scaleFactor);
    }
  };

  /** 手动改某个轴的尺寸(mm) → 换算成该轴的缩放因子写回父组件 */
  const handleDimChange = (axis: 0 | 1 | 2, newValue: number) => {
    if (!model) return;
    const original = model.parseResult.boundingBox.size;
    const origVals = [original.x, original.y, original.z];
    const orig = origVals[axis]!;
    if (orig === 0 || !Number.isFinite(newValue) || newValue <= 0) return;
    const k = newValue / orig;
    if (uniformScale) {
      onScaleFactorChange(k);
    } else if (axis === 0) {
      onScaleXChange(k);
    } else if (axis === 1) {
      onScaleYChange(k);
    } else {
      onScaleZChange(k);
    }
  };

  const showViewer =
    model !== null &&
    geometry !== null &&
    (loadStatus === "loading-3d" || loadStatus === "ready");

  // 没有模型、也没在加载 —— 什么都不渲染（页面上只有上传卡片）
  if (!model && loadStatus === "idle") return null;

  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm overflow-hidden">
      {/* ---------- 卡片头部（文件身份 + 操作）—— 由父组件渲染 ---------- */}
      {header !== undefined ? (
        <div className="px-4 py-3 border-b border-stone-200 bg-stone-50/60">
          {header}
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-stone-200 bg-stone-50/60">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-stone-800 flex items-center gap-2">
              <Boxes className="size-4 text-amber-600 shrink-0" />
              <span className="truncate">
                {model
                  ? t("dialog.title", { name: model.name })
                  : t("dialog.titlePlain")}
              </span>
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              {t("dialog.description")}
            </p>
          </div>
        </div>
      )}

      {/* ---------- 解析中 ---------- */}
      {(loadStatus === "uploading" || loadStatus === "parsing") && (
        <div className="py-12 flex flex-col items-center text-center">
          <div className="size-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
            <Loader2 className="size-8 text-amber-600 animate-spin" />
          </div>
          <h3 className="text-base font-semibold text-stone-800 mb-1">
            {loadStatus === "uploading"
              ? t("dialog.readingFile")
              : t("dialog.parsingObj")}
          </h3>
          <p className="text-sm text-stone-500 max-w-md">
            {loadProgress || t("dialog.pleaseWait")}
          </p>
          <div className="mt-4 w-full max-w-xs">
            <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(5, loadPercent)}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] text-stone-400 font-mono text-right">
              {loadPercent}%
            </div>
          </div>
        </div>
      )}

      {/* ---------- 解析失败 ---------- */}
      {loadStatus === "error" && uploadError && (
        <div className="py-12 flex flex-col items-center text-center">
          <div className="size-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
            <AlertCircle className="size-8 text-red-600" />
          </div>
          <h3 className="text-base font-semibold text-stone-800 mb-1">
            {t("dialog.loadFailed")}
          </h3>
          <p className="text-sm text-red-600 max-w-md mb-4">{uploadError}</p>
          <Button variant="outline" size="sm" onClick={onClearModel}>
            {t("dialog.reselectFile")}
          </Button>
        </div>
      )}

      {/* ---------- 3D 预览 + 尺寸调节 ---------- */}
      {showViewer && model && geometry && (
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* 左：3D 预览 */}
          <div className="border-b lg:border-b-0 lg:border-r border-stone-200 flex flex-col">
            <div className="flex items-center justify-between bg-stone-50 px-3 py-2 border-b border-stone-200">
              <span className="text-xs font-medium text-stone-600 flex items-center gap-1.5">
                <Boxes className="size-3.5 text-amber-600" />
                {t("dialog.preview3d")}
              </span>
              <div className="flex items-center gap-2">
                {loadStatus === "loading-3d" && (
                  <span className="text-[10px] text-amber-600 font-mono flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" />
                    {loadPercent}%
                  </span>
                )}
                {loadStatus === "ready" && (
                  <>
                    <button
                      type="button"
                      onClick={onToggleSupport}
                      className={`text-[10px] flex items-center gap-1 px-2 py-0.5 rounded border ${showSupport ? "text-amber-700 border-amber-400 bg-amber-50" : "text-stone-500 border-stone-300 bg-white"}`}
                      title={t("angle.toggleSupport")}
                    >
                      {t("angle.support")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOptimizeAngle(scales)}
                      disabled={angleOptimizing}
                      className="text-[10px] text-violet-600 hover:text-violet-700 flex items-center gap-1 px-2 py-0.5 rounded border border-violet-300 bg-white hover:bg-violet-50 disabled:opacity-50"
                    >
                      {angleOptimizing ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Compass className="size-3" />
                      )}
                      {angleOptimizing
                        ? `${angleProgress}%`
                        : t("angle.optimize")}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* 手动角度调整（仅当已执行智能摆盘后显示） */}
            {optimalAngle && loadStatus === "ready" && (
              <div className="px-3 py-2 border-b border-stone-200 bg-violet-50/30">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-medium text-violet-700 shrink-0">
                    {t("angle.manualTune")}
                  </span>
                  <div className="flex items-center gap-2 flex-1">
                    <AngleInput
                      label="X"
                      value={manualRotX}
                      onChange={(v) => onManualAngleChange("X", v, scales)}
                      color="#ef4444"
                    />
                    <AngleInput
                      label="Y"
                      value={manualRotY}
                      onChange={(v) => onManualAngleChange("Y", v, scales)}
                      color="#22c55e"
                    />
                    <AngleInput
                      label="Z"
                      value={manualRotZ}
                      onChange={(v) => onManualAngleChange("Z", v, scales)}
                      color="#3b82f6"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => onOptimizeAngle(scales)}
                    className="text-[10px] text-violet-600 hover:text-violet-700 flex items-center gap-1 px-2 py-0.5 rounded border border-violet-300 bg-white hover:bg-violet-50"
                  >
                    <Compass className="size-3" />
                    {t("angle.reoptimize")}
                  </button>
                </div>
              </div>
            )}

            {/* 预览区 —— 页面内布局给固定高度（弹窗里靠 flex-1 撑开） */}
            <div className="relative h-[300px] sm:h-[360px] lg:h-[420px] bg-stone-100">
              <ObjViewer
                objText={model.objText}
                mtlText={model.mtlText}
                textureBlobUrl={model.previewUrl}
                dims={geometry.dims}
                rotationX={viewerRotX}
                rotationY={viewerRotY}
                rotationZ={viewerRotZ}
                scale={dimMode === "custom" ? scales : 1}
                showSupport={showSupport}
                onReady={onViewerReady}
                onProgress={onViewerProgress}
              />
              {loadStatus === "loading-3d" && (
                <div className="absolute inset-0 bg-stone-100/80 backdrop-blur-sm flex flex-col items-center justify-center text-xs text-stone-500 pointer-events-none">
                  <div className="size-10 rounded-full bg-amber-100 flex items-center justify-center mb-2">
                    <Loader2 className="size-5 text-amber-600 animate-spin" />
                  </div>
                  <span>{loadProgress || t("dialog.loadingPreview")}</span>
                  <div className="mt-2 w-32 h-1 bg-stone-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(5, loadPercent)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 右：尺寸调节在上，克重（父组件渲染）在下。
              2026-11-01 调整：原来是「克重 → 尺寸调节」。克重是这块面板的
              **结论**，尺寸调节是**输入** —— 输入在前、结论在后，读起来是
              「先调尺寸 → 再看克重多少」。而且克重只有两个大数字，压在顶上
              会把下面真正要操作的尺寸输入挤到视线之外。 */}
          <div className="p-4 space-y-4">
            <div className="rounded-lg border border-stone-200 overflow-hidden">
              <div className="flex items-center justify-between bg-stone-50 px-3 py-2 border-b border-stone-200">
                <span className="text-xs font-medium text-stone-600">
                  {t("dialog.dimensionAdjust")}
                </span>
                <div className="inline-flex rounded-md border border-stone-200 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => onDimModeChange("original")}
                    className={`px-3 py-1 text-xs rounded transition-colors ${dimMode === "original" ? "bg-stone-800 text-white" : "text-stone-600 hover:text-stone-900"}`}
                  >
                    {t("dialog.originalSize")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDimModeChange("custom")}
                    className={`px-3 py-1 text-xs rounded transition-colors ${dimMode === "custom" ? "bg-amber-500 text-white" : "text-stone-600 hover:text-stone-900"}`}
                  >
                    {t("dialog.customSize")}
                  </button>
                </div>
              </div>

              <div className="p-3 space-y-3">
                <div className="space-y-2 min-h-[124px] flex flex-col justify-start">
                  <div className="grid grid-cols-3 gap-2">
                    {dimMode === "original" ? (
                      <>
                        <DimDisplay
                          axis="X"
                          axisColor="#ef4444"
                          label={t("axis.length")}
                          value={geometry.originalDims[0]}
                        />
                        <DimDisplay
                          axis="Y"
                          axisColor="#22c55e"
                          label={t("axis.width")}
                          value={geometry.originalDims[1]}
                        />
                        <DimDisplay
                          axis="Z"
                          axisColor="#3b82f6"
                          label={t("axis.height")}
                          value={geometry.originalDims[2]}
                        />
                      </>
                    ) : (
                      <>
                        <DimEditor
                          axis="X"
                          axisColor="#ef4444"
                          label={t("axis.length")}
                          value={geometry.dims[0]}
                          onChange={(v) => handleDimChange(0, v)}
                        />
                        <DimEditor
                          axis="Y"
                          axisColor="#22c55e"
                          label={t("axis.width")}
                          value={geometry.dims[1]}
                          onChange={(v) => handleDimChange(1, v)}
                        />
                        <DimEditor
                          axis="Z"
                          axisColor="#3b82f6"
                          label={t("axis.height")}
                          value={geometry.dims[2]}
                          onChange={(v) => handleDimChange(2, v)}
                        />
                      </>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs h-5">
                    {dimMode === "original" ? (
                      <span className="text-stone-500 flex items-center gap-1">
                        <Info className="size-3" />
                        {t("dialog.switchToCustom")}
                      </span>
                    ) : (
                      <>
                        <span className="text-stone-500 flex items-center gap-1">
                          <Info className="size-3" />
                          {uniformScale
                            ? t("dialog.linkedScale")
                            : t("dialog.independentScale")}
                        </span>
                        <div className="flex items-center gap-2">
                          {/* Radix Switch 渲染的是 button 而不是 input，
                              用 <label> 包它会被 a11y 规则判为「无关联控件的 label」，
                              这里改成可点击的按钮 + Switch。 */}
                          <div className="flex items-center gap-1 text-[11px] text-stone-500">
                            <button
                              type="button"
                              onClick={() => toggleUniformScale(!uniformScale)}
                              className="cursor-pointer hover:text-stone-700"
                            >
                              {t("dialog.uniformScale")}
                            </button>
                            <Switch
                              checked={uniformScale}
                              onCheckedChange={toggleUniformScale}
                              className="scale-75"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              onScaleFactorChange(1);
                              onScaleXChange(1);
                              onScaleYChange(1);
                              onScaleZChange(1);
                            }}
                            className="text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
                          >
                            <RotateCcw className="size-3" />
                            {t("dialog.restoreOriginal")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="text-[11px] h-6 flex items-center gap-1.5">
                    {dimMode === "custom" &&
                      (() => {
                        const [sx, sy, sz] = scales;
                        const isUniform = sx === sy && sy === sz;
                        const k = isUniform ? sx : Math.cbrt(sx * sy * sz);
                        if (Math.abs(k - 1) < 0.001) return null;
                        return (
                          <span className="text-stone-500 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-1.5 w-full">
                            <AlertCircle className="size-3 text-amber-600 shrink-0" />
                            {isUniform
                              ? t("dialog.scaleSummaryUniform", {
                                  s: fmt(sx, 3),
                                  v: fmt(sx ** 3, 3),
                                  a: fmt(sx ** 2, 3),
                                })
                              : t("dialog.scaleSummaryAxis", {
                                  sx: fmt(sx, 3),
                                  sy: fmt(sy, 3),
                                  sz: fmt(sz, 3),
                                  v: fmt(sx * sy * sz, 3),
                                })}
                          </span>
                        );
                      })()}
                  </div>
                </div>
              </div>
            </div>

            {/* 克重 —— 尺寸调完之后的结果，放最后 */}
            {weight}
          </div>
        </div>
      )}
    </div>
  );
}
