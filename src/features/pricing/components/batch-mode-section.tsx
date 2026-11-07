"use client";

import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Compass,
  Download,
  FileBox,
  ListChecks,
  Scale,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
/**
 * Mooncoda 克重计算器的「批量克重」区块。
 *
 * 移植自 wjp-source-code/src/app/page.tsx。多选 ZIP / OBJ → 多 Web Worker
 * 并行解析 → 智能摆盘 → 克重计算。所有处理在浏览器本地完成，不上传服务器。
 *
 * 区块只呈现克重 / 体积 / 摆盘结果，不呈现任何价格。
 */
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmt, StatBlock } from "@/features/pricing/components/shared";
import {
  type BatchItem,
  summarizeBatch,
} from "@/features/pricing/lib/batch-processor";
import { useDropZone } from "@/features/shared/hooks/use-drop-zone";

const BATCH_STATUS_LABEL_KEY: Record<BatchItem["status"], string> = {
  pending: "pending",
  extracting: "extracting",
  parsing: "parsing",
  optimizing: "optimizing",
  pricing: "pricing",
  done: "done",
  error: "error",
  skipped: "skipped",
};

const BATCH_STATUS_COLOR: Record<BatchItem["status"], string> = {
  pending: "bg-stone-100 text-stone-600 border-stone-200",
  extracting: "bg-blue-50 text-blue-700 border-blue-200",
  parsing: "bg-blue-50 text-blue-700 border-blue-200",
  optimizing: "bg-violet-50 text-violet-700 border-violet-200",
  pricing: "bg-amber-50 text-amber-700 border-amber-200",
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
  error: "bg-red-50 text-red-700 border-red-200",
  skipped: "bg-stone-100 text-stone-500 border-stone-200",
};

export type BatchModeSectionProps = {
  batchItems: BatchItem[];
  batchRunning: boolean;
  batchConcurrency: number;
  batchApplyAngle: boolean;
  batchFileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickFiles: () => void;
  onFilesChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRun: () => void;
  onCancel: () => void;
  onClear: () => void;
  onRemoveItem: (id: string) => void;
  onExportItem: (item: BatchItem) => void;
  onConcurrencyChange: (v: number) => void;
  onApplyAngleChange: (v: boolean) => void;
  onDropFiles: (files: File[]) => void;
  solidRatio: number;
  materialDensity: number;
  /** 支撑材料密度 (g/cm³) —— 支撑跟模型不是一种材料,批量算支撑克重用这个 */
  supportDensity: number;
};

export function BatchModeSection(props: BatchModeSectionProps) {
  const t = useTranslations("MaterialPricing.batch");
  const {
    batchItems,
    batchRunning,
    batchConcurrency,
    batchApplyAngle,
    batchFileInputRef,
    onPickFiles,
    onFilesChange,
    onRun,
    onCancel,
    onClear,
    onRemoveItem,
    onExportItem,
    onConcurrencyChange,
    onApplyAngleChange,
    onDropFiles,
    solidRatio,
    materialDensity,
    supportDensity,
  } = props;

  const summary = useMemo(() => summarizeBatch(batchItems), [batchItems]);
  const hasItems = batchItems.length > 0;
  const hasPending = batchItems.some(
    (i) => i.status === "pending" || i.status === "error"
  );
  // 拖放 —— 与克重工具的上传卡、模型检查工具的视口共用一份口径
  const { isDragOver: isBatchDragging, dropHandlers } =
    useDropZone<HTMLDivElement>((files) => onDropFiles(files));
  return (
    <section className="mb-6 space-y-4">
      {/* 头部说明 */}
      <Card className="border-stone-200 shadow-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-base font-semibold text-stone-800 flex items-center gap-2">
                <ListChecks className="size-5 text-amber-600" />
                {t("title")}
              </h3>
              <p className="mt-1 text-xs text-stone-500 max-w-2xl leading-relaxed">
                {t("intro")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={onPickFiles}
                disabled={batchRunning}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                <UploadCloud className="size-4" />
                {t("addFiles")}
              </Button>
              <input
                ref={batchFileInputRef}
                type="file"
                multiple
                accept=".zip,.rar,.7z,.obj,.stl,.ply,.glb"
                onChange={onFilesChange}
                className="hidden"
              />
            </div>
          </div>

          {/* 参数 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-stone-100">
            <div className="space-y-1.5">
              <Label className="text-xs text-stone-500">
                {t("concurrency")}
              </Label>
              <div className="flex items-center gap-2">
                <Slider
                  value={[batchConcurrency]}
                  min={1}
                  max={8}
                  step={1}
                  onValueChange={(v) => onConcurrencyChange(v[0] ?? 4)}
                  disabled={batchRunning}
                  className="flex-1 [&_[data-slot=slider-range]]:bg-amber-500 [&_[data-slot=slider-thumb]]:border-amber-500"
                />
                <span className="text-xs font-mono text-stone-700 w-6 text-right">
                  {batchConcurrency}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-stone-500">
                {t("smartAngle")}
              </Label>
              <div className="flex items-center gap-2 h-7">
                <Switch
                  checked={batchApplyAngle}
                  onCheckedChange={onApplyAngleChange}
                  disabled={batchRunning}
                />
                <span className="text-xs text-stone-600">
                  {batchApplyAngle ? t("enabled") : t("disabled")}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-stone-500">
                {t("materialDensity")}
              </Label>
              <div className="flex items-center gap-1 h-7">
                <span className="font-mono text-sm text-stone-700">
                  {fmt(materialDensity, 2)}
                </span>
                <span className="text-xs text-stone-400">g/cm³</span>
              </div>
            </div>
            {/* 支撑是另一种材料 —— 支撑克重按这个密度算,得让人看见 */}
            <div className="space-y-1.5">
              <Label className="text-xs text-stone-500">
                {t("supportDensity")}
              </Label>
              <div className="flex items-center gap-1 h-7">
                <span className="font-mono text-sm text-stone-700">
                  {fmt(supportDensity, 2)}
                </span>
                <span className="text-xs text-stone-400">g/cm³</span>
              </div>
            </div>
          </div>

          {/* 操作栏 */}
          {hasItems && (
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-stone-100 flex-wrap">
              <div className="text-xs text-stone-500">
                {t.rich("summaryLine", {
                  total: summary.total,
                  done: summary.done,
                  errors: summary.errors,
                  pending: summary.pending,
                  b: (chunks) => (
                    <strong className="text-stone-700">{chunks}</strong>
                  ),
                  bOk: (chunks) => (
                    <strong className="text-emerald-700">{chunks}</strong>
                  ),
                  bErr: (chunks) => (
                    <strong className="text-red-700">{chunks}</strong>
                  ),
                })}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClear}
                  disabled={batchRunning}
                  className="text-stone-500 hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="size-3.5" />
                  {t("clear")}
                </Button>
                {batchRunning ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCancel}
                    className="border-red-300 text-red-700 hover:bg-red-50"
                  >
                    <X className="size-4" />
                    {t("cancel")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={onRun}
                    disabled={!hasPending}
                    className="bg-amber-500 hover:bg-amber-600 text-white disabled:bg-stone-200 disabled:text-stone-400"
                  >
                    <Activity className="size-4" />
                    {summary.errors > 0
                      ? t("retry", { n: summary.errors })
                      : t("start", { n: summary.pending })}
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 空状态 */}
      {!hasItems && (
        <Card
          className={`border-2 border-dashed transition-colors cursor-pointer bg-stone-50/40 ${isBatchDragging ? "border-amber-500 bg-amber-50/60 ring-2 ring-amber-200" : "border-stone-300 hover:border-amber-400"}`}
          onClick={onPickFiles}
          {...dropHandlers}
        >
          <CardContent className="p-10 flex flex-col items-center text-center">
            <div
              className={`size-16 rounded-full flex items-center justify-center mb-4 transition-colors ${isBatchDragging ? "bg-amber-200" : "bg-amber-100"}`}
            >
              <ListChecks
                className={`size-8 ${isBatchDragging ? "text-amber-700" : "text-amber-600"}`}
              />
            </div>
            <h3 className="text-base font-semibold text-stone-800 mb-1">
              {isBatchDragging ? t("dropHint") : t("emptyTitle")}
            </h3>
            <p className="text-sm text-stone-500 max-w-md">
              {isBatchDragging ? t("dropPending") : t("emptyHint")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* 汇总 */}
      {hasItems && summary.done > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatBlock
            label={t("totalWeight")}
            value={`${fmt(summary.totalWeight, 1)} g`}
            icon={<Scale className="size-3.5" />}
            highlight
          />
          <StatBlock
            label={t("doneCount")}
            value={`${summary.done} / ${summary.total}`}
            icon={<CheckCircle2 className="size-3.5" />}
          />
          <StatBlock
            label={t("avgTime")}
            value={`${(summary.avgTimeMs / 1000).toFixed(1)} s`}
            icon={<Activity className="size-3.5" />}
            muted
          />
        </div>
      )}

      {/* 明细列表 */}
      {hasItems && (
        <Card className="border-stone-200 shadow-sm">
          <CardContent className="p-0 overflow-hidden">
            <div className="divide-y divide-stone-100">
              {batchItems.map((item) => (
                <BatchItemRow
                  key={item.id}
                  item={item}
                  onRemove={onRemoveItem}
                  onExport={onExportItem}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 参数提示 */}
      {hasItems && (
        <div className="flex items-center gap-2 text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded-md p-3">
          <AlertCircle className="size-3.5 text-stone-400 shrink-0" />
          <span>
            {t.rich("settingsReminder", {
              solidRatio,
              density: fmt(materialDensity, 2),
              supportDensity: fmt(supportDensity, 2),
              angle: batchApplyAngle ? t("enabled") : t("disabled"),
              b: (chunks) => (
                <strong className="text-stone-700">{chunks}</strong>
              ),
            })}
          </span>
        </div>
      )}
    </section>
  );
}

function BatchItemRow({
  item,
  onRemove,
  onExport,
}: {
  item: BatchItem;
  onRemove: (id: string) => void;
  onExport: (item: BatchItem) => void;
}) {
  const t = useTranslations("MaterialPricing.batch");
  const r = item.result;
  const angle = r?.optimalAngle;
  const duration =
    item.startTime && item.endTime
      ? (item.endTime - item.startTime) / 1000
      : null;
  const isProcessing =
    item.status !== "pending" &&
    item.status !== "done" &&
    item.status !== "error" &&
    item.status !== "skipped";

  return (
    <div className="p-3 sm:p-4 flex items-start gap-3 hover:bg-stone-50/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <FileBox className="size-4 text-stone-500 shrink-0" />
          <span className="text-sm font-medium text-stone-800 truncate">
            {item.name}
          </span>
          <Badge
            variant="outline"
            className={`text-[10px] ${BATCH_STATUS_COLOR[item.status]}`}
          >
            {t(`status.${BATCH_STATUS_LABEL_KEY[item.status]}`)}
          </Badge>
          {duration !== null && item.status === "done" && (
            <Badge
              variant="outline"
              className="text-[10px] font-mono border-stone-200 text-stone-500"
            >
              {duration.toFixed(1)}s
            </Badge>
          )}
        </div>

        {/* 进度条 */}
        {item.status !== "done" &&
          item.status !== "error" &&
          item.status !== "pending" &&
          item.status !== "skipped" && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1 bg-stone-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(3, item.progress)}%` }}
                />
              </div>
              <span className="text-[10px] text-stone-500 font-mono w-9 text-right">
                {item.progress}%
              </span>
            </div>
          )}

        {/* 错误 */}
        {item.status === "error" && item.error && (
          <div className="mt-1 text-xs text-red-600 flex items-center gap-1">
            <AlertCircle className="size-3 shrink-0" />
            {item.error}
          </div>
        )}

        {/* 结果 */}
        {r && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge
              variant="outline"
              className="font-mono border-stone-200 text-stone-600"
            >
              {fmt(r.pricing.volumeCM3, 2)} cm³
            </Badge>
            <Badge
              variant="outline"
              className="font-mono border-stone-200 text-stone-600"
            >
              {Math.ceil(r.pricing.materialWeight)} g
            </Badge>
            <Badge
              variant="outline"
              className="font-mono border-stone-200 text-stone-600"
            >
              {fmt(r.pricing.dims[0], 0)}×{fmt(r.pricing.dims[1], 0)}×
              {fmt(r.pricing.dims[2], 0)} mm
            </Badge>
            {angle && (
              <Badge
                variant="outline"
                className="font-mono border-violet-200 text-violet-700 bg-violet-50"
              >
                <Compass className="size-3" />
                X:{angle.rotX}° Y:{angle.rotY}°
              </Badge>
            )}
            {/*
              支撑徽标:摆盘过是最优姿态的支撑,没摆盘是**初始角度**的支撑
              —— 不用先摆一次盘才知道要多少支撑。
            */}
            {r.supportWeightG > 0 && (
              <Badge
                variant="outline"
                className="font-mono border-violet-200 text-violet-700 bg-violet-50"
              >
                {t("selfSupport", {
                  ratio: fmt(r.supportRatio * 100, 0),
                  weight: Math.ceil(r.supportWeightG),
                })}
              </Badge>
            )}
            {angle?.laidFlat && (
              <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100">
                {t("laidFlat")}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-1 shrink-0">
        {r && angle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-emerald-600 hover:bg-emerald-50"
                onClick={() => onExport(item)}
                title={t("exportRotated")}
              >
                <Download className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("exportRotated")}</TooltipContent>
          </Tooltip>
        )}
        {!isProcessing && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-stone-400 hover:text-red-600 hover:bg-red-50"
            onClick={() => onRemove(item.id)}
            title={t("remove")}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
