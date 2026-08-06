"use client";

import {
  AlertCircle,
  CheckCircle2,
  Download,
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
  refPreviewUrl?: string | undefined; // 参考图缩略（本地 object URL，仅前会话有效；刷新后失效）
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

export default function PublicImageGenPage() {
  const { toast } = useToast();
  // 参考图：上传到 R2 后保存公共读 URL；R2 未配置时回退到 base64 data URI
  const [uploadedImage, setUploadedImage] = useState<{
    dataUrl?: string;
    publicUrl?: string;
    previewUrl: string;
    fileName: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 效果
  const [selectedMask, setSelectedMask] = useState<string>("");
  const [masks, setMasks] = useState<PublicMask[]>([]);
  const [loadingMasks, setLoadingMasks] = useState(true);

  // 生成
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 本历史记录
  const [history, setHistory] = useState<HistoryItem[]>([]);
  // 进行中任务：恢复时用于显示「AI 创作中」的模型名
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

  // 清理轮询定时器
  const clearPoll = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  // 完成任务：入历史、清 task、停止轮询
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

  // 任务失败：错误提示、清 task、停止轮询
  const failTask = (msg: string) => {
    saveTask(null);
    clearPoll();
    setGenerating(false);
    setPendingModelName("");
    setError(msg);
    toast({ title: "生成失败", description: msg, variant: "destructive" });
  };

  // 持续轮询进行中任务
  const pollTask = (task: PendingTask, immediate = false) => {
    const startedAt = new Date(task.startedAt).getTime();
    const tick = async () => {
      // 超时
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
        // 仍在 processing → 继续轮询
        pollTimerRef.current = setTimeout(tick, POLL_INTERVAL);
      } catch {
        // 网络瞬时错误 → 继续重试
        pollTimerRef.current = setTimeout(tick, POLL_INTERVAL);
      }
    };
    clearPoll();
    // 首次：立即查询（恢复/刚发起时尽快拿结果）；之后间隔轮询
    pollTimerRef.current = setTimeout(tick, immediate ? 0 : POLL_INTERVAL);
  };

  // 组件卸载清理
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

  // 刷新恢复：masks 加载后，若存在进行中任务则恢复并续轮询
  useEffect(() => {
    if (!masks.length) return;
    const task = loadTask();
    if (!task) return;
    // 回填 mask 选择
    if (masks.some((m) => m.maskId === task.maskId)) {
      setSelectedMask(task.maskId);
    }
    // 超时则丢弃
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

  // 文件选择：优先走 R2 presigned 直传（图不经过服务器，避免 payload 限制）；
  // R2 未配置或签名失败时回退 base64（仅小图可行，大图会被 413）。
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

    // Serverless Function 请求体上限约 4.5MB；base64 会再膨胀 ~33%，
    // 因此过 3MB 的图必须走 R2 直传，否则 generate 会被 413。
    const BASE64_MAX_BYTES = 3 * 1024 * 1024;

    // 先尝试 R2 直传
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
      // R2 未配置 → 仅当图足够小才回退 base64
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
      // 大图无 R2 不可恢复，直接报错
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

    // 回退：base64 data URI（仅小图）
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
    // 单任务约束：发起新任务前清掉旧进行中任务与轮询
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
          // 优先使用 R2 公共 URL；回退时用 base64 data URI
          imageUrl: uploadedImage?.publicUrl ?? uploadedImage?.dataUrl,
          maskId: selectedMask,
          size: "1024x1024",
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "生成失败");

      const maskName = (data.maskName as string) || "AI 生图";

      // 异步任务仍在进行：持久化并续轮询
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
        return; // 保持 generating=true，不进入 finally 关闭
      }

      // 同步完成（或 poll 一次已出图）
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
        // 既无图也无进行中任务 → 当作失败
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
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      {/* 顶部导航 */}
      <header className="h-12 shrink-0 bg-white dark:bg-zinc-900 border-b flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span className="font-bold text-sm">AI 生图</span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          3D打印定制 · 一键生成
        </span>
      </header>

      {/* 主体：左输入 + 右结果 */}
      <div className="flex-1 flex overflow-hidden">
        {/* ============ 左侧：输入面板 ============ */}
        <aside className="w-[380px] shrink-0 bg-white dark:bg-zinc-900 border-r flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* 效果选择 */}
            <section className="space-y-2">
              <span className="text-xs font-semibold flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" />
                选择效果
                {!loadingMasks && (
                  <span className="text-[10px] text-muted-foreground font-normal">
                    · {masks.length} 个
                  </span>
                )}
              </span>
              {loadingMasks ? (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: 静态骨架屏，顺序固定无稳定 id
                      key={i}
                      className="h-24 w-32 shrink-0 rounded-lg bg-muted animate-pulse"
                    />
                  ))}
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
                  {masks.map((m) => (
                    <button
                      key={m.maskId}
                      type="button"
                      onClick={() => setSelectedMask(m.maskId)}
                      className={cn(
                        "group relative h-24 w-32 shrink-0 rounded-lg overflow-hidden border-2 transition-all snap-start",
                        "bg-gradient-to-br from-sky-100 to-indigo-100 dark:from-sky-950/40 dark:to-indigo-950/40",
                        selectedMask === m.maskId
                          ? "border-violet-500 ring-1 ring-violet-500/30"
                          : "border-transparent hover:border-violet-500/30"
                      )}
                      title={m.name}
                    >
                      <div className="absolute inset-0 flex items-center justify-center p-1.5">
                        {/* biome-ignore lint/performance/noImgElement: 动态远程预览图，next/image 需预配置 remotePatterns */}
                        <img
                          src={m.previewUrl}
                          alt={m.name}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent pt-3 pb-1 px-1">
                        <p className="text-white text-[10px] font-medium truncate text-center">
                          {m.name}
                        </p>
                      </div>
                      {selectedMask === m.maskId && (
                        <div className="absolute top-1 right-1 h-4 w-4 rounded-full bg-violet-500 flex items-center justify-center">
                          <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* 参考图上传 */}
            <section className="space-y-2">
              <span className="text-xs font-semibold flex items-center gap-1">
                <ImageIcon className="h-3.5 w-3.5" />
                参考图片
                <span className="text-[10px] text-muted-foreground font-normal">
                  (可选)
                </span>
              </span>
              {uploadedImage ? (
                <div className="relative group">
                  {/* biome-ignore lint/performance/noImgElement: 本地 blob/data URI 参考图预览 */}
                  <img
                    src={uploadedImage.previewUrl}
                    alt="参考图"
                    className="w-full aspect-square object-cover rounded-lg border"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveUpload}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-rose-500 text-white shadow-md hover:scale-110 transition-transform"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <div className="absolute bottom-2 left-2 right-2 bg-black/50 backdrop-blur text-white text-[10px] px-2 py-0.5 rounded truncate">
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
                    "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all",
                    dragOver
                      ? "border-violet-500 bg-violet-500/5"
                      : "border-muted-foreground/25 hover:border-violet-500/50"
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
                    {uploading
                      ? "上传中..."
                      : dragOver
                        ? "释放即可上传"
                        : "点击或拖拽图片"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    JPG / PNG / WEBP · ≤10MB
                  </p>
                </div>
              )}
            </section>
          </div>

          {/* 底部生成按钮 */}
          <div className="p-3 border-t bg-muted/30">
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !selectedMask}
              className="w-full bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 rounded-full"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-1.5" />
                  生成图片
                </>
              )}
            </Button>
          </div>
        </aside>

        {/* ============ 右侧：结果展示区 ============ */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex items-center justify-center p-6 overflow-auto relative">
            {/* 空状态 */}
            {!generating && !result && !error && (
              <div className="text-center text-muted-foreground">
                <div className="h-20 w-20 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="h-10 w-10 opacity-30" />
                </div>
                <p className="text-sm font-medium">
                  选择效果后点击「生成图片」
                </p>
                <p className="text-xs mt-1">AI 将根据效果风格生成图片</p>
              </div>
            )}

            {/* 生成中 */}
            {generating && (
              <div className="text-center">
                <div className="relative inline-block">
                  <Loader2 className="h-16 w-16 text-sky-500 animate-spin" />
                  <Sparkles className="h-6 w-6 text-violet-500 absolute top-5 left-5" />
                </div>
                <p className="text-sm font-medium text-sky-700 dark:text-sky-400 mt-4">
                  AI 创作中...
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {pendingModelName || selectedMaskData?.name || "AI 生图"} ·
                  预计 5-15 秒
                </p>
              </div>
            )}

            {/* 结果 */}
            {result && !generating && (
              <div className="max-w-lg w-full space-y-4">
                {/* 成功徽章 */}
                <div className="flex items-center justify-center gap-2">
                  <span className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs px-3 py-1 rounded-full border border-emerald-500/20">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    生成完成
                  </span>
                </div>
                {/* 图片 */}
                <div className="relative rounded-2xl overflow-hidden border-2 border-violet-500/20 shadow-xl">
                  {/* biome-ignore lint/performance/noImgElement: 生图结果为动态 data URI/远程 URL，不宜走 next/image */}
                  <img
                    src={result.url}
                    alt="生成结果"
                    className="w-full object-cover"
                  />
                </div>

                {/* 操作 */}
                <div className="flex gap-2 justify-center">
                  <Button
                    type="button"
                    onClick={handleDownload}
                    className="bg-gradient-to-r from-violet-500 to-purple-600 rounded-full px-6"
                  >
                    <Download className="h-4 w-4 mr-1.5" />
                    下载图片
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full px-6"
                    onClick={() => {
                      setResult(null);
                      handleGenerate();
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                    再生成一张
                  </Button>
                </div>
              </div>
            )}

            {/* 错误 */}
            {error && !generating && (
              <div className="text-center max-w-sm">
                <div className="h-16 w-16 rounded-2xl bg-rose-500/10 flex items-center justify-center mx-auto mb-3">
                  <AlertCircle className="h-8 w-8 text-rose-500" />
                </div>
                <p className="text-sm font-medium text-rose-700 dark:text-rose-400 mb-1">
                  生成失败
                </p>
                <p className="text-xs text-muted-foreground mb-4">{error}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleGenerate}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  重试
                </Button>
              </div>
            )}
          </div>
        </main>

        {/* ============ 最右侧：本地历史记录栏（竖列） ============ */}
        {history.length > 0 && (
          <aside className="w-[180px] shrink-0 bg-white dark:bg-zinc-900 border-l flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b">
              <span className="text-[11px] font-semibold flex items-center gap-1 text-muted-foreground">
                <History className="h-3 w-3" />
                历史
                <span className="text-[9px] font-normal">
                  ·{history.length}
                </span>
              </span>
              <button
                type="button"
                onClick={handleClearHistory}
                className="text-[10px] text-muted-foreground hover:text-rose-600 flex items-center gap-0.5"
                title="清空历史"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {history.map((h) => (
                <button
                  type="button"
                  key={h.id}
                  className="group relative w-full aspect-square rounded-md overflow-hidden border bg-muted cursor-pointer hover:ring-2 hover:ring-violet-500/40 transition"
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
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-black/55 text-white text-[9px] px-1 py-0.5 truncate text-center">
                    {h.maskName}
                  </div>
                </button>
              ))}
              <p className="text-center text-[9px] text-muted-foreground/70 pt-1">
                仅存于此浏览器
              </p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
