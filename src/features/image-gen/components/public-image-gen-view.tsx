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
  Edit3,
  FileText,
  History,
  Image as ImageIcon,
  Loader2,
  LogOut,
  RefreshCw,
  Share2,
  ShoppingCart,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { QuadrantGridPicker } from "@/components/quadrant-grid-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCanvasStore } from "@/features/canvas/stores/canvas/use-canvas-store";
import type { ProductCapabilities } from "@/features/gpt-image/lib/product-catalog";
import { ShareCard } from "@/features/gpt-image/user/components/share-card";
import { createPreviewShareAction } from "@/features/image-gen/actions/create-preview-share";
import { submitImageGenDemoAction } from "@/features/image-gen/actions/submit-image-gen-demo";

import {
  SpecModal,
  type SpecSelection,
} from "@/features/image-gen/components/spec-modal";
import { downloadProxyUrl } from "@/features/image-gen/lib/thumbnail-url";
import { Link, useRouter } from "@/i18n/routing";
import { signOut } from "@/lib/auth/client";
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
  /**
   * 2026-09-11：候选宫格数（1/2/4/9）。=1 或 outputMode="separate" 时不渲染 picker，
   * 直接以单图模式展示。>1 + outputMode="grid" 时必渲染 QuadrantGridPicker。
   * 老 history 项 / 老 API 响应没这字段时视为 1。
   */
  candidateCount?: number;
  /**
   * 2026-09-11：输出模式 —— "grid" = 1 张 composite 含 N 个 cell（用 picker）；
   * "separate" = N 张独立候选 URL（无需 picker，每张直接展示）。
   * 缺省视为 "grid"。
   */
  outputMode?: "grid" | "separate";
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

// ============ 全部历史效果图（photo 表 source=generation） ============
//
// 2026-09-14：去掉 localStorage 本地历史，改为查 /api/image-gen/photos/list?source=generation
// 取当前用户所有生图结果（跨设备、跨浏览器一致）。photo 行里没有 maskName /
// refPublicUrls / orderId / selectedCell —— 点击仅切 result.url 作预览，不再还原
// uploadedImages / selectedCell，不显示「查看订单」徽章。

/**
 * 把 next-safe-action 的 validationErrors 拍扁成可读字符串（schema 验证失败时用）。
 * 避免 toast 只看到「创建分享凭证失败 / 下单失败」兜底文案，看不到真正哪个字段不合法。
 * next-safe-action 5.x 的 validationErrors 是 ZodIssue[][]（按 schema 嵌套层级），这里
 * 把所有 issue.path.join(".") + issue.message 拼成一行。
 */
function extractValidationMessage(errors: unknown): string | null {
  if (!errors) return null;
  const collect = (node: unknown, path: string[] = []): string[] => {
    if (!node) return [];
    if (Array.isArray(node)) {
      // 顶层是 ZodIssue[]，每个元素可能再有 _errors 字段或本身就是 issue
      const out: string[] = [];
      for (const item of node) {
        if (item && typeof item === "object" && "message" in item) {
          const issue = item as {
            path?: (string | number)[];
            message?: string;
          };
          const key = [...path, ...(issue.path ?? [])].join(".");
          out.push(`${key || "?"}: ${issue.message ?? "校验失败"}`);
        } else if (Array.isArray(item)) {
          out.push(...collect(item, path));
        } else if (item && typeof item === "object" && "_errors" in item) {
          // zod flatten() 形态：{ field: { _errors: [...] } }
          const fieldObj = item as Record<string, unknown>;
          for (const [k, v] of Object.entries(fieldObj)) {
            if (k === "_errors") continue;
            out.push(...collect(v, [...path, k]));
          }
          const msgs = (fieldObj as { _errors?: unknown[] })._errors;
          if (Array.isArray(msgs)) {
            for (const m of msgs) {
              if (typeof m === "string") {
                out.push(`${path.join(".") || "?"}: ${m}`);
              }
            }
          }
        }
      }
      return out;
    }
    if (typeof node === "object") {
      // root 形态：{ _errors: [...], fieldName: { _errors: [...] } }
      const obj = node as Record<string, unknown>;
      const out: string[] = [];
      const rootMsgs = obj._errors;
      if (Array.isArray(rootMsgs)) {
        for (const m of rootMsgs) {
          if (typeof m === "string") out.push(m);
        }
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k === "_errors") continue;
        out.push(...collect(v, [...path, k]));
      }
      return out;
    }
    return [];
  };
  const msgs = collect(errors);
  if (msgs.length === 0) return null;
  return msgs.join("；");
}

// ============ 进行中任务持久化（单任务，刷新后可恢复） ============
interface PendingTask {
  taskId: string;
  maskId: string;
  maskName: string;
  refPreviewUrls?: string[] | undefined;
  /**
   * 2026-09-11：参考图 R2 公网 URL（与 refPreviewUrls 一一对应，blob URL
   * 刷新失效 → 任务恢复时或后续下单用 refPublicUrls 还原 uploadedImages）。
   */
  refPublicUrls?: string[] | undefined;
  /** 2026-09-11：模板宫格候选数（让 finishTask 写 history 时带上） */
  candidateCount?: number;
  /** 2026-09-11：模板输出模式（grid/separate） */
  outputMode?: "grid" | "separate";
  startedAt: string;
}

const TASK_KEY = "mooncoda_public_imagegen_task";
const POLL_INTERVAL = 2500;
const POLL_TIMEOUT = 120000; // 与 API maxDuration 对齐

/**
 * 2026-09-14：最近一次完成结果快照 —— 解决「生成成功 → 刷新页面 / 点历史栏 result
 * → uploadedImages 全空」的丢参考图 bug。
 *
 * 历史背景：
 * - 之前只有 TASK_KEY 持久化「进行中任务」；finishTask 后立即 saveTask(null)
 * - 用户刷新页面 → result/uploadedImages 全空；点右侧 DB 历史栏 → setResult
 *   但 uploadedImages 仍空 → 撞 preflight「请先上传参考图」toast
 * - DB photo 行不存 referenceImageUrl（参考图不存 photo 表），server 端拿不到
 *   历史生图的参考图 URL 列表；只能客户端 localStorage 兜底
 *
 * 持久化策略：
 * - finishTask 完成时把当前 result + uploadedImages + selectedMask + selectedCell
 *   一起写 LAST_RESULT_KEY（不覆盖进行中任务）
 * - 用户开始新一轮生成（handleGenerate）→ 清 LAST_RESULT_KEY
 * - 用户点「再生成一个」按钮（= setResult(null) + handleGenerate）→ 清 LAST_RESULT_KEY
 * - 用户调 handleResetDemo → 清 LAST_RESULT_KEY
 * - 页面 mount：loadLastResult() → 若有 → setResult + restoreUploadedImagesFromR2 +
 *   setSelectedMask + setSelectedCell，让 result 卡渲染出来时按钮 enabled
 * - 持久化窗口：直到下一次生成开始；不需要过期机制（同账号多设备用户重新生成就覆盖）
 */
interface LastResultSnapshot {
  result: GeneratedResult;
  uploadedImages: UploadedImage[];
  selectedMask: string;
  selectedCell: number | null;
  finishedAt: string;
}
const LAST_RESULT_KEY = "mooncoda_public_imagegen_last_result";

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

/** 2026-09-14：lastResult 快照读写 —— 见上方 LastResultSnapshot 注释 */
function loadLastResult(): LastResultSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_RESULT_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (!t || typeof t !== "object" || !t.result) return null;
    return t as LastResultSnapshot;
  } catch {
    return null;
  }
}
function saveLastResult(snapshot: LastResultSnapshot | null) {
  try {
    if (snapshot) {
      localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(snapshot));
    } else {
      localStorage.removeItem(LAST_RESULT_KEY);
    }
  } catch {
    // 静默
  }
}

// ============================================
// Page
// ============================================

export function PublicImageGenView({ user }: { user?: PublicImageGenUser }) {
  // 2026-09-13：去画布精修跳转 — next-intl 包装的 useRouter 自动加 locale 前缀。
  // 与文件内 Link 配套使用；直接 push 字符串路径会让画布路由丢 locale 前缀。
  const router = useRouter();
  // ========== 多张参考图 ==========
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 2026-09-XX：用户自由描述提示词。
  // - 选了模板时：append 到 promptTemplate.prompt 末尾（newline 分隔）
  //   → 走 image_gen 模型（带模板风格 + 用户修改意图）
  // - 没选模板时：作为唯一 prompt，API 走 text_to_image（无 ref）或
  //   image_to_image（有 ref）
  // trim 后判空避免空白占用 UI + 阻断提交。
  const [customPrompt, setCustomPrompt] = useState("");
  // 用于「基于此图改」按钮自动滚动 + 聚焦描述框
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const [selectedMask, setSelectedMask] = useState<string>("");
  const [masks, setMasks] = useState<PublicMask[]>([]);
  const [loadingMasks, setLoadingMasks] = useState(true);
  // 2026-09-10：产品线数据源 + 当前选中的产品线（"__all__" = 全部）
  const [productLines, setProductLines] = useState<PublicProductLine[]>([]);
  const [activeLineId, setActiveLineId] = useState<string>("__all__");

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 2026-09-11：demo 流用户在宫格里选的 cell（0..N-1）。
  // - candidateCount > 1 + outputMode="grid" 时必填才能提交
  // - 切换 mask 时重置；finishTask 写 history 时持久化；刷新后用 PendingTask 复原
  const [selectedCell, setSelectedCell] = useState<number | null>(null);

  const [dbHistory, setDbHistory] = useState<
    Array<{
      id: string;
      fileUrl: string;
      thumbnailUrl: string | null;
      model: string | null;
      format: string | null;
      createdAt: string | Date;
      // 2026-09-15：联表 imageJob 拿 maskId —— 历史点击要 setSelectedMask 让
      // 4 宫格 picker 正确渲染（否则当前 mask 是 1-候选，看不到 picker）。
      maskId: string | null;
    }>
  >([]);
  const [pendingModelName, setPendingModelName] = useState<string>("");
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ========== demo 下单流程状态 ==========
  const [showSpecModal, setShowSpecModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /**
   * 2026-09-15：/image-gen demo 下单与 preview 创建分享是**两条独立路径**
   * （用户原话「提交订单不需要创建分享，创建分享也不需要提交订单」+「分享
   * 链接是 /p/token，不是下单」+「点击分享后不需要这个页面，维持原页面」）。
   *
   * - demo 下单：handleClickSubmitOrder → submitDemoOrder → submitImageGenDemoAction
   *   写 promptOrder（SELECTED 状态）+ 扣个人 credit。成功后**替换结果视图
   *   为 demo 成功卡**（订单号 + 扣减积分 + 查看订单/再生成）。
   * - preview 分享：handleClickSharePreview → createSharePreview → createPreviewShareAction
   *   写 preview_share（status=candidates_ready + 预扣代理商 creditsLocked），
   *   客人扫码进 /p/{token} 确认后由 /api/orders/[token]/guest-confirm 扣
   *   代理商 credit 转 SELECTED。成功后**不替换结果视图**，仅自动弹 ShareCard
   *   Modal（QR + 复制链接指向 /p/{token}）；用户可继续操作结果卡的
   *   下载/去画布精修/再生成/选择此效果下单。
   *
   * 两条路径的 token 是不同来源：
   * - demo 路径 promptOrder 没有可分享的 /p/token
   * - preview 路径 preview_share.token = /p/{token} 的扫码凭证
   *
   * 状态拆分：
   * - submitted：只承载 demo 下单结果（不再有 kind: "preview" 分支）
   * - previewShareToken / previewShareOrderNo：preview 凭证数据，**不触发
   *   成功卡**，仅用于 ShareCard Modal + QR 渲染
   */
  const [submitted, setSubmitted] = useState<{
    orderId: string;
    orderNo: string;
    /** demo 流已扣 credit（个人 credit FIFO + SELECTED 订单转生产） */
    creditsConsumed: number;
  } | null>(null);
  /**
   * 2026-09-14：SpecModal 回调函数引用 —— 点 demo 下单按钮时绑 submitDemoOrder；
   * 点 preview 分享按钮时绑 createSharePreview。SpecModal.onConfirm 单纯转发
   * spec 给当前回调。两条路径**完全独立**，互不混（用户原话「下单的时候不出现
   * 分享弹窗」+「但是分享按钮要出现分享弹窗」）。
   */
  const [specOnConfirm, setSpecOnConfirm] = useState<
    ((spec: SpecSelection) => Promise<void>) | null
  >(null);
  /** 2026-09-15：preview 流专属凭证数据 —— 与 submitted 完全解耦。
   * createSharePreview 成功后 set 这两个 + 自动弹 ShareCard Modal，不替换结果视图。
   * handleResetDemo 时一起清掉（虽然预览流不进 handleResetDemo，但保留兜底）。 */
  const [previewShareToken, setPreviewShareToken] = useState<string | null>(
    null
  );
  const [previewShareOrderNo, setPreviewShareOrderNo] = useState<string | null>(
    null
  );
  // 2026-09-15：分享弹窗 —— preview 成功时弹独立 ShareCard Modal，QR + 复制
  // 链接指向 /p/{previewShareToken}（preview_share.token）。
  // 不替换结果视图（用户原话「点击分享后不需要这个页面，维持原页面」）。
  const [showShareModal, setShowShareModal] = useState(false);
  // preview 路径专属的分享弹窗 URL —— token 来自 previewShareToken。
  const shareUrl = useMemo(() => {
    if (!previewShareToken || !showShareModal) return "";
    if (typeof window === "undefined") return `/p/${previewShareToken}`;
    return `${window.location.origin}/p/${previewShareToken}`;
  }, [submitted, showShareModal]);

  // 2026-09-14：刷新 DB 历史（photo.source=generation）。成功回填 dbHistory，
  // 失败静默（不影响主流程）。初始挂载 + finishTask 后都调用。
  const refreshDbHistory = useCallback(() => {
    return fetch("/api/image-gen/photos/list?source=generation&limit=30", {
      cache: "no-store",
    })
      .then(
        (r) =>
          r.json() as Promise<{
            success: boolean;
            data?: {
              photos: Array<{
                id: string;
                fileUrl: string;
                thumbnailUrl: string | null;
                model: string | null;
                format: string | null;
                createdAt: string | Date;
                // 2026-09-15：联表 imageJob 拿到的 maskId，用于 4 宫格 picker 渲染
                maskId?: string | null;
              }>;
            };
          }>
      )
      .then((j) => {
        if (!j.success || !j.data) return;
        // 2026-09-15：归一化 maskId —— 老 photo（无 imageJob）或非 generation source
        // 没有 maskId，统一 null。picker 不会渲染这些老历史图的 cell 选择。
        setDbHistory(
          j.data.photos.map((p) => ({
            ...p,
            maskId: p.maskId ?? null,
          }))
        );
      })
      .catch(() => {
        // 静默失败 —— 历史栏允许空白
      });
  }, []);

  useEffect(() => {
    void refreshDbHistory();
  }, [refreshDbHistory]);

  // 清理轮询定时器
  // 2026-09-12：useCallback 锁引用 —— 否则下方 useEffect `[clearPoll]` 会因父组件
  // 任一 state 变化（generating / selectedMask / result）导致 clearPoll 新引用
  // → effect 每 render 跑 cleanup+resubscribe → SpecModal 内 useEffect reset 误触
  // → 「点了 6cm 仍 4cm 高亮」用户报告的真凶。配下方 useCallback 的 finishTask /
  // failTask / pollTask + effect deps 修复一起解 re-render storm。
  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  /**
   * 2026-09-11：从 R2 公网 URL 列表还原 uploadedImages（供 history 点击 +
   * finishTask 共用）。blob URL 刷新失效 → 必须用持久 URL；预览图直接复用
   * R2 URL 当 previewUrl，无需 createObjectURL。
   *
   * 2026-09-12：useCallback 锁引用 —— 同 pushHistory 注释，finishTask 依赖本函数。
   * deps 全空安全：setUploadedImages 是 stable setter。
   */
  const restoreUploadedImagesFromR2 = useCallback((publicUrls: string[]) => {
    if (publicUrls.length === 0) {
      setUploadedImages([]);
      return;
    }
    setUploadedImages(
      publicUrls.map((publicUrl, idx) => ({
        localId: `hist_${idx}_${Date.now().toString(36)}`,
        previewUrl: publicUrl,
        publicUrl,
        uploading: 0,
        fileName: `参考图 ${idx + 1}`,
        fileSize: 0,
      }))
    );
  }, []);

  // 完成任务：入历史、清 task、停止轮询
  // 2026-09-12：useCallback 锁引用 —— 与 clearPoll 同根因；
  // deps 全空安全：saveTask/clearPoll 都是 stable（ref + setter），task 是参数。
  const finishTask = useCallback(
    (task: PendingTask, url: string, duration?: number) => {
      saveTask(null);
      clearPoll();
      setGenerating(false);
      setPendingModelName("");
      const newResult: GeneratedResult = {
        url,
        modelName: task.maskName,
        maskName: task.maskName,
        duration,
      };
      setResult(newResult);
      // 2026-09-11：刷新场景下任务完成时也要还原 uploadedImages，否则用户
      // 直接点「选择此效果下单」会撞「需要参考图」假阳 bug。
      if (task.refPublicUrls && task.refPublicUrls.length > 0) {
        restoreUploadedImagesFromR2(task.refPublicUrls);
      }
      // 2026-09-14：写 lastResult 快照 —— result + uploadedImages +
      // selectedMask 一起持久化，下一次刷新 / 点历史栏 result-only 时能恢复
      // refImageUrls 让「分享给客户预览 / 选择此效果下单」按钮 enabled。
      // uploadedImages 从 task.refPublicUrls 现场计算（不能用 state 异步快照）。
      const refPublicUrls = task.refPublicUrls ?? [];
      const restoredImages: UploadedImage[] = refPublicUrls.map(
        (publicUrl, idx) => ({
          localId: `finish_${idx}_${Date.now().toString(36)}`,
          previewUrl: publicUrl,
          publicUrl,
          uploading: 0,
          fileName: `参考图 ${idx + 1}`,
          fileSize: 0,
        })
      );
      saveLastResult({
        result: newResult,
        uploadedImages: restoredImages,
        selectedMask: task.maskId,
        selectedCell: null, // 刷新恢复时统一重置 cell（避免上次点过 3 cell 这次又出现）
        finishedAt: new Date().toISOString(),
      });
      // 2026-09-14：历史改为 DB（photo.source=generation），不再在客户端
      // pushHistory。finishTask 完成后顺手 refetch dbHistory（不 await，
      // 不阻塞 UI；history 栏会异步刷新）。
      void refreshDbHistory();
    },
    [clearPoll, restoreUploadedImagesFromR2, refreshDbHistory]
  );

  // 任务失败：错误提示、清 task、停止轮询
  const failTask = useCallback(
    (msg: string) => {
      saveTask(null);
      clearPoll();
      setGenerating(false);
      setPendingModelName("");
      setError(msg);
      toast.error(msg);
    },
    [clearPoll]
  );

  // 持续轮询进行中任务
  // deps：clearPoll + finishTask + failTask 都已经 useCallback 锁稳定 → 引用不变
  // → 下方 useEffect `[masks]` 不会因 inline pollTask churn 误触恢复逻辑。
  const pollTask = useCallback(
    (task: PendingTask, immediate = false) => {
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
    },
    [clearPoll, finishTask, failTask]
  );

  // 组件卸载清理
  // 2026-09-12：clearPoll 已 useCallback 锁稳定 → `[clearPoll]` deps 在 render 间
  // 不会变，等价于 mount-only cleanup；旧版 deps=[clearPoll]（clearPoll 不稳定时）
  // 在每次父组件 re-render 时都会跑 cleanup（clearPoll()）+ resubscribe，与下方
  // useEffect [masks, pollTask] 形成双向 churn → SpecModal 内 useEffect reset
  // 误触 → 字段态丢失。修 clearPoll 引用稳定后 deps 缩不缩都一样，所以保留
  // 完整 deps 让 biome 满意。
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
  // 2026-09-12：pollTask 已 useCallback 锁稳定 → [masks, pollTask] deps 不会 churn，
  // effect 只在 masks 加载完成后跑一次（恢复进行中的 task），父组件 re-render 不触发。
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
    // 2026-09-12：pollTask 已 useCallback 锁稳定 → 列入 deps 是安全的（不会 churn
    // → effect 不会 re-run）。保留 [masks, pollTask] 让 biome 不再警告。
  }, [masks, pollTask]);

  // 2026-09-14：lastResult 快照恢复 —— 解决「生成成功 → 刷新页面」丢参考图 bug。
  // 与进行中任务恢复的 useEffect 互斥：loadTask() 有值说明还有 polling 续期，
  // loadLastResult() 只在没有进行中任务时生效（result 没在生成中）。
  // deps 只看 masks —— masks 加载完后跑一次，restoreUploadedImagesFromR2 /
  // setSelectedMask / setSelectedCell 都是 stable setter，不需要列 deps。
  useEffect(() => {
    if (!masks.length) return;
    if (loadTask()) return; // 优先续期 in-flight task
    const snap = loadLastResult();
    if (!snap) return;
    if (!masks.some((m) => m.maskId === snap.selectedMask)) {
      // 历史 mask 已被下架 → 丢弃快照，避免点「分享给客户预览」找不到 productType
      saveLastResult(null);
      return;
    }
    setSelectedMask(snap.selectedMask);
    setSelectedCell(snap.selectedCell);
    setResult(snap.result);
    if (snap.uploadedImages.length > 0) {
      // 直接用 snapshot 里的 uploadedImages（已含 publicUrl），不走
      // restoreUploadedImagesFromR2（避免再次重建 localId 漂移）。
      setUploadedImages(snap.uploadedImages);
    }
  }, [masks]);

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

  // 2026-09-XX：「基于此图改」入口 —— 一键把当前 result.url 作为参考图注入
  // uploadedImages（已 R2 公网 URL，跳过 handleFileSelect 上传路径），同时
  // 滚动 + 聚焦描述框。改图场景比「去画布精修」轻量：用户只想微调一张图
  // 时不一定要进画布编辑器，写一句「把背景换成沙滩」直接重跑就行。
  const handleRefineFromResult = () => {
    if (!result?.url) return;
    const localId = `refine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newImg: UploadedImage = {
      localId,
      previewUrl: result.url,
      publicUrl: result.url, // 直接是 R2 URL，handleGenerate 不再上传
      uploading: 0, // 0 = 就绪（handleGenerate 的 some(i=>uploading===1) 检查不会命中）
      fileName: `基于此图改 ${new Date().toLocaleTimeString("zh-CN")}`,
      fileSize: 0,
    };
    // 替换 uploadedImages（不是叠加）—— 用户说「基于此图改」就是以这张图为基准
    setUploadedImages([newImg]);
    // 滚动 + 聚焦描述框
    requestAnimationFrame(() => {
      promptRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      promptRef.current?.focus();
    });
    toast.success("结果图已加入参考图，请在描述框填写修改意图");
  };

  const handleGenerate = async () => {
    // 2026-09-XX：放宽 mask 必填 —— 选模板 OR 写描述二选一即可。
    // 不选模板时直接走「无模板纯描述」路径（API 端 mode 自动 = text_to_image
    // 或 image_to_image）。后端 /api/public/generate 已支持 maskId 可空。
    const trimmedPrompt = customPrompt.trim();
    if (!selectedMask && !trimmedPrompt) {
      toast.error("请选择效果或填写提示词描述");
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
    // 2026-09-14：新生成开始 → 清 lastResult 快照。新生成的 finishTask 会重写。
    saveLastResult(null);
    setPendingModelName("");
    setGenerating(true);
    setError(null);
    setResult(null);
    setSubmitted(null); // 新的生成重置已提交态
    // 2026-09-15：新的生成重置 preview 流凭证 —— 避免上一次凭证 token 残留
    // 在新结果视图上误导用户。
    setPreviewShareToken(null);
    setPreviewShareOrderNo(null);
    setShowShareModal(false);
    // 2026-09-11：新生成任务清空旧的 selectedCell（picker 等新结果出来再选）
    setSelectedCell(null);

    try {
      const res = await fetch("/api/public/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // 多张参考图：imageUrls[] 优先；空数组退化为 text_to_image（mask 没 ref 图也能生成）
          ...(refImageUrls.length > 0 ? { imageUrls: refImageUrls } : {}),
          // maskId 可选 —— 不传时后端走纯 prompt 路径
          ...(selectedMask ? { maskId: selectedMask } : {}),
          // 用户描述：选模板时拼到模板后，不选模板时作为唯一 prompt
          ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
          size: "1024x1024",
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "生成失败");

      const maskName = (data.maskName as string) || "AI 生图";

      if (data.taskId && data.taskStatus === "processing") {
        // 2026-09-11：当前 mask 的 candidateCount/outputMode 入 PendingTask，
        // 刷新后 finishTask 写 history 时拿得到（picker 决策依据）。
        const currentMask = masks.find((m) => m.maskId === selectedMask);
        const task: PendingTask = {
          taskId: data.taskId,
          maskId: selectedMask,
          maskName,
          refPreviewUrls: uploadedImages.map((i) => i.previewUrl),
          // 2026-09-11：参考图 R2 公网 URL 入 PendingTask；任务完成或刷新后
          // 下单时用这个还原 uploadedImages（修「刷新后下单提示需要参考图」）。
          refPublicUrls: refImageUrls,
          candidateCount: currentMask?.candidateCount ?? 1,
          outputMode: currentMask?.outputMode ?? "grid",
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
        const newResult: GeneratedResult = {
          url,
          modelName: maskName,
          maskName,
          duration: data.duration,
        };
        setResult(newResult);
        // 2026-09-15：同步结果分支（无 taskId 轮询，/api/public/generate 直接
        // 返回 image）也写 lastResult 快照 —— 不写会导致用户刷新后
        // refImageUrls 仍空（finishTask 不会被调用 → saveLastResult 不触发）。
        // 用现场 refImageUrls 构造 uploadedImages，与异步分支 finishTask 共用
        // 同一份 LastResultSnapshot 形态。
        const refPublicUrls = [...refImageUrls];
        const restoredImages: UploadedImage[] = refPublicUrls.map(
          (publicUrl, idx) => ({
            localId: `sync_${idx}_${Date.now().toString(36)}`,
            previewUrl: publicUrl,
            publicUrl,
            uploading: 0,
            fileName: `参考图 ${idx + 1}`,
            fileSize: 0,
          })
        );
        saveLastResult({
          result: newResult,
          uploadedImages: restoredImages,
          selectedMask,
          selectedCell: null,
          finishedAt: new Date().toISOString(),
        });
        // 2026-09-14：历史改为 DB（photo.source=generation），后台入库
        // 由 /api/public/generate 自动完成（已登录用户走 createImageJob +
        // dispatchImageGenerationJob），这里只 refetch。
        void refreshDbHistory();
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

  // 2026-09-15：修「点击下载图片按钮没反应」。原版直接 `<a href={result.url} download>`
  // 在 R2 跨域 URL 上 `download` 属性被浏览器忽略 + `target="_blank"` 让链接开了新页
  // 而不是下载文件。改走 `/api/image-gen/download` 代理（Content-Disposition:
  // attachment 强制下载 + 服务端无 CORS 限制），data: / blob: 短路由 downloadProxyUrl
  // 内部判断（与生图工作台 V1/V2 走同一模式）。
  const handleDownload = () => {
    if (!result?.url) return;
    const a = document.createElement("a");
    a.href = downloadProxyUrl(result.url, `mooncoda_${Date.now()}.png`);
    a.download = `mooncoda_${Date.now()}.png`;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success("已开始下载");
  };

  // 2026-09-15：去画布精修 —— 旧版把 result.url + refImageUrls[0] 拼到 URL
  // 查询串 (?gen=&ref=) 跳画布；R2 URL 通常 200+ 字符 + 含 ? & = 等保留字，
  // 经 URLSearchParams 编码后整段可能撞到生产构建下某个 chunk 的
  // 「w?.get is not a function」错误（minified 路径，无法直接定位到我们代码）。
  // 改走 sessionStorage：写一个一次性的 seed payload（key 带 projectId 隔离），
  // 画布 seed effect 读后立刻 removeItem —— 不污染 URL、不重复 seed。
  const CANVAS_SEED_KEY_PREFIX = "mooncoda:canvas:seed:";
  const handleGoToCanvas = () => {
    if (!result?.url) return;
    let projectId = "";
    try {
      projectId = useCanvasStore
        .getState()
        .createProject(
          `精修: ${selectedMaskData?.name ?? "AI 生图"} · ${new Date().toLocaleString("zh-CN")}`
        );
    } catch (e) {
      console.error("[image-gen] createProject failed", e);
      toast.error("创建画布项目失败，请稍后重试");
      return;
    }
    if (!projectId) {
      toast.error("创建画布项目失败，请稍后重试");
      return;
    }
    try {
      const payload = {
        genUrl: result.url,
        refUrl: refImageUrls[0] ?? "",
        createdAt: Date.now(),
      };
      window.sessionStorage.setItem(
        `${CANVAS_SEED_KEY_PREFIX}${projectId}`,
        JSON.stringify(payload)
      );
    } catch (e) {
      console.error("[image-gen] write canvas seed failed", e);
      toast.error("传递精修参数失败，请稍后重试");
      return;
    }
    router.push(`/dashboard/canvas/${projectId}`);
  };

  const selectedMaskData = masks.find((m) => m.maskId === selectedMask);

  // 2026-09-15：共用前置校验 —— grid 多 cell 必选；refImageUrls 非空已放宽。
  // 原「必须先上传参考图」硬卡会把上次生成成功的用户也挡在外面（lastResult 快照
  // 只存了 result 没存 refPublicUrls，刷新就丢），用户原话「已经有效果图即时没有
  // 参考图也能提交，因为是你弄丢的」→ 提交权交回用户。返回 true 表示通过校验可以
  // 继续，false 表示已 toast 阻断。让 handleClickSubmitOrder /
  // handleClickSharePreview 复用这套校验。
  const preflightForOrderAction = (): boolean => {
    if (!result || !selectedMaskData) return false;
    // 2026-09-11：grid + 多候选必须先选 cell 才能下单（picker 强制 gate）。
    // 单图（candidateCount=1）/ separate 模式跳过此检查。
    const cc = selectedMaskData.candidateCount ?? 1;
    const om = selectedMaskData.outputMode ?? "grid";
    if (om === "grid" && cc > 1 && selectedCell === null) {
      toast.error("请先在效果图上选一个分镜");
      return false;
    }
    return true;
  };

  // 点「选择此效果下单」—— demo 下单专属 SpecModal
  const handleClickSubmitOrder = () => {
    if (!preflightForOrderAction()) return;
    if (!selectedMaskData) return;
    // 无 productTypeCode → 跳过 modal，直接走免规格下单
    if (!selectedMaskData.productTypeCode) {
      void submitDemoOrder({
        productSize: null,
        accessoryCode: null,
        engravingText: null,
        // 2026-09-10：LB 扩字段（无 productTypeCode → 全 null）
        leatherColor: null,
        leatherExposed: null,
        pvcProtection: null,
        remarks: null,
        // 2026-09-11：订单来源平台（无 productTypeCode → null）
        platform: null,
        platformOrderNo: null,
      });
      return;
    }
    // 2026-09-14：setSpecOnConfirm 把 demo 提交函数绑到 SpecModal.onConfirm 上；
    // 用户在弹窗选完规格点确认 → SpecModal 直接调 submitDemoOrder(spec)。
    setSpecOnConfirm(() => submitDemoOrder);
    setShowSpecModal(true);
  };

  // 2026-09-14：「分享给客户预览」—— 创建 preview_share 凭证（status=
  // 'candidates_ready'，预扣代理商 creditsLocked），不写 promptOrder。
  // 客人扫码进 /p/{token} 点确认后才转 SELECTED。
  // 入口与 demo 下单按钮同形：复用同一 SpecModal UI（spec 校验 / 字典 /
  // capability-gated 一致），但通过 specOnConfirm 回调切换到 createSharePreview。
  const handleClickSharePreview = () => {
    if (!preflightForOrderAction()) return;
    if (!selectedMaskData) return;
    // 无 productTypeCode → 跳过 modal，直接走免规格建凭证
    if (!selectedMaskData.productTypeCode) {
      void createSharePreview({
        productSize: null,
        accessoryCode: null,
        engravingText: null,
        leatherColor: null,
        leatherExposed: null,
        pvcProtection: null,
        remarks: null,
        platform: null,
        platformOrderNo: null,
      });
      return;
    }
    setSpecOnConfirm(() => createSharePreview);
    setShowSpecModal(true);
  };

  // 2026-09-14：demo 下单提交函数 —— 由 handleClickSubmitOrder 或 SpecModal.onConfirm 调用。
  // 扣个人 credit + 写 SELECTED promptOrder；成功后 setSubmitted({ kind: "demo", ... })。
  // 与 createSharePreview 完全独立（不共享 state / 流程 / 成功卡渲染）。
  const submitDemoOrder = async (spec: SpecSelection) => {
    if (!result || !selectedMaskData) return;
    // 2026-09-15：参考图为空允许提交 —— server schema 已放宽
    // （referenceImageUrl: z.string().max(2048).optional().default("")）；
    // 上传图丢失场景写空数组到 uploadedImages，订单详情降级渲染。

    setShowSpecModal(false);
    setSubmitting(true);
    try {
      const res = await submitImageGenDemoAction({
        templateId: selectedMaskData.maskId,
        // 2026-09-15：从历史的单数字段 referenceImageUrl 升级为 referenceImageUrls 数组
        // —— 全量透传用户上传的多张参考图（max 10），落 promptOrder.uploadedImages。
        // 下游 /p/[token] SelectStep 通过 uploadedImages 渲染多张原图缩略图。
        referenceImageUrls: refImageUrls,
        // 2026-09-12：Lingting 生成的 demo 预览图（"效果图"），不是用户上传的原图。
        // 落 promptOrder.candidates[0][0]；订单详情展示这张图。
        // 旧版写错了把 referenceImageUrl 当 candidates，结果订单详情显示原图。
        demoPreviewUrl: result.url,
        productTypeCode: selectedMaskData.productTypeCode,
        productSize: spec.productSize,
        accessoryCode: spec.accessoryCode,
        engravingText: spec.engravingText,
        // 2026-09-12：engravingExposed 已从 SpecModal UI 移除；server schema
        // 该字段仍然存在（DB 列 + /p/[token] 路径还在用），这里不传 → server 默认 null。
        // 2026-09-10：LB 皮革徽章扩展字段透传到 server action
        leatherColor: spec.leatherColor,
        leatherExposed: spec.leatherExposed,
        pvcProtection: spec.pvcProtection,
        remarks: spec.remarks,
        // 2026-09-11：订单来源平台（PLATFORMS 字典 code；null = 未选）
        platform: spec.platform,
        // 2026-09-11：渠道订单号（与 platform 配对；空/null = 未填）
        platformOrderNo: spec.platformOrderNo,
        // 2026-09-11：用户从宫格里选的 cell（无 picker 场景下 null → server 强制 0）
        selectedCell: selectedCell,
      });
      if (!res?.data) {
        // eslint-disable-next-line no-console
        console.error("[image-gen] demo submit failed", {
          res,
          serverError: res?.serverError,
          validationErrors: res?.validationErrors,
        });
        const validationMsg = extractValidationMessage(res?.validationErrors);
        throw new Error(res?.serverError ?? validationMsg ?? "下单失败");
      }
      const data = res.data;
      // 2026-09-15：submitted 去掉 kind 字段（不再需要 demo / preview 区分）——
      // preview 流凭证已搬到独立 state（previewShareToken / previewShareOrderNo），
      // 不再触发成功卡替换。demo 下单成功后 setSubmitted → 渲染 demo 成功卡。
      setSubmitted({
        orderId: data.orderId,
        orderNo: data.orderNo,
        creditsConsumed: data.creditsConsumed,
      });

      // 2026-09-14：历史已迁到 DB photo 表，photo 行没有 orderId / selectedCell
      // 字段，「查看订单」徽章 + picker 复原已下线。这里不再 setHistory。
      // 下单完成后刷新 DB 历史即可（demo 下单不新增 photo，仅更新 photo 与 imageJob
      // 的关联，本次提交刚返回的就是上一步入库的同一张图）。
      void refreshDbHistory();

      toast.success(
        data.creditsConsumed > 0
          ? `订单已创建，扣减 ${data.creditsConsumed} 积分`
          : "订单已创建"
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[image-gen] demo submit failed:", err);
      toast.error(err instanceof Error ? err.message : "下单失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 2026-09-14：preview 创建分享提交函数 —— 由 handleClickSharePreview 或 SpecModal.onConfirm 调用。
  // 调 createPreviewShareAction 写 preview_share 凭证（status='candidates_ready' +
  // expires_at +7 天，预扣代理商 creditsLocked）—— 不写 promptOrder。
  // 客人扫码进 /p/{token} 点确认后由 /api/orders/[token]/guest-confirm 路由扣
  // 代理商 credit 转 SELECTED。成功后 setSubmitted({ kind: "preview", token }) +
  // 自动弹 ShareCard Modal（showShareModal=true）。
  // 与 submitDemoOrder 完全独立（不共享 state / 流程 / 成功卡渲染）。
  const createSharePreview = async (spec: SpecSelection) => {
    if (!result || !selectedMaskData) return;
    // 2026-09-15：与 submitDemoOrder 对齐 —— 参考图为空允许提交，server schema
    // 已放宽，客人扫码进 /p/{token} 看不到原图缩略图但能看到 demo 预览图。

    setShowSpecModal(false);
    setSubmitting(true);
    try {
      const res = await createPreviewShareAction({
        templateId: selectedMaskData.maskId,
        // 2026-09-15：与 submitDemoOrder 对齐 —— 全量透传多张参考图数组，
        // previewShare.uploadedImages 落全数组；客人扫码进 /p/[token] SelectStep
        // 渲染多张原图缩略图。
        referenceImageUrls: refImageUrls,
        demoPreviewUrl: result.url,
        productTypeCode: selectedMaskData.productTypeCode,
        productSize: spec.productSize,
        accessoryCode: spec.accessoryCode,
        engravingText: spec.engravingText,
        leatherColor: spec.leatherColor,
        leatherExposed: spec.leatherExposed,
        pvcProtection: spec.pvcProtection,
        remarks: spec.remarks,
        platform: spec.platform,
        platformOrderNo: spec.platformOrderNo,
        selectedCell: selectedCell,
      });
      if (!res?.data) {
        // eslint-disable-next-line no-console
        console.error("[image-gen] preview share failed", {
          res,
          serverError: res?.serverError,
          validationErrors: res?.validationErrors,
        });
        // 把 validationErrors 提取成可读字符串（schema 验证失败时只有这个）
        const validationMsg = extractValidationMessage(res?.validationErrors);
        throw new Error(
          res?.serverError ?? validationMsg ?? "创建预览凭证失败"
        );
      }
      const data = res.data;
      // 2026-09-15：preview 流不再 setSubmitted —— 成功卡会替换结果视图
      // （用户原话「点击分享后不需要这个页面，维持原页面」）。
      // 凭证数据搬到独立 state（previewShareToken / previewShareOrderNo），
      // 配合自动弹 ShareCard Modal（QR + 复制链接指向 /p/{data.token}）。
      // 用户关闭弹窗后留在结果视图，可以继续点「下载 / 去画布精修 / 再生成 /
      // 选择此效果下单」。
      setPreviewShareToken(data.token);
      setPreviewShareOrderNo(data.orderNo);
      setShowShareModal(true);

      toast.success("预览凭证已生成，发给客户扫码确认后即下单");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[image-gen] preview share failed:", err);
      toast.error(err instanceof Error ? err.message : "创建预览凭证失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 2026-09-14：重置（demo / preview 成功卡共用）—— 清掉成功态 + 结果图 +
  // 关分享弹窗（如果 preview 路径打开中），回到「选择模板重新生成」入口。
  // 同时清掉 lastResult 快照：成功卡「再生成一个」回到模板选择时不应该再自动
  // 恢复上一次的结果。
  const handleResetDemo = () => {
    setSubmitted(null);
    setResult(null);
    setError(null);
    setShowShareModal(false);
    // 2026-09-15：preview 流凭证数据兜底清掉 —— demo 成功卡「再生成一个」
    // 会调到这里，避免下一次刷新时被 stale token 干扰。
    setPreviewShareToken(null);
    setPreviewShareOrderNo(null);
    saveLastResult(null);
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
            <div className="flex items-center gap-1 pl-2 ml-1">
              <div
                className="flex items-center gap-2"
                title={user.email ?? user.name ?? user.id}
              >
                <div className="h-6 w-6 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-semibold">
                  {(user.name ?? user.email ?? user.id)
                    .slice(0, 1)
                    .toUpperCase()}
                </div>
                <span className="text-xs font-medium hidden md:inline max-w-[120px] truncate">
                  {user.name ?? user.email ?? "用户"}
                </span>
              </div>
              {/* 2026-09-14：/image-gen 顶栏加登出按钮（用户原话「/image-gen 页面无法登出」）。
                  原顶栏只显示头像 + 用户名，没有登出入口；登出是 Better Auth 标准
                  流程，模式与 (dashboard)/sidebar.tsx handleSignOut 一致 —— 调 signOut
                  后 router.push("/") 回首页。复用同套 client import 避免重复登录态处理。 */}
              <Button
                variant="ghost"
                size="xs"
                onClick={async () => {
                  await signOut({
                    fetchOptions: {
                      onSuccess: () => {
                        router.push("/");
                      },
                    },
                  });
                }}
                className="!text-muted-foreground hover:!text-red-500"
                title="登出"
                aria-label="登出"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">登出</span>
              </Button>
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
                        // 2026-09-11：换 mask 清空旧 cell 选择（新模板候选数可能不同）
                        setSelectedCell(null);
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

            {/* 2026-09-XX：提示词描述 —— 让「不选模板也能生图」+ 「改图」场景走通。
                后端 /api/public/generate 已经支持：maskId + prompt 共存时把
                prompt append 到模板 prompt 末尾；只有 prompt 没有 maskId 时
                直接作为唯一 prompt（text_to_image / image_to_image）。
                选模板与否由用户决定：模板 = 标准化风格 + 用户附加修改；
                无模板 = 纯用户描述。 */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  提示词描述
                  <span className="text-[10px] text-muted-foreground font-normal">
                    (
                    {selectedMask
                      ? "选模板时拼到模板提示词末尾"
                      : "不选模板时必填"}
                    )
                  </span>
                </span>
                {customPrompt && (
                  <button
                    type="button"
                    onClick={() => setCustomPrompt("")}
                    className="text-[10px] text-muted-foreground hover:text-rose-600 flex items-center gap-0.5"
                    title="清空描述"
                  >
                    <X className="h-3 w-3" />
                    清空
                  </button>
                )}
              </div>
              <Textarea
                ref={promptRef}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder={
                  selectedMask
                    ? "补充修改意图，如：把背景换成沙滩、加一只猫..."
                    : "描述你想生成的画面，如：一只趴在沙发上的橘猫，油画风格..."
                }
                rows={3}
                maxLength={500}
                className="text-xs resize-none"
              />
              <p className="text-[10px] text-muted-foreground">
                {customPrompt.length}/500 ·{" "}
                {selectedMask
                  ? "已选模板，此描述会追加到模板提示词后"
                  : refImageUrls.length > 0
                    ? "无模板 + 有参考图 → image_to_image"
                    : "无模板 + 无参考图 → text_to_image"}
              </p>
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
                      title="继续添加（可多选）"
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
                    const files = e.dataTransfer.files
                      ? Array.from(e.dataTransfer.files)
                      : [];
                    for (const f of files) handleFileSelect(f);
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
                  <Upload
                    className={cn(
                      "h-8 w-8 mx-auto mb-2",
                      dragOver ? "text-violet-500" : "text-muted-foreground"
                    )}
                  />
                  <p className="text-xs font-medium">
                    {dragOver
                      ? "释放即可上传（可多张）"
                      : "点击或拖拽图片（可多张）"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    JPG / PNG / WEBP · ≤10MB / 张（自动压缩到 5MB） · 最多{" "}
                    {MAX_REFERENCE_IMAGES} 张
                  </p>
                </div>
              )}
              {/* 2026-09-15：file input 必须挂在条件分支之外 —— 上传 1 张后
                  uploadedImages.length > 0 进入 grid 分支，原 dropzone（连同 input）卸载，
                  fileInputRef.current 变 null，grid 内的 <+> 按钮点击 no-op。
                  这里提到外层常驻，不影响布局（hidden）。 */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files
                    ? Array.from(e.target.files)
                    : [];
                  for (const f of files) handleFileSelect(f);
                  // 选完后清空 value —— 否则同名文件二次选择不触发 onChange
                  e.target.value = "";
                }}
              />
            </section>
          </div>

          {/* 底部生成按钮 */}
          <div className="p-3 border-t bg-muted/30">
            <Button
              type="button"
              onClick={handleGenerate}
              // 2026-09-XX：放宽到 (mask || prompt)，无 mask 时靠描述提交。
              disabled={
                generating ||
                submitting ||
                (!selectedMask && !customPrompt.trim())
              }
              className="w-full bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 rounded-full"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  生成中...
                </>
              ) : selectedMask ? (
                <>
                  <Wand2 className="h-4 w-4 mr-1.5" />
                  生成图片
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-1.5" />
                  用描述生成图片
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
                  选择效果或填写提示词描述后点击生成
                </p>
                <p className="text-xs mt-1">
                  支持模板风格 + 参考图 + 文字描述组合
                </p>
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
                  {/* 2026-09-11：grid + 多候选 → QuadrantGridPicker 覆盖透明 hotzone；
                      单图 / separate 模式 → 保留单图展示。candidateCount 缺省视为 1。 */}
                  {(() => {
                    const currentMask = masks.find(
                      (m) => m.maskId === selectedMask
                    );
                    const cc = currentMask?.candidateCount ?? 1;
                    const om = currentMask?.outputMode ?? "grid";
                    if (
                      om === "grid" &&
                      cc > 1 &&
                      (cc === 2 || cc === 4 || cc === 9)
                    ) {
                      return (
                        <QuadrantGridPicker
                          compositeUrl={result.url}
                          candidateCount={cc}
                          selectedCell={selectedCell}
                          onSelect={setSelectedCell}
                          ariaLabel="生成效果图，点击选择一个分镜"
                        />
                      );
                    }
                    // biome-ignore lint/performance/noImgElement: 生图结果为动态远程 URL
                    return (
                      <img
                        src={result.url}
                        alt="生成结果"
                        className="w-full object-cover"
                      />
                    );
                  })()}
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
                  {/* 2026-09-XX：基于此图改 —— 改图场景一键入口。
                      把 result.url 转 uploadedImages 条目（uploading=0 + publicUrl 直接是 R2 URL，
                      跳过 handleFileSelect 那条上传路径），同时聚焦描述框让用户写修改意图。
                      比「去画布精修」更轻量：用户只想微调一张图时不需要进画布编辑器。 */}
                  <Button
                    type="button"
                    onClick={handleRefineFromResult}
                    variant="outline"
                    className="rounded-full"
                    disabled={!result?.url || generating || submitting}
                    title="把结果图作为参考图，专注写修改描述"
                  >
                    <Edit3 className="h-4 w-4 mr-1.5" />
                    基于此图改
                  </Button>
                  {/* 2026-09-13：去画布精修 — 把当前 result.url + 第一张参考图传到
                      画布编辑器预置 2 个 image 节点（"效果图" + "原图参考"）。
                      grid 模式下 result.url 是 composite 整张，画布里用户自己裁剪。
                      refImageUrls 为空时只传 gen，ref 参数省略。 */}
                  <Button
                    type="button"
                    onClick={handleGoToCanvas}
                    variant="outline"
                    className="rounded-full"
                    disabled={!result?.url}
                    title="把效果图 + 原图带到画布编辑器二次精修"
                  >
                    <Wand2 className="h-4 w-4 mr-1.5" />
                    去画布精修
                  </Button>
                  {/* 2026-09-14：preview 流独立按钮 —— 调 createPreviewShareAction
                      写 preview_share 行（status=candidates_ready + 预扣代理商
                      creditsLocked），客人扫码进 /p/{token} 确认后才转 SELECTED。
                      与 demo 下单按钮（→ promptOrder）是两条完全独立的路径
                      （用户原话「提交订单不需要创建分享，创建分享也不需要提交
                      订单」）。SpecModal 物理上同一组件，但通过 specOnConfirm
                      回调函数引用切换到 createSharePreview。 */}
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={handleClickSharePreview}
                    disabled={submitting || !result?.url}
                    title="生成预览凭证发给客户扫码确认后下单（不写 promptOrder）"
                  >
                    <Share2 className="h-4 w-4 mr-1.5" />
                    分享给客户预览
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
                {/* 2026-09-15：amber warning 已放宽为提示性文案 —— 参考图为空时仍允许下单
                    （用户原话「已经有效果图即时没有参考图也能提交，因为是你弄丢的」），
                    这里只柔和提示「如需附加原图请上传」，不再硬卡。*/}
                {refImageUrls.length === 0 && (
                  <p className="text-[10px] text-center text-muted-foreground">
                    提示：当前未上传参考图，订单将只附带效果图；如需附原图请先上传
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

            {/* demo 下单成功卡 —— 替换结果视图。
    2026-09-15：preview 流不再触发此分支（已搬到独立 state +
    仅弹 ShareCard Modal，不替换视图，详见上方 submitted 类型注释）。
    所以此分支就是 demo 专属成功卡，无 kind 判断。 */}
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
                    {/* biome-ignore lint/performance/noImgElement: 已下单效果预览 */}
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
                      // demo 订单跳 /image-gen/orders 独立列表页（顶栏也跳这）
                      window.location.href = "/image-gen/orders";
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

        {/* ============ 最右侧：全部历史效果图（photo 表 source=generation） ============ */}
        {/* 2026-09-14：改自 localStorage 本地历史为 DB 全量历史；photo 行只
            携带 id/fileUrl/thumbnailUrl/model/format/createdAt，不带 maskName
            / refPublicUrls / orderId / selectedCell —— 点击只切 result.url 作
            预览，不还原 uploadedImages / selectedCell，不显示「查看订单」徽章。 */}
        {dbHistory.length > 0 && (
          <aside className="w-[180px] shrink-0 bg-white dark:bg-zinc-900 border-l flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b">
              <span className="text-[11px] font-semibold flex items-center gap-1 text-muted-foreground">
                <History className="h-3 w-3" />
                历史
                <span className="text-[9px] font-normal">
                  ·{dbHistory.length}
                </span>
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {dbHistory.map((h) => (
                <button
                  type="button"
                  key={h.id}
                  className="group relative w-full aspect-square rounded-md overflow-hidden border bg-muted cursor-pointer hover:ring-2 hover:ring-violet-500/40 transition"
                  title={new Date(h.createdAt).toLocaleString("zh-CN")}
                  onClick={() => {
                    // 2026-09-14：DB 历史项只承载「效果 URL」，点击仅切预览；
                    // 不还原 uploadedImages（photo 行无 refPublicUrls），
                    // 不还原 selectedCell（photo 行无 picker 状态），
                    // 不显示「查看订单」徽章（photo 行无 orderId）。
                    //
                    // 清掉 lastResult 快照：DB 历史 photo 没有 referenceImageUrl，
                    // 不能用别的生成留下的快照冒充本张历史图的参考图。让按钮 disabled
                    // 状态由当前 refImageUrls（空）正确触发，下方 amber warning 会
                    // 提示用户「需重新上传参考图」。
                    //
                    // 2026-09-15：联表拿到的 maskId 用于 setSelectedMask —— 让 4 宫格
                    // picker 渲染（当前 mask 不同时 picker 不会自动切 cc/outputMode）。
                    // 没拿到 maskId 时保留当前 selectedMask。
                    saveLastResult(null);
                    setSubmitted(null);
                    setError(null);
                    setResult({
                      url: h.fileUrl,
                      modelName: h.model ?? "AI 生图",
                      maskName: h.model ?? "AI 生图",
                    });
                    if (h.maskId && h.maskId !== selectedMask) {
                      setSelectedMask(h.maskId);
                      setSelectedCell(null);
                    }
                  }}
                >
                  {/* biome-ignore lint/performance/noImgElement: 历史图为动态远程 URL */}
                  <img
                    src={h.thumbnailUrl ?? h.fileUrl}
                    alt={h.model ?? "历史效果图"}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>

      {/* 规格选择 modal —— 2026-09-14：demo / preview 共用同一 SpecModal UI
          （spec 校验 / 字典 / capability-gated 一致），但通过 specOnConfirm
          回调切换：demo 下单按钮 → setSpecOnConfirm(() => submitDemoOrder)；
          preview 分享按钮 → setSpecOnConfirm(() => createSharePreview)。
          onConfirm 单纯转发 spec 给当前回调，两条路径互不污染。 */}
      <SpecModal
        open={showSpecModal}
        template={selectedMaskData ?? null}
        submitting={submitting}
        onClose={() => setShowSpecModal(false)}
        onConfirm={(spec) => {
          const cb = specOnConfirm;
          if (cb) void cb(spec);
        }}
      />

      {/* 2026-09-15：preview 流专属分享弹窗（独立 Modal）—— preview 凭证
          创建成功后由 createSharePreview 自动 setShowShareModal(true) 触发；
          demo 路径不打开。Modal 内 QR + 复制链接指向 /p/{previewShareToken}
          （preview_share.token，与 promptOrder 是两条独立数据）。
          用户关闭弹窗后留在结果视图，可继续操作其他按钮（用户原话「点击分享
          后不需要这个页面，维持原页面」）。 */}
      <ShareCard
        open={showShareModal && !!previewShareToken}
        shareUrl={shareUrl}
        orderNo={previewShareOrderNo ?? ""}
        onDownloadImage={handleDownload}
        onClose={() => setShowShareModal(false)}
      />

      {/* 2026-09-10：「我的订单」独立页面入口已挪到顶栏 Link(/image-gen/orders) */}
      {/* 订单详情用 inline view：/image-gen/orders 走 OrdersView 同页展开 */}
    </div>
  );
}
