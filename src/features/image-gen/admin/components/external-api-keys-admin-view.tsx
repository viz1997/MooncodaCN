"use client";

/**
 * 外部生图 API Key 管理 - Admin 视图
 *
 * 仿 mooncada-source/src/components/mooncada/modules/public-image-gen.tsx 设计：
 * - 顶部：外部页面预览卡片（指向 /[locale]/image-gen）
 * - 统计卡片：API Key 总数 / 启用中 / 累计调用 / 本月调用 / 累计成本
 * - API Key 列表：脱敏显示、明文切换、复制、启停、配额进度条、允许效果
 * - 新建对话框：生成新 Key，默认配额 100/月
 *
 * 数据为前端 mock（MOCK_EXTERNAL_API_KEYS），后端接入留后续阶段
 */

import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Copy,
  DollarSign,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Key,
  Plus,
  Trash2,
  TrendingUp,
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
import { MOCK_EXTERNAL_API_KEYS } from "@/features/image-gen/lib/external-api-keys-mock";
import type { ExternalApiKey } from "@/features/image-gen/lib/external-api-keys-types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const QUOTA_BAR_RED = 1;
const QUOTA_BAR_AMBER = 0.8;

function formatDateTime(iso?: string): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("zh-CN");
}

/**
 * 生成 24 位随机 key 字符串
 */
function randomKeyString(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i += 1) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

interface QuotaStat {
  percent: number;
  level: "ok" | "amber" | "red";
}

function computeQuota(monthlyCalls: number, monthlyQuota: number): QuotaStat {
  const percent = Math.min(
    100,
    Math.round((monthlyCalls / Math.max(monthlyQuota, 1)) * 100)
  );
  const level: QuotaStat["level"] =
    monthlyCalls >= monthlyQuota * QUOTA_BAR_RED
      ? "red"
      : monthlyCalls >= monthlyQuota * QUOTA_BAR_AMBER
        ? "amber"
        : "ok";
  return { percent, level };
}

export function ExternalApiKeysAdminView() {
  const { toast } = useToast();
  const [apiKeys, setApiKeys] = useState<ExternalApiKey[]>(
    MOCK_EXTERNAL_API_KEYS
  );
  const [showFullKey, setShowFullKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const stats = {
    total: apiKeys.length,
    active: apiKeys.filter((k) => k.status === "active").length,
    totalCalls: apiKeys.reduce((s, k) => s + k.totalCalls, 0),
    monthlyCalls: apiKeys.reduce((s, k) => s + k.monthlyCalls, 0),
    totalCost: apiKeys.reduce((s, k) => s + k.cost, 0),
  };

  const handleCopyKey = (key: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(key).catch(() => {});
    }
    toast({ title: "已复制 API Key" });
  };

  const handleToggleStatus = (k: ExternalApiKey) => {
    const nextStatus = k.status === "active" ? "disabled" : "active";
    setApiKeys((prev) =>
      prev.map((x) =>
        x.id === k.id
          ? {
              ...x,
              status: nextStatus,
            }
          : x
      )
    );
    toast({
      title: nextStatus === "active" ? "已启用" : "已禁用",
      description: k.name,
    });
  };

  const handleCreate = () => {
    const fullKey = randomKeyString();
    const head = fullKey.slice(0, 6);
    const tail = fullKey.slice(-2);
    const newKey: ExternalApiKey = {
      id: `ak_${String(Date.now()).slice(-6)}`,
      name: `新客户·${new Date().toLocaleDateString("zh-CN")}`,
      apiKey: `mk_public_${fullKey}`,
      maskedKey: `mk_public_${head}****${tail}`,
      status: "active",
      createdAt: new Date().toISOString(),
      totalCalls: 0,
      monthlyCalls: 0,
      monthlyQuota: 100,
      cost: 0,
      allowedMasks: ["MASK_001", "MASK_002"],
    };
    setApiKeys((prev) => [newKey, ...prev]);
    setCreateOpen(false);
    toast({ title: "API Key 已创建", description: newKey.name });
  };

  const handleDelete = (k: ExternalApiKey) => {
    setApiKeys((prev) => prev.filter((x) => x.id !== k.id));
    toast({
      title: "已删除",
      description: k.name,
      variant: "destructive",
    });
  };

  const openPublicPage = () => {
    if (typeof window !== "undefined") {
      window.open("/image-gen", "_blank");
    }
  };

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Globe className="h-5 w-5 text-violet-600" />
            外部生图服务
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            为非平台用户提供独立的生图网页 · 专属 API Key 通道 · 极简操作体验
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openPublicPage}>
            <ExternalLink className="h-4 w-4 mr-1.5" />
            打开外部生图页面
          </Button>
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-gradient-to-r from-violet-500 to-purple-600"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            新建 API Key
          </Button>
        </div>
      </div>

      {/* 外部页面预览卡片 */}
      <Card className="overflow-hidden border-violet-500/20 bg-gradient-to-br from-violet-500/5 to-purple-500/5">
        <CardContent className="p-5">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shrink-0">
              <Globe className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-bold">外部生图页面</h3>
                <Badge
                  variant="outline"
                  className="text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                >
                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                  已部署
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                独立路由页面，无需登录平台，外部用户通过专属 API Key
                即可使用生图服务
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-[11px] bg-muted px-2 py-0.5 rounded font-mono">
                  /image-gen
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={openPublicPage}
                >
                  访问页面 <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </div>
          </div>

          {/* 使用流程 */}
          <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t">
            {[
              { step: "1", title: "输入 API Key", desc: "专属通道认证" },
              { step: "2", title: "上传参考图", desc: "可选，支持拖拽" },
              { step: "3", title: "选择效果", desc: "已上架效果模版" },
              { step: "4", title: "生成下载", desc: "一键下载图片" },
            ].map((s) => (
              <div key={s.step} className="text-center">
                <div className="h-6 w-6 rounded-full bg-violet-500 text-white text-[10px] flex items-center justify-center font-bold mx-auto mb-1">
                  {s.step}
                </div>
                <p className="text-[11px] font-medium">{s.title}</p>
                <p className="text-[10px] text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">API Key 总数</p>
              <p className="text-xl font-bold">{stats.total}</p>
            </div>
            <div className="rounded-lg bg-violet-500/10 p-2">
              <Key className="h-4 w-4 text-violet-600" />
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">启用中</p>
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
              <p className="text-[10px] text-muted-foreground">累计调用</p>
              <p className="text-xl font-bold">
                {stats.totalCalls.toLocaleString("zh-CN")}
              </p>
            </div>
            <div className="rounded-lg bg-sky-500/10 p-2">
              <Activity className="h-4 w-4 text-sky-600" />
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">本月调用</p>
              <p className="text-xl font-bold text-amber-600">
                {stats.monthlyCalls.toLocaleString("zh-CN")}
              </p>
            </div>
            <div className="rounded-lg bg-amber-500/10 p-2">
              <TrendingUp className="h-4 w-4 text-amber-600" />
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-muted-foreground">累计成本</p>
              <p className="text-xl font-bold text-rose-600">
                ¥{stats.totalCost.toFixed(2)}
              </p>
            </div>
            <div className="rounded-lg bg-rose-500/10 p-2">
              <DollarSign className="h-4 w-4 text-rose-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* API Key 列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4 text-violet-600" />
            API Key 管理
          </CardTitle>
          <CardDescription className="text-xs">
            每个 Key 对应一个外部客户，可独立配置配额与权限
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {apiKeys.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-center text-muted-foreground">
              <Key className="h-10 w-10 mb-3" />
              <p className="font-medium">暂无 API Key</p>
              <p className="text-sm">点击右上角新建</p>
            </div>
          ) : (
            <div className="divide-y">
              {apiKeys.map((k) => {
                const quota = computeQuota(k.monthlyCalls, k.monthlyQuota);
                return (
                  <div
                    key={k.id}
                    className="p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-2">
                        {/* 客户名 + 状态 */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{k.name}</p>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                              k.status === "active"
                                ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900"
                                : "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-900/40 dark:text-zinc-400 dark:border-zinc-800"
                            )}
                          >
                            {k.status === "active" ? "启用" : "已禁用"}
                          </span>
                        </div>

                        {/* API Key */}
                        <div className="flex items-center gap-2 bg-muted/40 rounded px-2 py-1.5">
                          <code className="text-xs font-mono flex-1 truncate">
                            {showFullKey === k.id ? k.apiKey : k.maskedKey}
                          </code>
                          <button
                            type="button"
                            onClick={() =>
                              setShowFullKey(showFullKey === k.id ? null : k.id)
                            }
                            className="text-muted-foreground hover:text-foreground p-1"
                            aria-label="toggle visibility"
                          >
                            {showFullKey === k.id ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyKey(k.apiKey)}
                            className="text-muted-foreground hover:text-foreground p-1"
                            aria-label="copy"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* 统计信息 */}
                        <div className="grid grid-cols-4 gap-2 text-[10px]">
                          <div>
                            <span className="text-muted-foreground">
                              累计调用
                            </span>
                            <p className="font-mono font-medium">
                              {k.totalCalls.toLocaleString("zh-CN")}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              本月/配额
                            </span>
                            <p className="font-mono font-medium">
                              <span
                                className={cn(
                                  quota.level === "red" && "text-rose-600"
                                )}
                              >
                                {k.monthlyCalls}
                              </span>
                              /{k.monthlyQuota}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              累计成本
                            </span>
                            <p className="font-mono font-medium">
                              ¥{k.cost.toFixed(2)}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              最后使用
                            </span>
                            <p className="font-medium">
                              {k.lastUsedAt
                                ? formatDateTime(k.lastUsedAt)
                                : "从未"}
                            </p>
                          </div>
                        </div>

                        {/* 配额进度条 */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                "h-full transition-all",
                                quota.level === "red"
                                  ? "bg-rose-500"
                                  : quota.level === "amber"
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                              )}
                              style={{ width: `${quota.percent}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            {quota.percent}%
                          </span>
                        </div>

                        {/* 允许的效果 */}
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-[10px] text-muted-foreground">
                            允许效果:
                          </span>
                          {k.allowedMasks.map((m) => (
                            <Badge
                              key={m}
                              variant="outline"
                              className="text-[9px] font-mono py-0"
                            >
                              {m}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => handleToggleStatus(k)}
                        >
                          {k.status === "active" ? "禁用" : "启用"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-rose-600 hover:text-rose-700"
                          onClick={() => handleDelete(k)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 创建对话框（简化版，直接创建） */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => !open && setCreateOpen(false)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-violet-600" />
              新建 API Key
            </DialogTitle>
            <DialogDescription>
              将创建一个新的 API Key，默认配额 100 次/月，允许使用 MASK_001 和
              MASK_002 效果。创建后可在详情中调整。
            </DialogDescription>
          </DialogHeader>
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              提示：创建后可在 API Key 列表查看与编辑详细信息。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              className="bg-gradient-to-r from-violet-500 to-purple-600"
              onClick={handleCreate}
            >
              确认创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
