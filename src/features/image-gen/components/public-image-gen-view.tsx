"use client";

/**
 * /image-gen —— 登录用户 demo 生图页 + 「选择此效果下单」一键下单
 *
 * 2026-09-09：代理商概念砍掉后，/image-gen 重新设计为：
 *   - 主体保留原公开 demo 形态（单次生图 + localStorage 历史）
 *   - 登录 gate 在 page.tsx RSC 层处理（未登录跳 /sign-in）
 *   - 结果卡新增「选择此效果下单」按钮 → 弹 SpecModal → 调 submitImageGenDemoAction
 *   - demo 一键下单后显示成功卡（订单号 + 扣减积分 + 查看订单 / 再生成一个）
 *
 * 流程：
 *   1. 选 mask（productEffect 网格，从 /api/public/generate GET 拿）
 *   2. 上传参考图（可选，R2 presigned 直传；fallback base64 小图）
 *   3. 点「生成图片」 → POST /api/public/generate → 轮询 → 1 张结果
 *   4. 结果卡：「下载 / 再生成一张 / 选择此效果下单」三按钮
 *   5. 点下单 → SpecModal 弹 → 选 productSize/accessoryCode/engraving
 *      - 模板无 productTypeCode → 跳过 modal，直接 toast 提交中 → 一键创建订单
 *   6. 调 submitImageGenDemoAction → 扣个人 credit + 写 SELECTED promptOrder
 *   7. 成功卡：订单号 + 扣减积分 + 「查看订单 / 再生成一个」按钮
 *
 * 复用：
 *   - /api/public/generate（GET 拿 mask 列表 / POST 发起 demo 生图）
 *   - /api/image/task/[id]（异步任务轮询）
 *   - /api/public/upload（R2 presigned）
 *   - submitImageGenDemoAction（demo 一键下单，写 SELECTED promptOrder + 扣 credit）
 *   - SpecModal（规格选择弹窗）
 */

import {
  AlertCircle,
  CheckCircle2,
  Download,
  History,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { submitImageGenDemoAction } from "@/features/image-gen/actions/submit-image-gen-demo";

import {
  SpecModal,
  type SpecSelection,
} from "@/features/image-gen/components/spec-modal";
import { cn } from "@/lib/utils";

interface PublicMask {
  maskId: string;
  name: string;
  previewUrl: string;
  productTypeCode: string | null;
  price: number;
  description: string;
  model: string;
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
  /** demo 下单成功后写入：用于历史缩略图上的「查看订单」徽章 */
  orderId?: string | undefined;
  orderNo?: string | undefined;
  /** 价格（demo 下单扣减的 credit 数） */
  creditsConsumed?: number | undefined;
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

// ============================================
// Page
// ============================================

export function PublicImageGenView() {
  // ========== demo 主状态 ==========
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

  // ========== demo 下单流程状态 ==========
  const [showSpecModal, setShowSpecModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{
    orderId: string;
    orderNo: string;
    token: string;
    creditsConsumed: number;
  } | null>(null);

  // 加载历史
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
    toast.success("历史已清空");
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
    toast.error(msg);
  };

  // 持续轮询进行中任务
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

  // 组件卸载清理
  useEffect(() => () => clearPoll(), [clearPoll]);

  // 加载 mask 列表
  useEffect(() => {
    fetch("/api/public/generate")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.masks))
          setMasks(data.masks as PublicMask[]);
      })
      .catch(() => {})
      .finally(() => setLoadingMasks(false));
  }, []);

  // 刷新恢复：masks 加载后，若存在进行中任务则恢复并续轮询
  useEffect(() => {
    if (!masks.length) return;
    const task = loadTask();
    if (!task) return;
    if (masks.some((m) => m.maskId === task.maskId)) {
      setSelectedMask(task.maskId);
    }
    if (Date.now() - new Date(task.startedAt).getTime() > POLL_TIMEOUT) {
      saveTask(null);
      toast.error("上次生成已超时，请重新生成");
      return;
    }
    setGenerating(true);
    setResult(null);
    setError(null);
    setPendingModelName(task.maskName);
    pollTask(task, true);
    // 只在 masks 加载完成后恢复一次；pollTask/clearPoll 引用稳定（useCallback-free 但函数体依赖的 task 不变）
    // eslint-disable-next-line react-hooks/correctness/useExhaustiveDependencies
  }, [masks, pollTask]);

  // 文件选择：优先走 R2 presigned 直传（图不经过服务器）；
  // R2 未配置或签名失败时回退 base64（仅小图可行，大图会被 413）。
  const handleFileSelect = async (file: File | undefined) => {
    if (!file) return;
    if (
      !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(
        file.type
      )
    ) {
      toast.error("请上传 JPG/PNG/WEBP 格式");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("文件过大，最大 10MB");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setUploading(true);

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
        toast.success("参考图已上传");
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
        toast.error(msg);
        return;
      }
      console.warn("[upload] R2 直传失败，回退 base64:", err);
    }

    // 回退：base64 data URI（仅小图）—— 此路径下 publicUrl 为空，下单流程不能走
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
      const msg = err instanceof Error ? err.message : "图片读取失败";
      setError(msg);
      toast.error(msg);
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
      toast.error("请先选择效果");
      return;
    }
    clearPoll();
    saveTask(null);
    setPendingModelName("");
    setGenerating(true);
    setError(null);
    setResult(null);
    setSubmitted(null); // 新的生成重置已提交态

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
        toast.success(`生成完成：${maskName}`);
      } else {
        throw new Error(data.error || "生成失败");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      setGenerating(false);
      setError(msg);
      toast.error(msg);
    }
  };

  const handleDownload = () => {
    if (result?.url) {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = `mooncoda_${Date.now()}.png`;
      a.target = "_blank";
      a.click();
      toast.success("已开始下载");
    }
  };

  // ============================================
  // 下单流程
  // ============================================

  const selectedMaskData = masks.find((m) => m.maskId === selectedMask);

  // 点「选择此效果下单」
  const handleClickSubmitOrder = () => {
    if (!result || !selectedMaskData) return;
    if (!uploadedImage?.publicUrl) {
      toast.error(
        "下单需要参考图的 R2 URL。当前为 base64 模式，请重传 ≤3MB 的小图或配置 R2"
      );
      return;
    }
    // 无 productTypeCode → 跳过 modal，直接走免规格下单
    if (!selectedMaskData.productTypeCode) {
      void handleConfirmSpec({
        productSize: null,
        accessoryCode: null,
        engravingText: null,
        engravingExposed: null,
      });
      return;
    }
    setShowSpecModal(true);
  };

  // 确认规格 → 调 submitImageGenDemoAction
  const handleConfirmSpec = async (spec: SpecSelection) => {
    if (!result || !selectedMaskData || !uploadedImage?.publicUrl) return;

    setShowSpecModal(false);
    setSubmitting(true);
    try {
      const res = await submitImageGenDemoAction({
        templateId: selectedMaskData.maskId,
        referenceImageUrl: uploadedImage.publicUrl,
        productTypeCode: selectedMaskData.productTypeCode,
        productSize: spec.productSize,
        accessoryCode: spec.accessoryCode,
        engravingText: spec.engravingText,
        engravingExposed: spec.engravingExposed,
      });
      if (!res?.data) throw new Error("下单失败");
      const data = res.data;
      setSubmitted({
        orderId: data.orderId,
        orderNo: data.orderNo,
        token: data.token,
        creditsConsumed: data.creditsConsumed,
      });

      // 历史更新：把刚生成的 item 加 orderId
      setHistory((prev) => {
        const next = prev.map((h) =>
          h.url === result.url && !h.orderId
            ? {
                ...h,
                orderId: data.orderId,
                orderNo: data.orderNo,
                creditsConsumed: data.creditsConsumed,
              }
            : h
        );
        saveHistory(next);
        return next;
      });

      toast.success(
        data.creditsConsumed > 0
          ? `订单已创建，扣减 ${data.creditsConsumed} 积分`
          : "订单已创建"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "下单失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 重置 demo（再生成一个）
  const handleResetDemo = () => {
    setSubmitted(null);
    setResult(null);
    setError(null);
  };

  // ============================================
  // 渲染
  // ============================================

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
                  {[
                    "skel-0",
                    "skel-1",
                    "skel-2",
                    "skel-3",
                    "skel-4",
                    "skel-5",
                  ].map((k) => (
                    <div
                      key={k}
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
                      onClick={() => {
                        setSelectedMask(m.maskId);
                        setSubmitted(null);
                      }}
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
                        {m.previewUrl ? (
                          // biome-ignore lint/performance/noImgElement: 动态远程预览图
                          <img
                            src={m.previewUrl}
                            alt={m.name}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="w-full h-full rounded-md bg-gradient-to-br from-violet-200 via-fuchsia-200 to-sky-200 dark:from-violet-900/50 dark:via-fuchsia-900/40 dark:to-sky-900/40 flex items-center justify-center">
                            <span className="text-2xl font-bold text-violet-700/70 dark:text-violet-300/70">
                              {m.name.slice(0, 1)}
                            </span>
                          </div>
                        )}
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
                    {!uploadedImage.publicUrl && (
                      <span className="ml-1 text-amber-300">(base64)</span>
                    )}
                  </div>
                </div>
              ) : (
                // biome-ignore lint/a11y/useSemanticElements: 拖拽上传区
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
              disabled={generating || submitting || !selectedMask}
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
            {!generating && !result && !error && !submitted && (
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

            {/* 成功：结果（未提交时） */}
            {result && !generating && !submitted && (
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
                  {/* biome-ignore lint/performance/noImgElement: 生图结果为动态远程 URL */}
                  <img
                    src={result.url}
                    alt="生成结果"
                    className="w-full object-cover"
                  />
                </div>

                {/* 操作：下载 / 再生成 / 选择此效果下单 */}
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button
                    type="button"
                    onClick={handleDownload}
                    variant="outline"
                    className="rounded-full"
                  >
                    <Download className="h-4 w-4 mr-1.5" />
                    下载图片
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      setResult(null);
                      handleGenerate();
                    }}
                    disabled={generating || submitting}
                  >
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                    再生成一张
                  </Button>
                  <Button
                    type="button"
                    className="rounded-full bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
                    onClick={handleClickSubmitOrder}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        提交中...
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="h-4 w-4 mr-1.5" />
                        选择此效果下单
                      </>
                    )}
                  </Button>
                </div>
                {!uploadedImage?.publicUrl && (
                  <p className="text-[10px] text-center text-amber-600 dark:text-amber-400">
                    当前参考图为 base64 模式，下单需要 R2 URL ——
                    请重传图片或配置 R2
                  </p>
                )}
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

            {/* 已下单：成功卡（替换结果视图） */}
            {submitted && (
              <div className="max-w-md w-full text-center py-12 space-y-5">
                <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">订单已创建</h2>
                  <p className="text-sm text-muted-foreground mt-2">
                    订单号：{submitted.orderNo}
                  </p>
                  {submitted.creditsConsumed > 0 && (
                    <p className="text-sm text-muted-foreground mt-1">
                      已扣减 {submitted.creditsConsumed} 积分
                    </p>
                  )}
                </div>
                {/* 预览缩略 */}
                {result && (
                  <div className="mx-auto w-48 h-48 rounded-xl overflow-hidden border-2 border-emerald-500/20">
                    {/* biome-ignore lint/performance/noImgElement: 已生成结果预览 */}
                    <img
                      src={result.url}
                      alt="已下单效果"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex flex-col sm:flex-row gap-2 justify-center">
                  <Button
                    variant="outline"
                    onClick={() => {
                      window.location.href = `/p/${submitted.token}`;
                    }}
                  >
                    查看订单详情
                  </Button>
                  <Button
                    onClick={handleResetDemo}
                    className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
                  >
                    <Sparkles className="h-4 w-4 mr-1.5" />
                    再生成一个
                  </Button>
                </div>
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
                    if (h.orderId) {
                      // 已下单的项 → 跳订单页
                      window.location.href = `/p/${h.orderNo}`;
                      return;
                    }
                    // 未下单的项 → 仅展示
                    setSubmitted(null);
                    setError(null);
                    setSelectedMask(h.maskId);
                    setResult({
                      url: h.url,
                      modelName: h.modelName,
                      maskName: h.maskName,
                    });
                  }}
                >
                  {/* biome-ignore lint/performance/noImgElement: 历史图为动态远程 URL */}
                  <img
                    src={h.url}
                    alt={h.maskName}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-black/55 text-white text-[9px] px-1 py-0.5 truncate text-center">
                    {h.maskName}
                  </div>
                  {h.orderId && (
                    <div
                      className="absolute top-1 right-1 h-4 w-4 rounded-full bg-emerald-500 flex items-center justify-center"
                      title="已下单"
                    >
                      <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                    </div>
                  )}
                </button>
              ))}
              <p className="text-center text-[9px] text-muted-foreground/70 pt-1">
                仅存于此浏览器
              </p>
            </div>
          </aside>
        )}
      </div>

      {/* 规格选择 modal */}
      <SpecModal
        open={showSpecModal}
        template={selectedMaskData ?? null}
        submitting={submitting}
        onClose={() => setShowSpecModal(false)}
        onConfirm={(spec) => void handleConfirmSpec(spec)}
      />
    </div>
  );
}
