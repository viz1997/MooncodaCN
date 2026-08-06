"use client";

/**
 * 生图模型管理 - Admin 视图
 *
 * 仿 mooncada-source/modules/image-models.tsx 设计：
 * - 6 张统计卡片（模型总数 / 运行中 / 国产 / 国际 / 累计生成 / 平均质量）
 * - 过滤器：搜索 + 状态 + 来源（国产/国际）
 * - 模型卡片网格（耗时/单价/成功率/质量分/稳定分/支持模式/能力标签）
 * - 对比模式：最多 4 个模型横向对比
 * - 详情对话框：性能 + 商务 + 模式 + 尺寸 + 高级能力 + API 配置
 *
 * 数据来自 IMAGE_MODEL_LIST（src/features/image-gen/lib/image-models/types.ts）
 */

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  Globe,
  Image as ImageIcon,
  Layers,
  Settings,
  Shield,
  Sparkles,
  TrendingUp,
  Type,
  Wand2,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  GenerationMode,
  ImageModelConfig,
  ImageModelId,
  ModelStatus,
} from "@/features/image-gen/lib/image-models/types";
import {
  IMAGE_MODEL_LIST,
  MODE_LABELS,
} from "@/features/image-gen/lib/image-models/types";
import {
  EmptyState,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  ModelStatus,
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  active: {
    label: "运行中",
    color:
      "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
    icon: CheckCircle2,
  },
  maintenance: {
    label: "维护中",
    color:
      "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
    icon: AlertTriangle,
  },
  deprecated: {
    label: "已下线",
    color:
      "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
    icon: XCircle,
  },
};

const MODE_ICONS: Record<GenerationMode, typeof Type> = {
  text_to_image: Type,
  image_to_image: ImageIcon,
  image_editing: Sparkles,
  inpainting: Layers,
  upscaling: Activity,
};

function ScoreBar({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full transition-all", color)}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function ModelCard({
  model,
  onDetail,
}: {
  model: ImageModelConfig;
  onDetail: () => void;
}) {
  const statusCfg = STATUS_CONFIG[model.status];
  const StatusIcon = statusCfg.icon;
  return (
    <Card className="overflow-hidden hover:shadow-md transition-all flex flex-col">
      <div className={cn("bg-gradient-to-br p-4 text-white", model.gradient)}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-lg font-bold">{model.name}</p>
            <p className="text-xs opacity-90">{model.fullName}</p>
            <p className="text-[10px] opacity-75 mt-0.5 flex items-center gap-1">
              {model.isDomestic ? <Globe className="h-3 w-3" /> : null}
              {model.vendor}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium">
            <StatusIcon className="h-3 w-3" />
            {statusCfg.label}
          </span>
        </div>
      </div>

      <CardContent className="p-4 space-y-3 flex-1">
        <p className="text-xs text-muted-foreground line-clamp-2 h-8">
          {model.description}
        </p>

        {/* 关键指标 */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted/40 rounded-lg p-1.5">
            <Clock className="h-3 w-3 mx-auto text-sky-600" />
            <p className="text-[10px] text-muted-foreground mt-0.5">耗时</p>
            <p className="text-xs font-bold">
              {(model.avgDuration / 1000).toFixed(1)}s
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-1.5">
            <DollarSign className="h-3 w-3 mx-auto text-emerald-600" />
            <p className="text-[10px] text-muted-foreground mt-0.5">单价</p>
            <p className="text-xs font-bold">
              {model.currency === "CNY" ? "¥" : "$"}
              {model.pricePerImage}
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-1.5">
            <Activity className="h-3 w-3 mx-auto text-violet-600" />
            <p className="text-[10px] text-muted-foreground mt-0.5">成功率</p>
            <p className="text-xs font-bold">{model.successRate}%</p>
          </div>
        </div>

        {/* 评分 */}
        <div className="grid grid-cols-2 gap-2">
          <ScoreBar
            value={model.qualityScore}
            label="质量"
            color="bg-violet-500"
          />
          <ScoreBar
            value={model.stabilityScore}
            label="稳定性"
            color="bg-emerald-500"
          />
        </div>

        {/* 支持模式 */}
        <div className="flex flex-wrap gap-1">
          {model.capabilities.modes.map((m) => {
            const Icon = MODE_ICONS[m] ?? Type;
            return (
              <span
                key={m}
                className="inline-flex items-center gap-1 rounded border bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 px-1.5 py-0.5 text-[9px]"
              >
                <Icon className="h-2.5 w-2.5" />
                {MODE_LABELS[m]}
              </span>
            );
          })}
        </div>

        {/* 能力标签 */}
        <div className="flex flex-wrap gap-1">
          {model.capabilities.supportsNegativePrompt && (
            <span className="text-[9px] bg-amber-500/10 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">
              反向提示
            </span>
          )}
          {model.capabilities.supportsSeed && (
            <span className="text-[9px] bg-sky-500/10 text-sky-700 dark:text-sky-400 px-1.5 py-0.5 rounded">
              随机种子
            </span>
          )}
          {model.capabilities.supportsGuidance && (
            <span className="text-[9px] bg-violet-500/10 text-violet-700 dark:text-violet-400 px-1.5 py-0.5 rounded">
              引导系数
            </span>
          )}
          {model.asyncMode && (
            <span className="text-[9px] bg-rose-500/10 text-rose-700 dark:text-rose-400 px-1.5 py-0.5 rounded">
              异步任务
            </span>
          )}
          {model.capabilities.maxBatchSize > 1 && (
            <span className="text-[9px] bg-teal-500/10 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 rounded">
              批量×{model.capabilities.maxBatchSize}
            </span>
          )}
        </div>

        {/* 统计 */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t">
          <span className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            累计 {model.totalGenerated.toLocaleString("zh-CN")}
          </span>
          <span className="flex items-center gap-1">
            <Shield className="h-3 w-3" />
            免费 {model.freeQuota}/月
          </span>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={onDetail}
        >
          <Settings className="h-3.5 w-3.5 mr-1.5" />
          查看详情
        </Button>
      </CardContent>
    </Card>
  );
}

function ModelDetailDialog({
  model,
  open,
  onOpenChange,
}: {
  model: ImageModelConfig | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  if (!model) return null;
  const statusCfg = STATUS_CONFIG[model.status];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div
              className={cn(
                "h-10 w-10 rounded-lg bg-gradient-to-br flex items-center justify-center text-white",
                model.gradient
              )}
            >
              <Wand2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                {model.name}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    statusCfg.color
                  )}
                >
                  {statusCfg.label}
                </span>
                {model.isDomestic && (
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20"
                  >
                    国产
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-normal">
                {model.fullName} · {model.vendor}
              </p>
            </div>
          </DialogTitle>
          <DialogDescription>{model.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 最佳场景 */}
          <div>
            <p className="text-xs font-medium mb-1.5">最佳使用场景</p>
            <div className="flex flex-wrap gap-1.5">
              {model.bestFor.map((s) => (
                <Badge
                  key={s}
                  variant="outline"
                  className="text-[10px] bg-muted/30"
                >
                  {s}
                </Badge>
              ))}
            </div>
          </div>

          {/* 性能与商务 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2 bg-muted/30 rounded-lg p-3">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-amber-500" />
                性能指标
              </p>
              <ScoreBar
                value={model.qualityScore}
                label="质量评分"
                color="bg-violet-500"
              />
              <ScoreBar
                value={model.stabilityScore}
                label="稳定性"
                color="bg-emerald-500"
              />
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-muted-foreground">平均耗时</span>
                <span className="font-mono">
                  {(model.avgDuration / 1000).toFixed(2)}s
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">成功率</span>
                <span className="font-mono text-emerald-600">
                  {model.successRate}%
                </span>
              </div>
              {model.asyncMode && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">任务模式</span>
                  <span className="font-mono text-rose-600">
                    异步 (轮询 {(model.pollingInterval / 1000).toFixed(1)}s)
                  </span>
                </div>
              )}
            </div>
            <div className="space-y-2 bg-muted/30 rounded-lg p-3">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <DollarSign className="h-3 w-3 text-emerald-500" />
                商务信息
              </p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">单张价格</span>
                <span className="font-bold">
                  {model.currency === "CNY" ? "¥" : "$"}
                  {model.pricePerImage}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">每月免费额度</span>
                <span className="font-mono">{model.freeQuota} 张</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">累计生成</span>
                <span className="font-mono">
                  {model.totalGenerated.toLocaleString("zh-CN")}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">币种</span>
                <span className="font-mono">{model.currency}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">单次最大批量</span>
                <span className="font-mono">
                  {model.capabilities.maxBatchSize} 张
                </span>
              </div>
            </div>
          </div>

          {/* 支持的生成模式 */}
          <div>
            <p className="text-xs font-medium mb-2 flex items-center gap-1.5">
              <Type className="h-3 w-3" />
              支持的生成模式
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  "text_to_image",
                  "image_to_image",
                  "image_editing",
                  "inpainting",
                  "upscaling",
                ] as GenerationMode[]
              ).map((m) => {
                const enabled = model.capabilities.modes.includes(m);
                const Icon = MODE_ICONS[m] ?? Type;
                return (
                  <div
                    key={m}
                    className={cn(
                      "rounded-lg border p-2 flex items-center gap-2",
                      enabled
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-border bg-muted/20 opacity-50"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5",
                        enabled ? "text-emerald-600" : "text-muted-foreground"
                      )}
                    />
                    <span className="text-[11px]">{MODE_LABELS[m]}</span>
                    {enabled ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-500 ml-auto" />
                    ) : (
                      <XCircle className="h-3 w-3 ml-auto" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 支持的尺寸 */}
          <div className="bg-muted/30 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-medium">支持尺寸</p>
            <div className="flex flex-wrap gap-1">
              {model.capabilities.sizes.map((s) => (
                <Badge
                  key={s}
                  variant="outline"
                  className="text-[10px] font-mono"
                >
                  {s}
                </Badge>
              ))}
            </div>
          </div>

          {/* 高级能力 */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div
              className={cn(
                "rounded-lg border p-2 flex items-center justify-between",
                model.capabilities.supportsNegativePrompt
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-border opacity-50"
              )}
            >
              <span>反向提示词</span>
              {model.capabilities.supportsNegativePrompt ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
            </div>
            <div
              className={cn(
                "rounded-lg border p-2 flex items-center justify-between",
                model.capabilities.supportsSeed
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-border opacity-50"
              )}
            >
              <span>随机种子</span>
              {model.capabilities.supportsSeed ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
            </div>
            <div
              className={cn(
                "rounded-lg border p-2 flex items-center justify-between",
                model.capabilities.supportsGuidance
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-border opacity-50"
              )}
            >
              <span>引导系数</span>
              {model.capabilities.supportsGuidance ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
            </div>
            <div
              className={cn(
                "rounded-lg border p-2 flex items-center justify-between",
                model.capabilities.supportsStyle
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-border opacity-50"
              )}
            >
              <span>风格预设</span>
              {model.capabilities.supportsStyle ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
            </div>
          </div>

          {/* API 配置 */}
          <div className="bg-zinc-900 dark:bg-zinc-950 text-zinc-300 rounded-lg p-3 space-y-1">
            <p className="text-xs font-medium text-zinc-100">API 配置</p>
            <div className="text-[11px] font-mono space-y-0.5">
              <p>
                <span className="text-zinc-500">Endpoint:</span>{" "}
                {model.apiEndpoint}
              </p>
              <p>
                <span className="text-zinc-500">Auth:</span> {model.authType}
              </p>
              <p>
                <span className="text-zinc-500">Key Env:</span>{" "}
                <span className="text-amber-400">${model.apiKeyEnv}</span>
              </p>
              <p>
                <span className="text-zinc-500">Async:</span>{" "}
                {model.asyncMode ? "是" : "否"}
              </p>
            </div>
          </div>

          <a
            href={model.vendorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            访问 {model.vendor} 官网
          </a>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              toast({
                title: "配置已打开",
                description: "实际部署时此处跳转到 API Key 配置",
              })
            }
          >
            <Settings className="h-4 w-4 mr-1.5" />
            配置 API Key
          </Button>
          <Button onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const COMPARE_LIMIT = 4;

export function ImageModelsAdminView() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDomestic, setFilterDomestic] = useState<string>("all");
  const [detailModel, setDetailModel] = useState<ImageModelConfig | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<
    Set<ImageModelId>
  >(new Set());

  const filtered = IMAGE_MODEL_LIST.filter((m) => {
    const matchSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.fullName.toLowerCase().includes(search.toLowerCase()) ||
      m.vendor.toLowerCase().includes(search.toLowerCase()) ||
      m.bestFor.some((b) => b.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = filterStatus === "all" || m.status === filterStatus;
    const matchDomestic =
      filterDomestic === "all" ||
      (filterDomestic === "domestic" ? m.isDomestic : !m.isDomestic);
    return matchSearch && matchStatus && matchDomestic;
  });

  const stats = {
    total: IMAGE_MODEL_LIST.length,
    active: IMAGE_MODEL_LIST.filter((m) => m.status === "active").length,
    domestic: IMAGE_MODEL_LIST.filter((m) => m.isDomestic).length,
    international: IMAGE_MODEL_LIST.filter((m) => !m.isDomestic).length,
    totalGenerated: IMAGE_MODEL_LIST.reduce((s, m) => s + m.totalGenerated, 0),
    avgQuality: Math.round(
      IMAGE_MODEL_LIST.reduce((s, m) => s + m.qualityScore, 0) /
        IMAGE_MODEL_LIST.length
    ),
  };

  const handleToggleCompare = (id: ImageModelId) => {
    setSelectedForCompare((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= COMPARE_LIMIT) {
          toast({
            title: `最多对比 ${COMPARE_LIMIT} 个`,
            variant: "destructive",
          });
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const compareModels = IMAGE_MODEL_LIST.filter((m) =>
    selectedForCompare.has(m.id)
  );

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="生图模型管理"
        description="统一管理 11 个主流生图大模型 · DALL·E 3 / SD 3 / Flux / Midjourney / 即梦 / 通义万相 / 文心一格 / CogView / GPT-Image-2 / Nano Banana Pro / Nano Banana 2"
        actions={
          <Button
            variant={compareMode ? "default" : "outline"}
            onClick={() => {
              setCompareMode(!compareMode);
              if (compareMode) setSelectedForCompare(new Set());
            }}
            className={
              compareMode
                ? "bg-gradient-to-r from-violet-500 to-purple-600"
                : ""
            }
          >
            <Layers className="h-4 w-4 mr-1.5" />
            {compareMode
              ? "退出对比"
              : `对比模式${selectedForCompare.size > 0 ? ` (${selectedForCompare.size})` : ""}`}
          </Button>
        }
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">模型总数</p>
              <p className="text-xl font-bold">{stats.total}</p>
            </div>
            <div className="rounded-lg bg-violet-500/10 p-2">
              <ImageIcon className="h-4 w-4 text-violet-600" />
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">运行中</p>
              <p className="text-xl font-bold text-emerald-600">
                {stats.active}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">国产模型</p>
              <p className="text-xl font-bold text-sky-600">{stats.domestic}</p>
            </div>
            <div className="rounded-lg bg-sky-500/10 p-2">
              <Globe className="h-4 w-4 text-sky-600" />
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">国际模型</p>
              <p className="text-xl font-bold text-amber-600">
                {stats.international}
              </p>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-2">
              <Globe className="h-4 w-4 text-amber-600" />
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">累计生成</p>
              <p className="text-xl font-bold">
                {stats.totalGenerated.toLocaleString("zh-CN")}
              </p>
            </div>
            <div className="rounded-lg bg-rose-500/10 p-2">
              <TrendingUp className="h-4 w-4 text-rose-600" />
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">平均质量</p>
              <p className="text-xl font-bold text-teal-600">
                {stats.avgQuality}
              </p>
            </div>
            <div className="rounded-lg bg-teal-500/10 p-2">
              <Shield className="h-4 w-4 text-teal-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* 过滤器 */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模型名、厂商、场景..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground">状态:</span>
          {(["all", "active", "maintenance"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilterStatus(s)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                filterStatus === s
                  ? "bg-foreground text-background border-foreground"
                  : "hover:bg-muted"
              )}
            >
              {s === "all" ? "全部" : STATUS_CONFIG[s].label}
            </button>
          ))}
          <span className="text-[10px] text-muted-foreground ml-2">来源:</span>
          {(["all", "domestic", "international"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilterDomestic(s)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-full border transition-colors",
                filterDomestic === s
                  ? "bg-foreground text-background border-foreground"
                  : "hover:bg-muted"
              )}
            >
              {s === "all" ? "全部" : s === "domestic" ? "国产" : "国际"}
            </button>
          ))}
        </div>
      </div>

      {/* 模型卡片 */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={ImageIcon}
              title="无匹配模型"
              description="尝试调整搜索条件"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((m) => (
            <div key={m.id} className="relative">
              {compareMode && (
                <button
                  type="button"
                  onClick={() => handleToggleCompare(m.id)}
                  className={cn(
                    "absolute top-2 right-2 z-10 h-7 w-7 rounded-full border-2 flex items-center justify-center transition-all",
                    selectedForCompare.has(m.id)
                      ? "bg-violet-500 border-violet-500 text-white"
                      : "bg-white/80 border-white text-violet-600 hover:bg-violet-50"
                  )}
                  aria-label="select for compare"
                >
                  {selectedForCompare.has(m.id) && (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                </button>
              )}
              <ModelCard model={m} onDetail={() => setDetailModel(m)} />
            </div>
          ))}
        </div>
      )}

      {/* 对比视图 */}
      {compareMode && compareModels.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-violet-600" />
              模型对比 ({compareModels.length})
            </CardTitle>
            <CardDescription className="text-xs">
              横向对比已选模型的关键指标
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">
                    指标
                  </th>
                  {compareModels.map((m) => (
                    <th
                      key={m.id}
                      className="text-left py-2 px-3 min-w-[120px]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: m.color }}
                        />
                        <span className="font-bold">{m.name}</span>
                        {m.isDomestic && (
                          <span className="text-[9px] text-sky-600">国产</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">厂商</td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="py-2 px-3">
                      {m.vendor}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">状态</td>
                  {compareModels.map((m) => {
                    const cfg = STATUS_CONFIG[m.status];
                    return (
                      <td key={m.id} className="py-2 px-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px]",
                            cfg.color
                          )}
                        >
                          {cfg.label}
                        </span>
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">平均耗时</td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="py-2 px-3 font-mono">
                      {(m.avgDuration / 1000).toFixed(1)}s
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">质量评分</td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="py-2 px-3">
                      <span className="font-mono font-bold text-violet-600">
                        {m.qualityScore}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">稳定性</td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="py-2 px-3">
                      <span className="font-mono font-bold text-emerald-600">
                        {m.stabilityScore}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">单张价格</td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="py-2 px-3 font-mono">
                      {m.currency === "CNY" ? "¥" : "$"}
                      {m.pricePerImage}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">免费额度</td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="py-2 px-3 font-mono">
                      {m.freeQuota}/月
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">单次批量</td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="py-2 px-3 font-mono">
                      {m.capabilities.maxBatchSize}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">异步任务</td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="py-2 px-3">
                      {m.asyncMode ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">支持模式</td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="py-2 px-3">
                      <div className="flex flex-wrap gap-0.5">
                        {m.capabilities.modes.map((mode) => (
                          <Badge
                            key={mode}
                            variant="outline"
                            className="text-[9px] py-0"
                          >
                            {MODE_LABELS[mode]}
                          </Badge>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">
                    支持尺寸数
                  </td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="py-2 px-3 font-mono">
                      {m.capabilities.sizes.length}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">累计生成</td>
                  {compareModels.map((m) => (
                    <td key={m.id} className="py-2 px-3 font-mono">
                      {m.totalGenerated.toLocaleString("zh-CN")}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">成功率</td>
                  {compareModels.map((m) => (
                    <td
                      key={m.id}
                      className="py-2 px-3 font-mono text-emerald-600"
                    >
                      {m.successRate}%
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* 详情对话框 */}
      <ModelDetailDialog
        model={detailModel}
        open={!!detailModel}
        onOpenChange={(open) => !open && setDetailModel(null)}
      />
    </div>
  );
}
