"use client";

import {
  AlertTriangle,
  Box,
  Boxes,
  CheckCircle2,
  Cpu,
  Download,
  Eye,
  FileArchive,
  Loader2,
  Wand2,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  formatDate,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import {
  MOCK_EFFECTS,
  MOCK_MODELS,
  MOCK_PHOTOS,
} from "@/features/mooncada/lib/mock-data";
import type { Provider3DId } from "@/features/mooncada/lib/providers/types";
import {
  PROVIDER_LIST_3D,
  PROVIDERS_3D,
} from "@/features/mooncada/lib/providers/types";
import type { Model3D } from "@/features/mooncada/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function ModelsModule() {
  const { toast } = useToast();
  const [models, setModels] = useState<Model3D[]>(MOCK_MODELS);
  const [previewModel, setPreviewModel] = useState<Model3D | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  // 生成表单
  const [genProvider, setGenProvider] = useState<Provider3DId>("meshy");
  const [genInputType, setGenInputType] = useState<"text" | "image">("image");
  const [genPhotoId, setGenPhotoId] = useState<string>("");
  const [genPrompt, setGenPrompt] = useState("");
  const [genOutputFormat, setGenOutputFormat] = useState<string>("glb");
  const [genQuality, setGenQuality] = useState<string>("medium");

  const handleDownload = (model: Model3D, type: "original" | "print") => {
    setDownloading(`${model.modelId}-${type}`);
    setTimeout(() => {
      setModels((prev) =>
        prev.map((m) =>
          m.modelId === model.modelId
            ? { ...m, downloadCount: m.downloadCount + 1 }
            : m
        )
      );
      setDownloading(null);
      toast({
        title: "下载已开始",
        description: `${type === "original" ? "原始文件" : "打印文件"}: ${model.suggestedFileName}`,
      });
      if (model.downloadCount + 1 > 5) {
        toast({
          title: "下载次数提醒",
          description:
            model.downloadCount + 1 > 10
              ? "下载次数过多，请确认文件版本"
              : "请确认使用最新版本",
          variant: model.downloadCount + 1 > 10 ? "destructive" : "default",
        });
      }
    }, 1500);
  };

  const handleGenerate3D = async () => {
    const provider = PROVIDERS_3D[genProvider];
    if (provider.status === "maintenance") {
      toast({
        title: "引擎维护中",
        description: `${provider.name} 当前不可用`,
        variant: "destructive",
      });
      return;
    }
    if (genInputType === "image" && !genPhotoId) {
      toast({ title: "请选择图片", variant: "destructive" });
      return;
    }
    if (genInputType === "text" && !genPrompt) {
      toast({ title: "请输入文本描述", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/3d/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: genProvider,
          inputType: genInputType,
          imageUrl:
            genInputType === "image"
              ? MOCK_PHOTOS.find((p) => p.photoId === genPhotoId)?.fileUrl
              : undefined,
          textPrompt: genInputType === "text" ? genPrompt : undefined,
          outputFormat: genOutputFormat,
          quality: genQuality,
          enablePBR: true,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "生成失败");
      }
      // 添加到模型列表
      const newModel: Model3D = {
        modelId: data.modelId ?? `MD_NEW_${Date.now()}`,
        effectId: "EF_DIRECT",
        userId: "U_USER_001",
        status: "processing",
        previewUrl:
          data.previewUrl ??
          `https://picsum.photos/seed/new${Date.now()}/400/400`,
        downloadCount: 0,
        suggestedFileName: `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_NEW_TASK1.${genOutputFormat}`,
        createdAt: new Date().toISOString(),
        provider: genProvider,
        providerName: provider.name,
        generateDuration: provider.avgDuration,
        inputType: genInputType,
        prompt:
          genInputType === "text" ? genPrompt : `从图片 ${genPhotoId} 生成`,
        cost: provider.pricePerGeneration,
        currency: provider.currency,
      };
      setModels((prev) => [newModel, ...prev]);
      setGenerateOpen(false);
      setGenPrompt("");
      setGenPhotoId("");
      toast({
        title: `${provider.name} 任务已提交`,
        description: `任务ID: ${data.taskId ?? "-"} · 预计 ${(provider.avgDuration / 1000).toFixed(1)}s 完成`,
      });
      // 模拟异步完成
      setTimeout(() => {
        setModels((prev) =>
          prev.map((m) =>
            m.modelId === newModel.modelId
              ? {
                  ...m,
                  status: "completed",
                  generateDuration: provider.avgDuration,
                }
              : m
          )
        );
        toast({
          title: "3D模型生成完成",
          description: `${newModel.modelId} · ${provider.name}`,
        });
      }, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      toast({ title: "生成失败", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="3D 模型"
        description="支持 6 个引擎生成3D模型 · Tripo3D / 混元3D / Meshy / Hyper3D / Hitem3D / Triverse3D · 原始与打印文件分别管理"
        actions={
          <Button
            onClick={() => setGenerateOpen(true)}
            className="bg-gradient-to-r from-emerald-500 to-teal-600"
          >
            <Wand2 className="h-4 w-4 mr-1.5" />
            生成3D模型
          </Button>
        }
      />

      {/* 模型列表 */}
      {models.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Box}
              title="暂无3D模型"
              description="从2D效果图生成3D模型后，将在此处显示"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map((model) => {
            const effect = MOCK_EFFECTS.find(
              (e) => e.effectId === model.effectId
            );
            const hasWarning = model.downloadCount > 5;
            const hasCritical = model.downloadCount > 10;
            return (
              <Card
                key={model.modelId}
                className="overflow-hidden hover:shadow-md transition-all"
              >
                {/* 预览 */}
                <div
                  className="aspect-square bg-gradient-to-br from-muted to-muted/50 relative cursor-pointer group"
                  onClick={() => setPreviewModel(model)}
                >
                  <img
                    src={model.previewUrl}
                    alt={model.modelId}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <Button size="sm" variant="secondary">
                      <Eye className="h-4 w-4 mr-1" /> 预览
                    </Button>
                  </div>
                  {model.orderId && (
                    <Badge className="absolute top-2 left-2 text-[10px] bg-black/60 text-white border-0">
                      订单 {model.orderId}
                    </Badge>
                  )}
                  {hasCritical ? (
                    <Badge className="absolute top-2 right-2 text-[10px] bg-rose-500/90 text-white border-0">
                      <AlertTriangle className="h-3 w-3 mr-1" /> 下载过多
                    </Badge>
                  ) : hasWarning ? (
                    <Badge className="absolute top-2 right-2 text-[10px] bg-amber-500/90 text-white border-0">
                      <AlertTriangle className="h-3 w-3 mr-1" /> 请确认版本
                    </Badge>
                  ) : null}
                </div>
                {/* 信息 */}
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate">
                      {effect?.maskName ?? "3D模型"}
                    </p>
                    {model.status === "processing" ? (
                      <Badge className="text-[10px] bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        生成中
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-600" />
                        已完成
                      </Badge>
                    )}
                  </div>
                  {/* Provider 标签 */}
                  {model.provider && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white"
                        style={{
                          backgroundColor:
                            PROVIDERS_3D[model.provider as Provider3DId]
                              ?.color ?? "#64748b",
                        }}
                      >
                        <Cpu className="h-2.5 w-2.5" />
                        {model.providerName ??
                          PROVIDERS_3D[model.provider as Provider3DId]?.name ??
                          model.provider}
                      </span>
                      {model.generateDuration && (
                        <span className="text-[10px] text-muted-foreground">
                          {(model.generateDuration / 1000).toFixed(1)}s
                        </span>
                      )}
                      {model.cost && (
                        <span className="text-[10px] text-muted-foreground">
                          {model.currency === "CNY" ? "¥" : "$"}
                          {model.cost}
                        </span>
                      )}
                      {model.polyCount && (
                        <span className="text-[10px] text-muted-foreground">
                          {(model.polyCount / 1000).toFixed(0)}k 面
                        </span>
                      )}
                    </div>
                  )}
                  <p
                    className="text-[10px] text-muted-foreground font-mono truncate"
                    title={model.suggestedFileName}
                  >
                    <FileArchive className="h-3 w-3 inline mr-1" />
                    {model.suggestedFileName}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{formatDate(model.createdAt, true)}</span>
                    <span className="flex items-center gap-1">
                      <Download className="h-3 w-3" />
                      下载 {model.downloadCount} 次
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownload(model, "original")}
                      disabled={
                        downloading === `${model.modelId}-original` ||
                        model.status === "processing"
                      }
                    >
                      {downloading === `${model.modelId}-original` ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5 mr-1" />
                      )}
                      原始文件
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownload(model, "print")}
                      disabled={
                        downloading === `${model.modelId}-print` ||
                        model.status === "processing"
                      }
                    >
                      {downloading === `${model.modelId}-print` ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5 mr-1" />
                      )}
                      打印文件
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 生成3D模型对话框 */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-emerald-600" />
              生成3D模型
            </DialogTitle>
            <DialogDescription>
              选择3D引擎与输入，提交后异步生成模型
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* 引擎选择 */}
            <div className="space-y-1.5">
              <Label>选择3D引擎</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PROVIDER_LIST_3D.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setGenProvider(p.id)}
                    disabled={p.status === "maintenance"}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-lg border text-left transition-all disabled:opacity-40",
                      genProvider === p.id
                        ? "border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/30"
                        : "hover:bg-muted"
                    )}
                  >
                    <span
                      className="h-6 w-6 rounded shrink-0"
                      style={{ backgroundColor: p.color }}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{p.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {p.currency === "CNY" ? "¥" : "$"}
                        {p.pricePerGeneration} ·{" "}
                        {(p.avgDuration / 1000).toFixed(1)}s
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              {PROVIDERS_3D[genProvider] && (
                <p className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2">
                  {PROVIDERS_3D[genProvider].description}
                </p>
              )}
            </div>

            {/* 输入类型 */}
            <div className="space-y-1.5">
              <Label>输入类型</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setGenInputType("image")}
                  className={cn(
                    "p-2 rounded-lg border text-xs",
                    genInputType === "image"
                      ? "border-emerald-500 bg-emerald-500/5"
                      : "hover:bg-muted"
                  )}
                >
                  图片转3D
                </button>
                <button
                  onClick={() => setGenInputType("text")}
                  className={cn(
                    "p-2 rounded-lg border text-xs",
                    genInputType === "text"
                      ? "border-emerald-500 bg-emerald-500/5"
                      : "hover:bg-muted"
                  )}
                >
                  文本转3D
                </button>
              </div>
            </div>

            {/* 输入内容 */}
            {genInputType === "image" ? (
              <div className="space-y-1.5">
                <Label>选择图片</Label>
                <Select value={genPhotoId} onValueChange={setGenPhotoId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择用户上传的照片" />
                  </SelectTrigger>
                  <SelectContent>
                    {MOCK_PHOTOS.map((p) => (
                      <SelectItem key={p.photoId} value={p.photoId}>
                        {p.fileName} ({p.photoId})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>文本描述</Label>
                <Textarea
                  value={genPrompt}
                  onChange={(e) => setGenPrompt(e.target.value)}
                  placeholder="如：a cute chibi character with big eyes, holding a sword"
                  rows={3}
                  className="text-xs"
                />
              </div>
            )}

            {/* 高级参数 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>输出格式</Label>
                <Select
                  value={genOutputFormat}
                  onValueChange={setGenOutputFormat}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS_3D[genProvider].capabilities.outputFormats.map(
                      (f) => (
                        <SelectItem
                          key={f}
                          value={f}
                          className="uppercase font-mono"
                        >
                          {f}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>质量</Label>
                <Select value={genQuality} onValueChange={setGenQuality}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">草稿 (快)</SelectItem>
                    <SelectItem value="medium">中等</SelectItem>
                    <SelectItem value="high">高质量</SelectItem>
                    <SelectItem value="ultra">极致 (慢)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 成本预估 */}
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">预估成本</p>
                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                  {PROVIDERS_3D[genProvider].currency === "CNY" ? "¥" : "$"}
                  {PROVIDERS_3D[genProvider].pricePerGeneration}
                </p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>
                  预计耗时:{" "}
                  {(PROVIDERS_3D[genProvider].avgDuration / 1000).toFixed(1)}s
                </p>
                <p>成功率: {PROVIDERS_3D[genProvider].successRate}%</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleGenerate3D}
              disabled={generating}
              className="bg-gradient-to-r from-emerald-500 to-teal-600"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-1.5" />
                  开始生成
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 预览对话框 */}
      <Dialog
        open={!!previewModel}
        onOpenChange={(open) => !open && setPreviewModel(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-emerald-600" />
              3D模型预览
            </DialogTitle>
            <DialogDescription>
              {previewModel?.modelId} · {previewModel?.suggestedFileName}
            </DialogDescription>
          </DialogHeader>
          {previewModel && (
            <div className="space-y-3">
              <div className="aspect-video bg-gradient-to-br from-muted to-muted/30 rounded-lg flex items-center justify-center relative overflow-hidden">
                <img
                  src={previewModel.previewUrl}
                  alt="3D preview"
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                  <Badge className="bg-black/60 text-white border-0">
                    3D Preview
                  </Badge>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="bg-white/90"
                    >
                      旋转
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="bg-white/90"
                    >
                      缩放
                    </Button>
                  </div>
                </div>
              </div>
              {/* 详细信息 */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-muted/50 rounded-lg p-2.5">
                  <p className="text-muted-foreground mb-0.5">模型ID</p>
                  <p className="font-mono">{previewModel.modelId}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-2.5">
                  <p className="text-muted-foreground mb-0.5">关联订单</p>
                  <p className="font-mono">{previewModel.orderId ?? "-"}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-2.5">
                  <p className="text-muted-foreground mb-0.5">任务序号</p>
                  <p>TASK {previewModel.taskNum ?? "-"}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-2.5">
                  <p className="text-muted-foreground mb-0.5">下载次数</p>
                  <p
                    className={cn(
                      previewModel.downloadCount > 5 && "text-amber-600",
                      previewModel.downloadCount > 10 && "text-rose-600"
                    )}
                  >
                    {previewModel.downloadCount} 次
                  </p>
                </div>
              </div>
              {/* 警告 */}
              {previewModel.warning && (
                <div
                  className={cn(
                    "rounded-lg p-3 flex items-start gap-2 text-sm",
                    previewModel.downloadCount > 10
                      ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                      : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  )}
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">{previewModel.warning}</p>
                    <p className="text-xs mt-0.5 opacity-80">
                      建议与设计师确认当前文件版本，避免打印错误版本
                    </p>
                  </div>
                </div>
              )}
              {/* 文件名规范说明 */}
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 mb-1">
                  文件命名规范
                </p>
                <p className="text-xs text-muted-foreground">
                  文件名格式：
                  <code className="bg-muted px-1 py-0.5 rounded">
                    XXXXYXXMXXD_ORDERID_TASKN.zip
                  </code>
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  例：20260303D_ORD001005_TASK1.zip
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                previewModel && handleDownload(previewModel, "original")
              }
            >
              <Download className="h-4 w-4 mr-1.5" /> 原始文件
            </Button>
            <Button
              onClick={() =>
                previewModel && handleDownload(previewModel, "print")
              }
              className="bg-gradient-to-r from-emerald-500 to-teal-600"
            >
              <Download className="h-4 w-4 mr-1.5" /> 下载打印文件
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
