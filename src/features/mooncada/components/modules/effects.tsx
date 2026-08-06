"use client";

import {
  CheckCircle2,
  Clock,
  History,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Upload,
  Wand2,
  X,
  XCircle,
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  formatDate,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import { useAgentStore } from "@/features/mooncada/lib/agent-store";
import type { ImageModelId } from "@/features/mooncada/lib/image-models/types";
import {
  IMAGE_MODEL_LIST,
  IMAGE_MODELS,
} from "@/features/mooncada/lib/image-models/types";
import {
  MOCK_EFFECTS,
  MOCK_PHOTOS,
  MOCK_PRODUCT_EFFECTS,
} from "@/features/mooncada/lib/mock-data";
import { useMooncadaStore } from "@/features/mooncada/lib/store";
import type { Effect2D, EffectStatus } from "@/features/mooncada/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  EffectStatus,
  { label: string; icon: typeof Clock; color: string; bg: string }
> = {
  pending: {
    label: "排队中",
    icon: Clock,
    color: "text-amber-600",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  processing: {
    label: "生成中",
    icon: Loader2,
    color: "text-sky-600",
    bg: "bg-sky-500/10 border-sky-500/20",
  },
  completed: {
    label: "已完成",
    icon: CheckCircle2,
    color: "text-emerald-600",
    bg: "bg-emerald-500/10 border-emerald-500/20",
  },
  failed: {
    label: "失败",
    icon: XCircle,
    color: "text-rose-600",
    bg: "bg-rose-500/10 border-rose-500/20",
  },
};

// 本地上传图片类型
interface UploadedImage {
  file: File;
  previewUrl: string; // 本地 ObjectURL 预览
  fileName: string;
  fileSize: number;
}

export function EffectsModule() {
  const { toast } = useToast();
  const [effects, setEffects] = useState<Effect2D[]>(MOCK_EFFECTS);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [previewEffect, setPreviewEffect] = useState<Effect2D | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<string>(
    MOCK_PHOTOS[0]?.photoId ?? ""
  );
  const [selectedMask, setSelectedMask] = useState<string>(
    MOCK_PRODUCT_EFFECTS[0]?.maskId ?? ""
  );
  const [selectedImageModel, setSelectedImageModel] =
    useState<ImageModelId>("doubao");
  const [generating, setGenerating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  // 参考图模式: 'library' 从图库选, 'upload' 本地上传, 'none' 不使用参考图（纯文生图）
  const [refImageMode, setRefImageMode] = useState<
    "library" | "upload" | "none"
  >("library");
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(
    null
  );
  const [dragOver, setDragOver] = useState(false);

  const filtered =
    filterStatus === "all"
      ? effects
      : effects.filter((e) => e.status === filterStatus);

  // 处理本地文件选择
  const handleFileSelect = (file: File | undefined) => {
    if (!file) return;
    // 校验类型
    if (
      !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(
        file.type
      )
    ) {
      toast({
        title: "格式不支持",
        description: "请上传 JPG/PNG/WEBP 格式图片",
        variant: "destructive",
      });
      return;
    }
    // 校验大小 (10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "文件过大",
        description: "图片大小不能超过 10MB",
        variant: "destructive",
      });
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setUploadedImage({
      file,
      previewUrl,
      fileName: file.name,
      fileSize: file.size,
    });
    toast({
      title: "图片已选择",
      description: `${file.name} (${(file.size / 1024).toFixed(1)}KB)`,
    });
  };

  const handleRemoveUpload = () => {
    if (uploadedImage) {
      URL.revokeObjectURL(uploadedImage.previewUrl);
    }
    setUploadedImage(null);
  };

  // 切换模式时清理上传
  const handleModeChange = (mode: "library" | "upload" | "none") => {
    if (mode !== "upload" && uploadedImage) {
      handleRemoveUpload();
    }
    setRefImageMode(mode);
  };

  // 获取当前参考图信息（图库或本地上传）
  const getRefImage = (): {
    imageUrl: string;
    thumbUrl: string;
    photoId: string;
    photoName: string;
  } | null => {
    if (refImageMode === "library") {
      const photo = MOCK_PHOTOS.find((p) => p.photoId === selectedPhoto);
      if (!photo) return null;
      return {
        imageUrl: photo.fileUrl,
        thumbUrl: photo.thumbnailUrl,
        photoId: photo.photoId,
        photoName: photo.fileName,
      };
    }
    if (refImageMode === "upload" && uploadedImage) {
      return {
        imageUrl: uploadedImage.previewUrl,
        thumbUrl: uploadedImage.previewUrl,
        photoId: "LOCAL_UPLOAD",
        photoName: uploadedImage.fileName,
      };
    }
    return null; // none 模式
  };

  const handleGenerate = async () => {
    const mask = MOCK_PRODUCT_EFFECTS.find((m) => m.maskId === selectedMask);
    if (!mask) return;
    const imageModelCfg = IMAGE_MODELS[selectedImageModel];
    if (imageModelCfg.status === "maintenance") {
      toast({
        title: "模型维护中",
        description: `${imageModelCfg.name} 当前不可用`,
        variant: "destructive",
      });
      return;
    }

    const refImage = getRefImage();
    // 文生图模式不需要参考图；图生图模式必须提供参考图
    const generationMode = refImage ? "image_to_image" : "text_to_image";
    if (!refImage && refImageMode !== "none") {
      toast({
        title: '请提供参考图或选择"不使用参考图"',
        variant: "destructive",
      });
      return;
    }

    // 将产品效果的 prompt 中的 {{变量}} 替换为默认值
    let renderedPrompt = mask.prompt;
    mask.variables.forEach((v) => {
      renderedPrompt = renderedPrompt.replace(
        new RegExp(`\\{\\{${v.key}\\}\\}`, "g"),
        v.defaultValue
      );
    });

    setGenerating(true);

    // 乐观添加一条 processing 状态的记录
    const newEffect: Effect2D = {
      effectId: `EF_${String(Date.now()).slice(-6)}`,
      userId: "U_USER_001",
      photoId: refImage?.photoId ?? "TEXT_ONLY",
      photoUrl: refImage?.thumbUrl ?? "",
      maskId: mask.maskId,
      maskName: mask.name,
      status: "processing",
      resultUrls: [],
      prompt: renderedPrompt,
      createdAt: new Date().toISOString(),
      imageModel: selectedImageModel,
      imageModelName: imageModelCfg.name,
      mode: generationMode,
    };
    setEffects((prev) => [newEffect, ...prev]);

    try {
      const res = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedImageModel,
          mode: generationMode,
          prompt: renderedPrompt,
          imageUrl: refImage?.imageUrl,
          size: "1024x1024",
          batchSize: 3,
          maskId: mask.maskId,
          photoId: refImage?.photoId,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "生成失败");
      }

      // 异步任务模式：模拟轮询查询
      let result = data;
      if (data.taskId && data.status === "processing") {
        // 模拟轮询（实际应调用 /api/image/task/[id]?model=xxx）
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(
          `/api/image/task/${data.taskId}?model=${selectedImageModel}`
        );
        result = await pollRes.json();
      }

      if (!result.success) {
        throw new Error(result.error || "生成失败");
      }

      // 更新记录为完成
      setEffects((prev) =>
        prev.map((e) =>
          e.effectId === newEffect.effectId
            ? {
                ...e,
                status: "completed",
                resultUrls: (result.images ?? []).map(
                  (img: { url: string }) => img.url
                ),
                completedAt: new Date().toISOString(),
                generateDuration: result.duration,
                cost: result.cost,
                currency: result.currency,
                revisedPrompt: result.images?.[0]?.revisedPrompt,
                seed: result.images?.[0]?.seed,
              }
            : e
        )
      );
      toast({
        title: "生成完成",
        description: `使用「${mask.name}」+「${imageModelCfg.name}」生成 ${(result.images ?? []).length} 张`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      setEffects((prev) =>
        prev.map((e) =>
          e.effectId === newEffect.effectId
            ? { ...e, status: "failed", errorMsg: msg }
            : e
        )
      );
      toast({ title: "生成失败", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
      setGenerateOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="2D 效果图"
        description="查看 AI 生成的2D效果图历史 · 点击「去生图工作台」开始新的创作"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                useAgentStore.getState().setActiveWorkflow("recommend_mask");
                useAgentStore.getState().open();
              }}
              className="border-violet-500/30 text-violet-700 dark:text-violet-400 hover:bg-violet-500/5"
            >
              <Sparkles className="h-4 w-4 mr-1.5" />
              AI推荐3D模版
            </Button>
            <Button
              onClick={() =>
                useMooncadaStore.getState().setModule("generate-workbench")
              }
              className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
            >
              <Wand2 className="h-4 w-4 mr-1.5" />
              去生图工作台
            </Button>
          </div>
        }
      />

      {/* 状态过滤 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">状态筛选：</span>
        {["all", "pending", "processing", "completed", "failed"].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              filterStatus === s
                ? "bg-foreground text-background border-foreground"
                : "hover:bg-muted"
            )}
          >
            {s === "all" ? "全部" : STATUS_CONFIG[s as EffectStatus].label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          共 {filtered.length} 条记录
        </span>
      </div>

      {/* 历史记录 */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={History}
              title="暂无效果图"
              description="点击右上角按钮生成您的第一个2D效果图"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((effect) => {
            const config = STATUS_CONFIG[effect.status];
            const StatusIcon = config.icon;
            return (
              <Card
                key={effect.effectId}
                className="overflow-hidden hover:shadow-md transition-all"
              >
                {/* 结果图 */}
                <div
                  className="aspect-video bg-muted relative cursor-pointer"
                  onClick={() => setPreviewEffect(effect)}
                >
                  {effect.status === "completed" &&
                  effect.resultUrls.length > 0 ? (
                    <div className="grid grid-cols-3 h-full">
                      {effect.resultUrls.slice(0, 3).map((url, i) => (
                        <img
                          key={i}
                          src={url}
                          alt={`结果${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-2">
                      <StatusIcon
                        className={cn(
                          "h-8 w-8",
                          config.color,
                          effect.status === "processing" && "animate-spin"
                        )}
                      />
                      <p className="text-xs text-muted-foreground">
                        {config.label}
                      </p>
                    </div>
                  )}
                  <Badge
                    className={cn(
                      "absolute top-2 right-2 text-[10px]",
                      config.bg,
                      config.color,
                      "border"
                    )}
                  >
                    <StatusIcon
                      className={cn(
                        "h-3 w-3 mr-1",
                        effect.status === "processing" && "animate-spin"
                      )}
                    />
                    {config.label}
                  </Badge>
                </div>
                {/* 信息 */}
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate">
                      {effect.maskName}
                    </p>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {effect.effectId}
                    </span>
                  </div>
                  {/* 生图模型标签 */}
                  {effect.imageModel && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white"
                        style={{
                          backgroundColor:
                            IMAGE_MODELS[effect.imageModel as ImageModelId]
                              ?.color ?? "#64748b",
                        }}
                      >
                        <Wand2 className="h-2.5 w-2.5" />
                        {effect.imageModelName ?? effect.imageModel}
                      </span>
                      {effect.generateDuration && (
                        <span className="text-[10px] text-muted-foreground">
                          {(effect.generateDuration / 1000).toFixed(1)}s
                        </span>
                      )}
                      {effect.cost && (
                        <span className="text-[10px] text-muted-foreground">
                          {effect.currency === "CNY" ? "¥" : "$"}
                          {effect.cost}
                        </span>
                      )}
                      {effect.seed && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          seed:{effect.seed}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <img
                      src={effect.photoUrl}
                      alt="原图"
                      className="h-8 w-8 rounded object-cover"
                    />
                    <div className="text-[10px] text-muted-foreground">
                      <p>原图: {effect.photoId}</p>
                      <p>{formatDate(effect.createdAt, true)}</p>
                    </div>
                  </div>
                  {effect.status === "failed" && effect.errorMsg && (
                    <p className="text-[10px] text-rose-600 bg-rose-500/5 rounded p-1.5">
                      {effect.errorMsg}
                    </p>
                  )}
                  {effect.status === "completed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => setPreviewEffect(effect)}
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                      查看效果 ({effect.resultUrls.length})
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 预览对话框 */}
      <Dialog
        open={!!previewEffect}
        onOpenChange={(open) => !open && setPreviewEffect(null)}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              {previewEffect?.maskName}
            </DialogTitle>
            <DialogDescription>
              {previewEffect?.effectId} · 生成于{" "}
              {previewEffect && formatDate(previewEffect.createdAt, true)}
            </DialogDescription>
          </DialogHeader>
          {previewEffect && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">原图</p>
                  <img
                    src={previewEffect.photoUrl}
                    alt="原图"
                    className="w-full aspect-square object-cover rounded-lg"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    AI生成结果（第1张）
                  </p>
                  {previewEffect.resultUrls[0] && (
                    <img
                      src={previewEffect.resultUrls[0]}
                      alt="结果"
                      className="w-full aspect-square object-cover rounded-lg"
                    />
                  )}
                </div>
              </div>
              {previewEffect.resultUrls.length > 1 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    其他生成结果
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {previewEffect.resultUrls.slice(1).map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`结果${i + 2}`}
                        className="w-full aspect-square object-cover rounded-lg"
                      />
                    ))}
                  </div>
                </div>
              )}
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Prompt</p>
                <p className="text-xs font-mono">{previewEffect.prompt}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                toast({
                  title: "已加入3D生成队列",
                  description: "可前往 3D模型 模块查看",
                })
              }
            >
              生成3D模型
            </Button>
            <Button onClick={() => toast({ title: "已收藏" })}>收藏效果</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
