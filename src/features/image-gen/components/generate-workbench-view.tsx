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
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Heart,
  History,
  Image as ImageIcon,
  Library,
  Loader2,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Search,
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
import { toast } from "sonner";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { PromptVariable } from "@/db/image-gen-types";
import type { ImageJob, Photo } from "@/db/schema";
import type { PromptTemplateView } from "@/features/gpt-image/lib/types";
import {
  generateImageAction,
  listImageJobsAction,
  listPhotosAction,
  pollImageJobAction,
} from "@/features/image-gen/actions";
import type {
  ImageModelId,
  ImageSize,
} from "@/features/image-gen/lib/image-models/types";
import {
  IMAGE_MODEL_LIST,
  IMAGE_MODELS,
} from "@/features/image-gen/lib/image-models/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ============ 类型 ============
interface UploadedImage {
  file: File;
  previewUrl: string;
  fileName: string;
  fileSize: number;
}

type RefMode = "upload" | "library" | "none";
type EffectStatus = "pending" | "processing" | "completed" | "failed";

interface WorkbenchEffect {
  effectId: string;
  /**
   * imageJob 表 id（用于后续 pollImageJobAction 轮询异步任务）。
   * 同步任务（直接返 images）此字段为空；异步任务（taskId 路径）必填。
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
}

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
  const [refMode, setRefMode] = useState<RefMode>("none");
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
  // Phase 起：默认模型从 doubao 改为 nano_banana2 —— doubao 仍是占位实现，
  // 默认值会让用户在没选模板时撞墙。
  const [selectedModel, setSelectedModel] =
    useState<ImageModelId>("nano_banana2");
  const activeTemplates = templates.filter((t) => t.isActive);
  const [selectedMask, setSelectedMask] = useState<string>(
    activeTemplates[0]?.id ?? ""
  );
  // 模板变量取值
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // 基础参数
  const [batchSize, setBatchSize] = useState(1);
  const [size, setSize] = useState<ImageSize>("1024x1024");

  // 高级参数（折叠）
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [guidanceScale, setGuidanceScale] = useState(7);
  const [steps, setSteps] = useState(30);
  const [seed, setSeed] = useState<number | "">("");
  const [safetyCheck, setSafetyCheck] = useState(true);

  const [generating, setGenerating] = useState(false);
  // 手动「刷新状态」按钮的去抖锁：避免用户连点导致同 jobId 重复打 /poll
  const [refreshing, setRefreshing] = useState(false);
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

    if (job.status === "completed") {
      pollingRef.current.delete(effectId);
      const resultUrls = (job.resultUrls as string[]) ?? [];
      const completed: WorkbenchEffect = {
        ...eff,
        status: "completed",
        resultUrls,
        ...(job.generateDuration
          ? { duration: job.generateDuration as number }
          : {}),
        ...(job.cost && job.currency
          ? {
              cost: (job.cost as number) / 1000,
              currency: job.currency as string,
            }
          : {}),
      };
      setHistory((prev) =>
        prev.map((e) => (e.effectId === effectId ? completed : e))
      );
      setSelectedEffect((prev) =>
        prev?.effectId === effectId ? completed : prev
      );
      toast.success(`${eff.imageModelName} 生成完成`);
      return;
    }

    if (job.status === "failed") {
      pollingRef.current.delete(effectId);
      const failed: WorkbenchEffect = {
        ...eff,
        status: "failed",
        errorMsg: job.errorMsg ?? "生成失败",
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
   * 启动一个异步任务的轮询循环。
   * 通过历史 ref + pollingRef 保证组件卸载时也能正常清理；
   * 每个 effect 单独跑 setTimeout 链，避免多个 effect 互相干扰。
   */
  const startPolling = (effectId: string, jobId: string) => {
    if (pollingRef.current.has(effectId)) return;
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
        const res = await pollImageJobAction({ jobId });
        const job = res?.data?.job;
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

    const refImage =
      refMode === "upload" && uploadedImage
        ? {
            imageUrl: uploadedImage.previewUrl,
            photoId: "LOCAL_UPLOAD",
          }
        : refMode === "library" && selectedPhoto
          ? {
              imageUrl: selectedPhoto.fileUrl,
              photoId: selectedPhoto.id,
            }
          : null;
    const generationMode: "text_to_image" | "image_to_image" = refImage
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

    const newEffect: WorkbenchEffect = {
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
      createdAt: new Date().toISOString(),
      isGridComposite,
    };
    setHistory((prev) => [newEffect, ...prev]);
    setSelectedEffect(newEffect);

    try {
      const result = await generateImageAction({
        model: selectedModel,
        mode: generationMode,
        prompt: finalPrompt,
        negativePrompt: negativePrompt || undefined,
        imageUrl: refImage?.imageUrl,
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
        photoId: refImage?.photoId,
      });
      const images = result?.data?.images ?? [];
      const creditsConsumed = result?.data?.creditsConsumed;
      const returnedTaskId = result?.data?.taskId as string | undefined;
      const returnedJobId = result?.data?.jobId as string | undefined;

      // 异步任务路径：拿 taskId 但没 images —— 启动前端轮询。
      if (images.length === 0 && returnedTaskId && returnedJobId) {
        const pending: WorkbenchEffect = {
          ...newEffect,
          jobId: returnedJobId,
          taskId: returnedTaskId,
        };
        setHistory((prev) =>
          prev.map((e) => (e.effectId === newEffect.effectId ? pending : e))
        );
        setSelectedEffect((prev) =>
          prev?.effectId === newEffect.effectId ? pending : prev
        );
        startPolling(newEffect.effectId, returnedJobId);
        toast.info(
          `${modelConfig.name} 任务已提交，正在异步生成…${creditsConsumed ? `（消耗 ${creditsConsumed} 积分）` : ""}`
        );
        return;
      }

      // 同步路径（直接返 images）：立刻完成。
      const completed: WorkbenchEffect = {
        ...newEffect,
        status: "completed",
        resultUrls: images.map((img) => img.url),
        ...(images[0]?.revisedPrompt
          ? { revisedPrompt: images[0].revisedPrompt }
          : {}),
        ...(typeof images[0]?.seed === "number"
          ? { seed: images[0].seed }
          : {}),
        ...(returnedTaskId && returnedJobId
          ? { taskId: returnedTaskId, jobId: returnedJobId }
          : { duration: 0 }),
      };
      setHistory((prev) =>
        prev.map((e) => (e.effectId === newEffect.effectId ? completed : e))
      );
      setSelectedEffect(completed);
      toast.success(
        `${modelConfig.name} 生成完成${creditsConsumed ? ` · 消耗 ${creditsConsumed} 积分` : ""}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      const failed: WorkbenchEffect = {
        ...newEffect,
        status: "failed",
        errorMsg: msg,
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

  // 模板可用尺寸（与模型能力交集）
  const availableSizes: ImageSize[] = modelConfig.capabilities.sizes;
  const estimatedCost = modelConfig.currency === "CNY" ? "¥" : "$";

  // 抑制未使用变量告警
  void legacyToast;

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
            选择模型与参数，生成 2D 效果图
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* 参考图 */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold flex items-center gap-1">
                <ImageIcon className="h-3.5 w-3.5" />
                参考图
              </Label>
              <div className="flex gap-0.5 bg-muted rounded p-0.5">
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

            {refMode === "upload" &&
              (uploadedImage ? (
                <div className="relative group">
                  {/* biome-ignore lint/performance/noImgElement: 本地预览需要原生 img */}
                  <img
                    src={uploadedImage.previewUrl}
                    alt={uploadedImage.fileName}
                    className="w-full aspect-square object-cover rounded-lg border"
                  />
                  <button
                    type="button"
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
                    "w-full border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
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
                </button>
              ))}

            {refMode === "library" && (
              <div className="space-y-2">
                {/* 已选预览 */}
                {selectedPhoto && (
                  <div className="relative group">
                    {/* biome-ignore lint/performance/noImgElement: R2 动态 URL 用原生 img */}
                    <img
                      src={selectedPhoto.thumbnailUrl ?? selectedPhoto.fileUrl}
                      alt={selectedPhoto.fileName}
                      className="w-full aspect-square object-cover rounded-lg border border-violet-500"
                    />
                    <button
                      type="button"
                      onClick={() => setSelectedPhoto(null)}
                      className="absolute top-2 right-2 p-1 rounded-full bg-rose-500 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="移除已选"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <div className="absolute bottom-2 left-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded truncate flex items-center gap-1">
                      <Badge
                        variant="outline"
                        className="text-[9px] py-0 h-3.5 bg-violet-500/30 border-violet-400/50 text-white uppercase shrink-0"
                      >
                        {selectedPhoto.format ?? "img"}
                      </Badge>
                      <span className="truncate">{selectedPhoto.fileName}</span>
                    </div>
                  </div>
                )}

                {/* 搜索 */}
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    placeholder="搜索图库..."
                    className="w-full h-8 pl-7 pr-2 text-xs rounded border bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                  />
                </div>

                {/* 列表 / 状态 */}
                <div className="max-h-[280px] overflow-y-auto rounded-lg border bg-muted/20">
                  {libraryLoading ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-[10px]">加载图库中...</span>
                    </div>
                  ) : libraryError ? (
                    <div className="p-3 text-center">
                      <XCircle className="h-5 w-5 text-rose-500 mx-auto mb-1" />
                      <p className="text-[10px] text-rose-600 dark:text-rose-400">
                        {libraryError}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          libraryFetchedRef.current = false;
                          // 触发重新拉取：直接把 refMode 设为自身会触发上面的 effect
                          setRefMode("none");
                          setTimeout(() => setRefMode("library"), 0);
                        }}
                        className="text-[10px] text-violet-600 hover:underline mt-1.5 inline-flex items-center gap-1"
                      >
                        <RefreshCw className="h-3 w-3" /> 重试
                      </button>
                    </div>
                  ) : libraryPhotos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground gap-1.5">
                      <Library className="h-6 w-6" />
                      <p className="text-xs font-medium">图库为空</p>
                      <p className="text-[10px]">先去照片管理上传图片</p>
                      <a
                        href="/dashboard/photos"
                        className="text-[10px] text-violet-600 hover:underline mt-0.5"
                      >
                        前往图库管理 →
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
                          <div className="py-6 text-center text-[10px] text-muted-foreground">
                            没有匹配 “{librarySearch}” 的图片
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
                                    ? "border-violet-500 ring-1 ring-violet-500/30"
                                    : "border-transparent hover:border-violet-500/50"
                                )}
                                title={p.fileName}
                                aria-label={`选择 ${p.fileName}`}
                              >
                                {/* biome-ignore lint/performance/noImgElement: R2 动态 URL 用原生 img */}
                                <img
                                  src={p.thumbnailUrl ?? p.fileUrl}
                                  alt={p.fileName}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                                {selected && (
                                  <div className="absolute inset-0 bg-violet-500/20 flex items-center justify-center">
                                    <CheckCircle2 className="h-5 w-5 text-white drop-shadow" />
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

                <p className="text-[10px] text-muted-foreground text-center">
                  {libraryPhotos.length > 0 && !libraryLoading
                    ? `共 ${libraryPhotos.length} 张 · 点选即用`
                    : ""}
                </p>
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

          {/* 模板开关 */}
          <section className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40">
            <div>
              <p className="text-xs font-semibold flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                提示词模板
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {useTemplate ? "使用效果模版的提示词" : "手动输入提示词"}
              </p>
            </div>
            <Switch checked={useTemplate} onCheckedChange={setUseTemplate} />
          </section>

          {/* 提示词 - 仅关闭模板时显示 */}
          {!useTemplate && (
            <section className="space-y-2">
              <Label className="text-xs font-semibold flex items-center gap-1">
                <Type className="h-3.5 w-3.5" />
                提示词
              </Label>
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
                  type="button"
                  onClick={() => setPrompt("")}
                  className="hover:text-foreground"
                >
                  <Trash2 className="h-3 w-3 inline mr-0.5" />
                  清空
                </button>
              </div>
            </section>
          )}

          {/* 反向提示词 */}
          {!useTemplate && modelConfig.capabilities.supportsNegativePrompt && (
            <section className="space-y-2">
              <Label className="text-xs font-semibold">
                反向提示词{" "}
                <span className="text-[10px] text-muted-foreground font-normal">
                  (可选)
                </span>
              </Label>
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
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" />
                生图模型
                {isModelOverridden ? (
                  <Badge
                    variant="outline"
                    className="text-[9px] py-0 h-3.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                  >
                    已覆盖「
                    {selectedTemplate?.name}」模板默认
                  </Badge>
                ) : (
                  useTemplate &&
                  templateDefaultModel && (
                    <Badge
                      variant="outline"
                      className="text-[9px] py-0 h-3.5 bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30"
                    >
                      由模板指定
                    </Badge>
                  )
                )}
              </Label>
              {isModelOverridden && (
                <button
                  type="button"
                  onClick={handleRestoreTemplateModel}
                  className="text-[10px] text-violet-600 hover:text-violet-700 dark:text-violet-400 flex items-center gap-1"
                  title="还原为「{selectedTemplate?.name}」模板默认"
                >
                  <RotateCcw className="h-3 w-3" />
                  还原默认
                </button>
              )}
            </div>
            <Select
              value={selectedModel}
              onValueChange={(v) => setSelectedModel(v as ImageModelId)}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_MODEL_LIST.filter((m) => m.status === "active").map(
                  (m) => (
                    <SelectItem
                      key={m.id}
                      value={m.id}
                      // Phase：isAvailable=false 的模型在 API 层是占位 stub（simulateLatency +
                      // picsum），不能让用户选了不报错 —— UI 层直接禁用并加「即将上线」标记。
                      disabled={!m.isAvailable}
                      className="text-xs"
                    >
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
                        {!m.isAvailable && (
                          <Badge
                            variant="outline"
                            className="text-[9px] py-0 h-3.5 bg-zinc-500/10 text-zinc-500 border-zinc-500/30"
                          >
                            即将上线
                          </Badge>
                        )}
                      </span>
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
            {isModelOverridden ? (
              <p className="text-[10px] text-amber-700 dark:text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded p-1.5 flex items-center gap-1">
                <Sparkles className="h-3 w-3 shrink-0" />
                已覆盖「{selectedTemplate?.name}」模板默认（
                {templateDefaultModel &&
                  IMAGE_MODELS[templateDefaultModel]?.name}
                ），点上方「还原默认」可恢复
              </p>
            ) : useTemplate && templateDefaultModel ? (
              <p className="text-[10px] text-violet-700 dark:text-violet-400 bg-violet-500/5 border border-violet-500/20 rounded p-1.5 flex items-center gap-1">
                <Sparkles className="h-3 w-3 shrink-0" />
                模型由「{selectedTemplate?.name}」模板指定为 {modelConfig.name}
                ，可手动切换到其他模型
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground bg-muted/30 rounded p-1.5">
                {modelConfig.description}
              </p>
            )}
          </section>

          {/* 产品效果模版 */}
          <section className="space-y-2">
            <Label className="text-xs font-semibold flex items-center gap-1">
              效果模版
              {useTemplate && (
                <Badge
                  variant="outline"
                  className="text-[9px] py-0 h-3.5 text-violet-700 dark:text-violet-400 border-violet-500/30"
                >
                  必选
                </Badge>
              )}
            </Label>
            {activeTemplates.length === 0 ? (
              <>
                <Select value="" disabled>
                  <SelectTrigger className="h-9 text-xs opacity-60">
                    <SelectValue placeholder="暂无提示词模板" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_empty" disabled className="text-xs">
                      暂无提示词模板
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5 space-y-1">
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    还没有可用的提示词模板
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    请联系管理员在
                    <a
                      href="/admin/prompt-templates"
                      className="text-violet-600 hover:underline mx-0.5"
                    >
                      提示词模板管理
                    </a>
                    新建并启用模板。模板里
                    <code className="mx-0.5 px-1 py-0.5 rounded bg-muted text-[9px] font-mono">
                      isActive=false
                    </code>
                    的不会出现在此下拉里。
                  </p>
                </div>
              </>
            ) : (
              <>
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
                    {activeTemplates.map((tpl) => (
                      <SelectItem
                        key={tpl.id}
                        value={tpl.id}
                        className="text-xs"
                      >
                        {tpl.name} · ¥{tpl.price ?? 0}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {useTemplate && selectedTemplate && (
                  <p className="text-[10px] text-muted-foreground bg-violet-500/5 border border-violet-500/20 rounded p-1.5">
                    {selectedTemplate.description}
                  </p>
                )}
              </>
            )}
          </section>

          {/* 模板参数 */}
          {useTemplate &&
            selectedTemplate &&
            (selectedTemplate.variables ?? []).length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-violet-600" />
                    模参数
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    共 {(selectedTemplate.variables ?? []).length} 项
                  </span>
                </div>
                <div className="space-y-2">
                  {(selectedTemplate.variables ?? []).map((v) => (
                    <div key={v.key} className="space-y-1">
                      <Label className="text-[11px] flex items-center gap-1">
                        <span className="font-mono text-violet-700 dark:text-violet-400">
                          {`{{${v.key}}}`}
                        </span>
                        <span className="text-muted-foreground">{v.label}</span>
                        {v.required && (
                          <span className="text-rose-600 text-[10px]">*</span>
                        )}
                      </Label>
                      {v.options && v.options.length > 0 ? (
                        <Select
                          value={paramValues[v.key] ?? v.defaultValue}
                          onValueChange={(val) =>
                            setParamValues((p) => ({
                              ...p,
                              [v.key]: val,
                            }))
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
            <div className="space-y-1">
              <Label className="text-xs font-semibold">输出尺寸</Label>
              <div className="grid grid-cols-4 gap-1">
                {availableSizes.slice(0, 4).map((s) => (
                  <button
                    key={s}
                    type="button"
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

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">生成数量</Label>
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
                disabled={(() => {
                  const tplCandidateCount = useTemplate
                    ? (selectedTemplate?.candidateCount ?? 1)
                    : 1;
                  return tplCandidateCount === 4 || tplCandidateCount === 9;
                })()}
                className="w-full accent-violet-500 disabled:opacity-50"
              />
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>1</span>
                <span>最多 {modelConfig.capabilities.maxBatchSize}</span>
              </div>
              {(() => {
                const tplCandidateCount = useTemplate
                  ? (selectedTemplate?.candidateCount ?? 1)
                  : 1;
                if (tplCandidateCount === 4 || tplCandidateCount === 9) {
                  return (
                    <p className="text-[10px] text-violet-700 dark:text-violet-400 bg-violet-500/5 border border-violet-500/20 rounded p-1.5 mt-1">
                      当前模板为
                      {tplCandidateCount === 4 ? "2×2" : "3×3"}
                      宫格拼接，将返回 1
                      张含全部候选的拼接大图，批量数量已自动锁定
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          </section>

          {/* 高级参数 */}
          <section className="border-t pt-3">
            <button
              type="button"
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
                {modelConfig.capabilities.supportsGuidance && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        引导系数 (CFG)
                      </span>
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

                {modelConfig.capabilities.maxInferenceSteps > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        推理步数
                      </span>
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

                {modelConfig.capabilities.supportsSeed && (
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">
                      随机种子
                    </span>
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
              </div>
            )}
          </section>
        </div>

        {/* 底部：成本 + 生成按钮 */}
        <div className="p-3 border-t bg-muted/30 space-y-2">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>预计成本</span>
            <span className="font-mono font-semibold text-foreground">
              {estimatedCost}
              {(modelConfig.pricePerImage * batchSize).toFixed(2)}
            </span>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={generating}
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
        </div>
      </aside>

      {/* ============ 右侧：结果展示 ============ */}
      <main className="flex-1 flex flex-col bg-card border rounded-lg overflow-hidden min-w-0">
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
                  <span
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: modelConfig.color }}
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    {selectedEffect.imageModelName}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {selectedEffect.maskName} ·{" "}
                    {selectedEffect.mode === "text_to_image"
                      ? "文生图"
                      : "图生图"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(selectedEffect.createdAt).toLocaleString("zh-CN")}
                  </span>
                  {selectedEffect.status === "processing" &&
                    selectedEffect.jobId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px]"
                        disabled={refreshing}
                        onClick={async () => {
                          if (!selectedEffect.jobId) return;
                          setRefreshing(true);
                          try {
                            const res = await pollImageJobAction({
                              jobId: selectedEffect.jobId,
                            });
                            const job = res?.data?.job;
                            if (job) {
                              applyJobUpdate(selectedEffect.effectId, job);
                            }
                          } catch (err) {
                            toast.error(
                              err instanceof Error
                                ? err.message
                                : "刷新失败"
                            );
                          } finally {
                            setRefreshing(false);
                          }
                        }}
                      >
                        {refreshing ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3 mr-1" />
                        )}
                        刷新状态
                      </Button>
                    )}
                </div>
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
                      // biome-ignore lint/suspicious/noArrayIndexKey: 结果图按生成顺序展示
                      key={i}
                      className="group relative aspect-square rounded-lg overflow-hidden border bg-muted"
                    >
                      {/* biome-ignore lint/performance/noImgElement: 生成结果用原生 img 性能更佳 */}
                      <img
                        src={url}
                        alt={`结果 ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8"
                          onClick={() => toast.success("已下载")}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8"
                          onClick={() => toast.success("已收藏")}
                        >
                          <Heart className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8"
                          onClick={() => toast.success("已分享")}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="secondary"
                          className="h-8 w-8"
                          onClick={() => toast.success("放大查看")}
                        >
                          <Maximize2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-mono">
                        #{i + 1}
                      </div>
                    </div>
                  ))}
                </div>
              ) : selectedEffect.status === "processing" ? (
                <div className="aspect-video rounded-lg border-2 border-dashed border-sky-500/30 bg-sky-500/5 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="h-10 w-10 text-sky-500 animate-spin" />
                  {selectedEffect.taskId ? (
                    <>
                      <p className="text-sm font-medium text-sky-700 dark:text-sky-400">
                        任务已提交，正在异步生成…
                      </p>
                      <p className="text-xs text-muted-foreground">
                        上游排队中，最长约 180s
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-sky-700 dark:text-sky-400">
                        AI 正在生成中...
                      </p>
                      <p className="text-xs text-muted-foreground">
                        预计 {(modelConfig.avgDuration / 1000).toFixed(1)}s 完成
                      </p>
                    </>
                  )}
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
                  {selectedEffect.duration !== undefined && (
                    <div>
                      <span className="text-muted-foreground">耗时:</span>{" "}
                      <span className="font-mono">
                        {(selectedEffect.duration / 1000).toFixed(1)}s
                      </span>
                    </div>
                  )}
                  {selectedEffect.cost !== undefined && (
                    <div>
                      <span className="text-muted-foreground">成本:</span>{" "}
                      <span className="font-mono">
                        {selectedEffect.currency === "CNY" ? "¥" : "$"}
                        {selectedEffect.cost}
                      </span>
                    </div>
                  )}
                  {selectedEffect.seed !== undefined && (
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
                在左侧选择参考图与提示词，点击「生成」按钮开始创作
              </p>
            </div>
          )}
        </div>

        {/* 历史缩略图条 */}
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
                      type="button"
                      onClick={() => setSelectedEffect(eff)}
                      className={cn(
                        "relative h-12 w-12 rounded border-2 overflow-hidden shrink-0 transition-all",
                        selectedEffect?.effectId === eff.effectId
                          ? "border-violet-500 ring-1 ring-violet-500/30"
                          : "border-transparent hover:border-muted-foreground/30"
                      )}
                    >
                      {eff.resultUrls[0] ? (
                        // biome-ignore lint/performance/noImgElement: 缩略图用原生 img
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
                      <span
                        className="absolute bottom-0 left-0 right-0 h-1.5"
                        style={{
                          backgroundColor:
                            IMAGE_MODELS[eff.imageModel]?.color ?? "#64748b",
                        }}
                      />
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
