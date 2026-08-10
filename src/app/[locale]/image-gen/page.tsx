"use client";

import { motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Heart,
  History,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface PublicMask {
  maskId: string;
  name: string;
  previewUrl: string;
}

interface GeneratedResult {
  url: string;
  modelName: string;
  maskName: string;
  duration?: number | undefined;
}

// ============ 本地历史记录（localStorage，不入库） ============
interface HistoryItem {
  id: string;
  url: string;
  maskId: string;
  maskName: string;
  modelName: string;
  refPreviewUrl?: string | undefined;
  createdAt: string;
}

const HISTORY_KEY = "mooncoda_public_imagegen_history";
const HISTORY_MAX = 30;

function loadHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as HistoryItem[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(items.slice(0, HISTORY_MAX))
    );
  } catch {
    // 容量超限等异常，静默丢弃
  }
}

// ============ 进行中任务持久化（单任务，刷新后可恢复） ============
interface PendingTask {
  taskId: string;
  maskId: string;
  maskName: string;
  refPreviewUrl?: string | undefined;
  startedAt: string;
}

const TASK_KEY = "mooncoda_public_imagegen_task";
const POLL_INTERVAL = 2500;
const POLL_TIMEOUT = 120000; // 与 API maxDuration 对齐

function loadTask(): PendingTask | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TASK_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    return t && typeof t === "object" && t.taskId ? (t as PendingTask) : null;
  } catch {
    return null;
  }
}

function saveTask(t: PendingTask | null) {
  try {
    if (t) localStorage.setItem(TASK_KEY, JSON.stringify(t));
    else localStorage.removeItem(TASK_KEY);
  } catch {
    // 静默
  }
}

// ──────────────────────────────────────────────────────────
// 视觉组件：手作风小图标（lucide + 暖色圆形背景）
// ──────────────────────────────────────────────────────────
function ChipIcon({
  children,
  tone = "coral",
  className,
}: {
  children: React.ReactNode;
  tone?: "coral" | "amber" | "blush" | "primary";
  className?: string;
}) {
  const toneClass = {
    coral: "bg-coral-soft text-coral",
    amber: "bg-amber-soft text-amber",
    blush: "bg-blush-soft text-coral",
    primary: "bg-primary/10 text-primary",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl",
        toneClass,
        className
      )}
    >
      {children}
    </span>
  );
}

export default function PublicImageGenPage() {
  const { toast } = useToast();
  const [uploadedImage, setUploadedImage] = useState<{
    dataUrl?: string;
    publicUrl?: string;
    previewUrl: string;
    fileName: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedMask, setSelectedMask] = useState<string>("");
  const [masks, setMasks] = useState<PublicMask[]>([]);
  const [loadingMasks, setLoadingMasks] = useState(true);

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [pendingModelName, setPendingModelName] = useState<string>("");
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const pushHistory = (item: HistoryItem) => {
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, HISTORY_MAX);
      saveHistory(next);
      return next;
    });
  };

  const handleClearHistory = () => {
    setHistory([]);
    saveHistory([]);
    toast({ title: "历史已清空" });
  };

  const clearPoll = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const finishTask = (task: PendingTask, url: string, duration?: number) => {
    saveTask(null);
    clearPoll();
    setGenerating(false);
    setPendingModelName("");
    setResult({
      url,
      modelName: task.maskName,
      maskName: task.maskName,
      duration,
    });
    pushHistory({
      id: `gen_${Date.now()}`,
      url,
      maskId: task.maskId,
      maskName: task.maskName,
      modelName: task.maskName,
      refPreviewUrl: task.refPreviewUrl,
      createdAt: new Date().toISOString(),
    });
  };

  const failTask = (msg: string) => {
    saveTask(null);
    clearPoll();
    setGenerating(false);
    setPendingModelName("");
    setError(msg);
    toast({ title: "生成失败", description: msg, variant: "destructive" });
  };

  const pollTask = (task: PendingTask, immediate = false) => {
    const startedAt = new Date(task.startedAt).getTime();
    const tick = async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT) {
        failTask("生成超时，请重试");
        return;
      }
      try {
        const res = await fetch(`/api/image/task/${task.taskId}`);
        const data = await res.json();
        const url = data.images?.[0]?.url;
        if (
          data.success &&
          url &&
          (data.status === "completed" || data.images?.length)
        ) {
          finishTask(task, url, data.duration);
          return;
        }
        if (data.status === "failed") {
          failTask(data.error || "生成失败");
          return;
        }
        pollTimerRef.current = setTimeout(tick, POLL_INTERVAL);
      } catch {
        pollTimerRef.current = setTimeout(tick, POLL_INTERVAL);
      }
    };
    clearPoll();
    pollTimerRef.current = setTimeout(tick, immediate ? 0 : POLL_INTERVAL);
  };

  useEffect(() => () => clearPoll(), []);

  useEffect(() => {
    fetch("/api/public/generate")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.masks) setMasks(data.masks as PublicMask[]);
      })
      .catch(() => {})
      .finally(() => setLoadingMasks(false));
  }, []);

  useEffect(() => {
    if (!masks.length) return;
    const task = loadTask();
    if (!task) return;
    if (masks.some((m) => m.maskId === task.maskId)) {
      setSelectedMask(task.maskId);
    }
    if (Date.now() - new Date(task.startedAt).getTime() > POLL_TIMEOUT) {
      saveTask(null);
      toast({
        title: "上次生成已超时",
        description: "请重新生成",
        variant: "destructive",
      });
      return;
    }
    setGenerating(true);
    setResult(null);
    setError(null);
    setPendingModelName(task.maskName);
    pollTask(task, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masks]);

  const handleFileSelect = async (file: File | undefined) => {
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
    setUploading(true);

    const BASE64_MAX_BYTES = 3 * 1024 * 1024;

    try {
      const presignRes = await fetch("/api/public/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType: file.type,
          size: file.size,
          ext: file.name.split(".").pop(),
        }),
      });
      const presign = await presignRes.json();

      if (presign.success) {
        const putRes = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: presign.headers,
          body: file,
        });
        if (!putRes.ok) throw new Error(`R2 上传失败: ${putRes.status}`);
        setUploadedImage({
          publicUrl: presign.publicUrl,
          previewUrl,
          fileName: file.name,
        });
        toast({ title: "参考图已上传" });
        setResult(null);
        setError(null);
        return;
      }
      if (presign.code === "R2_NOT_CONFIGURED") {
        if (file.size > BASE64_MAX_BYTES) {
          throw new Error(
            "参考图过大且 R2 未配置，请配置 R2 环境变，或使用小于 3MB 的图片"
          );
        }
        console.warn("[upload] R2 未配置，回退 base64（小图）");
      } else {
        throw new Error(presign.error || "R2 签名失败");
      }
    } catch (err) {
      if (file.size > BASE64_MAX_BYTES) {
        setUploading(false);
        URL.revokeObjectURL(previewUrl);
        const msg = err instanceof Error ? err.message : "参考图上传失败";
        setError(msg);
        toast({
          title: "参考图上传失败",
          description: msg,
          variant: "destructive",
        });
        return;
      }
      console.warn("[upload] R2 直传失败，回退 base64:", err);
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("读取文件失败"));
        reader.readAsDataURL(file);
      });
      setUploadedImage({
        dataUrl,
        previewUrl,
        fileName: file.name,
      });
      setResult(null);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "读取文件失败";
      setError(msg);
      toast({
        title: "图片读取失败",
        description: msg,
        variant: "destructive",
      });
      URL.revokeObjectURL(previewUrl);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveUpload = () => {
    if (uploadedImage) URL.revokeObjectURL(uploadedImage.previewUrl);
    setUploadedImage(null);
  };

  const handleGenerate = async () => {
    if (!selectedMask) {
      toast({ title: "请先选择效果", variant: "destructive" });
      return;
    }
    clearPoll();
    saveTask(null);
    setPendingModelName("");
    setGenerating(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/public/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: uploadedImage?.publicUrl ?? uploadedImage?.dataUrl,
          maskId: selectedMask,
          size: "1024x1024",
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "生成失败");

      const maskName = (data.maskName as string) || "AI 生图";

      if (data.taskId && data.taskStatus === "processing") {
        const task: PendingTask = {
          taskId: data.taskId,
          maskId: selectedMask,
          maskName,
          refPreviewUrl: uploadedImage?.previewUrl,
          startedAt: new Date().toISOString(),
        };
        saveTask(task);
        setPendingModelName(maskName);
        pollTask(task);
        return;
      }

      setGenerating(false);
      const url = (data.image?.url as string) ?? "";
      if (url) {
        setResult({
          url,
          modelName: maskName,
          maskName,
          duration: data.duration,
        });
        pushHistory({
          id: `gen_${Date.now()}`,
          url,
          maskId: selectedMask,
          maskName,
          modelName: maskName,
          refPreviewUrl: uploadedImage?.previewUrl,
          createdAt: new Date().toISOString(),
        });
        toast({ title: "生成完成", description: maskName });
      } else {
        throw new Error(data.error || "生成失败");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      setGenerating(false);
      setError(msg);
      toast({ title: "生成失败", description: msg, variant: "destructive" });
    }
  };

  const handleDownload = () => {
    if (result?.url) {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = `mooncoda_${Date.now()}.png`;
      a.target = "_blank";
      a.click();
      toast({ title: "已开始下载" });
    }
  };

  const selectedMaskData = masks.find((m) => m.maskId === selectedMask);

  return (
    <div className="bg-background text-foreground relative flex h-screen min-h-screen flex-col overflow-hidden">
      {/* 装饰背景：暖色光晕 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(40% 35% at 15% 20%, var(--accent-coral-soft), transparent 70%), radial-gradient(45% 40% at 85% 80%, var(--accent-amber-soft), transparent 72%)",
        }}
      />

      {/* ═══════════ 顶部导航 ═══════════ */}
      <header className="bg-card/80 relative z-10 flex h-14 shrink-0 items-center justify-between border-b-2 px-4 backdrop-blur md:px-6">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="bg-coral shadow-sticker-coral flex h-9 w-9 rotate-[-4deg] items-center justify-center rounded-2xl">
            <Sparkles size={18} className="text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-extrabold tracking-tight">
              AI 生图{" "}
              <span className="bg-coral-soft text-coral ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase">
                免登录
              </span>
            </span>
            <span className="text-muted-foreground text-[11px]">
              3D 打印定制 · 一键生成预览
            </span>
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <span className="bg-amber-soft text-amber inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold">
            ✦ 单图直传
          </span>
          <span className="bg-coral-soft text-coral inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold">
            🐾 宠物友好
          </span>
        </div>
      </header>

      {/* ═══════════ 主体 ═══════════ */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden md:flex-row">
        {/* ───────── 左侧：输入面板 ───────── */}
        <aside className="bg-card/60 flex w-full shrink-0 flex-col overflow-hidden border-b-2 backdrop-blur md:w-[400px] md:border-b-0 md:border-r">
          <div className="flex-1 space-y-6 overflow-y-auto p-4 md:p-5">
            {/* 效果选择 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <ChipIcon tone="coral">
                  <Sparkles size={14} />
                </ChipIcon>
                <h3 className="text-sm font-extrabold tracking-tight">
                  选择效果
                </h3>
                {!loadingMasks && (
                  <span className="bg-coral-soft text-coral rounded-full px-2 py-0.5 text-[10px] font-bold">
                    {masks.length} 个
                  </span>
                )}
              </div>
              {loadingMasks ? (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: 静态骨架屏，顺序固定无稳定 id
                      key={i}
                      className="h-28 w-36 shrink-0 rounded-2xl bg-muted animate-pulse"
                    />
                  ))}
                </div>
              ) : (
                <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 -mx-1">
                  {masks.map((m) => (
                    <button
                      key={m.maskId}
                      type="button"
                      onClick={() => setSelectedMask(m.maskId)}
                      className={cn(
                        "group relative h-28 w-36 shrink-0 snap-start overflow-hidden rounded-2xl border-2 transition-all",
                        "bg-warm",
                        selectedMask === m.maskId
                          ? "border-coral shadow-sticker-coral scale-[1.02]"
                          : "border-border hover:border-coral/40 hover:-translate-y-0.5 hover:shadow-sticker"
                      )}
                      title={m.name}
                    >
                      <div className="absolute inset-0 flex items-center justify-center p-2">
                        {/* biome-ignore lint/performance/noImgElement: 动态远程预览图，next/image 需预配置 remotePatterns */}
                        <img
                          src={m.previewUrl}
                          alt={m.name}
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-1.5 pt-4 pb-1">
                        <p className="truncate text-center text-[11px] font-bold text-white">
                          {m.name}
                        </p>
                      </div>
                      {selectedMask === m.maskId && (
                        <div className="bg-coral shadow-sticker-coral absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full">
                          <CheckCircle2
                            size={12}
                            className="text-white"
                            strokeWidth={3}
                          />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* 参考图上传 */}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <ChipIcon tone="amber">
                  <ImageIcon size={14} />
                </ChipIcon>
                <h3 className="text-sm font-extrabold tracking-tight">
                  参考图片
                </h3>
                <span className="bg-amber-soft text-amber rounded-full px-2 py-0.5 text-[10px] font-bold">
                  可选
                </span>
              </div>
              {uploadedImage ? (
                <div className="bg-card shadow-sticker relative overflow-hidden rounded-2xl border-2">
                  {/* biome-ignore lint/performance/noImgElement: 本地 blob/data URI 参考图预览 */}
                  <img
                    src={uploadedImage.previewUrl}
                    alt="参考图"
                    className="aspect-square w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveUpload}
                    className="bg-coral shadow-sticker-coral absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full text-white transition-transform hover:scale-110"
                  >
                    <X size={14} strokeWidth={3} />
                  </button>
                  <div className="bg-foreground/80 absolute bottom-2 left-2 right-2 truncate rounded-lg px-2 py-1 text-[11px] font-medium text-white backdrop-blur">
                    {uploadedImage.fileName}
                  </div>
                </div>
              ) : (
                // biome-ignore lint/a11y/useSemanticElements: 拖拽上传区需 onDrop/onDragOver，无法用 button
                <div
                  role="button"
                  tabIndex={0}
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className={cn(
                    "group rounded-2xl border-2 border-dashed p-6 text-center transition-all cursor-pointer",
                    dragOver
                      ? "border-coral bg-coral-soft shadow-sticker-coral scale-[1.01]"
                      : "border-coral/30 bg-coral-soft/30 hover:border-coral hover:bg-coral-soft/50"
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files?.[0])}
                  />
                  <div className="flex flex-col items-center gap-2">
                    <div className="bg-coral-soft group-hover:bg-coral-soft/80 flex h-12 w-12 items-center justify-center rounded-2xl transition-colors">
                      <Upload
                        size={22}
                        className={cn(
                          "transition-colors",
                          dragOver
                            ? "text-coral"
                            : "text-coral/70 group-hover:text-coral"
                        )}
                        strokeWidth={2}
                      />
                    </div>
                    <div>
                      <p className="text-sm font-extrabold tracking-tight">
                        {uploading
                          ? "上传中..."
                          : dragOver
                            ? "释放即可上传"
                            : "点击或拖拽图片"}
                      </p>
                      <p className="text-muted-foreground mt-1 text-[11px]">
                        JPG / PNG / WEBP · ≤10MB
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* 小提示 */}
            <div className="bg-amber-soft border-coral/20 flex items-start gap-2.5 rounded-2xl border-2 border-dashed p-3">
              <span className="text-xl">💡</span>
              <div className="flex-1 text-[11px] leading-relaxed text-foreground/80">
                <span className="font-bold">小贴士：</span>
                不传参考图也能玩——AI 会按效果模板生成；上传宠物照片效果更佳 🐱🐶
              </div>
            </div>
          </div>

          {/* 底部生成按钮 */}
          <div className="border-coral/20 border-t-2 bg-gradient-to-t from-coral-soft/40 to-transparent p-4">
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !selectedMask}
              className={cn(
                "h-13 w-full rounded-full text-base font-extrabold shadow-sticker-coral transition-all",
                "bg-coral text-white hover:bg-coral/90 hover:-translate-y-0.5",
                !generating && !!selectedMask && "animate-wobble",
                generating && "bg-coral/70"
              )}
              style={{ height: "3.25rem" }}
            >
              {generating ? (
                <>
                  <Loader2 size={18} className="mr-2 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Wand2 size={18} className="mr-2" />
                  生成图片
                </>
              )}
            </Button>
            {selectedMaskData && !generating && (
              <p className="text-muted-foreground mt-2 text-center text-[11px]">
                已选{" "}
                <span className="text-coral font-bold">
                  {selectedMaskData.name}
                </span>
                {uploadedImage && " · 含参考图"}
              </p>
            )}
          </div>
        </aside>

        {/* ───────── 中央：结果展示区 ───────── */}
        <main className="relative flex flex-1 flex-col overflow-hidden">
          <div className="relative flex flex-1 items-center justify-center overflow-auto p-4 md:p-8">
            {/* 空状态 */}
            {!generating && !result && !error && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="max-w-md text-center"
              >
                <div className="bg-coral-soft shadow-sticker-coral relative mx-auto flex h-32 w-32 items-center justify-center rounded-[2rem] blob-2">
                  <span className="text-7xl">🎨</span>
                  <span className="bg-amber absolute -top-2 -right-2 flex h-10 w-10 items-center justify-center rounded-full text-lg shadow-sticker-amber animate-wobble">
                    ✨
                  </span>
                  <span className="bg-coral absolute -bottom-2 -left-2 flex h-9 w-9 items-center justify-center rounded-full text-base text-white shadow-sticker-coral">
                    🐾
                  </span>
                </div>
                <h3 className="mt-6 text-xl font-extrabold tracking-tight">
                  挑一个效果，点一下生成
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  AI 会按效果模板生成一张预览图，
                  <br />
                  喜欢的话就能直接拿去打印 🐶
                </p>
                <div className="text-muted-foreground mt-5 flex flex-wrap items-center justify-center gap-2 text-xs">
                  <span className="bg-card inline-flex items-center gap-1 rounded-full px-2.5 py-1 shadow-sticker">
                    ✦ 5-15 秒出图
                  </span>
                  <span className="bg-card inline-flex items-center gap-1 rounded-full px-2.5 py-1 shadow-sticker">
                    ✦ 历史自动保存
                  </span>
                  <span className="bg-card inline-flex items-center gap-1 rounded-full px-2.5 py-1 shadow-sticker">
                    ✦ 一键下载
                  </span>
                </div>
              </motion.div>
            )}

            {/* 生成中 */}
            {generating && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="text-center"
              >
                <div className="relative mx-auto inline-block">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{
                      duration: 6,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "linear",
                    }}
                    className="bg-coral-soft shadow-sticker-coral flex h-28 w-28 items-center justify-center rounded-full border-4 border-coral/30"
                  >
                    <Loader2 size={44} className="animate-spin text-coral" />
                  </motion.div>
                  <motion.span
                    animate={{ y: [0, -6, 0] }}
                    transition={{
                      duration: 1.5,
                      repeat: Number.POSITIVE_INFINITY,
                    }}
                    className="absolute -top-3 -right-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber text-xl shadow-sticker-amber"
                  >
                    ✨
                  </motion.span>
                  <motion.span
                    animate={{ y: [0, 6, 0] }}
                    transition={{
                      duration: 1.8,
                      repeat: Number.POSITIVE_INFINITY,
                    }}
                    className="bg-primary absolute -bottom-2 -left-3 flex h-9 w-9 items-center justify-center rounded-full text-base text-primary-foreground shadow-sticker"
                  >
                    🐾
                  </motion.span>
                </div>
                <p className="mt-6 text-base font-extrabold text-coral">
                  AI 创作中...
                </p>
                <p className="text-muted-foreground mt-1 text-sm">
                  {pendingModelName || selectedMaskData?.name || "AI 生图"} ·
                  预计 5-15 秒
                </p>
              </motion.div>
            )}

            {/* 结果 */}
            {result && !generating && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 20 }}
                className="w-full max-w-xl space-y-5"
              >
                {/* 顶部装饰条 */}
                <div className="flex items-center justify-center gap-2">
                  <span className="bg-coral-soft text-coral inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold shadow-sticker">
                    <CheckCircle2 size={14} strokeWidth={3} />
                    生成完成
                  </span>
                  <span className="bg-amber-soft text-amber inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold">
                    ✦ {result.maskName}
                  </span>
                </div>

                {/* 图片（贴纸卡 + 全息光斑） */}
                <div className="relative">
                  {/* 周围漂浮贴纸 */}
                  <motion.div
                    animate={{ rotate: [0, 8, -4, 0] }}
                    transition={{
                      duration: 6,
                      repeat: Number.POSITIVE_INFINITY,
                    }}
                    className="bg-coral shadow-sticker-coral absolute -top-3 -left-3 z-10 flex h-10 w-10 items-center justify-center rounded-2xl"
                  >
                    <span className="text-lg">🐾</span>
                  </motion.div>
                  <motion.div
                    animate={{ rotate: [0, -10, 6, 0] }}
                    transition={{
                      duration: 7,
                      repeat: Number.POSITIVE_INFINITY,
                    }}
                    className="bg-amber shadow-sticker-amber absolute -top-2 -right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full"
                  >
                    <Sparkles size={16} className="text-white" />
                  </motion.div>
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{
                      duration: 2.5,
                      repeat: Number.POSITIVE_INFINITY,
                    }}
                    className="bg-coral-soft absolute -bottom-2 -right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full shadow-sticker"
                  >
                    <Heart
                      size={14}
                      className="text-coral"
                      fill="currentColor"
                    />
                  </motion.div>

                  <div className="bg-card shadow-sticker-coral relative overflow-hidden rounded-3xl border-2 border-coral/30">
                    {/* biome-ignore lint/performance/noImgElement: 生图结果为动态 data URI/远程 URL，不宜走 next/image */}
                    <img
                      src={result.url}
                      alt="生成结果"
                      className="aspect-square w-full object-cover"
                    />
                    {/* 全息光斑 */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-3xl opacity-40 mix-blend-overlay"
                      style={{
                        background:
                          "linear-gradient(115deg, transparent 30%, rgba(255,200,220,0.5) 45%, rgba(255,230,150,0.4) 55%, rgba(180,230,255,0.5) 65%, transparent 80%)",
                      }}
                    />
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button
                    type="button"
                    onClick={handleDownload}
                    className="h-12 rounded-full bg-coral px-6 font-extrabold text-white shadow-sticker-coral hover:bg-coral/90 hover:-translate-y-0.5"
                  >
                    <Download size={16} className="mr-2" />
                    下载图片
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 rounded-full border-2 px-6 font-bold hover:bg-coral-soft/50"
                    onClick={() => {
                      setResult(null);
                      handleGenerate();
                    }}
                  >
                    <RefreshCw size={16} className="mr-2" />
                    再生成一张
                  </Button>
                </div>

                {/* 收藏贴士 */}
                <p className="text-muted-foreground text-center text-[11px]">
                  喜欢这张？把它存进历史里，下次来还能找到 ✨
                </p>
              </motion.div>
            )}

            {/* 错误 */}
            {error && !generating && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-sm text-center"
              >
                <div className="bg-coral-soft shadow-sticker-coral mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl">
                  <AlertCircle size={36} className="text-coral" />
                </div>
                <p className="text-base font-extrabold tracking-tight">
                  生成失败
                </p>
                <p className="text-muted-foreground mt-2 text-sm">{error}</p>
                <Button
                  type="button"
                  className="mt-5 h-11 rounded-full bg-coral px-6 font-bold text-white shadow-sticker-coral hover:bg-coral/90"
                  onClick={handleGenerate}
                >
                  <RefreshCw size={14} className="mr-1.5" />
                  重试
                </Button>
              </motion.div>
            )}
          </div>
        </main>

        {/* ───────── 最右侧：本地历史记录栏 ───────── */}
        {history.length > 0 && (
          <aside className="bg-card/60 hidden w-[200px] shrink-0 flex-col overflow-hidden border-l-2 backdrop-blur md:flex">
            <div className="flex shrink-0 items-center justify-between border-b-2 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <ChipIcon tone="blush" className="h-6 w-6">
                  <History size={12} />
                </ChipIcon>
                <span className="text-xs font-extrabold tracking-tight">
                  历史
                </span>
                <span className="bg-coral-soft text-coral rounded-full px-1.5 text-[10px] font-bold">
                  {history.length}
                </span>
              </div>
              <button
                type="button"
                onClick={handleClearHistory}
                className="text-muted-foreground hover:text-coral flex items-center gap-0.5 rounded-full p-1 text-[10px] transition-colors"
                title="清空历史"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
              {history.map((h) => (
                <button
                  type="button"
                  key={h.id}
                  className="group bg-card shadow-sticker relative aspect-square w-full cursor-pointer overflow-hidden rounded-xl border-2 transition-all hover:-translate-y-0.5 hover:shadow-sticker-coral"
                  title={`${h.maskName} · ${new Date(h.createdAt).toLocaleString("zh-CN")}`}
                  onClick={() => {
                    setResult({
                      url: h.url,
                      modelName: h.modelName,
                      maskName: h.maskName,
                    });
                    setError(null);
                  }}
                >
                  {/* biome-ignore lint/performance/noImgElement: 历史图为动态远程/data URI */}
                  <img
                    src={h.url}
                    alt={h.maskName}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1 py-1 text-center text-[10px] font-bold text-white">
                    {h.maskName}
                  </div>
                </button>
              ))}
              <p className="text-muted-foreground/70 pt-1 text-center text-[10px]">
                仅存于此浏览器
              </p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
