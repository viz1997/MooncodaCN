"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Heart,
  History,
  ImageIcon,
  Loader2,
  Maximize2,
  RefreshCw,
  Send,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
  Type,
  Upload,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/features/mooncada/components/shared";
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
import type { Effect2D, EffectStatus } from "@/features/mooncada/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ============ 类型 ============
interface UploadedImage {
  file: File;
  previewUrl: string;
  fileName: string;
  fileSize: number;
}

type RefMode = "library" | "upload" | "none";

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

// ============ 主工作台 ============
export function GenerateWorkbenchModule() {
  const { toast } = useToast();
  // 历史记录（倒序，最新在前）
  const [history, setHistory] = useState<Effect2D[]>(MOCK_EFFECTS);
  // 选中查看的图（默认最新一条）
  const [selectedEffect, setSelectedEffect] = useState<Effect2D | null>(
    MOCK_EFFECTS[0] ?? null
  );

  // 参考图
  const [refMode, setRefMode] = useState<RefMode>("upload");
  const [selectedPhoto, setSelectedPhoto] = useState<string>(
    MOCK_PHOTOS[0]?.photoId ?? ""
  );
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(
    null
  );
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 提示词
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  // 提示词模板开关：开启时使用产品效果模版的 prompt，隐藏手动输入
  const [useTemplate, setUseTemplate] = useState(true);

  // 模型与参数
  const [selectedModel, setSelectedModel] = useState<ImageModelId>("doubao");
  const [selectedMask, setSelectedMask] = useState<string>(
    MOCK_PRODUCT_EFFECTS[0]?.maskId ?? ""
  );
  // 模板模式下用户填入的变量取值（key -> value），优先于 defaultValue
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [batchSize, setBatchSize] = useState(1);
  const [size, setSize] = useState("1024x1024");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [guidanceScale, setGuidanceScale] = useState(7);
  const [steps, setSteps] = useState(30);
  const [seed, setSeed] = useState<number | "">("");
  const [safetyCheck, setSafetyCheck] = useState(true);

  const [generating, setGenerating] = useState(false);

  const modelConfig = IMAGE_MODELS[selectedModel];
  const selectedMaskData = MOCK_PRODUCT_EFFECTS.find(
    (m) => m.maskId === selectedMask
  );

  // ============ 文件处理 ============
  const handleFileSelect = (file: File | undefined) => {
    if (!file) return;
    if (
      !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(
        file.type
      )
    ) {
      toast({
        title: "格式不支持",
        description: "请上传 JPG/PNG/WEBP",
        variant: "destructive",
      });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "文件过大",
        description: "最大 10MB",
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
  };

  const handleRemoveUpload = () => {
    if (uploadedImage) URL.revokeObjectURL(uploadedImage.previewUrl);
    setUploadedImage(null);
  };

  const handleModeChange = (mode: RefMode) => {
    if (mode !== "upload" && uploadedImage) handleRemoveUpload();
    setRefMode(mode);
  };

  // ============ 选择产品效果时初始化参数取值 ============
  const handleSelectMask = (maskId: string) => {
    setSelectedMask(maskId);
    const mask = MOCK_PRODUCT_EFFECTS.find((m) => m.maskId === maskId);
    if (mask) {
      // 自动使用产品效果指定的生图模型
      if (mask.model) {
        setSelectedModel(mask.model as ImageModelId);
      }
      // 初始化各变量为默认值
      const init: Record<string, string> = {};
      mask.variables.forEach((v) => {
        init[v.key] = v.defaultValue;
      });
      setParamValues(init);
    }
  };

  // 初始化时按默认选中模板填充参数
  useEffect(() => {
    if (selectedMaskData) {
      const init: Record<string, string> = {};
      selectedMaskData.variables.forEach((v) => {
        init[v.key] = v.defaultValue;
      });
      setParamValues(init);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============ 获取参考图 ============
  const getRefImage = () => {
    if (refMode === "library") {
      const photo = MOCK_PHOTOS.find((p) => p.photoId === selectedPhoto);
      return photo
        ? {
            imageUrl: photo.fileUrl,
            thumbUrl: photo.thumbnailUrl,
            photoId: photo.photoId,
          }
        : null;
    }
    if (refMode === "upload" && uploadedImage) {
      return {
        imageUrl: uploadedImage.previewUrl,
        thumbUrl: uploadedImage.previewUrl,
        photoId: "LOCAL_UPLOAD",
      };
    }
    return null;
  };

  // ============ 渲染模板 prompt：用 paramValues 替换占位符（用户值 > defaultValue） ============
  const renderTemplatePrompt = (mask = selectedMaskData) => {
    if (!mask) return "";
    let rendered = mask.prompt;
    mask.variables.forEach((v) => {
      const val = paramValues[v.key] || v.defaultValue;
      rendered = rendered.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, "g"), val);
    });
    return rendered;
  };

  // ============ 生成 ============
  const handleGenerate = async () => {
    // 开启模板模式时，prompt 由模板 + 参数取值渲染；关闭时需要手动输入
    const effectivePrompt = useTemplate ? renderTemplatePrompt() : prompt;

    if (!effectivePrompt.trim()) {
      toast({
        title: useTemplate ? "请选择效果模版" : "请输入提示词",
        variant: "destructive",
      });
      return;
    }
    // 模板模式必填参数校验
    if (useTemplate && selectedMaskData) {
      const missing = selectedMaskData.variables.find(
        (v) => v.required && !(paramValues[v.key] || v.defaultValue)
      );
      if (missing) {
        toast({
          title: "缺少必填参数",
          description: `${missing.label}（{{${missing.key}}}）`,
          variant: "destructive",
        });
        return;
      }
    }
    if (modelConfig.status === "maintenance") {
      toast({
        title: "模型维护中",
        description: `${modelConfig.name} 当前不可用`,
        variant: "destructive",
      });
      return;
    }

    const refImage = getRefImage();
    const generationMode = refImage ? "image_to_image" : "text_to_image";

    // 能力校验
    if (negativePrompt && !modelConfig.capabilities.supportsNegativePrompt) {
      toast({
        title: "该模型不支持反向提示词",
        description: `${modelConfig.name} 不支持 negative prompt`,
        variant: "destructive",
      });
      return;
    }
    if (batchSize > modelConfig.capabilities.maxBatchSize) {
      toast({
        title: "超出批量上限",
        description: `${modelConfig.name} 单次最多 ${modelConfig.capabilities.maxBatchSize} 张`,
        variant: "destructive",
      });
      return;
    }

    setGenerating(true);

    const newEffect: Effect2D = {
      effectId: `EF_${String(Date.now()).slice(-6)}`,
      userId: "U_USER_001",
      photoId: refImage?.photoId ?? "TEXT_ONLY",
      photoUrl: refImage?.thumbUrl ?? "",
      maskId: selectedMask || "CUSTOM",
      maskName: selectedMaskData?.name ?? "自定义",
      status: "processing",
      resultUrls: [],
      prompt: effectivePrompt,
      createdAt: new Date().toISOString(),
      imageModel: selectedModel,
      imageModelName: modelConfig.name,
      mode: generationMode,
    };
    setHistory((prev) => [newEffect, ...prev]);
    setSelectedEffect(newEffect);

    try {
      const res = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          mode: generationMode,
          prompt: effectivePrompt,
          negativePrompt: negativePrompt || undefined,
          imageUrl: refImage?.imageUrl,
          size,
          batchSize,
          seed: seed === "" ? undefined : seed,
          guidanceScale: modelConfig.capabilities.supportsGuidance
            ? guidanceScale
            : undefined,
          numInferenceSteps:
            modelConfig.capabilities.maxInferenceSteps > 0 ? steps : undefined,
          enableSafetyCheck: safetyCheck,
          maskId: selectedMask || undefined,
          photoId: refImage?.photoId,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "生成失败");

      // 异步任务轮询
      let result = data;
      if (data.taskId && data.status === "processing") {
        await new Promise((r) => setTimeout(r, 2000));
        const pollRes = await fetch(
          `/api/image/task/${data.taskId}?model=${selectedModel}`
        );
        result = await pollRes.json();
      }
      if (!result.success) throw new Error(result.error || "生成失败");

      const completed: Effect2D = {
        ...newEffect,
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
      };
      setHistory((prev) =>
        prev.map((e) => (e.effectId === newEffect.effectId ? completed : e))
      );
      setSelectedEffect(completed);
      toast({
        title: "生成完成",
        description: `${modelConfig.name} · ${(result.images ?? []).length} 张`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      setHistory((prev) =>
        prev.map((e) =>
          e.effectId === newEffect.effectId
            ? { ...e, status: "failed", errorMsg: msg }
            : e
        )
      );
      setSelectedEffect((prev) =>
        prev?.effectId === newEffect.effectId
          ? { ...prev, status: "failed", errorMsg: msg }
          : prev
      );
      toast({ title: "生成失败", description: msg, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleRandomSeed = () => setSeed(Math.floor(Math.random() * 1e9));

  // ============ 渲染 ============
  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* ============ 左侧：参数面板 ============ */}
      <aside className="w-[380px] shrink-0 flex flex-col bg-card border rounded-lg overflow-hidden">
        <div className="p-3 border-b bg-muted/30">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-violet-600" />
            生图工作台
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            选择模型与参数，生成2D效果图
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* 参考图 */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold flex items-center gap-1">
                <ImageIcon className="h-3.5 w-3.5" />
                参考图
              </label>
              <div className="flex gap-0.5 bg-muted rounded p-0.5">
                {(["upload", "library", "none"] as RefMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => handleModeChange(m)}
                    className={cn(
                      "text-[10px] px-2 py-1 rounded transition-colors",
                      refMode === m
                        ? "bg-background shadow-sm font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {m === "upload" ? "上传" : m === "library" ? "图库" : "无"}
                  </button>
                ))}
              </div>
            </div>

            {refMode === "upload" &&
              (uploadedImage ? (
                <div className="relative group">
                  <img
                    src={uploadedImage.previewUrl}
                    alt={uploadedImage.fileName}
                    className="w-full aspect-square object-cover rounded-lg border"
                  />
                  <button
                    onClick={handleRemoveUpload}
                    className="absolute top-2 right-2 p-1 rounded-full bg-rose-500 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="移除"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <div className="absolute bottom-2 left-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded truncate">
                    {uploadedImage.fileName} ·{" "}
                    {(uploadedImage.fileSize / 1024).toFixed(1)}KB
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    handleFileSelect(e.dataTransfer.files?.[0]);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                    dragOver
                      ? "border-violet-500 bg-violet-500/5"
                      : "border-muted-foreground/30 hover:border-violet-500/50 hover:bg-muted/30"
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files?.[0])}
                  />
                  <Upload
                    className={cn(
                      "h-8 w-8 mx-auto mb-2",
                      dragOver ? "text-violet-500" : "text-muted-foreground"
                    )}
                  />
                  <p className="text-xs font-medium">
                    {dragOver ? "释放即可上传" : "点击或拖拽图片"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    JPG/PNG/WEBP · ≤10MB
                  </p>
                </div>
              ))}

            {refMode === "library" && (
              <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
                {MOCK_PHOTOS.map((p) => (
                  <button
                    key={p.photoId}
                    onClick={() => setSelectedPhoto(p.photoId)}
                    className={cn(
                      "aspect-square rounded border-2 overflow-hidden transition-all",
                      selectedPhoto === p.photoId
                        ? "border-violet-500 ring-1 ring-violet-500/30"
                        : "border-transparent hover:border-muted-foreground/30"
                    )}
                  >
                    <img
                      src={p.thumbnailUrl}
                      alt={p.fileName}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}

            {refMode === "none" && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 text-center">
                <Type className="h-5 w-5 text-amber-600 mx-auto mb-1" />
                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                  纯文生图模式
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  仅根据提示词生成
                </p>
              </div>
            )}
          </section>

          {/* 提示词模板开关 */}
          <section className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40">
            <div>
              <p className="text-xs font-semibold flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                提示词模板
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {useTemplate
                  ? "使用效果模版的提示词，无需手动填写"
                  : "手动输入提示词"}
              </p>
            </div>
            <Switch checked={useTemplate} onCheckedChange={setUseTemplate} />
          </section>

          {/* 提示词 - 仅关闭模板时显示 */}
          {!useTemplate && (
            <section className="space-y-2">
              <label className="text-xs font-semibold flex items-center gap-1">
                <Type className="h-3.5 w-3.5" />
                提示词
              </label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="描述你想要的图像效果..."
                rows={5}
                className="text-xs resize-none"
              />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{prompt.length} 字符</span>
                <button
                  onClick={() => setPrompt("")}
                  className="hover:text-foreground"
                >
                  <Trash2 className="h-3 w-3 inline mr-0.5" />
                  清空
                </button>
              </div>
            </section>
          )}

          {/* 反向提示词（可选，仅支持时且关闭模板时显示） */}
          {!useTemplate && modelConfig.capabilities.supportsNegativePrompt && (
            <section className="space-y-2">
              <label className="text-xs font-semibold">
                反向提示词{" "}
                <span className="text-[10px] text-muted-foreground font-normal">
                  (可选)
                </span>
              </label>
              <Textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="不希望出现的内容..."
                rows={2}
                className="text-xs resize-none"
              />
            </section>
          )}

          {/* 生图模型 */}
          <section className="space-y-2">
            <label className="text-xs font-semibold flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5" />
              生图模型
              {useTemplate && selectedMaskData?.model && (
                <Badge
                  variant="outline"
                  className="text-[9px] py-0 h-3.5 bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30"
                >
                  由效果指定
                </Badge>
              )}
            </label>
            <Select
              value={selectedModel}
              onValueChange={(v) => setSelectedModel(v as ImageModelId)}
              disabled={useTemplate && !!selectedMaskData?.model}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_MODEL_LIST.filter((m) => m.status === "active").map(
                  (m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: m.color }}
                        />
                        {m.name}
                        <span className="text-[10px] text-muted-foreground">
                          {m.currency === "CNY" ? "¥" : "$"}
                          {m.pricePerImage} ·{" "}
                          {(m.avgDuration / 1000).toFixed(1)}s
                        </span>
                        {m.isDomestic && (
                          <Badge
                            variant="outline"
                            className="text-[9px] py-0 h-3.5"
                          >
                            国产
                          </Badge>
                        )}
                      </span>
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
            {useTemplate && selectedMaskData?.model ? (
              <p className="text-[10px] text-violet-700 dark:text-violet-400 bg-violet-500/5 border border-violet-500/20 rounded p-1.5 flex items-center gap-1">
                <Sparkles className="h-3 w-3 shrink-0" />
                模型由「{selectedMaskData.name}」效果指定为 {modelConfig.name}
                ，关闭模板可手动切换
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground bg-muted/30 rounded p-1.5">
                {modelConfig.description}
              </p>
            )}
          </section>

          {/* 产品效果模版 */}
          <section className="space-y-2">
            <label className="text-xs font-semibold flex items-center gap-1">
              效果模版
              {useTemplate && (
                <Badge
                  variant="outline"
                  className="text-[9px] py-0 h-3.5 text-violet-700 dark:text-violet-400 border-violet-500/30"
                >
                  必选
                </Badge>
              )}
            </label>
            <Select value={selectedMask} onValueChange={handleSelectMask}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!useTemplate && (
                  <SelectItem value="none" className="text-xs">
                    不使用模版（自定义）
                  </SelectItem>
                )}
                {MOCK_PRODUCT_EFFECTS.filter((m) => m.status === "active").map(
                  (m) => (
                    <SelectItem
                      key={m.maskId}
                      value={m.maskId}
                      className="text-xs"
                    >
                      {m.name} · ¥{m.price}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
            {useTemplate && selectedMaskData && (
              <p className="text-[10px] text-muted-foreground bg-violet-500/5 border border-violet-500/20 rounded p-1.5">
                {selectedMaskData.description}
              </p>
            )}
          </section>

          {/* 模板参数（变量取值）：有 options 渲染下拉，无 options 渲染文本框 */}
          {useTemplate &&
            selectedMaskData &&
            selectedMaskData.variables.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-violet-600" />
                    模参数
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    共 {selectedMaskData.variables.length} 项
                  </span>
                </div>
                <div className="space-y-2">
                  {selectedMaskData.variables.map((v) => (
                    <div key={v.key} className="space-y-1">
                      <Label className="text-[11px] flex items-center gap-1">
                        <span className="font-mono text-violet-700 dark:text-violet-400">{`{{${v.key}}}`}</span>
                        <span className="text-muted-foreground">{v.label}</span>
                        {v.required && (
                          <span className="text-rose-600 text-[10px]">*</span>
                        )}
                      </Label>
                      {v.options && v.options.length > 0 ? (
                        <Select
                          value={paramValues[v.key] ?? v.defaultValue}
                          onValueChange={(val) =>
                            setParamValues((p) => ({ ...p, [v.key]: val }))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {v.options.map((opt) => (
                              <SelectItem
                                key={opt}
                                value={opt}
                                className="text-xs"
                              >
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={paramValues[v.key] ?? ""}
                          onChange={(e) =>
                            setParamValues((p) => ({
                              ...p,
                              [v.key]: e.target.value,
                            }))
                          }
                          placeholder={v.defaultValue || `请输入${v.label}`}
                          className="h-8 text-xs"
                        />
                      )}
                      {v.description && (
                        <p className="text-[10px] text-muted-foreground">
                          {v.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

          {/* 基础参数 */}
          <section className="space-y-3">
            {/* 尺寸 */}
            <div className="space-y-1">
              <label className="text-xs font-semibold">输出尺寸</label>
              <div className="grid grid-cols-4 gap-1">
                {modelConfig.capabilities.sizes.slice(0, 4).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    className={cn(
                      "text-[10px] py-1.5 rounded border font-mono transition-colors",
                      size === s
                        ? "border-violet-500 bg-violet-500/5 text-violet-700 dark:text-violet-400"
                        : "hover:bg-muted"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* 批量数量 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold">生成数量</label>
                <span className="text-xs font-mono text-violet-600">
                  {batchSize} 张
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={modelConfig.capabilities.maxBatchSize}
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>1</span>
                <span>最多 {modelConfig.capabilities.maxBatchSize}</span>
              </div>
            </div>
          </section>

          {/* 高级参数（可折叠） */}
          <section className="border-t pt-3">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between text-xs font-semibold"
            >
              <span className="flex items-center gap-1">
                <Settings2 className="h-3.5 w-3.5" />
                高级参数
              </span>
              {showAdvanced ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3">
                {/* 引导系数 */}
                {modelConfig.capabilities.supportsGuidance && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-muted-foreground">
                        引导系数 (CFG)
                      </label>
                      <span className="text-[11px] font-mono">
                        {guidanceScale}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      step={0.5}
                      value={guidanceScale}
                      onChange={(e) => setGuidanceScale(Number(e.target.value))}
                      className="w-full accent-violet-500"
                    />
                  </div>
                )}

                {/* 推理步数 */}
                {modelConfig.capabilities.maxInferenceSteps > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-muted-foreground">
                        推理步数
                      </label>
                      <span className="text-[11px] font-mono">{steps}</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={modelConfig.capabilities.maxInferenceSteps}
                      value={steps}
                      onChange={(e) => setSteps(Number(e.target.value))}
                      className="w-full accent-violet-500"
                    />
                  </div>
                )}

                {/* 随机种子 */}
                {modelConfig.capabilities.supportsSeed && (
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">
                      随机种子
                    </label>
                    <div className="flex gap-1">
                      <input
                        type="number"
                        value={seed}
                        onChange={(e) =>
                          setSeed(
                            e.target.value === "" ? "" : Number(e.target.value)
                          )
                        }
                        placeholder="随机"
                        className="flex-1 h-8 text-xs rounded border bg-background px-2"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2"
                        onClick={handleRandomSeed}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* 安全检查 */}
                {modelConfig.capabilities.supportsSafetyCheck && (
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-muted-foreground">
                      安全检查
                    </label>
                    <Switch
                      checked={safetyCheck}
                      onCheckedChange={setSafetyCheck}
                    />
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* 底部生成按钮 */}
        <div className="p-3 border-t bg-muted/30 space-y-2">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>预计成本</span>
            <span className="font-mono font-semibold text-foreground">
              {modelConfig.currency === "CNY" ? "¥" : "$"}
              {(modelConfig.pricePerImage * batchSize).toFixed(2)}
            </span>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={generating || (!useTemplate && !prompt.trim())}
            className="w-full bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                生成 {batchSize} 张
              </>
            )}
          </Button>
        </div>
      </aside>

      {/* ============ 右侧：结果展示 ============ */}
      <main className="flex-1 flex flex-col bg-card border rounded-lg overflow-hidden min-w-0">
        {/* 顶部工具栏 */}
        <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-600" />
            <h2 className="text-sm font-bold">生成结果</h2>
            {selectedEffect && (
              <Badge variant="outline" className="text-[10px] font-mono">
                {selectedEffect.effectId}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              <History className="h-3.5 w-3.5 mr-1" />
              历史 ({history.length})
            </Button>
          </div>
        </div>

        {/* 主结果区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {selectedEffect ? (
            <div className="space-y-4">
              {/* 状态栏 */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      STATUS_CONFIG[selectedEffect.status].bg,
                      STATUS_CONFIG[selectedEffect.status].color
                    )}
                  >
                    {(() => {
                      const Icon = STATUS_CONFIG[selectedEffect.status].icon;
                      return (
                        <Icon
                          className={cn(
                            "h-3 w-3",
                            selectedEffect.status === "processing" &&
                              "animate-spin"
                          )}
                        />
                      );
                    })()}
                    {STATUS_CONFIG[selectedEffect.status].label}
                  </span>
                  {selectedEffect.imageModel && (
                    <span
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white"
                      style={{
                        backgroundColor:
                          IMAGE_MODELS[
                            selectedEffect.imageModel as ImageModelId
                          ]?.color ?? "#64748b",
                      }}
                    >
                      <Sparkles className="h-2.5 w-2.5" />
                      {selectedEffect.imageModelName ??
                        selectedEffect.imageModel}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {selectedEffect.maskName} ·{" "}
                    {selectedEffect.mode === "text_to_image"
                      ? "文生图"
                      : "图生图"}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {formatDate(selectedEffect.createdAt, true)}
                </span>
              </div>

              {/* 结果图片网格 */}
              {selectedEffect.status === "completed" &&
              selectedEffect.resultUrls.length > 0 ? (
                <div
                  className={cn(
                    "grid gap-3",
                    selectedEffect.resultUrls.length === 1
                      ? "grid-cols-1"
                      : selectedEffect.resultUrls.length === 2
                        ? "grid-cols-2"
                        : "grid-cols-2 md:grid-cols-3"
                  )}
                >
                  {selectedEffect.resultUrls.map((url, i) => (
                    <div
                      key={i}
                      className="group relative aspect-square rounded-lg overflow-hidden border bg-muted"
                    >
                      <img
                        src={url}
                        alt={`结果${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                      {/* 悬浮操作 */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8"
                          onClick={() => toast({ title: "已下载" })}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8"
                          onClick={() => toast({ title: "已收藏" })}
                        >
                          <Heart className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8"
                          onClick={() => toast({ title: "已分享" })}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8"
                          onClick={() => toast({ title: "放大查看" })}
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {selectedEffect.seed && (
                        <div className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-mono">
                          #{i + 1}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : selectedEffect.status === "processing" ? (
                <div className="aspect-video rounded-lg border-2 border-dashed border-sky-500/30 bg-sky-500/5 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="h-10 w-10 text-sky-500 animate-spin" />
                  <p className="text-sm font-medium text-sky-700 dark:text-sky-400">
                    AI 正在生成中...
                  </p>
                  <p className="text-xs text-muted-foreground">
                    预计 {(modelConfig.avgDuration / 1000).toFixed(1)}s 完成
                  </p>
                </div>
              ) : selectedEffect.status === "failed" ? (
                <div className="aspect-video rounded-lg border-2 border-dashed border-rose-500/30 bg-rose-500/5 flex flex-col items-center justify-center gap-3">
                  <XCircle className="h-10 w-10 text-rose-500" />
                  <p className="text-sm font-medium text-rose-700 dark:text-rose-400">
                    生成失败
                  </p>
                  <p className="text-xs text-muted-foreground max-w-md text-center">
                    {selectedEffect.errorMsg}
                  </p>
                  <Button size="sm" variant="outline" onClick={handleGenerate}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    重试
                  </Button>
                </div>
              ) : (
                <div className="aspect-video rounded-lg border-2 border-dashed border-amber-500/30 bg-amber-500/5 flex flex-col items-center justify-center gap-2">
                  <Clock className="h-8 w-8 text-amber-500" />
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    排队中...
                  </p>
                </div>
              )}

              {/* Prompt 信息 */}
              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">
                    提示词
                  </p>
                  <p className="text-xs font-mono whitespace-pre-wrap">
                    {selectedEffect.prompt}
                  </p>
                </div>
                {selectedEffect.revisedPrompt && (
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-0.5">
                      模型重写
                    </p>
                    <p className="text-xs text-violet-700 dark:text-violet-400 italic">
                      {selectedEffect.revisedPrompt}
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-4 gap-2 pt-1 border-t text-[10px]">
                  {selectedEffect.generateDuration && (
                    <div>
                      <span className="text-muted-foreground">耗时:</span>{" "}
                      <span className="font-mono">
                        {(selectedEffect.generateDuration / 1000).toFixed(1)}s
                      </span>
                    </div>
                  )}
                  {selectedEffect.cost && (
                    <div>
                      <span className="text-muted-foreground">成本:</span>{" "}
                      <span className="font-mono">
                        {selectedEffect.currency === "CNY" ? "¥" : "$"}
                        {selectedEffect.cost}
                      </span>
                    </div>
                  )}
                  {selectedEffect.seed && (
                    <div>
                      <span className="text-muted-foreground">种子:</span>{" "}
                      <span className="font-mono">{selectedEffect.seed}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">模式:</span>{" "}
                    <span className="font-mono">
                      {selectedEffect.mode === "text_to_image"
                        ? "文生图"
                        : "图生图"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="rounded-full bg-muted p-6 mb-4">
                <Sparkles className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-1">开始你的第一次生成</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                在左侧选择参考图与提示词，点击"生成"按钮开始创作
              </p>
            </div>
          )}
        </div>

        {/* 底部历史缩略图条 */}
        {history.length > 0 && (
          <div className="border-t bg-muted/20 p-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground shrink-0">
                历史
              </span>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {history.slice(0, 20).map((eff) => {
                  const Icon = STATUS_CONFIG[eff.status].icon;
                  return (
                    <button
                      key={eff.effectId}
                      onClick={() => setSelectedEffect(eff)}
                      className={cn(
                        "relative h-12 w-12 rounded border-2 overflow-hidden shrink-0 transition-all",
                        selectedEffect?.effectId === eff.effectId
                          ? "border-violet-500 ring-1 ring-violet-500/30"
                          : "border-transparent hover:border-muted-foreground/30"
                      )}
                    >
                      {eff.resultUrls[0] ? (
                        <img
                          src={eff.resultUrls[0]}
                          alt={eff.effectId}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted">
                          <Icon
                            className={cn(
                              "h-3.5 w-3.5",
                              STATUS_CONFIG[eff.status].color,
                              eff.status === "processing" && "animate-spin"
                            )}
                          />
                        </div>
                      )}
                      {eff.imageModel && (
                        <span
                          className="absolute bottom-0 left-0 right-0 h-1.5"
                          style={{
                            backgroundColor:
                              IMAGE_MODELS[eff.imageModel as ImageModelId]
                                ?.color ?? "#64748b",
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
