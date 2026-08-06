"use client";

/**
 * 3D 引擎管理 - Admin 视图
 *
 * 仿 mooncada-source/modules/providers-3d.tsx 设计：
 * - 5 张统计卡片（引擎总数 / 运行中 / 维护中 / 累计生成 / 平均质量）
 * - 场景推荐引擎（6 个使用场景 → 首选 + 备选引擎）
 * - 引擎卡片网格（耗时/单价/成功率/能力标签）
 * - 对比模式：最多 4 个引擎横向对比
 * - 详情对话框：性能 + 商务 + 能力矩阵 + 输出规格 + API 配置
 *
 * 数据来自 PROVIDER_LIST_3D（src/features/mooncada/lib/providers/types.ts）
 */

import {
  Activity,
  AlertTriangle,
  Bone,
  Box,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Layers,
  Settings,
  Shield,
  TrendingUp,
  Type,
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
import {
  EmptyState,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import type {
  Provider3DConfig,
  Provider3DId,
  ProviderStatus,
} from "@/features/mooncada/lib/providers/types";
import {
  PROVIDER_LIST_3D,
  PROVIDERS_3D,
  RECOMMEND_BY_SCENE,
} from "@/features/mooncada/lib/providers/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  ProviderStatus,
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

const CAPABILITY_ICONS: Record<
  keyof Omit<
    import("@/features/mooncada/lib/providers/types").ProviderCapabilities,
    "outputFormats" | "maxPolyCount" | "maxTextureResolution"
  >,
  { icon: typeof Type; label: string }
> = {
  textTo3d: { icon: Type, label: "文本生3D" },
  imageTo3d: { icon: ImageIcon, label: "图片生3D" },
  multiView: { icon: Layers, label: "多视角" },
  pbrTexture: { icon: Box, label: "PBR纹理" },
  rigging: { icon: Bone, label: "骨骼绑定" },
  animation: { icon: Film, label: "动画" },
};

const SCENE_LABELS: Record<string, string> = {
  character_animation: "角色动画",
  high_end_custom: "高端定制",
  ecommerce: "电商产品",
  rapid_prototype: "快速原型",
  game_asset: "游戏资产",
  "3d_printing": "3D打印",
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

function ProviderCard({
  provider,
  onDetail,
}: {
  provider: Provider3DConfig;
  onDetail: () => void;
}) {
  const statusCfg = STATUS_CONFIG[provider.status];
  const StatusIcon = statusCfg.icon;
  return (
    <Card className="overflow-hidden hover:shadow-md transition-all flex flex-col">
      <div
        className={cn("bg-gradient-to-br p-4 text-white", provider.gradient)}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-lg font-bold">{provider.name}</p>
            <p className="text-xs opacity-90">{provider.fullName}</p>
            <p className="text-[10px] opacity-75 mt-0.5">
              厂商: {provider.vendor}
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
          {provider.description}
        </p>

        {/* 关键指标 */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted/40 rounded-lg p-1.5">
            <Clock className="h-3 w-3 mx-auto text-sky-600" />
            <p className="text-[10px] text-muted-foreground mt-0.5">耗时</p>
            <p className="text-xs font-bold">
              {(provider.avgDuration / 1000).toFixed(1)}s
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-1.5">
            <DollarSign className="h-3 w-3 mx-auto text-emerald-600" />
            <p className="text-[10px] text-muted-foreground mt-0.5">单价</p>
            <p className="text-xs font-bold">
              {provider.currency === "CNY" ? "¥" : "$"}
              {provider.pricePerGeneration}
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-1.5">
            <Activity className="h-3 w-3 mx-auto text-violet-600" />
            <p className="text-[10px] text-muted-foreground mt-0.5">成功率</p>
            <p className="text-xs font-bold">{provider.successRate}%</p>
          </div>
        </div>

        {/* 评分 */}
        <div className="grid grid-cols-2 gap-2">
          <ScoreBar
            value={provider.qualityScore}
            label="质量"
            color="bg-violet-500"
          />
          <ScoreBar
            value={provider.stabilityScore}
            label="稳定性"
            color="bg-emerald-500"
          />
        </div>

        {/* 能力标签 */}
        <div className="flex flex-wrap gap-1">
          {(
            Object.entries(CAPABILITY_ICONS) as [
              keyof typeof CAPABILITY_ICONS,
              (typeof CAPABILITY_ICONS)[keyof typeof CAPABILITY_ICONS],
            ][]
          ).map(([key, cfg]) => {
            const Icon = cfg.icon;
            const enabled = provider.capabilities[key];
            return (
              <span
                key={key}
                className={cn(
                  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px]",
                  enabled
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                    : "bg-muted text-muted-foreground border-border line-through opacity-50"
                )}
              >
                <Icon className="h-2.5 w-2.5" />
                {cfg.label}
              </span>
            );
          })}
        </div>

        {/* 统计 */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t">
          <span className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            累计 {provider.totalGenerated.toLocaleString("zh-CN")}
          </span>
          <span className="flex items-center gap-1">
            <Shield className="h-3 w-3" />
            免费 {provider.freeQuota}/月
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

function ProviderDetailDialog({
  provider,
  open,
  onOpenChange,
}: {
  provider: Provider3DConfig | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  if (!provider) return null;
  const statusCfg = STATUS_CONFIG[provider.status];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div
              className={cn(
                "h-10 w-10 rounded-lg bg-gradient-to-br flex items-center justify-center text-white",
                provider.gradient
              )}
            >
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                {provider.name}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    statusCfg.color
                  )}
                >
                  {statusCfg.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground font-normal">
                {provider.fullName} · {provider.vendor}
              </p>
            </div>
          </DialogTitle>
          <DialogDescription>{provider.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 最佳场景 */}
          <div>
            <p className="text-xs font-medium mb-1.5">最佳使用场景</p>
            <div className="flex flex-wrap gap-1.5">
              {provider.bestFor.map((s) => (
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

          {/* 性能指标 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2 bg-muted/30 rounded-lg p-3">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-amber-500" />
                性能指标
              </p>
              <ScoreBar
                value={provider.qualityScore}
                label="质量评分"
                color="bg-violet-500"
              />
              <ScoreBar
                value={provider.stabilityScore}
                label="稳定性"
                color="bg-emerald-500"
              />
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-muted-foreground">平均耗时</span>
                <span className="font-mono">
                  {(provider.avgDuration / 1000).toFixed(2)}s
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">成功率</span>
                <span className="font-mono text-emerald-600">
                  {provider.successRate}%
                </span>
              </div>
            </div>
            <div className="space-y-2 bg-muted/30 rounded-lg p-3">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <DollarSign className="h-3 w-3 text-emerald-500" />
                商务信息
              </p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">单次价格</span>
                <span className="font-bold">
                  {provider.currency === "CNY" ? "¥" : "$"}
                  {provider.pricePerGeneration}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">每月免费额度</span>
                <span className="font-mono">{provider.freeQuota} 次</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">累计生成</span>
                <span className="font-mono">
                  {provider.totalGenerated.toLocaleString("zh-CN")}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">币种</span>
                <span className="font-mono">{provider.currency}</span>
              </div>
            </div>
          </div>

          {/* 能力矩阵 */}
          <div>
            <p className="text-xs font-medium mb-2 flex items-center gap-1.5">
              <Box className="h-3 w-3" />
              能力矩阵
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(
                Object.entries(CAPABILITY_ICONS) as [
                  keyof typeof CAPABILITY_ICONS,
                  (typeof CAPABILITY_ICONS)[keyof typeof CAPABILITY_ICONS],
                ][]
              ).map(([key, cfg]) => {
                const Icon = cfg.icon;
                const enabled = provider.capabilities[key];
                return (
                  <div
                    key={key}
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
                    <span className="text-[11px]">{cfg.label}</span>
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

          {/* 输出规格 */}
          <div className="bg-muted/30 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-medium">输出规格</p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">支持格式</span>
              <div className="flex gap-1">
                {provider.capabilities.outputFormats.map((f) => (
                  <Badge
                    key={f}
                    variant="outline"
                    className="text-[10px] font-mono uppercase"
                  >
                    {f}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">最大面数</span>
              <span className="font-mono">
                {provider.capabilities.maxPolyCount.toLocaleString("zh-CN")}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">最大纹理分辨率</span>
              <span className="font-mono">
                {provider.capabilities.maxTextureResolution}×
                {provider.capabilities.maxTextureResolution}
              </span>
            </div>
          </div>

          {/* API 配置 */}
          <div className="bg-zinc-900 dark:bg-zinc-950 text-zinc-300 rounded-lg p-3 space-y-1">
            <p className="text-xs font-medium text-zinc-100">API 配置</p>
            <div className="text-[11px] font-mono space-y-0.5">
              <p>
                <span className="text-zinc-500">Endpoint:</span>{" "}
                {provider.apiEndpoint}
              </p>
              <p>
                <span className="text-zinc-500">Auth:</span> {provider.authType}
              </p>
              <p>
                <span className="text-zinc-500">Key Env:</span>{" "}
                <span className="text-amber-400">${provider.apiKeyEnv}</span>
              </p>
            </div>
          </div>

          <a
            href={provider.vendorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            访问 {provider.vendor} 官网
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

export function Providers3DAdminView() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [detailProvider, setDetailProvider] = useState<Provider3DConfig | null>(
    null
  );
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<
    Set<Provider3DId>
  >(new Set());

  const filtered = PROVIDER_LIST_3D.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.fullName.toLowerCase().includes(search.toLowerCase()) ||
      p.vendor.toLowerCase().includes(search.toLowerCase()) ||
      p.bestFor.some((b) => b.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = filterStatus === "all" || p.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const stats = {
    total: PROVIDER_LIST_3D.length,
    active: PROVIDER_LIST_3D.filter((p) => p.status === "active").length,
    maintenance: PROVIDER_LIST_3D.filter((p) => p.status === "maintenance")
      .length,
    totalGenerated: PROVIDER_LIST_3D.reduce((s, p) => s + p.totalGenerated, 0),
    avgQuality: Math.round(
      PROVIDER_LIST_3D.reduce((s, p) => s + p.qualityScore, 0) /
        PROVIDER_LIST_3D.length
    ),
  };

  const handleToggleCompare = (id: Provider3DId) => {
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

  const compareProviders = PROVIDER_LIST_3D.filter((p) =>
    selectedForCompare.has(p.id)
  );

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="3D 引擎管理"
        description="统一管理 6 个 3D 生成引擎 · Tripo3D / 混元3D / Meshy / Hyper3D / Hitem3D / Triverse3D · 能力对比与调用路由"
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">引擎总数</p>
              <p className="text-xl font-bold">{stats.total}</p>
            </div>
            <div className="rounded-lg bg-violet-500/10 p-2">
              <Cpu className="h-4 w-4 text-violet-600" />
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
              <p className="text-[10px] text-muted-foreground">维护中</p>
              <p className="text-xl font-bold text-amber-600">
                {stats.maintenance}
              </p>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
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
            <div className="rounded-lg bg-sky-500/10 p-2">
              <TrendingUp className="h-4 w-4 text-sky-600" />
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

      {/* 场景推荐 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            场景推荐引擎
          </CardTitle>
          <CardDescription className="text-xs">
            根据使用场景智能推荐最佳引擎
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.entries(RECOMMEND_BY_SCENE).map(([scene, providers]) => (
            <div
              key={scene}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30"
            >
              <span className="text-xs font-medium w-20 shrink-0">
                {SCENE_LABELS[scene] ?? scene}
              </span>
              <div className="flex gap-1.5 flex-wrap">
                {providers.map((pid, i) => {
                  const p = PROVIDERS_3D[pid];
                  return (
                    <button
                      type="button"
                      key={pid}
                      onClick={() => setDetailProvider(p)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs border transition-all hover:shadow-sm",
                        i === 0
                          ? cn(
                              "text-white border-0 bg-gradient-to-r",
                              p.gradient
                            )
                          : "bg-card hover:bg-muted/50"
                      )}
                    >
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          i === 0 ? "bg-white" : ""
                        )}
                        style={i === 0 ? {} : { backgroundColor: p.color }}
                      />
                      {p.name}
                      {i === 0 && (
                        <span className="text-[9px] opacity-90">首选</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 过滤器 */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Cpu className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索引擎名、厂商、场景..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30"
          />
        </div>
        <div className="flex items-center gap-1">
          {(["all", "active", "maintenance", "deprecated"] as const).map(
            (s) => (
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
            )
          )}
        </div>
      </div>

      {/* 引擎卡片网格 */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Cpu}
              title="无匹配引擎"
              description="尝试调整搜索条件"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div key={p.id} className="relative">
              {compareMode && (
                <button
                  type="button"
                  onClick={() => handleToggleCompare(p.id)}
                  className={cn(
                    "absolute top-2 right-2 z-10 h-7 w-7 rounded-full border-2 flex items-center justify-center transition-all",
                    selectedForCompare.has(p.id)
                      ? "bg-violet-500 border-violet-500 text-white"
                      : "bg-white/80 border-white text-violet-600 hover:bg-violet-50"
                  )}
                  aria-label="select for compare"
                >
                  {selectedForCompare.has(p.id) && (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                </button>
              )}
              <ProviderCard
                provider={p}
                onDetail={() => setDetailProvider(p)}
              />
            </div>
          ))}
        </div>
      )}

      {/* 对比视图 */}
      {compareMode && compareProviders.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-violet-600" />
              引擎对比 ({compareProviders.length})
            </CardTitle>
            <CardDescription className="text-xs">
              横向对比已选引擎的关键指标
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">
                    指标
                  </th>
                  {compareProviders.map((p) => (
                    <th
                      key={p.id}
                      className="text-left py-2 px-3 min-w-[120px]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: p.color }}
                        />
                        <span className="font-bold">{p.name}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">厂商</td>
                  {compareProviders.map((p) => (
                    <td key={p.id} className="py-2 px-3">
                      {p.vendor}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">状态</td>
                  {compareProviders.map((p) => {
                    const cfg = STATUS_CONFIG[p.status];
                    return (
                      <td key={p.id} className="py-2 px-3">
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
                  {compareProviders.map((p) => (
                    <td key={p.id} className="py-2 px-3 font-mono">
                      {(p.avgDuration / 1000).toFixed(1)}s
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">质量评分</td>
                  {compareProviders.map((p) => (
                    <td key={p.id} className="py-2 px-3">
                      <span className="font-mono font-bold text-violet-600">
                        {p.qualityScore}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">稳定性</td>
                  {compareProviders.map((p) => (
                    <td key={p.id} className="py-2 px-3">
                      <span className="font-mono font-bold text-emerald-600">
                        {p.stabilityScore}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">单次价格</td>
                  {compareProviders.map((p) => (
                    <td key={p.id} className="py-2 px-3 font-mono">
                      {p.currency === "CNY" ? "¥" : "$"}
                      {p.pricePerGeneration}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">免费额度</td>
                  {compareProviders.map((p) => (
                    <td key={p.id} className="py-2 px-3 font-mono">
                      {p.freeQuota}/月
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">最大面数</td>
                  {compareProviders.map((p) => (
                    <td key={p.id} className="py-2 px-3 font-mono">
                      {p.capabilities.maxPolyCount.toLocaleString("zh-CN")}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">
                    纹理分辨率
                  </td>
                  {compareProviders.map((p) => (
                    <td key={p.id} className="py-2 px-3 font-mono">
                      {provider_cap_resolution(p)}px
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">输出格式</td>
                  {compareProviders.map((p) => (
                    <td key={p.id} className="py-2 px-3">
                      <div className="flex flex-wrap gap-0.5">
                        {p.capabilities.outputFormats.map((f) => (
                          <Badge
                            key={f}
                            variant="outline"
                            className="text-[9px] py-0 uppercase font-mono"
                          >
                            {f}
                          </Badge>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">累计生成</td>
                  {compareProviders.map((p) => (
                    <td key={p.id} className="py-2 px-3 font-mono">
                      {p.totalGenerated.toLocaleString("zh-CN")}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted-foreground">成功率</td>
                  {compareProviders.map((p) => (
                    <td
                      key={p.id}
                      className="py-2 px-3 font-mono text-emerald-600"
                    >
                      {p.successRate}%
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* 详情对话框 */}
      <ProviderDetailDialog
        provider={detailProvider}
        open={!!detailProvider}
        onOpenChange={(open) => !open && setDetailProvider(null)}
      />
    </div>
  );
}

function provider_cap_resolution(p: Provider3DConfig): number {
  return p.capabilities.maxTextureResolution;
}
