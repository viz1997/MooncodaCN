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
 *   2. 上传参考图（多张 max 10，R2 presigned 直传 + 客户端 5MB 降采样）
 *   3. 点「生成图片」 → POST /api/public/generate → 轮询 → 1 张结果
 *   4. 结果卡：「下载 / 再生成一张 / 选择此效果下单」三按钮
 *   5. 点下单 → SpecModal 弹 → 选 productSize/accessoryCode/engraving
 *      - 模板无 productTypeCode → 跳过 modal，直接 toast 提交中 → 一键创建订单
 *   6. 调 submitImageGenDemoAction → 扣个人 credit + 写 SELECTED promptOrder
 *   7. 成功卡：订单号 + 扣减积分 + 「查看订单 / 再生成一个」按钮
 *
 * 参考 V1 生图工作台 generate-workbench-view.tsx handleFileSelect：多张图 + 5MB
 * 客户端降采样 + /api/image/upload（登录用户专属 presign 路径） + imageUrls[]
 * 透传 —— 避免 Lingting 上游 413，匹配 internalGenerateSchema imageUrls.max(10)
 * 硬上限。
 *
 * 复用：
 *   - /api/public/generate（GET 拿 mask 列表 / POST 发起 demo 生图）
 *   - /api/image/task/[id]（异步任务轮询）
 *   - /api/image/upload（R2 presigned 登录用户路径）
 *   - submitImageGenDemoAction（demo 一键下单，写 SELECTED promptOrder + 扣 credit）
 *   - SpecModal（规格选择弹窗）
 *   - @/lib/image-client-resize（浏览器端 5MB 降采样，避免 Lingting 413）
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
import type { ProductCapabilities } from "@/features/gpt-image/lib/product-catalog";
import { submitImageGenDemoAction } from "@/features/image-gen/actions/submit-image-gen-demo";

import {
  SpecModal,
  type SpecSelection,
} from "@/features/image-gen/components/spec-modal";
import { Link } from "@/i18n/routing";
import { resizeImage, wrapBlobAsFile } from "@/lib/image-client-resize";
import { cn } from "@/lib/utils";

/**
 * 2026-09-10：登录用户信息（从 page.tsx RSC 透传）。用于顶栏渲染用户名 +
 * 「我的订单」按钮 + 头像首字母。不传则降级到匿名样式（兼容单元测试）。
 */
export interface PublicImageGenUser {
  id: string;
  name: string | null;
  email: string | null;
}

interface PublicMask {
  maskId: string;
  name: string;
  previewUrl: string;
  productTypeCode: string | null;
  price: number;
  description: string;
  model: string;
  /**
   * 2026-09-10：模板级可配置尺寸子集（cm 数字字符串数组）。
   * - null/空数组 → 字典全量
   * - 非空 → 仅这些
   */
  allowedSizes?: string[] | null;
  /**
   * 2026-09-10：模板级可配置配件子集（code 数组）。
   */
  allowedAccessories?: string[] | null;
  /**
   * 2026-09-10：模板级 capability 覆盖。
   * - null/undefined → 继承 catalog 默认
   * - 非空 → SpecModal 用 effective capability 渲染
   */
  allowedCapabilities?: Partial<ProductCapabilities> | null;
  /**
   * 2026-09-10：皮革颜色子集。
   * - null/undefined/[] → LEATHER_COLORS 全展示
   * - 非空 → 仅这些 code（不在字典里的静默丢弃）
   */
  allowedColors?: string[] | null;
  /**
   * 2026-09-10：引用 promptTemplate.id（POST 时优先用 promptTemplate.prompt）。
   * 前端不直接读，保留字段用于诊断展示。
   */
  promptTemplateId?: string | null;
  /**
   * 2026-09-10：关联产品线 id 列表（productLineIds）—— 用于产品线 Segmented 分组过滤。
   */
  productLineIds?: string[];
}

/**
 * 2026-09-10：用户端产品线（active），由 GET 响应带回。
 * - productLineId：业务主键
 * - name：中文显示名
 * - coverUrl：封面图 URL（可空）
 * - sortOrder：排序（小的靠前）
 * - maskCount：该产品线下 active mask 数（用于 Segmented label 拼数字）
 */
interface PublicProductLine {
  productLineId: string;
  name: string;
  coverUrl: string;
  sortOrder: number;
  maskCount: number;
}

interface GeneratedResult {
  url: string;
  modelName: string;
  maskName: string;
  duration?: number | undefined;
}

// ============ 多张参考图（与 V1 工作台对齐，参考 generate-workbench-view） ============
// 2026-09-09：demo 支持多张参考图，与 [[v1-workbench-multi-image]] 同结构
// （uploadedImages 数组、localId 用 crypto.randomUUID 截 8 位、客户端 5MB 降采样、
// /api/image/upload 登录用户路径）。max=10 与 internalGenerateSchema imageUrls.max(10) 对齐。
interface UploadedImage {
  localId: string;
  previewUrl: string;
  publicUrl: string | null;
  uploading: 0 | 1;
  fileName: string;
  fileSize: number;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // File API / canvas 内存兜底
const MAX_REFERENCE_IMAGES = 10; // 与 schema imageUrls.max(10) 对齐

// ============ 本地历史记录（localStorage，不入库） ============
interface HistoryItem {
  id: string;
  url: string;
  maskId: string;
  maskName: string;
  modelName: string;
  refPreviewUrls?: string[] | undefined;
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
  refPreviewUrls?: string[] | undefined;
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

export function PublicImageGenView({ user }: { user?: PublicImageGenUser }) {
  // ========== 多张参考图 ==========
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedMask, setSelectedMask] = useState<string>("");
  const [masks, setMasks] = useState<PublicMask[]>([]);
  const [loadingMasks, setLoadingMasks] = useState(true);
  // 2026-09-10：产品线数据源 + 当前选中的产品线（"__all__" = 全部）
  const [productLines, setProductLines] = useState<PublicProductLine[]>([]);
  const [activeLineId, setActiveLineId] = useState<string>("__all__");

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
      refPreviewUrls: task.refPreviewUrls,
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

  // 加载 mask 列表（2026-09-10：同时取 productLines）
  useEffect(() => {
    fetch("/api/public/generate")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.masks))
          setMasks(data.masks as PublicMask[]);
        if (data.success && Array.isArray(data.productLines))
          setProductLines(data.productLines as PublicProductLine[]);
      })
      .catch(() => {})
      .finally(() => setLoadingMasks(false));
  }, []);

  // 2026-09-10：按产品线过滤后的 mask 列表（activeLineId === "__all__" 不过滤）
  const visibleMasks =
    activeLineId === "__all__"
      ? masks
      : masks.filter((m) => (m.productLineIds ?? []).includes(activeLineId));

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
    // 只在 masks 加载完成后恢复一次；pollTask/clearPoll 引用稳定
    // eslint-disable-next-line react-hooks/correctness/useExhaustiveDependencies
  }, [masks, pollTask]);

  // ============================================
  // 多张参考图上传（与 V1 工作台对齐）
  // ============================================

  /**
   * 把单张图上传到 R2：
   *   1) 客户端降采样到 ≤5MB（resizeImage）
   *   2) POST /api/image/upload 拿 { uploadUrl, publicUrl }（登录用户路径）
   *   3) PUT 文件到 R2 uploadUrl 直传
   *   4) 返 publicUrl
   *
   * 与工作台 uploadFileToR2 一致；改自 [[workbench-v2-lingting-413]] 的 5MB 上限。
   */
  const uploadFileToR2 = async (file: File): Promise<string> => {
    // 1) 拿预签名（/api/image/upload 是登录用户路径，5MB 限制 + 按 userId objectKey 隔离）
    const presignRes = await fetch("/api/image/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contentType: file.type,
        size: file.size,
        ext: file.name.split(".").pop()?.toLowerCase(),
      }),
    });
    if (!presignRes.ok) {
      throw new Error(`获取上传地址失败：HTTP ${presignRes.status}`);
    }
    const presignJson = (await presignRes.json()) as {
      success: boolean;
      uploadUrl?: string;
      publicUrl?: string;
      error?: string;
    };
    if (
      !presignJson.success ||
      !presignJson.uploadUrl ||
      !presignJson.publicUrl
    ) {
      throw new Error(presignJson.error ?? "获取上传地址失败");
    }

    // 2) PUT 到 R2 直传
    const putRes = await fetch(presignJson.uploadUrl, {
      method: "PUT",
      body: file,
    });
    if (!putRes.ok) {
      throw new Error(`R2 上传失败：HTTP ${putRes.status}`);
    }
    return presignJson.publicUrl;
  };

  /**
   * handleFileSelect —— push 单张图到 uploadedImages 数组，异步走客户端降采样 + R2 直传
   * 与 V1 工作台 generate-workbench-view.tsx handleFileSelect 同形态
   * （[[v1-workbench-multi-image]]）。
   */
  const handleFileSelect = (file: File | undefined) => {
    if (!file) return;
    if (
      !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(
        file.type
      )
    ) {
      toast.error("请上传 JPG/PNG/WEBP 格式");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("文件过大，最大 10MB");
      return;
    }
    if (uploadedImages.length >= MAX_REFERENCE_IMAGES) {
      toast.error(`参考图已达上限（最多 ${MAX_REFERENCE_IMAGES} 张）`);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    const localId = `${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
    const placeholder: UploadedImage = {
      localId,
      previewUrl,
      publicUrl: null,
      uploading: 1,
      fileName: file.name,
      fileSize: file.size,
    };
    setUploadedImages((prev) => [...prev, placeholder]);

    // 异步：客户端降采样 → R2 上传
    void (async () => {
      let toUpload: File = file;
      let finalSize = file.size;
      try {
        const resized = await resizeImage(file);
        if (resized.resized) {
          if (resized.finalBytes < resized.originalBytes * 0.95) {
            toast.success(
              `已自动压缩 ${(resized.originalBytes / 1024 / 1024).toFixed(1)}MB → ${(resized.finalBytes / 1024 / 1024).toFixed(1)}MB`
            );
          }
          toUpload = wrapBlobAsFile(resized.blob, file.name, file.type);
          finalSize = resized.finalBytes;
        }
      } catch (err) {
        // resize 失败：原图已 ≤10MB，按原图上传；Lingting 端可能再 413 但至少 try 一下
        // eslint-disable-next-line no-console
        console.warn("[image-gen] resize failed, uploading original:", err);
      }

      try {
        const publicUrl = await uploadFileToR2(toUpload);
        setUploadedImages((prev) =>
          prev.map((img) =>
            img.localId === localId
              ? { ...img, publicUrl, uploading: 0, fileSize: finalSize }
              : img
          )
        );
        setResult(null);
        setError(null);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[image-gen] upload to R2 failed:", err);
        setUploadedImages((prev) =>
          prev.map((img) =>
            img.localId === localId ? { ...img, uploading: 0 } : img
          )
        );
        toast.error(err instanceof Error ? err.message : "参考图上传失败");
      }
    })();
  };

  const handleRemoveUpload = (localId: string) => {
    setUploadedImages((prev) => {
      const target = prev.find((img) => img.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.localId !== localId);
    });
  };

  const handleClearAllUploads = () => {
    setUploadedImages((prev) => {
      for (const img of prev) URL.revokeObjectURL(img.previewUrl);
      return [];
    });
  };

  // 已上传成功的参考图 publicUrl 列表（传给生成 API）
  const refImageUrls = uploadedImages
    .filter((i) => i.publicUrl)
    .map((i) => i.publicUrl) as string[];

  // ============================================
  // 生成 + 下单
  // ============================================

  const handleGenerate = async () => {
    if (!selectedMask) {
      toast.error("请先选择效果");
      return;
    }
    if (uploadedImages.some((i) => i.uploading === 1)) {
      toast.error("参考图上传中，请稍候");
      return;
    }
    if (
      uploadedImages.length > 0 &&
      refImageUrls.length !== uploadedImages.length
    ) {
      toast.error("部分参考图上传失败，请重试");
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
          // 多张参考图：imageUrls[] 优先；空数组退化为 text_to_image（mask 没 ref 图也能生成）
          ...(refImageUrls.length > 0 ? { imageUrls: refImageUrls } : {}),
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
          refPreviewUrls: uploadedImages.map((i) => i.previewUrl),
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
          refPreviewUrls: uploadedImages.map((i) => i.previewUrl),
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

  const selectedMaskData = masks.find((m) => m.maskId === selectedMask);

  // 点「选择此效果下单」
  const handleClickSubmitOrder = () => {
    if (!result || !selectedMaskData) return;
    // demo 一键下单必须有 R2 URL（base64 不支持）；多图取第一张的 publicUrl 写订单的 uploadedImages[0]
    if (refImageUrls.length === 0) {
      toast.error("下单需要参考图的 R2 URL，请先上传至少一张参考图");
      return;
    }
    // 无 productTypeCode → 跳过 modal，直接走免规格下单
    if (!selectedMaskData.productTypeCode) {
      void handleConfirmSpec({
        productSize: null,
        accessoryCode: null,
        engravingText: null,
        engravingExposed: null,
        // 2026-09-10：LB 扩字段（无 productTypeCode → 全 null）
        leatherColor: null,
        leatherExposed: null,
        pvcProtection: null,
        remarks: null,
      });
      return;
    }
    setShowSpecModal(true);
  };

  // 确认规格 → 调 submitImageGenDemoAction
  const handleConfirmSpec = async (spec: SpecSelection) => {
    if (!result || !selectedMaskData) return;
    if (refImageUrls.length === 0) {
      toast.error("参考图丢失，请重新上传");
      return;
    }

    setShowSpecModal(false);
    setSubmitting(true);
    try {
      const res = await submitImageGenDemoAction({
        templateId: selectedMaskData.maskId,
        // demo 一键下单：上传图片列表里取第一张作为订单 uploadedImages[0]
        // （多图模式下其他参考图保留在 uploadedImages 里供后续 regenerate 用）
        referenceImageUrl: refImageUrls[0] ?? "",
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
      {/* 顶部导航 —— 2026-09-10 加用户信息 + 「我的订单」入口 */}
      <header className="h-12 shrink-0 bg-white dark:bg-zinc-900 border-b flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span className="font-bold text-sm">AI 生图</span>
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            · 3D打印定制 · 一键生成
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/image-gen/orders"
            className="text-xs text-muted-foreground hover:text-violet-600 flex items-center gap-1 px-2 py-1 rounded-md hover:bg-violet-500/5 transition-colors"
            title="查看我的订单"
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">我的订单</span>
          </Link>
          {user ? (
            <div
              className="flex items-center gap-2 pl-2 ml-1"
              title={user.email ?? user.name ?? user.id}
            >
              <div className="h-6 w-6 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-semibold">
                {(user.name ?? user.email ?? user.id).slice(0, 1).toUpperCase()}
              </div>
              <span className="text-xs font-medium hidden md:inline max-w-[120px] truncate">
                {user.name ?? user.email ?? "用户"}
              </span>
            </div>
          ) : (
            <Link
              href="/sign-in?callbackUrl=/image-gen"
              className="text-xs px-3 py-1 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 transition-colors"
            >
              登录
            </Link>
          )}
        </div>
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
                    · {visibleMasks.length} 个
                  </span>
                )}
              </span>
              {/* 2026-09-10：产品线 Segmented 分组（DB-backed productLines） */}
              {productLines.length > 0 && (
                <div className="overflow-x-auto -mx-1 px-1 pb-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setActiveLineId("__all__")}
                      className={cn(
                        "text-[10px] px-2.5 py-1 rounded-full border transition-colors shrink-0",
                        activeLineId === "__all__"
                          ? "bg-violet-500 text-white border-violet-500"
                          : "bg-background hover:bg-muted"
                      )}
                    >
                      全部 · {masks.length}
                    </button>
                    {productLines.map((l) => (
                      <button
                        key={l.productLineId}
                        type="button"
                        onClick={() => setActiveLineId(l.productLineId)}
                        className={cn(
                          "text-[10px] px-2.5 py-1 rounded-full border transition-colors shrink-0",
                          activeLineId === l.productLineId
                            ? "bg-violet-500 text-white border-violet-500"
                            : "bg-background hover:bg-muted"
                        )}
                      >
                        {l.name} · {l.maskCount}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
              ) : visibleMasks.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                  该产品线下暂无效果
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
                  {visibleMasks.map((m) => (
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

            {/* 参考图上传（多张） */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold flex items-center gap-1">
                  <ImageIcon className="h-3.5 w-3.5" />
                  参考图片
                  <span className="text-[10px] text-muted-foreground font-normal">
                    (可选 · 最多 {MAX_REFERENCE_IMAGES} 张)
                  </span>
                </span>
                {uploadedImages.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllUploads}
                    className="text-[10px] text-muted-foreground hover:text-rose-600 flex items-center gap-0.5"
                    title="清空所有参考图"
                  >
                    <Trash2 className="h-3 w-3" />
                    清空
                  </button>
                )}
              </div>
              {uploadedImages.length > 0 ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {uploadedImages.map((img, idx) => (
                    <div
                      key={img.localId}
                      className="relative group aspect-square"
                    >
                      {/* biome-ignore lint/performance/noImgElement: 本地 blob 参考图预览 */}
                      <img
                        src={img.previewUrl}
                        alt={`参考图 ${idx + 1}`}
                        className={cn(
                          "w-full h-full object-cover rounded-lg border",
                          img.uploading === 1 && "opacity-50"
                        )}
                      />
                      {img.uploading === 1 && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveUpload(img.localId)}
                        className="absolute top-0.5 right-0.5 p-1 rounded-full bg-rose-500 text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                      {img.publicUrl && (
                        <div className="absolute bottom-0.5 left-0.5 h-3 w-3 rounded-full bg-emerald-500 flex items-center justify-center">
                          <CheckCircle2 className="h-2 w-2 text-white" />
                        </div>
                      )}
                    </div>
                  ))}
                  {uploadedImages.length < MAX_REFERENCE_IMAGES && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-violet-500/50 flex items-center justify-center text-muted-foreground hover:text-violet-500 transition"
                      title="继续添加"
                    >
                      <Upload className="h-4 w-4" />
                    </button>
                  )}
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
                    {dragOver ? "释放即可上传" : "点击或拖拽图片"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    JPG / PNG / WEBP · ≤10MB（自动压缩到 5MB）
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
                  {uploadedImages.length > 0 && (
                    <span className="inline-flex items-center gap-1 bg-violet-500/10 text-violet-700 dark:text-violet-400 text-xs px-3 py-1 rounded-full border border-violet-500/20">
                      参考图 {uploadedImages.length} 张
                    </span>
                  )}
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
                      void handleGenerate();
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
                {refImageUrls.length === 0 && (
                  <p className="text-[10px] text-center text-amber-600 dark:text-amber-400">
                    当前未上传参考图，下单需要至少 1 张参考图 —— 请先上传
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
                  {h.refPreviewUrls && h.refPreviewUrls.length > 0 && (
                    <div className="absolute top-1 left-1 h-4 w-4 rounded-full bg-violet-500/90 flex items-center justify-center text-[9px] font-medium text-white">
                      {h.refPreviewUrls.length}
                    </div>
                  )}
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

      {/* 2026-09-10：「我的订单」独立页面入口已挪到顶栏 Link(/image-gen/orders) */}
      {/* 订单详情用 inline view：/image-gen/orders 走 OrdersView 同页展开 */}
    </div>
  );
}
