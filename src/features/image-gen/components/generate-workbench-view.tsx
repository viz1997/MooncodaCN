"use client";

/**
 * 生图工作台 - 仿 Mooncada 设计
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
  CheckCircle2,
  Clock,
  Download,
  Image as ImageIcon,
  Library,
  Loader2,
  Minus,
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
  Upload,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import type { PromptTemplateView } from "@/features/gpt-image/lib/types";
import {
  generateImageAction,
  listImageJobsAction,
  listPhotosAction,
} from "@/features/image-gen/actions";
import type {
  ImageModelId,
  ImageSize,
} from "@/features/image-gen/lib/image-models/types";
import {
  IMAGE_MODEL_LIST,
  IMAGE_MODELS,
} from "@/features/image-gen/lib/image-models/types";
import { ExternalImageGenCard } from "@/features/image-gen/components/external-image-gen-card";
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
  /** 该次提交的 prompt（与 effect 主 prompt 可能不同 —— 用户连续微调时） */
  prompt: string;
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

function toWorkbenchEffect(job: ImageJob): WorkbenchEffect {
  const modelConfig = IMAGE_MODELS[job.model as ImageModelId];
  return {
    effectId: `job_${job.id.slice(0, 8)}`,
    jobId: job.id,
    // exactOptionalPropertyTypes 下不能写 `key: undefined`，要么省略要么改类型
    ...(job.taskId ? { taskId: job.taskId } : {}),
    prompt: job.prompt,
    maskId: job.maskId ?? "CUSTOM",
    maskName: job.maskId ?? "自定义",
    status: job.status,
    resultUrls: (job.resultUrls as string[]) ?? [],
    mode: job.mode as "text_to_image" | "image_to_image",
    imageModel: job.model as ImageModelId,
    imageModelName: modelConfig?.name ?? job.model,
    createdAt: job.createdAt.toISOString(),
    ...(job.errorMsg ? { errorMsg: job.errorMsg } : {}),
  };
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
 * 失败语义：throw 让调用方 toast 报错；不静默吞（否则用户以为下载成功但没拿到）。
 */
async function downloadImage(url: string, filename: string): Promise<void> {
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
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  // 提示词模板开关
  const [useTemplate, setUseTemplate] = useState(true);

  // 模型与提示词模板（Phase C：mask → template 语义重命名，但 selectedMask 状态名保留
  // 以兼容 WorkbenchEffect.maskId 字段与 generateImageAction({ maskId }) 调用）
  // 默认 gpt_image_2：唯一支持 batchSize>1 的真实接入模型，工作台主推。
  const [selectedModel, setSelectedModel] =
    useState<ImageModelId>("gpt_image_2");
  const activeTemplates = templates.filter((t) => t.isActive);
  const [selectedMask, setSelectedMask] = useState<string>(
    activeTemplates[0]?.id ?? ""
  );
  // 模板变量取值
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // 基础参数
  const [batchSize, setBatchSize] = useState(1);
  const [size, setSize] = useState<ImageSize>("1024x1024");

  // 高级参数（Accordion 默认折叠，无需本地 state）
  const [guidanceScale, setGuidanceScale] = useState(7);
  const [steps, setSteps] = useState(30);
  const [seed, setSeed] = useState<number | "">("");
  const [safetyCheck, setSafetyCheck] = useState(true);

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
  const selectedTemplate = activeTemplates.find((t) => t.id === selectedMask);
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
        const hydrated: WorkbenchEffect[] = jobs.map(toWorkbenchEffect);
        setHistory((prev) => mergeHydratedHistory(prev, hydrated));
        // 给残留的 processing job 续轮询
        for (const eff of hydrated) {
          if (eff.status === "processing" && eff.jobId) {
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
  const applyJobUpdate = (effectId: string, job: ImageJob) => {
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

      const next: WorkbenchEffect = {
        ...eff,
        // 仅在 effect 主 effect 是 processing 时一起刷成 completed（最后一条
        // submission 完成 → effect 也算完成）。如果有 pending submission 保持 processing。
        status: hasUnfinishedSubmission(eff)
          ? "processing"
          : "completed",
        resultUrls,
        ...duration,
        ...cost,
        submissions: (eff.submissions ?? []).map((s, i) =>
          i === targetSubmissionIdx
            ? {
                ...s,
                status: "completed",
                resultUrls,
              }
            : s
        ),
      };
      setHistory((prev) =>
        prev.map((e) => (e.effectId === effectId ? next : e))
      );
      setSelectedEffect((prev) =>
        prev?.effectId === effectId ? next : prev
      );
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
   * effect 是否还有未结束的 submission（用于决定 effect 自身 status）
   */
  function hasUnfinishedSubmission(eff: WorkbenchEffect): boolean {
    return (eff.submissions ?? []).some(
      (s) => s.status === "processing" || s.status === "pending"
    );
  }
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
    // 复用条件：当前选中的是 processing/completed/failed 真实会话（非 draft），
    // 且 model / mode / mask（模板）全部一致。draft / 不一致 / 没有当前会话 →
    // 新建会话。ChatGPT 风格 —— 同一对话内连续提问不强制开新 chat。
    //
    // 为什么不强制每次新建：用户连续"再来一张""微调 prompt 再试"时，强行
    // 开新会话会把历史时间轴撑得很乱，与主流生图平台 UX 不符。
    const canAppendToCurrent =
      selectedEffect &&
      selectedEffect.status !== "draft" &&
      selectedEffect.imageModel === selectedModel &&
      selectedEffect.mode === generationMode &&
      (selectedEffect.maskId || "CUSTOM") === (selectedMask || "CUSTOM");

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
    if (canAppendToCurrent && selectedEffect) {
      // 复用：保留 effect 主结构，把新 submission 追加到 submissions 列表
      // 时间戳刷成最新，effect 自身 status 保持上一次的状态（不影响旧结果展示）
      const existingSubs = selectedEffect.submissions ?? [];
      newEffect = {
        ...selectedEffect,
        createdAt: submissionTs,
        status: "processing", // effect 状态跟随最新提交
        prompt: finalPrompt, // prompt 用最新的
        submissions: [...existingSubs, newSubmission],
      };
      setHistory((prev) =>
        prev.map((e) =>
          e.effectId === selectedEffect.effectId ? newEffect : e
        )
      );
    } else {
      newEffect = {
        effectId: `EF_${String(Date.now()).slice(-6)}`,
        prompt: finalPrompt,
        // maskId 字段名保留以兼容 generateImageAction / imageJob.maskId 列；
        // 实际值是 promptTemplate.id。
        maskId: selectedMask || "CUSTOM",
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
        seed: seed === "" ? undefined : seed,
        guidanceScale: modelConfig.capabilities.supportsGuidance
          ? guidanceScale
          : undefined,
        numInferenceSteps:
          modelConfig.capabilities.maxInferenceSteps > 0 ? steps : undefined,
        enableSafetyCheck: safetyCheck,
        maskId: selectedMask || undefined,
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
          const isLatest =
            i === (newEffect.submissions ?? []).length - 1;
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
   */
  const handleNewSession = () => {
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

  // 模板可用尺寸（与模型能力交集）
  const availableSizes: ImageSize[] = modelConfig.capabilities.sizes;

  // 抑制未使用变量告警
  void legacyToast;

  return (
    <>
      <div className="flex h-[calc(100vh-8rem)] gap-4">
        {/* ============ 左侧：参数面板 ============ */}
        <aside className="w-[380px] shrink-0 flex flex-col bg-card border rounded-lg overflow-hidden">

          {/*
            精简布局 —— Kimi/DeepSeek/GPT 式：
            - 三个 Accordion：参考图 / 提示词 / 输出
            - 高级参数折叠到一个右上角「⚙️」按钮弹出的 Popover
            - 标签去 chip / 去「必选」「已覆盖」冗余 badge
            - Accordion trigger 用最小化样式（无 hover background、无图标旋转动画）
          */}
          <Accordion
            type="multiple"
            defaultValue={["ref", "prompt", "output"]}
            className="flex-1 overflow-y-auto px-3"
          >
            {/* ============ 参考图 ============ */}
            <AccordionItem value="ref" className="border-b border-border/40">
              <AccordionTrigger className="hover:no-underline py-2.5 text-xs font-medium [&[data-state=open]>svg]:hidden">
                <span className="flex items-center gap-2">
                  <ImageIcon className="h-3.5 w-3.5 text-primary" />
                  参考图
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground font-normal">
                  {REF_MODE_LABELS[refMode]}
                  {(refMode === "upload" && uploadedImage) ||
                  (refMode === "library" && selectedPhoto)
                    ? " · 已选"
                    : ""}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <div className="space-y-2">
                  <div className="flex gap-0.5 bg-muted rounded p-0.5 w-fit">
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
                          "w-full border border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors",
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
                            "h-5 w-5 mx-auto mb-1.5",
                            dragOver
                              ? "text-primary"
                              : "text-muted-foreground"
                          )}
                        />
                        <p className="text-xs">
                          {dragOver ? "释放即可上传" : "点击或拖拽图片"}
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
                              src={
                                selectedPhoto.thumbnailUrl ??
                                selectedPhoto.fileUrl
                              }
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
                                        src={p.thumbnailUrl ?? p.fileUrl}
                                        alt={p.fileName}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                      />
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
              </AccordionContent>
            </AccordionItem>

            {/* ============ 提示词 ============ */}
            <AccordionItem value="prompt" className="border-b border-border/40">
              <AccordionTrigger className="hover:no-underline py-2.5 text-xs font-medium [&[data-state=open]>svg]:hidden">
                <span className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  提示词
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground font-normal">
                  {useTemplate ? selectedTemplate?.name ?? "模板" : "手动"}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <div className="space-y-2">
                  {/* 模板/手动 toggle */}
                  <div className="flex gap-0.5 bg-muted rounded p-0.5 w-fit">
                    {([
                      { v: true, label: "模板" },
                      { v: false, label: "手动" },
                    ] as const).map((opt) => (
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
                              const selected = tpl.id === selectedMask;
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
                                {(selectedTemplate.variables ?? []).map(
                                  (v) => (
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
                                            paramValues[v.key] ??
                                            v.defaultValue
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
                                  )
                                )}
                              </div>
                            )}
                        </>
                      )}
                    </div>
                  )}

                  {/* 手动模式 */}
                  {!useTemplate && (
                    <div className="space-y-1.5">
                      <Textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="描述你想要的图像效果..."
                        rows={4}
                        className="text-xs resize-none"
                      />
                      {modelConfig.capabilities.supportsNegativePrompt && (
                        <Textarea
                          value={negativePrompt}
                          onChange={(e) => setNegativePrompt(e.target.value)}
                          placeholder="反向提示词（可选）"
                          rows={2}
                          className="text-xs resize-none"
                        />
                      )}
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* ============ 输出参数（合并模型 + 尺寸 + 数量）============ */}
            <AccordionItem value="output" className="border-b-0">
              <AccordionTrigger className="hover:no-underline py-2.5 text-xs font-medium [&[data-state=open]>svg]:hidden">
                <span className="flex items-center gap-2">
                  <Settings2 className="h-3.5 w-3.5 text-primary" />
                  输出
                </span>
                <span className="ml-auto text-[11px] text-muted-foreground font-normal font-mono">
                  {(() => {
                    const [w, h] = parseImageSize(size);
                    return `${w === h ? "1:1" : `${w}:${h}`} · ${(() => {
                      const tplCandidateCount = useTemplate
                        ? (selectedTemplate?.candidateCount ?? 1)
                        : 1;
                      if (
                        tplCandidateCount === 4 ||
                        tplCandidateCount === 9
                      ) {
                        return "1 张拼接";
                      }
                      return `${batchSize} 张`;
                    })()}`;
                  })()}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-3">
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
                      {IMAGE_MODEL_LIST.filter(
                        (m) => m.status === "active"
                      ).map((m) => (
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
                      ))}
                    </SelectContent>
                  </Select>

                  {/* 尺寸 + 数量 横向 */}
                  <div className="flex gap-1.5">
                    <div className="grid grid-cols-4 gap-1 flex-1">
                      {availableSizes.slice(0, 4).map((s) => {
                        const selected = size === s;
                        const [w, h] = parseImageSize(s);
                        const AspectIcon = getAspectIcon(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setSize(s)}
                            title={`${s} (${w}:${h})`}
                            className={cn(
                              "flex items-center justify-center gap-1 py-1.5 rounded border transition-all text-[10px]",
                              selected
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:border-muted-foreground/50"
                            )}
                          >
                            <AspectIcon
                              className="h-3 w-3"
                              strokeWidth={2}
                            />
                            <span className="font-mono">
                              {w === h ? "1:1" : `${w}:${h}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 数量 stepper（Lovart/GPT 风：- 数字 +） */}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      数量
                    </span>
                    {(() => {
                      const tplCandidateCount = useTemplate
                        ? (selectedTemplate?.candidateCount ?? 1)
                        : 1;
                      const isLocked =
                        tplCandidateCount === 4 || tplCandidateCount === 9;
                      const max = modelConfig.capabilities.maxBatchSize;
                      const display = isLocked ? 1 : batchSize;
                      return (
                        <>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            disabled={isLocked || display <= 1}
                            onClick={() => setBatchSize(Math.max(1, display - 1))}
                            aria-label="减少数量"
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="text-sm font-mono w-8 text-center tabular-nums">
                            {display}
                          </span>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-7 w-7"
                            disabled={isLocked || display >= max}
                            onClick={() =>
                              setBatchSize(Math.min(max, display + 1))
                            }
                            aria-label="增加数量"
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {isLocked ? "宫格拼接已锁定" : `最多 ${max} 张`}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

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
                    !safetyCheck) && (
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
                className="w-72 space-y-3"
              >
                <p className="text-xs font-semibold">高级参数</p>
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
                      onChange={(e) =>
                        setGuidanceScale(Number(e.target.value))
                      }
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
                          e.target.value === ""
                            ? ""
                            : Number(e.target.value)
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
                            <span className="text-muted-foreground/60">·</span>
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
                 * 永远不被新提交覆盖，新提交作为新节点追加在末尾。这是 ChatGPT
                 * "消息气泡按时间顺序累积"风格。
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
                    // hydrate fallback：submissions 为空但 effect 有 resultUrls，
                    // 视为一条 completed submission（DB 单行映射）。
                    if (subs.length === 0 && selectedEffect.resultUrls.length > 0) {
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
                    return subs.map((sub) => (
                      <SubmissionNode
                        key={sub.submissionId}
                        effectId={selectedEffect.effectId}
                        submission={sub}
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

        {/* ============ 右侧：会话历史 rail（Lovart 风）============
         * 垂直窄列：顶部「+」新建会话按钮 + 下方可滚动的会话缩略图列表。
         * 历史从主画布底部挪到这里 —— 新会话里就不会再出现旧会话的缩略图，
         * 点哪个会话就进入哪个，符合 Lovart 的"会话即工作流"心智。
         */}
        <aside className="w-[88px] shrink-0 flex flex-col bg-card border rounded-lg overflow-hidden">
          <div className="p-2 border-b bg-muted/30 flex flex-col items-center gap-1">
            <span className="text-[10px] font-medium text-muted-foreground tracking-wide">
              会话
            </span>
            <button
              type="button"
              onClick={handleNewSession}
              className="h-12 w-12 rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/30 hover:bg-muted/60 hover:border-primary/60 flex items-center justify-center transition-all duration-200 hover:scale-105 group"
              title="新建会话"
              aria-label="新建会话"
            >
              <Plus className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
            {history.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-[10px] text-muted-foreground/60 text-center px-1 leading-relaxed">
                点击「+」开始第一次生图
              </div>
            ) : (
              history.map((eff) => {
                const Icon = STATUS_CONFIG[eff.status].icon;
                const isSelected =
                  selectedEffect?.effectId === eff.effectId;
                return (
                  <button
                    key={eff.effectId}
                    type="button"
                    onClick={() => setSelectedEffect(eff)}
                    className={cn(
                      "relative h-12 w-12 rounded-xl overflow-hidden transition-all duration-200 group/sess",
                      isSelected
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-card shadow-md scale-105"
                        : "ring-1 ring-border hover:ring-muted-foreground/40 hover:scale-105"
                    )}
                    title={
                      eff.maskName +
                      (eff.status === "draft"
                        ? ""
                        : ` · ${STATUS_CONFIG[eff.status].label}`)
                    }
                  >
                    {eff.resultUrls[0] ? (
                      // biome-ignore lint/performance/noImgElement: 缩略图用原生 img
                      <img
                        src={eff.resultUrls[0]}
                        alt={eff.maskName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted">
                        <Icon
                          className={cn(
                            "h-4 w-4",
                            STATUS_CONFIG[eff.status].color,
                            eff.status === "processing" && "animate-spin"
                          )}
                        />
                      </div>
                    )}
                    {/* 状态点：右上角小圆点（仅非 completed 才显示） */}
                    {eff.status !== "completed" && (
                      <span
                        className={cn(
                          "absolute top-0.5 right-0.5 h-2 w-2 rounded-full ring-2 ring-card",
                          eff.status === "processing" &&
                            "bg-primary animate-pulse",
                          eff.status === "failed" && "bg-rose-500",
                          eff.status === "pending" && "bg-amber-500",
                          eff.status === "draft" && "bg-primary"
                        )}
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>
          {history.length > 0 && (
            <div className="p-2 border-t bg-muted/30 flex justify-center">
              <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-mono">
                {history.length}
              </Badge>
            </div>
          )}
        </aside>
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
    </>
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
  onLightbox,
  onRetry,
}: {
  effectId: string;
  submission: WorkbenchSubmission;
  onLightbox: (url: string, index: number) => void;
  onRetry?: () => void;
}) {
  const { status, resultUrls, createdAt, errorMsg, isGridComposite } =
    submission;

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
        <span className="font-mono font-semibold">
          共 {resultUrls.length} 张
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          {formatAbsoluteTime(createdAt)}
        </span>
        {isGridComposite && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="inline-flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" />
              宫格拼接
            </span>
          </>
        )}
      </div>

      {resultUrls.length === 1 ? (
        <button
          type="button"
          onClick={() => onLightbox(resultUrls[0]!, 0)}
          className="group block max-w-[280px] rounded-lg overflow-hidden border bg-muted hover:border-primary/60 transition-colors text-left"
          title="点击查看大图"
        >
          {/* biome-ignore lint/performance/noImgElement: 单图预览 */}
          <img
            src={resultUrls[0]}
            alt="生成结果"
            className="block w-full h-auto transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2 max-w-[360px]">
          {resultUrls.map((url, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: 一次提交内的图按生成顺序
              key={i}
              type="button"
              onClick={() => onLightbox(url, i)}
              className="group relative aspect-square overflow-hidden rounded-lg border bg-muted hover:border-primary/60 transition-colors"
              title={`第 ${i + 1} 张 · 点击查看大图`}
            >
              {/* biome-ignore lint/performance/noImgElement: 多图网格缩略图 */}
              <img
                src={url}
                alt={`结果 ${i + 1}`}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                loading="lazy"
              />
              <span className="absolute bottom-1 left-1 bg-black/60 backdrop-blur-sm text-white text-[9px] px-1 py-0.5 rounded font-mono leading-none opacity-0 group-hover:opacity-100 transition-opacity">
                #{i + 1}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
