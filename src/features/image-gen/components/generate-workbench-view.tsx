"use client";

import { Input as AntdInput, App, Modal } from "antd";

/**
 * 生图工作台 - 仿 Mooncoda 设计
 *
 * 双栏布局：
 * - 左侧 380px 参数面板：参考图 / 模板开关 / 提示词 / 反向提示词 / 生图模型 /
 *   提示词模板 / 模板参数 / 输出尺寸 / 批量数量 / 高级参数 / 生成按钮 + 预计成本
 * - 右侧主区：状态徽章 + 结果网格 + 元数据 + 历史缩略图条
 *
 * 数据走真实 action（generateImageAction），历史为前端 state。
 *
 * Phase C：模板数据源从 productEffect 表迁移到 promptTemplate 表（与 gpt-image 共用），
 * 所以 props 类型是 PromptTemplateView[]，不再依赖 ProductEffect 类型。
 */

import {
  BookmarkPlus,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  FolderPlus,
  Grid3x3,
  Image as ImageIcon,
  Library,
  Loader2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Share2,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { PromptVariable } from "@/db/image-gen-types";
import type { ImageJob, Photo } from "@/db/schema";
import type { InsertAssetPayload } from "@/features/canvas/components/canvas/asset-picker-modal";
import { AssetPickerModal } from "@/features/canvas/components/canvas/asset-picker-modal";
import { PromptSelectDialog } from "@/features/canvas/components/prompts/prompt-select-dialog";
import { stitchToGrid } from "@/features/canvas/lib/stitch-images";
import { useMyPromptStore } from "@/features/canvas/stores/use-my-prompt-store";
import type { PromptTemplateView } from "@/features/gpt-image/lib/types";
import {
  generateImageAction,
  listImageJobsAction,
  listPhotosAction,
} from "@/features/image-gen/actions";
import { ExternalImageGenCard } from "@/features/image-gen/components/external-image-gen-card";
import type {
  ImageModelId,
  ImageSize,
} from "@/features/image-gen/lib/image-models/types";
import {
  IMAGE_MODEL_LIST,
  IMAGE_MODELS,
} from "@/features/image-gen/lib/image-models/types";
import {
  downloadProxyUrl,
  thumbnailUrl,
} from "@/features/image-gen/lib/thumbnail-url";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ============ 类型 ============
interface UploadedImage {
  file: File;
  previewUrl: string;
  /**
   * R2 公共域 URL：把 blob 上传到 R2 后服务端可访问的 URL。
   * handleGenerate 时作为 imageUrl 传给服务端 —— 直接用 blob URL 会让
   * 服务端 fetch 拿到 ENOENT（blob 只存在于创建它的浏览器）。
   * null 表示仍在上传/上传失败。
   */
  publicUrl: string | null;
  /**
   * 上传进度（0-1）：仅作 UI 反馈，0.5 半透明蒙层即可，不展开进度条。
   * null 表示不在上传中。
   */
  uploading: number | null;
  fileName: string;
  fileSize: number;
}

type RefMode = "upload" | "library" | "none";
type EffectStatus = "draft" | "pending" | "processing" | "completed" | "failed";

interface WorkbenchSubmission {
  /** 单次提交的本地 id（同一 effect 内唯一），key 用这个 */
  submissionId: string;
  /** 该次提交的 jobId（异步任务才存在；同步返图也填一个临时 id 用于诊断） */
  jobId?: string;
  taskId?: string;
  /** 该次提交返的 url 列表（按模型顺序） */
  resultUrls: string[];
  status: EffectStatus;
  createdAt: string;
  /** failed 时填的错误信息 */
  errorMsg?: string;
  /** 是否为宫格拼接模式（candidateCount=4/9 一张大图） */
  isGridComposite?: boolean;
  /**
   * 是否为客户端二次拼接（用户在高级参数里勾选了「自动拼接宫格图」，
   * 把 N 张独立候选用 Canvas API 拼成一张宫格大图）。仅展示层用：
   * - 标题徽章改为"已拼接"
   * - 单图布局（不显示 N 格网格）
   * - 下载文件名加 `_stitched` 后缀
   *
   * 注意：isGridComposite 与 isStitched 互斥 —— 模板自带宫格拼接时
   * 不再二次拼接。
   */
  isStitched?: boolean;
  /**
   * 客户端拼接的宫格大图 dataURL。仅在 isStitched=true 且拼接成功时设置。
   * 与 resultUrls（始终保留 N 张原图）并存 —— 用户既能看宫格大图也能保留
   * 单独访问每张原图。SubmissionNode 渲染时按 isStitched 分支选择主预览
   * 是 composite 还是 N 格原图，并把另一形态作为附属缩略图。
   */
  stitchedUrl?: string;
  /** 该次提交的 prompt（与 effect 主 prompt 可能不同 —— 用户连续微调时） */
  prompt: string;
  /**
   * 该次提交实际生成耗时（ms）。
   * 与 effect.duration 不同 —— effect.duration 是 effect 级最后刷新的
   * 一次 job 耗时，覆盖式写入；submission.duration 是这一条 submission
   * 自己的耗时，多次提交互不覆盖。时间轴节点显示用这个。
   */
  duration?: number;
}

interface WorkbenchEffect {
  effectId: string;
  /**
   * imageJob 表 id（用于后续 pollImageJobAction 轮询异步任务）。
   * 同步任务（直接返 images）此字段为空；异步任务（taskId 路径）必填。
   *
   * 历史遗留：早期实现把"每次提交"当独立 effect。后来改成 ChatGPT 风格：
   * 同一 model/mode/mask 下多次提交 = 同一个 effect（共享 effectId），
   * submissions 数组按提交顺序累加。本次重构后这个字段基本只用于 hydrate
   * 路径（DB 里 imageJob 一行 = 一个 submission）。
   */
  jobId?: string;
  /**
   * 上游 task_id（仅当模型走异步提交时才存在，用于诊断 / 排查）。
   * 与 jobId 不同：jobId 是我们这层的记录 id，taskId 是上游模型给的。
   */
  taskId?: string;
  prompt: string;
  /**
   * 模板 id（Phase C 起指向 promptTemplate.id，原 productEffect.maskId 字段）。
   * 字段名保留 `maskId` 以兼容 imageJob.maskId 列（DB schema 没改）。
   */
  maskId: string;
  maskName: string;
  status: EffectStatus;
  resultUrls: string[];
  revisedPrompt?: string;
  seed?: number;
  duration?: number;
  cost?: number;
  currency?: string;
  mode: "text_to_image" | "image_to_image";
  imageModel: ImageModelId;
  imageModelName: string;
  createdAt: string;
  errorMsg?: string;
  /**
   * 是否为宫格拼接模式（candidateCount=4/9 时一张大图含 N 个候选）。
   * 仅展示层用：标题 / 单图布局 / 下载行为。
   */
  isGridComposite?: boolean;
  /**
   * submission 是否被客户端二次拼接（见 WorkbenchSubmission.isStitched）。
   * effect 级仅展示层用：rail 缩略图走 single 模式。
   */
  isStitched?: boolean;
  /**
   * 最新一条 submission 的拼接宫格大图 dataURL（见
   * WorkbenchSubmission.stitchedUrl）。effect 级镜像，方便 rail / 外部直接
   * 读 effect 拿 composite，不必再穿透 submissions[last]。
   */
  stitchedUrl?: string;
  /**
   * 提交记录列表（每次 handleGenerate push 一条）。时间轴按 submissions
   * 顺序渲染 —— 这就是 ChatGPT 风格"消息气泡按时间顺序堆积"。
   * 之前已完成的 submission 不会因为新提交进入 processing 而被替换。
   */
  submissions?: WorkbenchSubmission[];
}

const STATUS_CONFIG: Record<
  EffectStatus,
  { label: string; icon: typeof Clock; color: string; bg: string }
> = {
  draft: {
    label: "新会话",
    icon: Sparkles,
    color: "text-primary",
    bg: "bg-primary/10 border-primary/20",
  },
  pending: {
    label: "排队中",
    icon: Clock,
    color: "text-amber-600",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  processing: {
    label: "生成中",
    icon: Loader2,
    color: "text-primary",
    bg: "bg-primary/10 border-primary/20",
  },
  completed: {
    label: "已完成",
    icon: CheckCircle2,
    color: "text-primary",
    bg: "bg-primary/10 border-primary/20",
  },
  failed: {
    label: "失败",
    icon: XCircle,
    color: "text-rose-600",
    bg: "bg-rose-500/10 border-rose-500/20",
  },
};

const REF_MODE_LABELS: Record<RefMode, string> = {
  upload: "上传",
  library: "图库",
  none: "无",
};

/**
 * 把 imageJob（DB 行）映射成客户端 WorkbenchEffect。
 *
 * effectId 用 `job_${id.slice(0, 8)}` 前缀 —— 避免和新建时用的
 * `EF_${Date.now().slice(-6)}` 撞 key，也方便一眼分辨"从 DB 恢复"
 * vs"刚生成"。modelName 失败时退回 job.model 原值，至少不会显示空白。
 */
/**
 * 绝对时间格式：MM-DD HH:MM:SS（不带年份 —— 工作台都是近期会话，省一年更清爽）。
 *
 * 用于结果时间轴上每个节点的标题行 —— 用户要"具体时间"而不是"X 小时前"
 * 这种模糊表述，所以显示到秒。
 */
function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 短相对时间，rail 里塞不下绝对时间。
 * - < 60s → "刚刚"
 * - < 60min → "X 分钟前"
 * - 同一天 → "X 小时前"
 * - 跨天 → "MM-DD"
 * - 跨年 → "YYYY-MM-DD"
 */
function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  // "今天 X 小时前"：5 分钟阈值内算今天
  if (hr < 24 && d.toDateString() === new Date().toDateString()) {
    return `${hr} 小时前`;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear
    ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ============ stitchedUrl 持久化（localStorage） ============
// 2026-08-31：客户端拼接的宫格大图 dataURL 持久化到 localStorage ——
// imageJob 表没有 stitchedUrl 列，加 schema 迁移成本高（且 dataURL 这种
// 大 base64 不适合塞关系库），用 localStorage 兜底：跨刷新能恢复。
// key 格式 imagegen:v1:stitched:<jobId> = dataURL。
// 失败 / 拼接关 / count<2 → 不写，所以 jobsToEffects 查不到 = 走 N 张原图分支。
// 删除会话是前端本地操作（imageJob 不清理，TODO：见 rename/delete 节注释），
// 不主动删 localStorage —— 反正 jobsToEffects 只为 status=completed 的 submission
// 标 isStitched，孤儿 entry 不会被读。
const STITCHED_LS_PREFIX = "imagegen:v1:stitched:";

function readStitchedFromStorage(jobId: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(STITCHED_LS_PREFIX + jobId) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStitchedToStorage(jobId: string, dataUrl: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STITCHED_LS_PREFIX + jobId, dataUrl);
  } catch (err) {
    console.warn("[workbench] save stitched to localStorage failed:", err);
  }
}

/**
 * 把 DB 里的 imageJob 行列表 hydrate 成 WorkbenchEffect 列表。
 *
 * 2026-08-23 修复 Bug3：之前每个 imageJob 行被 toWorkbenchEffect 1:1 映射成
 * 独立 effect（`job_${id.slice(0,8)}`）。但客户端 handleGenerate 把多次提交
 * 合并到同一个 effect 的 submissions[] —— "ChatGPT 风格一个会话多条消息"。
 * 概念上的"同一个会话"在 DB 里没有 sessionId 列（imageJob 只有 maskId 列），
 * 不加 schema 迁移的前提下用 (model, mode, maskId) 启发式合并：同一组合下
 * 按 createdAt 倒序把每条 row 当成一条 submission 塞进 effect.submissions。
 *
 * 为什么是 (model, mode, maskId)：
 * - 这三项是 effect "会话级容器"的固定字段，handleGenerate 里 mode 切换 /
 *   mask 切换都会促发 handleNewSession 走新 draft 路径
 * - 用户主动点 "+ 新建会话" 时切不同的 model/mode/mask 才会真正另起炉灶
 *   —— 同设置下点 "+" 是罕见 corner case，误合并可接受
 *
 * effectId 用最早一条 jobId.slice(0,8) —— 同一 group 反复刷新 effectId 稳
 * 定，pollingRef / selectedEffect 都靠这个 key 不会错位。latestJob.id 写顶层
 * jobId —— applyJobUpdate / polling 只跟最新一条未完 submission 打交道（生
 * 成按钮 generating guard 同一 effect 同一时刻最多 1 条 in-flight）。
 */
function jobsToEffects(jobs: ImageJob[]): WorkbenchEffect[] {
  // 按 createdAt 升序排，分组后取 [0] 是最早一条
  const sorted = [...jobs].sort((a, b) => +a.createdAt - +b.createdAt);

  // 按 (model, mode, maskId) 分桶
  const groups = new Map<string, ImageJob[]>();
  for (const job of sorted) {
    const key = `${job.model}|${job.mode}|${job.maskId ?? ""}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(job);
  }

  const effects: WorkbenchEffect[] = [];
  for (const groupJobs of groups.values()) {
    const firstJob = groupJobs[0]!;
    const latestJob = groupJobs[groupJobs.length - 1]!;
    const modelConfig = IMAGE_MODELS[firstJob.model as ImageModelId];

    // 每行 imageJob → 一条 WorkbenchSubmission。submissionId 用
    // `hydrated_<id8>` 前缀避免和 handleGenerate 的 `sub_<ts6>` 撞 key
    // （applyJobUpdate 用 s.jobId === matchJobId 找对应 submission，不依赖
    // submissionId，但 React key / 测试断言里要用到，保持稳定可读）。
    //
    // 2026-08-31：stitchedUrl 从 localStorage 读 —— DB imageJob 没有这列，
    // 不持久化就会"刷新后回到 N 张原图"，用户原话"自动拼接是多张图拼接成一张
    // 宫格图"。仅 completed 才标 isStitched（pending/processing 没拼接过）。
    const submissions: WorkbenchSubmission[] = groupJobs.map((job) => {
      const stitchedUrl =
        job.status === "completed"
          ? readStitchedFromStorage(job.id)
          : undefined;
      return {
        submissionId: `hydrated_${job.id.slice(0, 8)}`,
        jobId: job.id,
        resultUrls: (job.resultUrls as string[]) ?? [],
        status: job.status,
        prompt: job.prompt,
        createdAt: job.createdAt.toISOString(),
        ...(job.taskId ? { taskId: job.taskId } : {}),
        ...(job.errorMsg ? { errorMsg: job.errorMsg } : {}),
        // 拼接大图：有 stitchedUrl 才算 isStitched；fallback 默认走 N 张原图
        ...(stitchedUrl ? { stitchedUrl, isStitched: true } : {}),
      };
    });

    // effect 顶层 status：有任一 submission 未完 → processing；
    // 全完但有 failed → failed；其余（全部 completed） → completed。
    // 顶层的 createdAt / prompt / resultUrls 用最新一条 —— rail 缩略图 /
    // "刚刚 / 1 小时前" / displayName 都看顶层字段。
    const hasUnfinished = submissions.some(
      (s) => s.status === "pending" || s.status === "processing"
    );
    const hasFailed = submissions.some((s) => s.status === "failed");
    const effectStatus: EffectStatus = hasUnfinished
      ? "processing"
      : hasFailed && latestJob.status !== "completed"
        ? "failed"
        : "completed";

    // 2026-08-31：effect 顶层 stitchedUrl 也要从 localStorage 补 —— rail 缩略图
    // 走 eff.stitchedUrl ?? eff.resultUrls[0]，没顶层 stitchedUrl 的话刷新后
    // rail 退到第一张原图，rail 视觉也跟着掉。latestJob 的拼接图就是 effect 的
    // 当前拼接图（与 applyJobUpdate 写顶层 stitchedUrl 的语义一致）。
    const latestStitched =
      latestJob.status === "completed"
        ? readStitchedFromStorage(latestJob.id)
        : undefined;

    effects.push({
      effectId: `job_${firstJob.id.slice(0, 8)}`,
      jobId: latestJob.id,
      ...(latestJob.taskId ? { taskId: latestJob.taskId } : {}),
      prompt: latestJob.prompt,
      maskId: latestJob.maskId ?? "CUSTOM",
      maskName: latestJob.maskId ?? "自定义",
      status: effectStatus,
      resultUrls: (latestJob.resultUrls as string[]) ?? [],
      mode: latestJob.mode as "text_to_image" | "image_to_image",
      imageModel: latestJob.model as ImageModelId,
      imageModelName: modelConfig?.name ?? latestJob.model,
      createdAt: latestJob.createdAt.toISOString(),
      // 顶层拼接图：有才挂；rail 缩略图与外层 SubmissionNode 都会优先用它
      ...(latestStitched
        ? { stitchedUrl: latestStitched, isStitched: true }
        : {}),
      submissions,
    });
  }

  // 按 createdAt 倒序，rail 最新在最上面
  return effects.sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)
  );
}

/**
 * 把 DB 数据并入客户端 history：
 * - DB 里的同 effectId 条目覆盖客户端的（更权威）
 * - 客户端刚生成还没入库的（EF_ 前缀）保留
 * - 最终按 createdAt 倒序
 *
 * 不直接 setHistory(jobs) 是因为：handleGenerate 设入 history 后如果立即
 * 触发 mount effect（比如 React 18 严格模式双调用），会丢刚生成的条目。
 */
function mergeHydratedHistory(
  client: WorkbenchEffect[],
  fromDb: WorkbenchEffect[]
): WorkbenchEffect[] {
  const byId = new Map<string, WorkbenchEffect>();
  for (const e of fromDb) byId.set(e.effectId, e);
  for (const e of client) {
    if (!byId.has(e.effectId)) byId.set(e.effectId, e);
  }
  return Array.from(byId.values()).sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)
  );
}

/**
 * 调服务端 /api/image-gen/jobs/[jobId]/poll 推进一次，返回最新 imageJob 行。
 *
 * 失败语义：
 * - 网络/服务端 throw：让调用方决定如何处理（startPolling 是 warn-and-continue；
 *   手动刷新按钮是 toast.error）
 * - 路由返 { success: false } 但 200：当作 throw，错误信息从 error 字段取
 */
async function pollImageJob(jobId: string): Promise<ImageJob | null> {
  const res = await fetch(`/api/image-gen/jobs/${jobId}/poll`, {
    method: "POST",
  });
  const body = (await res.json()) as {
    success: boolean;
    data?: { job: ImageJob };
    error?: string;
  };
  if (!res.ok || !body.success) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data?.job ?? null;
}

/**
 * 把用户上传的图片走 R2 预签名直传，返回可在服务端 fetch 的 publicUrl。
 *
 * 流程（与 gpt-image /p/[token] 的 use-order-actions presignOne + putToR2 同形态）：
 *   1. POST /api/image/upload 拿 { uploadUrl, publicUrl }
 *   2. PUT 文件到 uploadUrl（直传 R2，不经过我们的 server）
 *   3. 返 publicUrl
 *
 * 为什么不能直接把 blob URL 传给服务端：blob URL 只存在于创建它的浏览器，
 * 服务端 fetch 会拿到 ENOENT —— 之前生产事故「下载原图失败（1）：fetch failed」
 * 就是这个原因（2026-08-18）。
 */
async function uploadFileToR2(file: File): Promise<string> {
  // 1) 拿预签名
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

  // 2) PUT 到 R2（直传，不经过我们 server）
  const putRes = await fetch(presignJson.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`上传到存储失败：HTTP ${putRes.status}`);
  }

  return presignJson.publicUrl;
}

/**
 * 触发浏览器下载一张远程图片（fetch → Blob → 临时 a[download]）。
 *
 * 为什么不用 `<a href={url} download>` 直链：
 * - R2 公共域默认会带 Content-Disposition: attachment 时 OK，但 R2 / S3 的
 *   公共读 URL 通常只带 inline，浏览器打开预览页而不是下载。
 * - 跨域 + 未带 CORS 头时，浏览器对 `download` 属性无效，会直接打开图片。
 * 走 fetch → blob → 本地 objectURL 一定能强制下载，且不依赖服务器端配置。
 *
 * 2026-08-26：HTTP(S) URL 改走 /api/image-gen/download 服务端代理
 * —— R2 默认未配 CORS，浏览器直接 fetch 会被拒（"Failed to fetch"）。
 * 服务端 fetch 无跨域限制，回流靠 Content-Disposition: attachment 触发下载。
 * data: URL 不走代理（fetch data: 无 CORS 问题）。
 *
 * 失败语义：throw 让调用方 toast 报错；不静默吞（否则用户以为下载成功但没拿到）。
 */
async function downloadImage(url: string, filename: string): Promise<void> {
  // data: URL 走原 fetch → blob → objectURL（data: 无 CORS 问题）
  if (url.startsWith("data:")) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`下载失败：HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      // 必须挂到 DOM 才能在 Firefox 上正常触发 click
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      // 给浏览器一点时间启动下载再回收，避免某些浏览器提前失效
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
    return;
  }

  // HTTP(S) URL：浏览器直接 GET 服务端代理，靠 Content-Disposition: attachment
  // 触发下载。无 CORS、无内存峰值、无需 fetch + blob 解码。
  const a = document.createElement("a");
  a.href = downloadProxyUrl(url, filename);
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 把 ImageSize（如 "1344x768"）解析成 [w, h] 二元组，无法解析时兜底 [1, 1]。
 */
function parseImageSize(size: ImageSize): [number, number] {
  const m = /^(\d+)x(\d+)$/.exec(size);
  return m?.[1] && m[2] ? [Number(m[1]), Number(m[2])] : [1, 1];
}

/**
 * 按宽高比挑 lucide 图标：w==h → Square，w>h → 横向，w<h → 纵向。
 * Lovart / Midjourney 风格的尺寸可视化。
 */
function getAspectIcon(size: ImageSize) {
  const [w, h] = parseImageSize(size);
  if (w === h) return Square;
  return w > h ? RectangleHorizontal : RectangleVertical;
}

/**
 * 2026-08-21：与 V2 ImageSettingsPanel 对齐 —— V2 的 aspect ratio 网格总是显示
 * 全部 13 个 aspect，不按模型能力过滤。V1 之前用 `modelConfig.capabilities.sizes`
 * 过滤，导致不同模型看到的尺寸列表不一样。
 *
 * 现在固定显示所有 ImageSize 选项，按常用度排序：1:1 → 4:3 / 3:4 → 16:9 / 9:16 → 2k。
 * 上游是否真支持由 provider adapter 决定；model 不支持时由上游报错，不在前端预过滤。
 */
const ALL_IMAGE_SIZES: ImageSize[] = [
  // 2026-08-25：尺寸列表去重，删除同比例的重复项（之前 1:1 有 5 个 entry
  // 都显示 "1:1" 标签，用户根本分不清是哪个；4:3 / 3:4 也各有两个近比例
  // 变体）。现在每个宽高比只保留 1~2 个标准尺寸，1:1 多留一个 2K 高清。
  // 其它高分辨率（4K 等）由上游 provider adapter 决定，前端不预列。
  // 1:1
  "1024x1024",
  "2048x2048",
  // 4:3 / 3:4
  "1024x768",
  "768x1024",
  // 3:2 / 2:3
  "1536x1024",
  "1024x1536",
  // 16:9 / 9:16
  "1280x720",
  "720x1280",
  // auto
  "auto",
];

/**
 * 推断图片扩展名：从 URL 路径末段拿，否则看 mime 头，否则兜底 .png。
 */
function inferImageExtension(url: string, mime?: string | null): string {
  const lastDot = url.lastIndexOf(".");
  if (lastDot !== -1 && lastDot > url.lastIndexOf("/")) {
    const ext = url
      .slice(lastDot + 1)
      .toLowerCase()
      .split(/[?#]/)[0];
    if (ext && /^[a-z0-9]{1,5}$/.test(ext)) return ext;
  }
  if (mime) {
    if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
    if (mime.includes("png")) return "png";
    if (mime.includes("webp")) return "webp";
  }
  return "png";
}

/**
 * 构造下载文件名：`{modelName}_{effectId}_{idx}_{YYYYMMDDHHmm}.{ext}`
 *
 * 用模型名 + 任务 id 而不是任务 id 全文 —— 用户在下载目录里一眼能看出是
 * 哪个模型出的、属于哪次生成；时间戳保证多次下载不撞名。
 */
function buildDownloadFilename(
  effect: { imageModelName: string; effectId: string },
  url: string,
  index: number,
  mime?: string | null
): string {
  const ext = inferImageExtension(url, mime);
  const d = new Date();
  const ts =
    `${d.getFullYear()}` +
    `${String(d.getMonth() + 1).padStart(2, "0")}` +
    `${String(d.getDate()).padStart(2, "0")}` +
    `${String(d.getHours()).padStart(2, "0")}` +
    `${String(d.getMinutes()).padStart(2, "0")}`;
  // 模型名常含空格（如「Doubao Seedream」）和中文，文件系统不友好的字符替换为下划线
  const safeModel = effect.imageModelName.replace(/[\\/:*?"<>|\s]+/g, "_");
  const safeId = effect.effectId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const idx = String(index + 1).padStart(3, "0");
  return `${safeModel}_${safeId}_${idx}_${ts}.${ext}`;
}

interface GenerateWorkbenchViewProps {
  /** 启用的提示词模板列表（来自 promptTemplate 表，与 gpt-image 共用同一数据源） */
  templates: PromptTemplateView[];
}

/**
 * 2026-08-26：V1 设置持久化 —— 之前只有 autoStitch 用单独的 localStorage
 * key（imagegen:v1:autoStitch），其他设置（model / template / count / size /
 * quality / prompt 等）都是 useState 默认值，刷新即丢。现在统一存到
 * imagegen:v1:settings，刷新时一次性回填。
 *
 * 与 V2（zustand persist）相比，V1 走"裸 useState + 单 mount-load useEffect
 * + 单 save useEffect"轻量模式：组件已 5000+ 行，重构成 zustand store
 * 收益小、风险大。代价是 useState 数量多，save effect 列出所有 deps。
 *
 * 迁移：旧 `imagegen:v1:autoStitch` 还在 —— 首次加载时若新 key 不存在，
 * 回退读旧 key；写入新 key 后保留旧 key 不动（避免一次性大改 schema）。
 */
const V1_SETTINGS_KEY = "imagegen:v1:settings";
const LEGACY_AUTO_STITCH_KEY = "imagegen:v1:autoStitch";

interface V1PersistedSettings {
  selectedModel: ImageModelId;
  selectedMask: string;
  paramValues: Record<string, string>;
  batchSize: number;
  size: ImageSize;
  quality: "auto" | "high" | "medium" | "low";
  transparentBackground: boolean;
  guidanceScale: number;
  steps: number;
  seed: number | "";
  safetyCheck: boolean;
  sidebarOpen: boolean;
  prompt: string;
  negativePrompt: string;
  autoStitch: boolean;
  useTemplate: boolean;
}

const DEFAULT_V1_SETTINGS: V1PersistedSettings = {
  selectedModel: "gpt_image_2",
  selectedMask: "",
  paramValues: {},
  batchSize: 1,
  size: "1024x1024",
  quality: "auto",
  transparentBackground: false,
  guidanceScale: 7,
  steps: 30,
  seed: "",
  safetyCheck: true,
  sidebarOpen: false,
  prompt: "",
  negativePrompt: "",
  autoStitch: false,
  useTemplate: true,
};

function loadV1Settings(): V1PersistedSettings {
  // SSR / 沙箱 / 隐私模式：window.localStorage 不可用，直接返回默认
  if (typeof window === "undefined") return DEFAULT_V1_SETTINGS;
  try {
    const raw = window.localStorage.getItem(V1_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<V1PersistedSettings>;
      // 浅合并：缺失字段用默认补齐，避免老格式 / 部分写入导致 undefined
      return { ...DEFAULT_V1_SETTINGS, ...parsed };
    }
  } catch {
    // JSON 损坏 / quota 满 → 静默吞
  }
  // 迁移兼容：旧 key 单独存的 autoStitch
  try {
    const legacy = window.localStorage.getItem(LEGACY_AUTO_STITCH_KEY);
    if (legacy === "true") {
      return { ...DEFAULT_V1_SETTINGS, autoStitch: true };
    }
  } catch {
    // 同上
  }
  return DEFAULT_V1_SETTINGS;
}

function saveV1Settings(settings: V1PersistedSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(V1_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage 满 / 禁用，静默吞：刷新时丢设置而已，不影响当次使用
  }
}

export function GenerateWorkbenchView({
  templates,
}: GenerateWorkbenchViewProps) {
  const { toast: legacyToast } = useToast();

  // 历史记录（最新在前）
  const [history, setHistory] = useState<WorkbenchEffect[]>([]);
  // 当前选中的结果
  const [selectedEffect, setSelectedEffect] = useState<WorkbenchEffect | null>(
    null
  );

  // 参考图模式 + 数据
  // 2026-08-18：默认从 "none" 改为 "upload"。
  // 原因：默认模型 gpt_image_2 只支持图生图（无 imageUrl 会直接失败），
  // 默认进入上传区更顺手，也避免再点一次 toggle。
  const [refMode, setRefMode] = useState<RefMode>("upload");
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(
    null
  );
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 图库模式：当前用户的照片列表 + 选中项 + 搜索
  const [libraryPhotos, setLibraryPhotos] = useState<Photo[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  // 防止 React 18 严格模式下 useEffect 重复拉取
  const libraryFetchedRef = useRef(false);

  // 提示词
  const [prompt, setPrompt] = useState(DEFAULT_V1_SETTINGS.prompt);
  const [negativePrompt, setNegativePrompt] = useState(
    DEFAULT_V1_SETTINGS.negativePrompt
  );
  // 提示词模板开关
  const [useTemplate, setUseTemplate] = useState(
    DEFAULT_V1_SETTINGS.useTemplate
  );

  // 三按钮对应的三个 Dialog（与 V2 image-workbench 对齐：收藏 / 提示词库 / 资产库）
  // 与 V2 不同点：V1 的 prompt 输入区可能处于「模板模式」，三按钮仅在手动模式下出现
  // —— 模板模式由模板变量 + selectedMask 决定，用户没自由输入 prompt 的入口
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [savePromptOpen, setSavePromptOpen] = useState(false);

  // 模型与提示词模板（Phase C：mask → template 语义重命名，但 selectedMask 状态名保留
  // 以兼容 WorkbenchEffect.maskId 字段与 generateImageAction({ maskId }) 调用）
  // 默认 gpt_image_2：唯一支持 batchSize>1 的真实接入模型，工作台主推。
  const [selectedModel, setSelectedModel] = useState<ImageModelId>(
    DEFAULT_V1_SETTINGS.selectedModel
  );
  const activeTemplates = templates.filter((t) => t.isActive);
  // 初始为 ""，mount-load effect 会按持久化值 / 首个 active 模板补全
  const [selectedMask, setSelectedMask] = useState<string>(
    DEFAULT_V1_SETTINGS.selectedMask
  );
  // 模板变量取值
  const [paramValues, setParamValues] = useState<Record<string, string>>(
    DEFAULT_V1_SETTINGS.paramValues
  );

  // 基础参数
  const [batchSize, setBatchSize] = useState(DEFAULT_V1_SETTINGS.batchSize);
  const [size, setSize] = useState<ImageSize>(DEFAULT_V1_SETTINGS.size);
  // 2026-08-20：与 V2 ImageSettingsPanel 对齐 —— 质量 / 透明背景
  // - quality: 默认 "auto"（不透传给上游，由 provider adapter 决定默认）
  // - transparentBackground: true → 提交时把 background="transparent" 透传
  const [quality, setQuality] = useState<"auto" | "high" | "medium" | "low">(
    DEFAULT_V1_SETTINGS.quality
  );
  const [transparentBackground, setTransparentBackground] = useState(
    DEFAULT_V1_SETTINGS.transparentBackground
  );

  // 2026-08-25：自动拼接宫格图 —— 用户开启后，handleGenerate / applyJobUpdate
  // 拿到的 N 张候选图会被客户端 Canvas API 拼成 √N×√N 宫格大图，作为
  // 单张图展示 / 下载。模板自带宫格拼接（candidateCount=4/9 → 模型返 1
  // 张大图）不受此开关影响 —— 已经是 1 张了，没法再"拼接"。
  // 默认 false：不打扰现有用户。
  // 2026-08-26：与下面 V1PersistedSettings 合并到 imagegen:v1:settings 统一
  // 持久化（之前用独立 key imagegen:v1:autoStitch，新用户用新 key；老用户
  // 由 loadV1Settings 回退读旧 key 自动迁移）。
  const [autoStitch, setAutoStitch] = useState(DEFAULT_V1_SETTINGS.autoStitch);

  // 2026-08-23：会话列表 rail 默认折叠 —— 给中间参数面板 + 右侧结果区更多横向空间，
  // 用户点 sider 上的展开图标再展开；右上角的 collapse 图标手动收起
  const [sidebarOpen, setSidebarOpen] = useState(
    DEFAULT_V1_SETTINGS.sidebarOpen
  );

  // 高级参数（Accordion 默认折叠，无需本地 state）
  const [guidanceScale, setGuidanceScale] = useState(
    DEFAULT_V1_SETTINGS.guidanceScale
  );
  const [steps, setSteps] = useState(DEFAULT_V1_SETTINGS.steps);
  const [seed, setSeed] = useState<number | "">(DEFAULT_V1_SETTINGS.seed);
  const [safetyCheck, setSafetyCheck] = useState(
    DEFAULT_V1_SETTINGS.safetyCheck
  );

  // mount 时一次性从 localStorage 回填所有设置
  // —— 避免 SSR / 首次渲染看到默认值后立即跳到持久化值产生闪烁。
  useEffect(() => {
    const s = loadV1Settings();
    setSelectedModel(s.selectedModel);
    setParamValues(s.paramValues);
    setBatchSize(s.batchSize);
    setSize(s.size);
    setQuality(s.quality);
    setTransparentBackground(s.transparentBackground);
    setAutoStitch(s.autoStitch);
    setGuidanceScale(s.guidanceScale);
    setSteps(s.steps);
    setSeed(s.seed);
    setSafetyCheck(s.safetyCheck);
    setPrompt(s.prompt);
    setNegativePrompt(s.negativePrompt);
    setUseTemplate(s.useTemplate);
    // selectedMask 持久化值可能是空（首次使用），保留 "" 让下方 derived state
    // 兜底首个 active 模板 —— 避免 useEffect 把 templates prop 当 dep
    setSelectedMask(s.selectedMask);
    setSidebarOpen(s.sidebarOpen);
  }, []);

  // 任一字段变化都同步到 localStorage —— deps 全展开（仅写一行的额外成本）
  useEffect(() => {
    saveV1Settings({
      selectedModel,
      selectedMask,
      paramValues,
      batchSize,
      size,
      quality,
      transparentBackground,
      autoStitch,
      guidanceScale,
      steps,
      seed,
      safetyCheck,
      sidebarOpen,
      prompt,
      negativePrompt,
      useTemplate,
    });
  }, [
    selectedModel,
    selectedMask,
    paramValues,
    batchSize,
    size,
    quality,
    transparentBackground,
    autoStitch,
    guidanceScale,
    steps,
    seed,
    safetyCheck,
    sidebarOpen,
    prompt,
    negativePrompt,
    useTemplate,
  ]);

  const [generating, setGenerating] = useState(false);
  // 手动「刷新状态」按钮的去抖锁：避免用户连点导致同 jobId 重复打 /poll
  const [refreshing, setRefreshing] = useState(false);
  // Lightbox：放大查看结果图用。`null` = 关闭。
  // 同时记录所在 effectId + index 用于「下载」「复制 URL」按钮沿用上下文。
  const [lightbox, setLightbox] = useState<{
    url: string;
    effectId: string;
    index: number;
    mime?: string | null;
  } | null>(null);
  /**
   * 参考图预览 Dialog：
   * 上传/库选之后默认只显示小缩略图（避免撑满 380px 左侧面板把其他
   * 设置挤到屏幕外），用户主动点缩略图才弹全屏预览。
   */
  const [refPreview, setRefPreview] = useState<{
    url: string;
    name: string;
  } | null>(null);
  // 每张结果图的下载/分享去抖锁：避免 hover 按钮连点导致重复 fetch
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const modelConfig = IMAGE_MODELS[selectedModel];
  // 2026-08-26：selectedMask 持久化可能为空（首次使用 / 用户从未切换），
  // derived 一个 effectiveSelectedMask 兜底首个 active 模板 —— 不需要把
  // templates prop 当 useEffect 依赖（避免 mount-load effect 被 deps 推着
  // 重跑，破坏"只读一次 localStorage"语义）。
  const effectiveSelectedMask = selectedMask || activeTemplates[0]?.id || "";
  const selectedTemplate = activeTemplates.find(
    (t) => t.id === effectiveSelectedMask
  );
  /**
   * 当前模板推荐的模型 id（Phase：模板 model 字段允许为空，模板可选 doubao 等
   * 占位但未实现的模型当默认；空或占位时不强制锁，仍按模板 model 字段填）。
   * 用 derived state 替代 useState，避免模板切换时双源不一致。
   */
  const templateDefaultModel = (selectedTemplate?.model ??
    null) as ImageModelId | null;
  /**
   * 用户是否覆盖了模板默认模型：
   * - 没选模板：不显示"已覆盖"提示
   * - 选了模板且 selectedModel ≠ 模板默认：显示覆盖徽章 + 还原按钮
   */
  const isModelOverridden =
    templateDefaultModel !== null && selectedModel !== templateDefaultModel;
  const handleRestoreTemplateModel = () => {
    if (templateDefaultModel) setSelectedModel(templateDefaultModel);
  };
  // 上面两个变量暂未在精简面板里挂回（高级参数收纳到齿轮 Popover 后
  // 原本的"已覆盖/还原"链路变成死代码）。留着等未来"模型选择 / 模板默认
  // 不一致"提示重新引入时复用，避免重新推导 templateDefaultModel。
  void isModelOverridden;
  void handleRestoreTemplateModel;

  // 选择提示词模板时初始化变量默认值 + 切到指定模型
  const handleSelectMask = (templateId: string) => {
    setSelectedMask(templateId);
    const tpl = activeTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    if (tpl.model) {
      // 模板指定的 model 若已下线（isAvailable=false），自动回退到第一个可用模型，
      // 避免用户一进工作台就撞到「暂未上线」toast。模板默认仍写库不修改；
      // UI 上的「已覆盖」徽章会提示用户实际生效的是回退模型。
      const tplModelConfig = IMAGE_MODELS[tpl.model as ImageModelId];
      if (tplModelConfig?.isAvailable) {
        setSelectedModel(tpl.model as ImageModelId);
      } else {
        const fallback =
          IMAGE_MODEL_LIST.find((m) => m.isAvailable)?.id ?? null;
        if (fallback) setSelectedModel(fallback);
      }
    }
    const init: Record<string, string> = {};
    (tpl.variables ?? []).forEach((v) => {
      init[v.key] = v.defaultValue;
    });
    setParamValues(init);
  };

  // 「收藏当前提示词」 —— 写进 useMyPromptStore（localforage）。
  // 与 V2 image-workbench 的 handleConfirmSavePrompt 同形态：用户填标题，存「我的提示词」Tab。
  const addMyPrompt = useMyPromptStore((state) => state.addPrompt);
  const handleOpenSavePrompt = () => {
    if (!prompt.trim()) {
      toast.error("请先输入提示词");
      return;
    }
    setSavePromptOpen(true);
  };
  const handleConfirmSavePrompt = (title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("请输入标题");
      return;
    }
    addMyPrompt({
      title: trimmedTitle,
      prompt,
      tags: [],
      source: "workbench",
    });
    setSavePromptOpen(false);
    toast.success("已收藏到「我的提示词」");
  };
  // 资产库插入 —— V1 当前没用「参考图」之外的资产消费场景，先只把图片贴到 prompt 上方的缩略图位置
  // （refMode 库选）。视频/文本暂不接，与 AssetPickerModal 的语义保持一致即可。
  const handleInsertAsset = (payload: InsertAssetPayload) => {
    if (payload.kind !== "image") return;
    setRefMode("library");
    setUploadedImage(null);
    setSelectedPhoto({
      id: `picker-${Date.now()}`,
      userId: "self",
      fileName: payload.title,
      fileUrl: payload.dataUrl,
      thumbnailUrl: payload.dataUrl,
      width: null,
      height: null,
      format: null,
      fileSize: null,
      createdAt: new Date(),
    } as Photo);
  };

  // 首次加载按默认选中模板填充参数
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅首次加载执行
  useEffect(() => {
    if (selectedTemplate) {
      const init: Record<string, string> = {};
      (selectedTemplate.variables ?? []).forEach((v: PromptVariable) => {
        init[v.key] = v.defaultValue;
      });
      setParamValues(init);
    }
  }, []);

  // 进入图库模式时拉取当前用户照片；refMode 切走不重拉，组件卸载才重置 fetched 标志
  useEffect(() => {
    if (refMode !== "library" || libraryFetchedRef.current) return;
    libraryFetchedRef.current = true;
    setLibraryLoading(true);
    setLibraryError(null);
    listPhotosAction({ limit: 100 })
      .then((res) => {
        if (res?.data?.photos) {
          setLibraryPhotos(res.data.photos);
        }
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "图库加载失败";
        setLibraryError(msg);
        libraryFetchedRef.current = false; // 失败时允许下次重试
      })
      .finally(() => setLibraryLoading(false));
  }, [refMode]);

  /**
   * 挂载时从 DB 拉最近 20 条 imageJob 灌进 history，
   * 让"刷新页面 / 切设备 / 重开浏览器"不再丢进度。
   *
   * 关键：对 status === "processing" 的 job 调用 startPolling(effectId, jobId)
   * 续上 setTimeout 链 —— 否则即便 history 回来了，前端也不会主动推
   * 状态，必须等下一次 5 分钟 cron 兜底。这条直接消除"看着 stuck 但啥
   * 也不动"的体验。
   *
   * 注意：必须放在 startPolling 闭包可用的位置（见下方 startPolling 定义）。
   * 这里用宽松的 [] deps —— mount 时一次性加载；客户端 handleGenerate 推入
   * history 后会保留（mergeHydratedHistory 的逻辑），不会丢新生成的条目。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅首次加载执行
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await listImageJobsAction({ limit: 20 });
        if (cancelled) return;
        const jobs = res?.data?.jobs ?? [];
        // 2026-08-23 修复 Bug3：jobsToEffects 按 (model, mode, maskId) 把多次
        // 提交合并到同一个 effect.submissions，refresh 后 rail 不再把同一会话
        // 的多次提交显示成 N 条独立会话。
        const hydrated: WorkbenchEffect[] = jobsToEffects(jobs);
        // mount 时 prev=[]，merged 与 hydrated 顺序等价（都是按 createdAt 倒序）
        const merged = mergeHydratedHistory([], hydrated);
        setHistory(merged);
        // 刷新页面场景：selectedEffect 组件 state 会丢，没选过任何 effect 时
        // 默认选最新一条历史 —— 否则右侧结果区一直空着，要用户手动点 rail
        // 才能看到处理中的任务 / 上次结果（用户报告"生图任务中刷新页面导致
        // 任务无法显示"就是这里出的问题）。
        setSelectedEffect((prev) => prev ?? merged[0] ?? null);
        // 给残留的 processing job 续轮询。注意 effect.jobId 是最新一条 submission
        // 的 jobId，但合并后 effect.status="processing" 也可能是因为中间某条
        // 老的 submission 还在跑 —— 此时 poll 最新那条已经 completed 的 jobId
        // 会立刻返 completed 然后停掉，in-flight 的老 submission 永远收不到
        // 状态推送。改成从 submissions[] 反向找第一条 in-flight 的来 poll。
        for (const eff of hydrated) {
          if (eff.status !== "processing") continue;
          const pendingSub = [...(eff.submissions ?? [])]
            .reverse()
            .find((s) => s.status === "pending" || s.status === "processing");
          if (pendingSub?.jobId) {
            startPolling(eff.effectId, pendingSub.jobId);
          } else if (eff.jobId) {
            // 兜底：submissions 缺数据（异常 hydrate）时退回到顶层 jobId
            startPolling(eff.effectId, eff.jobId);
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[workbench hydrate] failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ============ 文件处理 ============
  const handleFileSelect = (file: File | undefined) => {
    if (!file) return;
    if (
      !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(
        file.type
      )
    ) {
      toast.error("格式不支持，请上传 JPG/PNG/WEBP");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("文件过大，最大 10MB");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    // uploading=null 表示「上传中或未上传」；publicUrl=null 表示没有可用的
    // 服务端 URL。handleGenerate 看到这两个都是 null 就拒绝提交，避免把
    // blob URL 当成 imageUrl 传给服务端踩 ENOENT 坑。
    setUploadedImage({
      file,
      previewUrl,
      publicUrl: null,
      uploading: 0,
      fileName: file.name,
      fileSize: file.size,
    });

    // 异步上传到 R2 —— 拿到 publicUrl 才能让 submitLingtingTask 在服务端 fetch。
    // 失败时 publicUrl 保持 null，handleGenerate 会拒绝提交并 toast 报错。
    void uploadFileToR2(file)
      .then((publicUrl) => {
        setUploadedImage((prev) =>
          prev && prev.file === file
            ? { ...prev, publicUrl, uploading: null }
            : prev
        );
        if (!publicUrl) {
          toast.error("参考图上传失败，请重试");
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[workbench] upload to R2 failed:", err);
        setUploadedImage((prev) =>
          prev && prev.file === file ? { ...prev, uploading: null } : prev
        );
        toast.error(err instanceof Error ? err.message : "上传失败");
      });
  };

  const handleRemoveUpload = () => {
    if (uploadedImage) URL.revokeObjectURL(uploadedImage.previewUrl);
    setUploadedImage(null);
  };

  const handleModeChange = (mode: RefMode) => {
    // 离开 upload 模式：释放本地预览 URL，避免 blob 内存泄漏
    if (mode !== "upload" && uploadedImage) handleRemoveUpload();
    // 离开 library 模式：清空已选照片 + 搜索词，避免切回 upload/none 还带着旧 photoId
    if (mode !== "library") {
      setSelectedPhoto(null);
      setLibrarySearch("");
    }
    setRefMode(mode);
  };

  // 渲染模板 prompt：替换 {{变量}}
  const renderTemplatePrompt = (tpl = selectedTemplate) => {
    if (!tpl) return "";
    let rendered = tpl.prompt ?? "";
    (tpl.variables ?? []).forEach((v: PromptVariable) => {
      const val = paramValues[v.key] || v.defaultValue;
      rendered = rendered.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, "g"), val);
    });
    return rendered;
  };

  // ============ 生成 ============
  // 递减轮询间隔（秒）：与 gpt-image /api/orders/[token]/poll 一致。
  // cold start 时上游还没真正开始算，给足余量；越接近完成越短，避免空转。
  // total ≈ 3+3+4+5+6+8+10+12+15 = 66s，覆盖大多数异步任务。
  const POLL_INTERVALS_SEC = [3, 3, 4, 5, 6, 8, 10, 12, 15];
  const POLL_TIMEOUT_MS = 180_000;

  // 引用最新的 history 以便 setInterval 闭包始终读到新值
  const historyRef = useRef<WorkbenchEffect[]>([]);
  // 当前正在轮询的 effectId（防止重复启动轮询）
  const pollingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  /**
   * 把 DB imageJob 的状态映射回客户端 WorkbenchEffect。
   *
   * 被两处共用：
   * 1. startPolling 的 setTimeout tick —— 拉一次 /poll 后应用结果
   * 2. 手动「刷新状态」按钮 —— 用户主动 retry 一次
   *
   * 关键副作用：终态（completed/failed）会把 effectId 从 pollingRef 摘掉，
   * 调用方据此判断"轮询是否该停了"。
   *
   * 不处理 pending/processing —— 此时不动 state，让 setTimeout tick 自然
   * 落到下一轮。
   */
  const applyJobUpdate = async (effectId: string, job: ImageJob) => {
    const eff = historyRef.current.find((e) => e.effectId === effectId);
    if (!eff) return;

    // 关键：现在 effect 是"会话级容器"，里面多个 submission 各管各的。
    // pollImageJob 只能拿到本次提交的 jobId 对应的行 → 只更新对应 submission，
    // 不要把整个 effect 标 completed。其它 submission 保持原样。
    //
    // 怎么找对应 submission：传进来的 jobId === submission.jobId（handleGenerate
    // 里 pending 时塞的），相等就是它。
    const matchJobId = job.id;
    const targetSubmissionIdx = (eff.submissions ?? []).findIndex(
      (s) => s.jobId === matchJobId
    );

    if (job.status === "completed") {
      pollingRef.current.delete(effectId);
      const resultUrls = (job.resultUrls as string[]) ?? [];
      const cost =
        job.cost && job.currency
          ? {
              cost: (job.cost as number) / 1000,
              currency: job.currency as string,
            }
          : {};
      const duration = job.generateDuration
        ? { duration: job.generateDuration as number }
        : {};

      // 找到对应 submission，看是不是宫格拼接模板（candidateCount=4/9 时模型
      // 本身就返 1 张大图，不再二次拼接）。isGridComposite 由 handleGenerate 在
      // 新建 submission 时根据模板 candidateCount 写入。
      const targetSubmission = (eff.submissions ?? [])[targetSubmissionIdx];
      const isTemplateGrid = targetSubmission?.isGridComposite === true;
      // 2026-08-25：自动拼接宫格图 —— 开启 + ≥ 2 张 + 非模板宫格 → 客户端
      // Canvas 拼接成单张大图。
      //
      // 关键设计：resultUrls 始终保留 N 张原图（用户要求"也需要保留多个原图"，
      // 否则一旦开启拼接就再也看不到单张候选）。宫格大图作为"另一种视图"挂
      // 在 stitchedUrl 上，SubmissionNode 按 isStitched 分支决定主预览是
      // composite 还是 N 格原图，并把另一形态作为附属缩略图。这样既不丢
      // 原图、又不牺牲"一张宫格大图"的视觉冲击。
      //
      // applyJobUpdate 是 async 函数（外层 startPolling 是 async），可以直接
      // await。失败（任何一张图解码失败）就静默回退，不打 isStitched 标记。
      let stitchedComposite: string | undefined;
      if (autoStitch && !isTemplateGrid && resultUrls.length >= 2) {
        try {
          stitchedComposite = await stitchToGrid(resultUrls);
          // 2026-08-31：拼接成功后立刻落 localStorage —— imageJob 表没有
          // stitchedUrl 列，跨刷新靠这个兜底恢复。失败时不动 localStorage
          // （保留旧 entry 也无害：jobsToEffects 走 status=completed 才读，
          // 旧 job 的 entry 自然命中；新 job 失败 = 没有 stitchedUrl entry =
          // 走 N 张原图分支，与失败语义一致）。
          writeStitchedToStorage(matchJobId, stitchedComposite);
        } catch (err) {
          console.warn("[workbench] stitch failed:", err);
        }
      }
      const isStitchedNow = stitchedComposite !== undefined;

      const next: WorkbenchEffect = {
        ...eff,
        // 仅在 effect 主 effect 是 processing 时一起刷成 completed（最后一条
        // submission 完成 → effect 也算完成）。这里必须用 Except 版本 —— 被
        // 完成的那条 submission 在 eff 里还标记着 processing，普通版本会
        // 永远返 true，导致 effect 永远卡 processing。
        status: hasUnfinishedSubmissionExcept(eff, targetSubmissionIdx)
          ? "processing"
          : "completed",
        // resultUrls 保持 N 张原图（不再被 composite 覆盖）。rail 缩略图按
        // stitchedUrl ?? resultUrls[0] 选择展示素材。
        resultUrls,
        // 拼接大图：拆成两个独立条件，避免 TS 把 stitchedComposite 的类型扩成
        // string | undefined 后撞到 exactOptionalPropertyTypes。
        ...(stitchedComposite !== undefined
          ? { stitchedUrl: stitchedComposite }
          : {}),
        ...(isStitchedNow ? { isStitched: true } : {}),
        ...duration,
        ...cost,
        submissions: (eff.submissions ?? []).map((s, i) =>
          i === targetSubmissionIdx
            ? {
                ...s,
                status: "completed",
                // submission 级 resultUrls 同样保留 N 张原图，stitchedUrl 单独存
                resultUrls,
                ...(stitchedComposite !== undefined
                  ? { stitchedUrl: stitchedComposite }
                  : {}),
                ...(isStitchedNow ? { isStitched: true } : {}),
                // 同时把本次 job 的耗时写到对应 submission（覆盖式：每条 submission
                // 各自记自己的耗时，effect 级 duration 是最新一次的值）
                ...duration,
              }
            : s
        ),
      };
      setHistory((prev) =>
        prev.map((e) => (e.effectId === effectId ? next : e))
      );
      setSelectedEffect((prev) => (prev?.effectId === effectId ? next : prev));
      toast.success(`${eff.imageModelName} 生成完成`);
      return;
    }

    if (job.status === "failed") {
      pollingRef.current.delete(effectId);
      const failed: WorkbenchEffect = {
        ...eff,
        status: hasUnfinishedSubmissionExcept(eff, targetSubmissionIdx)
          ? "processing"
          : "failed",
        errorMsg: job.errorMsg ?? "生成失败",
        submissions: (eff.submissions ?? []).map((s, i) =>
          i === targetSubmissionIdx
            ? {
                ...s,
                status: "failed",
                errorMsg: job.errorMsg ?? "生成失败",
              }
            : s
        ),
      };
      setHistory((prev) =>
        prev.map((e) => (e.effectId === effectId ? failed : e))
      );
      setSelectedEffect((prev) =>
        prev?.effectId === effectId ? failed : prev
      );
      toast.error(`生成失败：${failed.errorMsg}`);
    }
  };

  /**
   * effect 是否还有**除 exceptIdx 之外**未结束的 submission。
   * 完成/失败分支都用 Except 版本 —— 不能用普通版，普通版会把正在被标记
   * 为 completed 的那条也算进去（它在 eff 里还是 processing），effect 永远
   * 卡 processing。
   */
  function hasUnfinishedSubmissionExcept(
    eff: WorkbenchEffect,
    exceptIdx: number
  ): boolean {
    return (eff.submissions ?? []).some(
      (s, i) =>
        i !== exceptIdx && (s.status === "processing" || s.status === "pending")
    );
  }

  /**
   * 启动一个异步任务的轮询循环。
   * 通过历史 ref + pollingRef 保证组件卸载时也能正常清理；
   * 每个 effect 单独跑 setTimeout 链，避免多个 effect 互相干扰。
   */
  const startPolling = (effectId: string, jobId: string) => {
    // 同 effectId 已存在旧轮询（用户在同一会话内连续生成） → 先清掉，避免两套
    // setTimeout 链各自拉各自的 jobId，结果错乱覆盖。
    pollingRef.current.delete(effectId);
    pollingRef.current.add(effectId);

    const startedAt = Date.now();
    let attempt = 0;

    const tick = async () => {
      // 组件卸载 / 用户切走就停（history 已被删也停）
      if (!pollingRef.current.has(effectId)) return;
      const eff = historyRef.current.find((e) => e.effectId === effectId);
      if (!eff || eff.status !== "processing") {
        pollingRef.current.delete(effectId);
        return;
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        pollingRef.current.delete(effectId);
        const failed: WorkbenchEffect = {
          ...eff,
          status: "failed",
          errorMsg: "轮询超时（180s），请重试",
        };
        setHistory((prev) =>
          prev.map((e) => (e.effectId === effectId ? failed : e))
        );
        setSelectedEffect((prev) =>
          prev?.effectId === effectId ? failed : prev
        );
        toast.error("生成超时");
        return;
      }

      try {
        const job = await pollImageJob(jobId);
        if (!job) {
          // poll 端没返 job：忽略，等下一轮
        } else if (job.status === "completed" || job.status === "failed") {
          applyJobUpdate(effectId, job);
          return; // 终态：停 setTimeout 链
        }
        // pending / processing：不动 state，等下一轮
      } catch (err) {
        // 单次 poll 失败不打断整体链路，等下一轮
        // eslint-disable-next-line no-console
        console.warn("[workbench poll] failed:", err);
      }

      const delaySec =
        POLL_INTERVALS_SEC[Math.min(attempt, POLL_INTERVALS_SEC.length - 1)] ??
        10;
      attempt += 1;
      setTimeout(tick, delaySec * 1000);
    };

    setTimeout(tick, POLL_INTERVALS_SEC[0]! * 1000);
  };

  const handleGenerate = async () => {
    // useTemplate 开着但 DB 没模板 —— 即使用户关掉 Switch 想手输也该先提醒，
    // 否则容易在切换中误触。直接拦在最前。
    if (useTemplate && activeTemplates.length === 0) {
      toast.error("暂无提示词模板，请联系管理员添加或关闭模板开关");
      return;
    }
    const effectivePrompt = useTemplate ? renderTemplatePrompt() : prompt;
    if (!effectivePrompt.trim()) {
      toast.error(useTemplate ? "请选择提示词模板" : "请输入提示词");
      return;
    }
    if (useTemplate && selectedTemplate) {
      const missing = (selectedTemplate.variables ?? []).find(
        (v) => v.required && !(paramValues[v.key] || v.defaultValue)
      );
      if (missing) {
        toast.error(`缺少必填参数：${missing.label}（{{${missing.key}}}）`);
        return;
      }
    }
    if (modelConfig.status === "maintenance") {
      toast.error(`${modelConfig.name} 当前维护中`);
      return;
    }
    if (!modelConfig.isAvailable) {
      toast.error(`${modelConfig.name} 暂未上线，请选择其他模型`);
      return;
    }
    if (negativePrompt && !modelConfig.capabilities.supportsNegativePrompt) {
      toast.error(`${modelConfig.name} 不支持反向提示词`);
      return;
    }

    // 宫格拼接：模板 candidateCount=4/9 时，单次提交一张拼接大图
    // （用户不再选 batchSize，UI 会禁用 batchSize slider）。
    // batchSize 强制 1：避免一次扣 4 张积分；模型返 1 张大图就是全部 4 个候选。
    const tplCandidateCount = useTemplate
      ? (selectedTemplate?.candidateCount ?? 1)
      : 1;
    const isGridComposite = tplCandidateCount === 4 || tplCandidateCount === 9;
    const effectiveBatchSize = isGridComposite ? 1 : batchSize;

    if (effectiveBatchSize > modelConfig.capabilities.maxBatchSize) {
      toast.error(
        `${modelConfig.name} 单次最多 ${modelConfig.capabilities.maxBatchSize} 张`
      );
      return;
    }

    // refImage 三种形态：abort 标记 / 上传模式（无 photoId） / 图库模式（有 photoId）
    type RefImage =
      | { __abort: string }
      | { imageUrl: string }
      | { imageUrl: string; photoId: string }
      | null;

    const refImage: RefImage =
      refMode === "upload" && uploadedImage
        ? (() => {
            // 上传模式：必须用 R2 publicUrl（服务端可 fetch），blob URL 仅供
            // 本地预览。如果还在上传或上传失败，用一个标记值让外层 abort。
            if (uploadedImage.uploading !== null) {
              return { __abort: "参考图还在上传中，请稍候" };
            }
            if (!uploadedImage.publicUrl) {
              return { __abort: "参考图上传失败，请重新选择" };
            }
            return {
              // publicUrl 是 R2 公共域 URL（持久、可服务端 fetch）。
              // photoId 不写 —— image_job.photo_id 是 photo.id 外键，本地上传
              // 没经过 createPhotoAction，没有对应 photo 行；createImageJob
              // 内部还有一道 UUID 正则兜底把非 UUID 字符串过滤成 null。
              imageUrl: uploadedImage.publicUrl,
            };
          })()
        : refMode === "library" && selectedPhoto
          ? {
              imageUrl: selectedPhoto.fileUrl,
              photoId: selectedPhoto.id,
            }
          : null;

    // 上传模式 abort 路径：IIFE 返的 __abort 标记
    if (refImage && "__abort" in refImage) {
      toast.error(refImage.__abort);
      return;
    }
    // 窄化为正常 refImage 形态（去掉 __abort 分支）
    const safeRefImage: { imageUrl: string; photoId?: string } | null =
      refImage && !("__abort" in refImage)
        ? (refImage as { imageUrl: string; photoId?: string })
        : null;
    const generationMode: "text_to_image" | "image_to_image" = safeRefImage
      ? "image_to_image"
      : "text_to_image";

    // 宫格拼接：给 prompt 加 2x2/3x3 后缀，让模型直接出拼接大图。
    // 与 gpt-image submitGeneration buildGridLayout 一致；这里只追加中文化版本，
    // 因为 gpt-image 那个是英文 promptTemplate 数据源，不复用。
    let finalPrompt = effectivePrompt;
    if (isGridComposite) {
      const gridSuffix =
        tplCandidateCount === 4
          ? "，以 2×2 四宫格布局，单张图内含 4 个候选方案（每格独立构图、风格一致、互不重叠）"
          : "，以 3×3 九宫格布局，单张图内含 9 个候选方案（每格独立构图、风格一致、互不重叠）";
      finalPrompt = `${effectivePrompt}${gridSuffix}`;
    }

    setGenerating(true);

    // 决定会话归属：复用还是新建。
    //
    // 2026-08-22 二次收紧（用户反馈 "同一个会话生图为什么会自动新建会话"）：
    // **只有用户主动点 "+ 新建会话" 才会创建 EF_xxx**。即使 selectedEffect
    // 为 null（用户没点过历史项），也 fallback 到 `history[0]`（最近一条，
    // 含 processing / completed / failed 全状态）继续 append —— 这条规则
    // 覆盖 99% 场景：用户刷新页面 / 切走 Tab / 刚生成完没点历史项就再生成。
    //
    // 唯一会真正新建 EF_xxx 的场景：**history 也为空**（首次进入工作台 +
    // 从来没生成过）。此时不创建就没法提交，所以是不可避免的兜底，不算
    // "自动创建会话"。
    //
    // effect 的 imageModel / mode / maskName 字段是**会话首次生成时**的
    // 快照，不随中途切换更新；后续提交的实际参数由 submission 自身 + 入参
    // generateImageAction 决定。
    const targetEffect = selectedEffect ?? history[0] ?? null;
    const canAppendToCurrent = !!targetEffect;

    const submissionTs = new Date().toISOString();
    const submissionId = `sub_${String(Date.now()).slice(-6)}`;
    const newSubmission: WorkbenchSubmission = {
      submissionId,
      resultUrls: [],
      status: "processing",
      createdAt: submissionTs,
      isGridComposite,
      prompt: finalPrompt,
    };

    let newEffect: WorkbenchEffect;
    if (canAppendToCurrent && targetEffect) {
      // 复用：保留 effect 主结构，把新 submission 追加到 submissions 列表
      // 时间戳刷成最新。targetEffect 可能是 selectedEffect，也可能是
      // history[0] fallback —— 后者场景下用户没显式点过历史项，但有
      // 历史可承接（用户刷新页面 / 切走 Tab 后回来直接生成）。如果当前
      // effect 是 draft（来自 handleNewSession），顺便补全 maskId /
      // maskName / mode / imageModel / imageModelName 等占位字段，原地
      // "提升"为真实会话。
      const existingSubs = targetEffect.submissions ?? [];
      const isDraft = targetEffect.status === "draft";
      newEffect = {
        ...targetEffect,
        createdAt: submissionTs,
        status: "processing", // effect 状态跟随最新提交
        prompt: finalPrompt, // prompt 用最新的
        ...(isDraft
          ? {
              maskId: effectiveSelectedMask || "CUSTOM",
              maskName: selectedTemplate?.name ?? "自定义",
              mode: generationMode,
              imageModel: selectedModel,
              imageModelName: modelConfig.name,
              isGridComposite,
            }
          : {}),
        submissions: [...existingSubs, newSubmission],
      };
      setHistory((prev) =>
        prev.map((e) => (e.effectId === targetEffect.effectId ? newEffect : e))
      );
    } else {
      newEffect = {
        effectId: `EF_${String(Date.now()).slice(-6)}`,
        prompt: finalPrompt,
        // maskId 字段名保留以兼容 generateImageAction / imageJob.maskId 列；
        // 实际值是 promptTemplate.id。
        maskId: effectiveSelectedMask || "CUSTOM",
        maskName: selectedTemplate?.name ?? "自定义",
        status: "processing",
        resultUrls: [],
        mode: generationMode,
        imageModel: selectedModel,
        imageModelName: modelConfig.name,
        createdAt: submissionTs,
        isGridComposite,
        submissions: [newSubmission],
      };
      setHistory((prev) => [newEffect, ...prev]);
    }
    setSelectedEffect(newEffect);

    try {
      const result = await generateImageAction({
        model: selectedModel,
        mode: generationMode,
        prompt: finalPrompt,
        negativePrompt: negativePrompt || undefined,
        imageUrl: safeRefImage?.imageUrl,
        size,
        batchSize: effectiveBatchSize,
        // 2026-08-20：与 V2 ImageSettingsPanel 对齐 —— quality + background 透传
        // - quality="auto" 不传（让上游决定默认值）
        // - transparentBackground 仅在用户开启时传 background="transparent"
        ...(quality !== "auto" ? { quality } : {}),
        ...(transparentBackground ? { background: "transparent" } : {}),
        seed: seed === "" ? undefined : seed,
        guidanceScale: modelConfig.capabilities.supportsGuidance
          ? guidanceScale
          : undefined,
        numInferenceSteps:
          modelConfig.capabilities.maxInferenceSteps > 0 ? steps : undefined,
        enableSafetyCheck: safetyCheck,
        maskId: effectiveSelectedMask || undefined,
        photoId: safeRefImage?.photoId,
      });

      // safe-action 错误结果处理（与 src/features/support/components/
      // ticket-message-form.tsx 一致的 pattern）：
      //   校验失败 → result.validationErrors
      //   服务端 throw → result.serverError
      //   成功 → result.data
      if (!result?.data) {
        if (result?.serverError) {
          throw new Error(result.serverError);
        }
        if (result?.validationErrors) {
          throw new Error("参数校验失败");
        }
        throw new Error("提交失败：未知错误");
      }

      const returnedJobId = result.data.jobId;
      const triggerMode = result.data.triggerMode;

      // 新架构（/p/[token] 镜像）：action 永远是 202 异步 submit，立刻返 jobId。
      // 真实的上游调用由 Inngest submitImageGenJob 函数在后台跑，
      // 前端通过 startPolling 调 /api/image-gen/jobs/[jobId]/poll 拉进度。
      if (!returnedJobId) {
        throw new Error("提交失败：未返回 jobId");
      }

      const pending: WorkbenchEffect = {
        ...newEffect,
        jobId: returnedJobId,
        submissions: (newEffect.submissions ?? []).map((s, i) => {
          // 找到 handleGenerate 刚 push 的那一条 submission，给它赋 jobId
          const isLatest = i === (newEffect.submissions ?? []).length - 1;
          return isLatest ? { ...s, jobId: returnedJobId } : s;
        }),
      };
      setHistory((prev) =>
        prev.map((e) => (e.effectId === newEffect.effectId ? pending : e))
      );
      setSelectedEffect((prev) =>
        prev?.effectId === newEffect.effectId ? pending : prev
      );
      startPolling(newEffect.effectId, returnedJobId);
      toast.info(
        `${modelConfig.name} 任务已提交${triggerMode === "sync" ? "（同步模式）" : ""}…`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      // 同步失败（action 抛错）→ 直接把刚 push 的最新 submission 标 failed，
      // 不要把整个 effect 也标 failed（其它 submission 还可能正常）。
      const failed: WorkbenchEffect = {
        ...newEffect,
        status: "failed",
        errorMsg: msg,
        submissions: (newEffect.submissions ?? []).map((s, i) =>
          i === (newEffect.submissions ?? []).length - 1
            ? { ...s, status: "failed", errorMsg: msg }
            : s
        ),
      };
      setHistory((prev) =>
        prev.map((e) => (e.effectId === newEffect.effectId ? failed : e))
      );
      setSelectedEffect((prev) =>
        prev?.effectId === newEffect.effectId ? failed : prev
      );
      toast.error(`生成失败：${msg}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleRandomSeed = () => setSeed(Math.floor(Math.random() * 1e9));

  /**
   * 新建空会话：往历史插一个 status=draft 的占位 effect，让右侧回到「开始创作」
   * 空状态，但不丢之前的生成记录。与 ChatGPT 「+ New chat」是同种 UX。
   *
   * effectId 用 `draft_<ts.slice(-6)>` —— 跟 `EF_` 前缀区分，避免和真生成撞 key
   * 触发 startPolling 时找不到对应历史条目。
   *
   * 2026-08-22：重置 uploadedImage / selectedPhoto / librarySearch，让新会话
   * 拿到干净的初始状态。上一个会话残留的 uploadedImage（上传中 / publicUrl=null /
   * 上传失败）会跨会话延续，把新会话的"生成"按钮 disable 住：
   *   refMode === "upload" && uploadedImage !== null &&
   *     (uploading !== null || !publicUrl)
   * 用户报告"会话任务进行中新建会话，新会话的生成按钮无法点击"就是这个原因。
   * revokeObjectURL 是为了避免 blob URL 内存泄漏。
   */
  const handleNewSession = () => {
    if (uploadedImage) {
      URL.revokeObjectURL(uploadedImage.previewUrl);
      setUploadedImage(null);
    }
    setSelectedPhoto(null);
    setLibrarySearch("");

    const draft: WorkbenchEffect = {
      effectId: `draft_${String(Date.now()).slice(-6)}`,
      prompt: "",
      maskId: "",
      maskName: "新会话",
      status: "draft",
      resultUrls: [],
      mode: refMode === "none" ? "text_to_image" : "image_to_image",
      imageModel: selectedModel,
      imageModelName: modelConfig.name,
      createdAt: new Date().toISOString(),
    };
    setHistory((prev) => [draft, ...prev]);
    setSelectedEffect(draft);
  };

  // ============ 会话改名 / 删除 ============
  //
  // 2026-08-22 新增（用户反馈 "会话支持删除和修改名称"）。
  //
  // 重命名：本地更新 maskName，**不写 DB**。原因：imageJob 表只有 maskId 列
  // 没有 title/customName，要持久化得先加列（schema 迁移）+ 改 jobsToEffects
  // + 改 hydrate。短期收益低，TODO。如果后续要持久化，建议加 `customTitle`
  // 列 + `renameImageJob` server action。
  //
  // 删除：本地从 history 移除。**DB 行不清理**（原因同上 —— 没有 deleteImageJob
  // server action；下次刷新 listImageJobsAction 还会把它读回来）。删除前需要
  // 用户二次确认（confirmingDeleteId 状态）。
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  );

  const handleStartRename = (eff: WorkbenchEffect) => {
    setEditingSessionId(eff.effectId);
    // 初始值用当前显示名（draft → effectId，与 rail displayName 保持一致；
    // 其余取当前 maskName）
    const current =
      eff.status === "draft"
        ? eff.effectId
        : eff.maskName && eff.maskName !== "CUSTOM"
          ? eff.maskName
          : eff.prompt?.slice(0, 24) || "";
    setEditingName(current);
    setConfirmingDeleteId(null);
  };

  const handleSaveRename = () => {
    if (!editingSessionId) return;
    const trimmed = editingName.trim().slice(0, 32);
    if (!trimmed) {
      // 空字符串 = 取消（视为放弃编辑）
      setEditingSessionId(null);
      setEditingName("");
      return;
    }
    setHistory((prev) =>
      prev.map((e) =>
        e.effectId === editingSessionId
          ? { ...e, maskName: trimmed, maskId: trimmed }
          : e
      )
    );
    setEditingSessionId(null);
    setEditingName("");
  };

  const handleCancelRename = () => {
    setEditingSessionId(null);
    setEditingName("");
  };

  const handleRequestDelete = (effectId: string) => {
    setConfirmingDeleteId(effectId);
    setEditingSessionId(null);
  };

  const handleConfirmDelete = (effectId: string) => {
    setHistory((prev) => prev.filter((e) => e.effectId !== effectId));
    setSelectedEffect((prev) => (prev?.effectId === effectId ? null : prev));
    // 停掉对该 effect 的轮询
    pollingRef.current.delete(effectId);
    setConfirmingDeleteId(null);
  };

  const handleCancelDelete = () => {
    setConfirmingDeleteId(null);
  };

  // 模板可用尺寸（与模型能力交集）— 2026-08-21：尺寸 UI 改为显示全集 ALL_IMAGE_SIZES，
  // 不再按 model 能力过滤（对齐 V2 ImageSettingsPanel 行为）。
  // const availableSizes: ImageSize[] = modelConfig.capabilities.sizes;

  // 抑制未使用变量告警
  void legacyToast;

  return (
    <>
      <div className="flex h-[calc(100vh-8rem)] gap-4">
        {/* ============ 左侧：会话历史 rail（Lovart 风）============
         *
         * 2026-08-22 改造：宽度从 w-[88px] 扩到 w-60（240px），每条 session 从
         * 纯缩略图升级为"缩略图 + 名称 + 相对时间 + 状态"四要素，方便用户识别
         * 旧会话 —— 之前用户反馈"无法滚动查看以及查看全部，没有名称时间"。
         *
         * 顶部「+」按钮 sticky，让用户长会话列表滚到底也能新建；底部总数 +
         * 滚动提示。
         *
         * 2026-08-23：默认折叠（sidebarOpen=false）—— 给中间参数面板 + 右侧
         * 结果区更多横向空间；只在用户主动点左侧展开按钮时显示完整列表。
         */}
        {sidebarOpen ? (
          <aside className="w-60 shrink-0 flex flex-col bg-card border rounded-lg overflow-hidden">
            {/* 顶部：sticky，新建按钮始终可见 */}
            <div className="p-2 border-b bg-muted/30 flex items-center gap-2 sticky top-0 z-10">
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-muted transition-colors"
                title="收起会话列表"
                aria-label="收起会话列表"
              >
                <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
              </button>
              <span className="text-[10px] font-medium text-muted-foreground tracking-wide">
                会话
              </span>
              <Badge
                variant="secondary"
                className="h-4 px-1.5 text-[9px] font-mono"
              >
                {history.length}
              </Badge>
              <button
                type="button"
                onClick={handleNewSession}
                className="ml-auto h-8 w-8 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/30 hover:bg-muted/60 hover:border-primary/60 flex items-center justify-center transition-all duration-200 hover:scale-105 group"
                title="新建会话"
                aria-label="新建会话"
              >
                <Plus className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </button>
            </div>
            {/* 中部：可滚动列表 —— 显式加 max-h + overflow-y-auto 兜底，部分
             * 浏览器 flex-1 在嵌套布局里会失效 */}
            <div
              className="flex-1 overflow-y-auto p-2 space-y-1.5"
              style={{ maxHeight: "calc(100vh - 11rem)" }}
            >
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-[10px] text-muted-foreground/60 text-center px-1 leading-relaxed gap-2">
                  <span>暂无会话</span>
                  <span>点击右上「+」开始第一次生图</span>
                </div>
              ) : (
                history.map((eff) => {
                  const Icon = STATUS_CONFIG[eff.status].icon;
                  const isSelected = selectedEffect?.effectId === eff.effectId;
                  const isEditing = editingSessionId === eff.effectId;
                  const isConfirmingDelete =
                    confirmingDeleteId === eff.effectId;
                  // 名称：draft 默认显示 effectId（用户反馈"新建会话默认名称为
                  // 该会话id"——和 maskName="新会话"那种纯占位比，id 至少有辨识
                  // 度，多个 draft 并存不会撞名）；其余优先 maskName，回退到
                  // prompt 前 24 字
                  const displayName =
                    eff.status === "draft"
                      ? eff.effectId
                      : eff.maskName && eff.maskName !== "CUSTOM"
                        ? eff.maskName
                        : eff.prompt?.slice(0, 24) || "未命名";
                  const tooltipTitle = `${displayName} · ${STATUS_CONFIG[eff.status].label} · ${formatAbsoluteTime(eff.createdAt)}`;
                  // 2026-08-25：rail 缩略图走拼接大图（开启自动拼接时）或 N 张
                  // 原图的首张（默认）。applyJobUpdate 现在把 stitchedUrl 与
                  // resultUrls 拆开，resultUrls 始终保留 N 张原图，所以这里
                  // stitchedUrl 优先以展示"拼接"的视觉，否则用 resultUrls[0]
                  // 退到原图第一张。
                  const railThumb = eff.stitchedUrl ?? eff.resultUrls[0] ?? "";
                  return (
                    // 嵌套 button 不能放进 button，外层用 div + onClick 选中
                    // biome-ignore lint/a11y/useKeyWithClickEvents: rail 项支持 hover 出现操作按钮
                    <div
                      key={eff.effectId}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!isEditing && !isConfirmingDelete) {
                          setSelectedEffect(eff);
                        }
                      }}
                      title={
                        isEditing || isConfirmingDelete
                          ? undefined
                          : tooltipTitle
                      }
                      className={cn(
                        "w-full flex items-start gap-2 rounded-lg p-1.5 text-left transition-colors group/sess",
                        isSelected
                          ? "bg-primary/10 ring-1 ring-primary/50"
                          : "hover:bg-muted/60 ring-1 ring-transparent",
                        isConfirmingDelete &&
                          "ring-1 ring-rose-500/50 bg-rose-500/5"
                      )}
                    >
                      {/* 缩略图：48x48（2026-08-23：去掉右上角状态点 overlay，用户反馈
                       * "不要这个"——状态信息已在右侧状态行（label + 相对时间）
                       * 体现，缩略图上重复点反而干扰视线） */}
                      <span className="relative h-12 w-12 shrink-0 rounded-md overflow-hidden bg-muted">
                        {eff.resultUrls[0] ? (
                          // biome-ignore lint/performance/noImgElement: 缩略图用原生 img
                          <img
                            src={thumbnailUrl(railThumb, 96)}
                            alt={displayName}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="w-full h-full flex items-center justify-center">
                            <Icon
                              className={cn(
                                "h-4 w-4",
                                STATUS_CONFIG[eff.status].color,
                                eff.status === "processing" && "animate-spin"
                              )}
                            />
                          </span>
                        )}
                      </span>

                      {isEditing ? (
                        // 重命名模式：input + 状态行
                        <span className="min-w-0 flex-1 flex flex-col gap-1">
                          <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={handleSaveRename}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleSaveRename();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                handleCancelRename();
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            maxLength={32}
                            className="w-full px-1.5 py-0.5 text-xs font-medium rounded border border-primary/50 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <span className="text-[10px] text-muted-foreground">
                            Enter 保存 · Esc 取消
                          </span>
                        </span>
                      ) : isConfirmingDelete ? (
                        // 删除确认模式
                        <span className="min-w-0 flex-1 flex flex-col gap-1">
                          <span className="text-xs font-medium text-rose-700 dark:text-rose-400 truncate">
                            删除该会话？
                          </span>
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConfirmDelete(eff.effectId);
                              }}
                              className="h-6 px-2 text-[10px] font-medium rounded bg-rose-500 text-white hover:bg-rose-600 transition-colors"
                            >
                              删除
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCancelDelete();
                              }}
                              className="h-6 px-2 text-[10px] font-medium rounded bg-muted hover:bg-muted/80 transition-colors"
                            >
                              取消
                            </button>
                          </span>
                        </span>
                      ) : (
                        // 正常显示模式
                        <>
                          {/* 文字：名称 + 状态 + 相对时间 */}
                          <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                            <span
                              className={cn(
                                "text-xs font-medium truncate",
                                isSelected ? "text-primary" : "text-foreground"
                              )}
                            >
                              {displayName}
                            </span>
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <span
                                className={cn(
                                  "shrink-0",
                                  STATUS_CONFIG[eff.status].color
                                )}
                              >
                                {STATUS_CONFIG[eff.status].label}
                              </span>
                              <span className="shrink-0">·</span>
                              <span className="font-mono tabular-nums truncate">
                                {formatRelativeTime(eff.createdAt)}
                              </span>
                            </span>
                          </span>
                          {/* 操作图标：hover 时显示，✏️ + 🗑️ */}
                          <span className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover/sess:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartRename(eff);
                              }}
                              className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground"
                              title="重命名"
                              aria-label="重命名会话"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRequestDelete(eff.effectId);
                              }}
                              className="h-5 w-5 rounded flex items-center justify-center hover:bg-rose-500/10 text-muted-foreground hover:text-rose-500"
                              title="删除"
                              aria-label="删除会话"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        ) : (
          // 折叠态：只显示会话缩略图竖列（最小宽度 56px = 48px 缩略图 + padding），
          // 顶部一个图标按钮用来切回完整列表。点缩略图 = 选中该会话（不自动展开）
          <aside className="w-14 shrink-0 flex flex-col bg-card border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="h-11 flex items-center justify-center hover:bg-muted/60 transition-colors border-b"
              title="展开会话列表"
              aria-label="展开会话列表"
            >
              <PanelLeftOpen className="h-4 w-4 text-muted-foreground" />
            </button>
            {/* 缩略图列表：每个 cell = 48px 方图（与展开态一致），title 提供名称/状态/时间
             * hover 查看，selected 用 primary ring 高亮 */}
            <div className="flex-1 overflow-y-auto p-1 space-y-1">
              {history.length === 0 ? (
                <span
                  className="block text-[9px] text-muted-foreground/60 text-center py-2 leading-tight"
                  title="暂无会话"
                >
                  暂无
                </span>
              ) : (
                history.map((eff) => {
                  const Icon = STATUS_CONFIG[eff.status].icon;
                  const isSelected = selectedEffect?.effectId === eff.effectId;
                  const displayName =
                    eff.status === "draft"
                      ? eff.effectId
                      : eff.maskName && eff.maskName !== "CUSTOM"
                        ? eff.maskName
                        : eff.prompt?.slice(0, 24) || "未命名";
                  const railThumb = eff.stitchedUrl ?? eff.resultUrls[0] ?? "";
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: 缩略图 cell 仅做选中
                    <div
                      key={eff.effectId}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedEffect(eff)}
                      title={`${displayName} · ${STATUS_CONFIG[eff.status].label} · ${formatAbsoluteTime(eff.createdAt)}`}
                      className={cn(
                        "h-12 w-12 mx-auto rounded-md overflow-hidden bg-muted cursor-pointer transition-all",
                        isSelected
                          ? "ring-2 ring-primary"
                          : "hover:ring-1 hover:ring-primary/40"
                      )}
                    >
                      {eff.resultUrls[0] ? (
                        // biome-ignore lint/performance/noImgElement: 缩略图用原生 img
                        <img
                          src={thumbnailUrl(railThumb, 96)}
                          alt={displayName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center">
                          <Icon
                            className={cn(
                              "h-4 w-4",
                              STATUS_CONFIG[eff.status].color,
                              eff.status === "processing" && "animate-spin"
                            )}
                          />
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        )}

        {/* ============ 中间：参数面板 ============ */}
        <aside className="w-[380px] shrink-0 flex flex-col bg-card border rounded-lg overflow-hidden">
          {/*
            2026-08-23：去掉 Accordion 折叠 —— 用户反馈"提示词和参考图不需要展开收起这功能"。
            三个分区（参考图 / 提示词 / 输出）始终可见，全在一个可滚动容器里纵向铺开，
            每个区的高度由内容本身决定（textarea rows=12、dropzone p-8），不靠折叠省空间。
            segmented control 留在每个区标题栏右侧，模式切换零成本。
          */}
          <div className="flex-1 overflow-y-auto px-3 divide-y divide-border/40">
            {/* ============ 参考图 ============ */}
            <div className="py-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="flex items-center gap-2 text-xs font-medium flex-1">
                  <ImageIcon className="h-3.5 w-3.5 text-primary" />
                  <span>参考图</span>
                  <span className="ml-auto text-[11px] text-muted-foreground font-normal">
                    {(refMode === "upload" && uploadedImage) ||
                    (refMode === "library" && selectedPhoto)
                      ? "已选"
                      : ""}
                  </span>
                </span>
                <div
                  className="flex gap-0.5 bg-muted rounded p-0.5 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {(["upload", "library", "none"] as RefMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleModeChange(m)}
                      className={cn(
                        "text-[10px] px-2 py-1 rounded transition-colors",
                        refMode === m
                          ? "bg-background shadow-sm font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {REF_MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="space-y-2">
                  {refMode === "upload" &&
                    (uploadedImage ? (
                      <div className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30">
                        {/* 缩略图：点击预览 */}
                        <button
                          type="button"
                          onClick={() =>
                            setRefPreview({
                              url: uploadedImage.previewUrl,
                              name: uploadedImage.fileName,
                            })
                          }
                          className="relative shrink-0 h-12 w-12 rounded-md overflow-hidden border bg-muted hover:border-primary/60 transition-colors group/thumb"
                          title="点击预览"
                        >
                          {/* biome-ignore lint/performance/noImgElement: 缩略图 */}
                          <img
                            src={uploadedImage.previewUrl}
                            alt={uploadedImage.fileName}
                            className={cn(
                              "w-full h-full object-cover",
                              uploadedImage.uploading !== null && "opacity-60"
                            )}
                          />
                          {uploadedImage.uploading !== null && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
                            </div>
                          )}
                        </button>
                        {/* 文件信息 */}
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <p className="text-xs font-medium truncate">
                            {uploadedImage.fileName}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {(uploadedImage.fileSize / 1024).toFixed(1)} KB
                            {uploadedImage.uploading !== null
                              ? " · 上传中…"
                              : uploadedImage.publicUrl
                                ? " · 已就绪"
                                : ""}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-rose-600"
                          onClick={handleRemoveUpload}
                          aria-label="移除"
                          title="移除"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
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
                          // 2026-08-23：上传区域高度从 p-5 (~80px) 抬到 p-8 (~140px)，
                          // 用户反馈"图片上传区域高度太小"，加图标尺寸 + 副文案，让落地点更明显
                          "w-full border border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors space-y-1.5",
                          dragOver
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40 hover:bg-muted/30"
                        )}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) =>
                            handleFileSelect(e.target.files?.[0])
                          }
                        />
                        <Upload
                          className={cn(
                            "h-7 w-7 mx-auto",
                            dragOver ? "text-primary" : "text-muted-foreground"
                          )}
                        />
                        <p className="text-xs font-medium">
                          {dragOver ? "释放即可上传" : "点击或拖拽图片"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          支持 JPG / PNG / WebP，单张
                        </p>
                      </button>
                    ))}

                  {refMode === "library" && (
                    <div className="space-y-2">
                      {selectedPhoto && (
                        <div className="flex items-center gap-2 p-2 rounded-lg border border-primary/40 bg-primary/5">
                          {/* 缩略图：点击预览 */}
                          <button
                            type="button"
                            onClick={() =>
                              setRefPreview({
                                url:
                                  selectedPhoto.thumbnailUrl ??
                                  selectedPhoto.fileUrl,
                                name: selectedPhoto.fileName,
                              })
                            }
                            className="relative shrink-0 h-12 w-12 rounded-md overflow-hidden border bg-muted hover:border-primary/60 transition-colors"
                            title="点击预览"
                          >
                            {/* biome-ignore lint/performance/noImgElement: R2 缩略图 */}
                            <img
                              src={thumbnailUrl(
                                selectedPhoto.thumbnailUrl ??
                                  selectedPhoto.fileUrl,
                                96
                              )}
                              alt={selectedPhoto.fileName}
                              className="w-full h-full object-cover"
                            />
                          </button>
                          {/* 文件信息 */}
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <p className="text-xs font-medium truncate">
                              {selectedPhoto.fileName}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {selectedPhoto.format?.toUpperCase() ?? "IMG"}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-rose-600"
                            onClick={() => setSelectedPhoto(null)}
                            aria-label="移除已选"
                            title="移除"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}

                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                          value={librarySearch}
                          onChange={(e) => setLibrarySearch(e.target.value)}
                          placeholder="搜索图库..."
                          className="w-full h-8 pl-7 pr-2 text-xs rounded border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>

                      <div className="max-h-[280px] overflow-y-auto rounded-lg border bg-muted/20">
                        {libraryLoading ? (
                          <div className="flex items-center justify-center py-6 text-muted-foreground gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                          </div>
                        ) : libraryError ? (
                          <div className="p-3 text-center">
                            <p className="text-[10px] text-rose-600 dark:text-rose-400">
                              {libraryError}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                libraryFetchedRef.current = false;
                                setRefMode("none");
                                setTimeout(() => setRefMode("library"), 0);
                              }}
                              className="text-[10px] text-primary hover:underline mt-1.5"
                            >
                              重试
                            </button>
                          </div>
                        ) : libraryPhotos.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-1">
                            <Library className="h-5 w-5" />
                            <p className="text-[10px]">图库为空</p>
                            <a
                              href="/dashboard/photos"
                              className="text-[10px] text-primary hover:underline"
                            >
                              去上传
                            </a>
                          </div>
                        ) : (
                          (() => {
                            const filtered = libraryPhotos.filter((p) =>
                              p.fileName
                                .toLowerCase()
                                .includes(librarySearch.trim().toLowerCase())
                            );
                            if (filtered.length === 0) {
                              return (
                                <div className="py-4 text-center text-[10px] text-muted-foreground">
                                  没有匹配的图片
                                </div>
                              );
                            }
                            return (
                              <div className="grid grid-cols-3 gap-1 p-1">
                                {filtered.map((p) => {
                                  const selected = selectedPhoto?.id === p.id;
                                  // 2026-08-23：photo 表统一承载本地上传 + 生图结果，
                                  // 图库 cell 加 chip 区分来源；放左上角避免与
                                  // selected 时的中央 checkmark 冲突。
                                  const isGen = p.source === "generation";
                                  return (
                                    <button
                                      key={p.id}
                                      type="button"
                                      onClick={() => setSelectedPhoto(p)}
                                      className={cn(
                                        "relative aspect-square rounded overflow-hidden border-2 transition-all",
                                        selected
                                          ? "border-primary"
                                          : "border-transparent hover:border-primary/40"
                                      )}
                                      title={p.fileName}
                                    >
                                      {/* biome-ignore lint/performance/noImgElement: R2 动态 URL 用原生 img */}
                                      <img
                                        src={thumbnailUrl(
                                          p.thumbnailUrl ?? p.fileUrl,
                                          200
                                        )}
                                        alt={p.fileName}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                      />
                                      {/* 来源 chip：左上角，selected 状态中央
                                       * checkmark 时仍可见（背景半透避免遮挡图） */}
                                      <span
                                        className={cn(
                                          "absolute top-0.5 left-0.5 inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-medium leading-none backdrop-blur-sm",
                                          isGen
                                            ? "bg-violet-500/80 text-white"
                                            : "bg-emerald-500/80 text-white"
                                        )}
                                      >
                                        {isGen ? (
                                          <Sparkles className="h-2 w-2" />
                                        ) : (
                                          <Upload className="h-2 w-2" />
                                        )}
                                        {isGen ? "生图" : "上传"}
                                      </span>
                                      {selected && (
                                        <div className="absolute inset-0 bg-primary/30 flex items-center justify-center">
                                          <CheckCircle2 className="h-4 w-4 text-white" />
                                        </div>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ============ 提示词 ============ */}
            <div className="py-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="flex items-center gap-2 text-xs font-medium flex-1">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span>提示词</span>
                </span>
                <div
                  className="flex gap-0.5 bg-muted rounded p-0.5 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {(
                    [
                      { v: true, label: "模板" },
                      { v: false, label: "手动" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={String(opt.v)}
                      type="button"
                      onClick={() => setUseTemplate(opt.v)}
                      className={cn(
                        "text-[10px] px-2 py-1 rounded transition-colors",
                        useTemplate === opt.v
                          ? "bg-background shadow-sm font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="space-y-2">
                  {/* 模板模式 */}
                  {useTemplate && (
                    <div className="space-y-2">
                      {activeTemplates.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground bg-muted/30 rounded px-2.5 py-2">
                          暂无模板，去
                          <a
                            href="/admin/prompt-templates"
                            className="text-primary hover:underline mx-0.5"
                          >
                            模板管理
                          </a>
                          新建。
                        </p>
                      ) : (
                        <>
                          <div className="-mx-1 px-1 flex gap-1.5 overflow-x-auto pb-1 snap-x">
                            {activeTemplates.map((tpl) => {
                              const selected = tpl.id === effectiveSelectedMask;
                              return (
                                <button
                                  key={tpl.id}
                                  type="button"
                                  onClick={() => handleSelectMask(tpl.id)}
                                  className={cn(
                                    "snap-start shrink-0 w-24 h-14 rounded-md overflow-hidden text-left transition-all relative",
                                    selected
                                      ? "ring-2 ring-primary ring-offset-1 ring-offset-card"
                                      : "ring-1 ring-border hover:ring-muted-foreground/40"
                                  )}
                                  title={tpl.description ?? tpl.name}
                                >
                                  {tpl.coverUrl ? (
                                    // biome-ignore lint/performance/noImgElement: 模板封面用原生 img
                                    <img
                                      src={tpl.coverUrl}
                                      alt={tpl.name}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-muted">
                                      <Sparkles className="h-4 w-4 text-muted-foreground/60" />
                                    </div>
                                  )}
                                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1">
                                    <span className="text-[10px] font-medium text-white truncate block">
                                      {tpl.name}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          {/* 模板参数 inline */}
                          {selectedTemplate &&
                            (selectedTemplate.variables ?? []).length > 0 && (
                              <div className="space-y-1.5">
                                {(selectedTemplate.variables ?? []).map((v) => (
                                  <div
                                    key={v.key}
                                    className="flex items-center gap-2"
                                  >
                                    <Label className="text-[11px] text-muted-foreground shrink-0 w-20 truncate">
                                      {v.label}
                                    </Label>
                                    {v.options && v.options.length > 0 ? (
                                      <Select
                                        value={
                                          paramValues[v.key] ?? v.defaultValue
                                        }
                                        onValueChange={(val) =>
                                          setParamValues((p) => ({
                                            ...p,
                                            [v.key]: val,
                                          }))
                                        }
                                      >
                                        <SelectTrigger className="h-7 text-xs flex-1">
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
                                        placeholder={
                                          v.defaultValue || `请输入${v.label}`
                                        }
                                        className="h-7 text-xs flex-1"
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                        </>
                      )}
                    </div>
                  )}

                  {/* 手动模式 */}
                  {!useTemplate && (
                    <div className="space-y-1.5">
                      {/* 三按钮：收藏当前 / 提示词库 / 资产库（与 V2 工作台对齐） */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          disabled={!prompt.trim()}
                          onClick={handleOpenSavePrompt}
                        >
                          <BookmarkPlus className="mr-1 h-3 w-3" />
                          收藏当前
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => setPromptDialogOpen(true)}
                        >
                          <BookOpen className="mr-1 h-3 w-3" />
                          提示词库
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => setAssetPickerOpen(true)}
                        >
                          <FolderPlus className="mr-1 h-3 w-3" />
                          资产库
                        </Button>
                      </div>
                      <Textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="描述你想要的图像效果..."
                        // 2026-08-23：rows 8 → 12，再抬一档；用户连续两次反馈高度太小
                        rows={12}
                        className="text-xs resize-none"
                      />
                      {modelConfig.capabilities.supportsNegativePrompt && (
                        <Textarea
                          value={negativePrompt}
                          onChange={(e) => setNegativePrompt(e.target.value)}
                          placeholder="反向提示词（可选）"
                          // 2026-08-23：rows 4 → 6
                          rows={6}
                          className="text-xs resize-none"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ============ 输出参数（合并模型 + 尺寸 + 数量）============ */}
            <div className="py-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="flex items-center gap-2 text-xs font-medium flex-1">
                  <Settings2 className="h-3.5 w-3.5 text-primary" />
                  <span>输出</span>
                  <span className="ml-auto text-[11px] text-muted-foreground font-normal font-mono">
                    {(() => {
                      const tplCandidateCount = useTemplate
                        ? (selectedTemplate?.candidateCount ?? 1)
                        : 1;
                      if (tplCandidateCount === 4 || tplCandidateCount === 9) {
                        return "1 张拼接";
                      }
                      return `${batchSize} 张`;
                    })()}
                  </span>
                </span>
              </div>
              <div className="space-y-3">
                {/* 模型 */}
                <Select
                  value={selectedModel}
                  onValueChange={(v) => setSelectedModel(v as ImageModelId)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    {IMAGE_MODEL_LIST.filter((m) => m.status === "active").map(
                      (m) => (
                        <SelectItem
                          key={m.id}
                          value={m.id}
                          disabled={!m.isAvailable}
                          className="text-xs"
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{
                                backgroundColor: m.isAvailable
                                  ? m.color
                                  : "transparent",
                                border: !m.isAvailable
                                  ? `1.5px dashed ${m.color}`
                                  : undefined,
                              }}
                            />
                            <span>{m.name}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {m.currency === "CNY" ? "¥" : "$"}
                              {m.pricePerImage}
                            </span>
                          </span>
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* 底部：生成按钮 + 高级齿轮入口（工作台不扣积分） */}
          <div className="p-3 border-t bg-muted/30 flex items-center gap-2">
            <Button
              onClick={handleGenerate}
              disabled={
                generating ||
                // 上传模式 + 还在上传/上传失败：禁用按钮，避免把 blob URL 提交给服务端
                (refMode === "upload" &&
                  uploadedImage !== null &&
                  (uploadedImage.uploading !== null ||
                    !uploadedImage.publicUrl))
              }
              className="flex-1 bg-gradient-to-r from-primary to-primary/80 hover:from-primary hover:to-primary/70 shadow-lg shadow-primary/20"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  生成中...
                </>
              ) : refMode === "upload" &&
                uploadedImage !== null &&
                uploadedImage.uploading !== null ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  上传参考图中…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  生成 {(() => {
                    const tplCandidateCount = useTemplate
                      ? (selectedTemplate?.candidateCount ?? 1)
                      : 1;
                    if (tplCandidateCount === 4 || tplCandidateCount === 9) {
                      return `1 张拼接图`;
                    }
                    return `${batchSize} 张`;
                  })()}
                </>
              )}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0 relative"
                  title="高级参数"
                >
                  <Settings2 className="h-4 w-4" />
                  {(guidanceScale !== 7 ||
                    steps !== 30 ||
                    seed !== "" ||
                    !safetyCheck ||
                    size !== "1024x1024" ||
                    batchSize !== 1 ||
                    quality !== "auto" ||
                    transparentBackground ||
                    autoStitch) && (
                    <span
                      className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-500"
                      title="已修改默认"
                    />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="top"
                className="w-72 max-h-[70vh] space-y-3 overflow-y-auto"
              >
                <p className="text-xs font-semibold">高级参数</p>

                {/* 2026-08-25：自动拼接宫格图 —— 提到 Popover 最顶部的"生成选项"
                 * 分组。之前塞在 9 个区块最末尾，用户很难找到；现在和尺寸 /
                 * 数量 / 质量同级，作为"生成结果如何呈现"的开关优先展示。
                 * - 仅 batchSize ≥ 2 时生效（模板宫格 candidateCount=4/9 不受影响）
                 * - 开启后右侧结果区单张宫格大图展示，标题徽章显示"自动拼接" */}
                <div className="rounded-md border bg-muted/40 px-2.5 py-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Grid3x3 className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="text-xs font-semibold">
                        自动拼接宫格图
                      </span>
                    </div>
                    <Switch
                      checked={autoStitch}
                      onCheckedChange={setAutoStitch}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground/80 leading-snug">
                    多张结果自动拼成一张宫格大图（仅 batchSize ≥ 2 时生效）
                  </p>
                </div>

                <div className="border-t border-border/50" />
                {modelConfig.capabilities.supportsGuidance && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">CFG</span>
                      <span className="font-mono">{guidanceScale}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      step={0.5}
                      value={guidanceScale}
                      onChange={(e) => setGuidanceScale(Number(e.target.value))}
                      className="w-full accent-primary h-1"
                    />
                  </div>
                )}
                {modelConfig.capabilities.maxInferenceSteps > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">推理步数</span>
                      <span className="font-mono">{steps}</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={modelConfig.capabilities.maxInferenceSteps}
                      value={steps}
                      onChange={(e) => setSteps(Number(e.target.value))}
                      className="w-full accent-primary h-1"
                    />
                  </div>
                )}
                {modelConfig.capabilities.supportsSeed && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      种子
                    </span>
                    <input
                      type="number"
                      value={seed}
                      onChange={(e) =>
                        setSeed(
                          e.target.value === "" ? "" : Number(e.target.value)
                        )
                      }
                      placeholder="随机"
                      className="flex-1 h-7 text-xs rounded border bg-background px-2"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={handleRandomSeed}
                      title="随机种子"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                {modelConfig.capabilities.supportsSafetyCheck && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      安全检查
                    </span>
                    <Switch
                      checked={safetyCheck}
                      onCheckedChange={setSafetyCheck}
                    />
                  </div>
                )}

                {/* 2026-08-21：与 V2 ImageSettingsPanel 对齐，尺寸 / 数量 / 质量 / 透明背景放进高级参数。
                 * - size: 当前 model 支持的所有尺寸（含 AspectIcon），V2 风格卡片（h-[72px]，icon 在上 label 在下）
                 * - batchSize: 1~maxBatchSize，宫格拼接模板（4/9）时锁定为 1
                 * - quality: auto/high/medium/low（auto 不透传给上游）
                 * - transparentBackground: 开启后提交时 background="transparent"
                 * 标记"已修改默认"小红点：当 size/batchSize 非默认 || quality !== "auto" || transparentBackground 时点亮 */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    尺寸
                  </span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {ALL_IMAGE_SIZES.map((s) => {
                      const selected = size === s;
                      const [w, h] = parseImageSize(s);
                      const AspectIcon = getAspectIcon(s);
                      // 1:1 同时存在 1024x1024 / 2048x2048 两个 entry，
                      // 单显示 "1:1" 用户分不清。补一行分辨率副标题。
                      const subtitle =
                        w === h
                          ? w >= 2048
                            ? "2K"
                            : w >= 1024
                              ? "1K"
                              : `${w}²`
                          : null;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSize(s)}
                          title={`${s} (${w}:${h})`}
                          className={cn(
                            "flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-xs transition",
                            selected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-muted-foreground/50"
                          )}
                        >
                          <AspectIcon className="h-4 w-4" strokeWidth={2} />
                          <span className="font-mono">
                            {w === h ? "1:1" : `${w}:${h}`}
                          </span>
                          {subtitle && (
                            <span className="text-[9px] text-muted-foreground/70 font-mono leading-none">
                              {subtitle}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 数量 stepper（宫格拼接模板锁定 1，否则 1~maxBatchSize） */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    数量
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      disabled={
                        (useTemplate &&
                          (selectedTemplate?.candidateCount === 4 ||
                            selectedTemplate?.candidateCount === 9)) ||
                        batchSize <= 1
                      }
                      onClick={() => setBatchSize(Math.max(1, batchSize - 1))}
                      aria-label="减少数量"
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="text-sm font-mono w-8 text-center tabular-nums">
                      {useTemplate &&
                      (selectedTemplate?.candidateCount === 4 ||
                        selectedTemplate?.candidateCount === 9)
                        ? 1
                        : batchSize}
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      disabled={
                        (useTemplate &&
                          (selectedTemplate?.candidateCount === 4 ||
                            selectedTemplate?.candidateCount === 9)) ||
                        batchSize >= modelConfig.capabilities.maxBatchSize
                      }
                      onClick={() =>
                        setBatchSize(
                          Math.min(
                            modelConfig.capabilities.maxBatchSize,
                            batchSize + 1
                          )
                        )
                      }
                      aria-label="增加数量"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {useTemplate &&
                      (selectedTemplate?.candidateCount === 4 ||
                        selectedTemplate?.candidateCount === 9)
                        ? "宫格拼接已锁定"
                        : `最多 ${modelConfig.capabilities.maxBatchSize} 张`}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">
                    质量
                  </span>
                  <div className="grid grid-cols-4 gap-1">
                    {(
                      [
                        { value: "auto", label: "自动" },
                        { value: "high", label: "高" },
                        { value: "medium", label: "中" },
                        { value: "low", label: "低" },
                      ] as const
                    ).map((opt) => {
                      const selected = quality === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setQuality(opt.value)}
                          className={cn(
                            "py-1 rounded border transition-all text-[10px]",
                            selected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-muted-foreground/50"
                          )}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <span className="text-[11px] text-muted-foreground">
                      透明背景
                    </span>
                    <p className="text-[10px] text-muted-foreground/70">
                      生成 PNG 透明背景图（仅部分模型/尺寸支持）
                    </p>
                  </div>
                  <Switch
                    checked={transparentBackground}
                    onCheckedChange={setTransparentBackground}
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </aside>

        {/* ============ 右侧：结果展示 ============ */}
        <main className="flex-1 flex flex-col bg-card border rounded-lg overflow-hidden min-w-0">
          <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold">生成结果</h2>
              {selectedEffect && (
                <Badge variant="outline" className="text-[10px] font-mono">
                  {selectedEffect.effectId}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {/* 外部生图入口：放在结果区头部 action 区，hover 弹 Popover 显示
               * 完整链接 / 复制按钮。不再横在页面顶部 —— 它是边缘功能，
               * 不该跟工作台主功能抢纵向空间。 */}
              <ExternalImageGenCard />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {selectedEffect ? (
              selectedEffect.status === "draft" ? (
                /* 新会话草稿：还没生成过，仅给一个简短的开始提示 + 当前模型 */
                <div className="h-full flex flex-col items-center justify-center text-center px-6 relative overflow-hidden">
                  <div className="absolute inset-0 flex items-center justify-center opacity-50 pointer-events-none">
                    <div className="h-72 w-72 rounded-full bg-gradient-to-br from-primary/25 via-primary/10 to-primary/5 blur-3xl" />
                  </div>
                  <div className="relative flex flex-col items-center gap-4">
                    <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-2xl shadow-primary/20">
                      <Plus className="h-12 w-12 text-white" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl font-bold">新会话</h3>
                      <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                        在左侧配置参数，然后点击「生成」按钮开始创作
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: modelConfig.color }}
                      />
                      当前模型：{modelConfig.name}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 状态栏 —— Lovart 风：单个统一 pill + 右上角刷新 */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    {(() => {
                      const sc = STATUS_CONFIG[selectedEffect.status];
                      const Icon = sc.icon;
                      const durationSec =
                        selectedEffect.duration && selectedEffect.duration > 0
                          ? `${(selectedEffect.duration / 1000).toFixed(1)}s`
                          : null;
                      return (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            sc.bg,
                            sc.color
                          )}
                        >
                          <Icon
                            className={cn(
                              "h-3 w-3",
                              selectedEffect.status === "processing" &&
                                "animate-spin"
                            )}
                          />
                          <span>{sc.label}</span>
                          <span className="text-muted-foreground/60">·</span>
                          <span
                            className="inline-flex items-center gap-1"
                            style={{ color: modelConfig.color }}
                          >
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: modelConfig.color }}
                            />
                            {selectedEffect.imageModelName}
                          </span>
                          <span className="text-muted-foreground/60">·</span>
                          <span className="text-muted-foreground">
                            {selectedEffect.mode === "text_to_image"
                              ? "文生图"
                              : "图生图"}
                          </span>
                          {durationSec && (
                            <>
                              <span className="text-muted-foreground/60">
                                ·
                              </span>
                              <span className="text-muted-foreground font-mono">
                                {durationSec}
                              </span>
                            </>
                          )}
                        </span>
                      );
                    })()}
                    {selectedEffect.status === "processing" &&
                      selectedEffect.jobId && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs"
                          disabled={refreshing}
                          onClick={async () => {
                            if (!selectedEffect.jobId) return;
                            setRefreshing(true);
                            try {
                              const job = await pollImageJob(
                                selectedEffect.jobId
                              );
                              if (job) {
                                applyJobUpdate(selectedEffect.effectId, job);
                              }
                            } catch (err) {
                              toast.error(
                                err instanceof Error ? err.message : "刷新失败"
                              );
                            } finally {
                              setRefreshing(false);
                            }
                          }}
                        >
                          {refreshing ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3 mr-1" />
                          )}
                          刷新状态
                        </Button>
                      )}
                  </div>

                  {/* 结果展示：按 submissions 数组逐条渲染时间轴节点
                   *
                   * 关键 UX：每次提交都是时间轴上独立的一行 —— 已完成的 submission
                   * 永远不被新提交覆盖。2026-08-23 改：用户反馈 timeline 倒序看着
                   * 费力（ChatGPT 那种"消息累积"不符合生图场景 —— 用户要看的是
                   * "我刚才提交的最新那张"，不是历史堆栈），改为**最新 submission
                   * 渲染在最上面**，老 submission 自然沉到底部。数据数组保持
                   * chronological ASC（jobsToEffects 写入顺序、handleGenerate
                   * append 也走末尾），只在 render 时 `.reverse()` 倒序遍历。
                   *
                   * 节点内：
                   * - completed → 单图大预览 / 多图网格（hover 高亮 + 点击大图）
                   * - processing → spinner 占位（不霸占整个区域，不影响其它节点）
                   * - failed → 红框 + 错误信息 + 「重试」按钮
                   *
                   * 历史兼容：如果 effect 没有 submissions（旧 effect / hydrate 还没
                   * 升级的数据），回退到 effect.resultUrls 单节点展示。
                   */}
                  <div className="space-y-3">
                    {(() => {
                      const subs = selectedEffect.submissions ?? [];
                      // hydrate fallback 1：submissions 为空 + 有 resultUrls
                      // → 视为一条 completed submission（DB 单行映射）
                      if (
                        subs.length === 0 &&
                        selectedEffect.resultUrls.length > 0
                      ) {
                        return (
                          <SubmissionNode
                            effectId={selectedEffect.effectId}
                            submission={{
                              submissionId: "legacy",
                              status: "completed",
                              resultUrls: selectedEffect.resultUrls,
                              createdAt: selectedEffect.createdAt,
                              ...(selectedEffect.isGridComposite
                                ? { isGridComposite: true }
                                : {}),
                              ...(selectedEffect.isStitched
                                ? { isStitched: true }
                                : {}),
                              ...(selectedEffect.duration
                                ? { duration: selectedEffect.duration }
                                : {}),
                              prompt: selectedEffect.prompt,
                            }}
                            onLightbox={(url, idx) =>
                              setLightbox({
                                url,
                                effectId: selectedEffect.effectId,
                                index: idx,
                              })
                            }
                          />
                        );
                      }
                      // hydrate fallback 2：submissions 为空 + effect 是 processing 状态
                      // → 视为一条 processing submission（处理中的 DB 单行映射）。
                      // 配合 mount useEffect 的 setSelectedEffect 默认选中，
                      // 刷新页面后右侧时间轴能立刻看到 spinner + "生成中"，
                      // 而不是空白（用户报告"刷新页面导致任务无法显示"补这一刀）。
                      if (
                        subs.length === 0 &&
                        selectedEffect.status === "processing"
                      ) {
                        return (
                          <SubmissionNode
                            effectId={selectedEffect.effectId}
                            submission={{
                              submissionId: "hydrated-processing",
                              status: "processing",
                              resultUrls: [],
                              createdAt: selectedEffect.createdAt,
                              ...(selectedEffect.isGridComposite
                                ? { isGridComposite: true }
                                : {}),
                              prompt: selectedEffect.prompt,
                            }}
                            onLightbox={(url, idx) =>
                              setLightbox({
                                url,
                                effectId: selectedEffect.effectId,
                                index: idx,
                              })
                            }
                          />
                        );
                      }
                      return [...subs].reverse().map((sub) => (
                        <SubmissionNode
                          key={sub.submissionId}
                          effectId={selectedEffect.effectId}
                          submission={sub}
                          {...(selectedEffect.duration
                            ? { effectDuration: selectedEffect.duration }
                            : {})}
                          onLightbox={(url, idx) =>
                            setLightbox({
                              url,
                              effectId: selectedEffect.effectId,
                              index: idx,
                            })
                          }
                          onRetry={handleGenerate}
                        />
                      ));
                    })()}
                  </div>
                </div>
              )
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 relative overflow-hidden">
                {/* Lovart 风：背景渐变光晕 + 居中大图标 */}
                <div className="absolute inset-0 flex items-center justify-center opacity-50 pointer-events-none">
                  <div className="h-72 w-72 rounded-full bg-gradient-to-br from-primary/25 via-primary/10 to-primary/5 blur-3xl" />
                </div>
                <div className="relative flex flex-col items-center gap-4">
                  <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-2xl shadow-primary/20">
                    <Sparkles className="h-12 w-12 text-white" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold">开始你的第一次生成</h3>
                    <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                      在左侧选择参考图与提示词模板，点击「生成」按钮开始创作
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      1
                    </kbd>
                    <span>选参考</span>
                    <span className="text-muted-foreground/40">→</span>
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      2
                    </kbd>
                    <span>写提示</span>
                    <span className="text-muted-foreground/40">→</span>
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      3
                    </kbd>
                    <span>生成</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ============ Lightbox 放大查看 ============
       * 用 shadcn Dialog 全屏显示选中的结果图：最大化、Esc 关闭、点击背景关闭。
       * 顶部右上角的 X 已由 DialogContent 自带。
       * 底部提供「下载」「复制链接」两个常用动作的副本（与 hover 工具栏一致），
       * 让用户在全屏下也能直接动手，不用来回切回去 hover 小图。
       */}
      <Dialog
        open={lightbox !== null}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
      >
        <DialogContent
          className="max-w-[min(96vw,1400px)] w-auto h-auto max-h-[92vh] p-0 bg-transparent border-none shadow-none flex flex-col items-center gap-2"
          overlayClassName="bg-black/90"
        >
          {lightbox && (
            <>
              <DialogTitle className="sr-only">
                放大查看 {lightbox.index + 1}
              </DialogTitle>
              {/* biome-ignore lint/performance/noImgElement: 原生 img 性能 + 原图尺寸 */}
              <img
                src={lightbox.url}
                alt={`结果 ${lightbox.index + 1}`}
                className="block max-w-full max-h-[80vh] object-contain rounded-md shadow-2xl"
              />
              <div className="flex items-center gap-2 text-white">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs gap-1.5"
                  disabled={
                    busyKey ===
                    `dl-lightbox-${lightbox.effectId}-${lightbox.index}`
                  }
                  onClick={async () => {
                    if (!selectedEffect) return;
                    const key = `dl-lightbox-${lightbox.effectId}-${lightbox.index}`;
                    setBusyKey(key);
                    try {
                      await downloadImage(
                        lightbox.url,
                        buildDownloadFilename(
                          selectedEffect,
                          lightbox.url,
                          lightbox.index
                        )
                      );
                      toast.success("已下载");
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : "下载失败"
                      );
                    } finally {
                      setBusyKey(null);
                    }
                  }}
                >
                  {busyKey ===
                  `dl-lightbox-${lightbox.effectId}-${lightbox.index}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  下载
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 text-xs gap-1.5"
                  disabled={
                    busyKey ===
                    `share-lightbox-${lightbox.effectId}-${lightbox.index}`
                  }
                  onClick={async () => {
                    const key = `share-lightbox-${lightbox.effectId}-${lightbox.index}`;
                    setBusyKey(key);
                    try {
                      if (
                        !navigator.clipboard ||
                        !navigator.clipboard.writeText
                      ) {
                        throw new Error("当前浏览器不支持剪贴板 API");
                      }
                      await navigator.clipboard.writeText(lightbox.url);
                      toast.success("链接已复制");
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : "复制失败"
                      );
                    } finally {
                      setBusyKey(null);
                    }
                  }}
                >
                  {busyKey ===
                  `share-lightbox-${lightbox.effectId}-${lightbox.index}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Share2 className="h-3.5 w-3.5" />
                  )}
                  复制链接
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ============ 参考图预览 Dialog ============
       * 用户点击左侧上传/库选的小缩略图才打开。
       * 全屏查看、Esc/点背景关闭 —— 与 Lightbox 同形态。
       */}
      <Dialog
        open={refPreview !== null}
        onOpenChange={(open) => {
          if (!open) setRefPreview(null);
        }}
      >
        <DialogContent className="max-w-4xl p-2 bg-transparent border-none shadow-none">
          <DialogTitle className="sr-only">
            {refPreview?.name ?? "参考图预览"}
          </DialogTitle>
          {refPreview && (
            // biome-ignore lint/performance/noImgElement: 全屏预览原生 img
            <img
              src={refPreview.url}
              alt={refPreview.name}
              className="w-full h-auto max-h-[85vh] object-contain rounded-lg"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 提示词库 —— 三 Tab：外部源 / 模板库（DB）/ 我的提示词（localforage） */}
      <PromptSelectDialog
        open={promptDialogOpen}
        onOpenChange={setPromptDialogOpen}
        onSelect={(text) => setPrompt(text)}
      />

      {/* 资产库 —— 两 Tab：我的资产（localforage）/ 我的图片（DB photo 表） */}
      <AssetPickerModal
        open={assetPickerOpen}
        onInsert={handleInsertAsset}
        onClose={() => setAssetPickerOpen(false)}
      />

      {/* 收藏当前提示词 —— 写 useMyPromptStore（与 V2 同形态） */}
      <SavePromptModal
        open={savePromptOpen}
        prompt={prompt}
        onClose={() => setSavePromptOpen(false)}
        onConfirm={handleConfirmSavePrompt}
      />
    </>
  );
}

/**
 * 收藏当前提示词的对话框 —— antd Modal + Input。
 * 形态与 V2 image-workbench.tsx 的同名组件保持一致：用户填标题（必填），存到
 * useMyPromptStore。这里独立定义而不是从 V2 导入，是因为 V2 那个是 image-workbench
 * 的内部函数，未导出。逻辑短，复制比跨模块 export 更简单。
 */
function SavePromptModal({
  open,
  prompt,
  onClose,
  onConfirm,
}: {
  open: boolean;
  prompt: string;
  onClose: () => void;
  onConfirm: (title: string) => void;
}) {
  const { message } = App.useApp();
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!open) setTitle("");
  }, [open]);

  const handleOk = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      message.warning("请输入标题");
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <Modal
      title="收藏当前提示词"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
      width={520}
    >
      <div className="space-y-3 py-2">
        <AntdInput
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onPressEnter={handleOk}
          placeholder="给提示词起个名字"
          maxLength={64}
          autoFocus
        />
        <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-stone-400">
            提示词
          </div>
          <p className="line-clamp-6 whitespace-pre-wrap break-words">
            {prompt || "—"}
          </p>
        </div>
      </div>
    </Modal>
  );
}

/**
 * 单个 submission 的时间轴节点。
 *
 * 三种状态分别走不同 layout：
 * - processing：左圆点 + spinner + "生成中" 标签 —— 不占满区域、不影响其他节点
 * - completed：左圆点 + 节点头部（数量 + 绝对时间） + 单图/网格缩略图
 * - failed：左红圆点 + 错误信息 + 重试按钮
 *
 * 圆点 + 节点布局与时间轴主视图一致；每个节点独立、不抢空间。
 */
function SubmissionNode({
  effectId: _effectId,
  submission,
  effectDuration,
  onLightbox,
  onRetry,
}: {
  effectId: string;
  submission: WorkbenchSubmission;
  /**
   * 兜底耗时：本次 submission 没记录 duration 时（迁移前 / 老数据 / applyJobUpdate
   * 还没跑到的那条），从 effect 级 duration 顶上。effect.duration 是 effect
   * 内最近一次 job 的耗时，对绝大多数老 submission 是合理近似。
   */
  effectDuration?: number;
  onLightbox: (url: string, index: number) => void;
  onRetry?: () => void;
}) {
  const {
    status,
    resultUrls,
    stitchedUrl,
    createdAt,
    errorMsg,
    isGridComposite,
    isStitched,
    duration,
  } = submission;
  // submission 自身 duration 优先；缺失则降级到 effect 级 duration。
  const displayDuration = duration ?? effectDuration;

  if (status === "processing") {
    return (
      <div className="relative pl-5">
        <div className="absolute left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card animate-pulse" />
        <div className="flex items-center gap-2 mb-2 text-[11px]">
          <Loader2 className="h-3 w-3 text-primary animate-spin" />
          <span className="font-medium text-primary">生成中…</span>
          <span className="text-muted-foreground/40">·</span>
          <span className="font-mono text-muted-foreground tabular-nums">
            {formatAbsoluteTime(createdAt)}
          </span>
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-6 flex items-center gap-3">
          <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
          <div className="space-y-0.5">
            <p className="text-xs font-medium">AI 正在生成中</p>
            <p className="text-[10px] text-muted-foreground">
              之前的图仍然可见，本次提交追加在时间轴末尾
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="relative pl-5">
        <div className="absolute left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-card" />
        <div className="flex items-center gap-2 mb-2 text-[11px]">
          <XCircle className="h-3 w-3 text-rose-500" />
          <span className="font-medium text-rose-700 dark:text-rose-400">
            失败
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="font-mono text-muted-foreground tabular-nums">
            {formatAbsoluteTime(createdAt)}
          </span>
        </div>
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 flex items-start gap-3">
          <div className="space-y-1.5 flex-1 min-w-0">
            <p className="text-xs font-medium text-rose-700 dark:text-rose-400">
              生成失败
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed break-all">
              {errorMsg ?? "未知错误，请稍后重试"}
            </p>
          </div>
          {onRetry && (
            <Button
              size="sm"
              variant="outline"
              className="border-rose-500/30 text-rose-700 hover:bg-rose-500/5 h-7 px-2.5 text-xs"
              onClick={onRetry}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              重试
            </Button>
          )}
        </div>
      </div>
    );
  }

  // completed（含 legacy fallback —— status 不在 processing/failed 时统一按 completed 处理）
  return (
    <div className="relative pl-5">
      <div className="absolute left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
      <div className="flex items-center gap-2 mb-2 text-[11px]">
        {isStitched ? (
          <span className="font-mono font-semibold">
            宫格大图 · {resultUrls.length} 张原图
          </span>
        ) : (
          <span className="font-mono font-semibold">
            共 {resultUrls.length} 张
          </span>
        )}
        <span className="text-muted-foreground/40">·</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          {formatAbsoluteTime(createdAt)}
        </span>
        {displayDuration && displayDuration > 0 && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span
              className="inline-flex items-center gap-1 font-mono text-muted-foreground tabular-nums"
              title="本次生成耗时"
            >
              <Timer className="h-3 w-3" />
              {(displayDuration / 1000).toFixed(1)}s
            </span>
          </>
        )}
        {isStitched ? (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span
              className="inline-flex items-center gap-1 text-primary"
              title="已自动拼接为宫格大图"
            >
              <Sparkles className="h-3 w-3" />
              自动拼接
            </span>
          </>
        ) : isGridComposite ? (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="inline-flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" />
              宫格拼接
            </span>
          </>
        ) : null}
      </div>

      {/* isStitched + stitchedUrl 分支（2026-08-28 改成只渲染 composite）：
       * 用户反复强调"自动拼接是多张图拼接成一张宫格图"——之前
       * composite + N 张原图共存的设计虽然保留了单张访问入口，但
       * 与"自动拼接"的定义冲突：composite 已经把所有原图缝合成 1 张
       * 宫格图，再在下方展示 N 张独立图就成了"又分开成多个独立图"。
       * 现在 stitched 时只渲染 1 张 composite 宫格大图，不再叠加
       * N 张原图。需要看单张原图就关闭自动拼接开关（走非 stitched
       * 分支的 flex 80px 缩略图），或点开 lightbox 放大看 composite。
       *
       * 非 stitched 分支（2026-08-28 用户原话"水平排列即可，一行放不下
       * 才换行"）走 `flex max-w-[360px] flex-wrap gap-2`，每张 80px 方形
       * cell，1-4 张一行，5+ 换行。 */}
      {isStitched && stitchedUrl ? (
        <button
          type="button"
          onClick={() => onLightbox(stitchedUrl, 0)}
          className="group relative block w-full max-w-[360px] overflow-hidden rounded-lg border bg-muted hover:border-primary/60 transition-colors"
          title="点击查看宫格大图"
        >
          {/* biome-ignore lint/performance/noImgElement: timeline 拼接大图 */}
          <img
            src={thumbnailUrl(stitchedUrl, 720)}
            alt="宫格拼接大图"
            className="block w-full h-auto transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm text-white text-[9px] font-medium leading-none">
            <Grid3x3 className="h-2.5 w-2.5" />
            宫格
          </span>
        </button>
      ) : (
        /* 单次生成的多张图:水平 flex-wrap,1-4 张一行,5+ 换行(2026-08-28)。
         * 非 stitched 分支走 80px 方形 cell,简短访问入口。 */
        <div className="flex max-w-[360px] flex-wrap gap-2">
          {resultUrls.map((url, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: 一次提交内的图按生成顺序
              key={i}
              type="button"
              onClick={() => onLightbox(url, i)}
              className="group relative h-[80px] w-[80px] shrink-0 overflow-hidden rounded-lg border bg-muted hover:border-primary/60 transition-colors"
              title={
                resultUrls.length === 1
                  ? "点击查看大图"
                  : `第 ${i + 1} 张 · 点击查看大图`
              }
            >
              {/* biome-ignore lint/performance/noImgElement: timeline 缩略图 */}
              <img
                src={thumbnailUrl(url, 228)}
                alt={resultUrls.length === 1 ? "生成结果" : `结果 ${i + 1}`}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                loading="lazy"
              />
              {resultUrls.length > 1 && (
                <span className="absolute bottom-1 left-1 bg-black/60 backdrop-blur-sm text-white text-[9px] px-1 py-0.5 rounded font-mono leading-none opacity-0 group-hover:opacity-100 transition-opacity">
                  #{i + 1}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
