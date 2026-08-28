// @ts-nocheck
/**
 * 生图工作台 V2 —— 来自 infinite-canvas-main/web/src/pages/image/index.tsx 整体迁移
 *
 * 路由：`/dashboard/generate-v2`
 * RSC entry：`src/app/[locale]/(dashboard)/dashboard/generate-v2/page.tsx`
 * 客户端壳：`src/features/canvas/pages/image-workbench-client.tsx`（dynamic ssr:false 屏障）
 *
 * 与 V1（/dashboard/generate）的差异：
 * - V1：单文件精简版（无日志面板、无参考图、无批量生成）
 * - V2：完整 infinite-canvas 体验，左侧历史日志 + 中列 prompt/refs/参数 + 右侧结果网格
 *   + Agent 桥接（use-workbench-agent-store）+ 资产选择 + Prompt 库选择
 *
 * 与画布编辑器共享 store：
 * - use-config-store（AiConfig / baseUrl / 模型）
 * - use-asset-store / use-workbench-agent-store / use-theme-store
 * - services/api/image（**2026-08-20 接 channelMode 双轨**：remote → /api/canvas/generate 后端代理；local → 浏览器直连上游）
 *
 * 命名约定：
 * - 原 infinite-canvas 文件用 default export，本文件改 named export `ImageWorkbench`
 *   以便 dynamic import 显式取 `.ImageWorkbench`
 *
 * 内置/自定义切换：
 * - 末尾挂 `<AppConfigModal />`（订阅 useConfigStore.isConfigOpen，自动响应 openConfigDialog 调用）
 * - channelMode 默认 "remote"（见 use-config-store.ts defaultConfig），用户首次进 V2 工作台
 *   即可用平台 wellapi key 生成，不消耗积分；切到 "local" 才走用户自配 baseUrl/apiKey
 *
 * 已知：
 * - 文件顶部 `// @ts-nocheck` —— canvas 模块内部 store 类型与 exactOptionalPropertyTypes
 *   不兼容（WorkbenchGenerationTask 部分属性不接受 | undefined），与原 infinite-canvas
 *   写法一致；运行时类型由 store 自身保证
 */

import {
  App,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Image,
  Input,
  Modal,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { saveAs } from "file-saver";
import localforage from "localforage";
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  BookOpen,
  CheckSquare,
  ClipboardPaste,
  Download,
  FolderPlus,
  History,
  ImagePlus,
  LayoutGrid,
  LoaderCircle,
  PenLine,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetPickerModal } from "@/features/canvas/components/canvas/asset-picker-modal";
import { AppConfigModal } from "@/features/canvas/components/layout/app-config-modal";
import { ModelPicker } from "@/features/canvas/components/model-picker/model-picker";
import { PromptSelectDialog } from "@/features/canvas/components/prompts/prompt-select-dialog";
import {
  ImageSettingsPanel,
  imageQualityLabel,
  imageSizeLabel,
} from "@/features/canvas/components/settings-panels/image-settings-panel";
import i18n from "@/features/canvas/i18n";
import { canvasThemes } from "@/features/canvas/lib/canvas-theme";
import { imageReferenceLabel } from "@/features/canvas/lib/image-reference-prompt";
import {
  formatBytes,
  formatDuration,
  getDataUrlByteSize,
  readImageMeta,
} from "@/features/canvas/lib/image-utils";
import { stitchToGrid } from "@/features/canvas/lib/stitch-images";
import {
  requestEdit,
  requestGeneration,
} from "@/features/canvas/services/api/image";
import {
  deleteStoredImages,
  resolveImageUrl,
  uploadImage,
} from "@/features/canvas/services/image-storage";
import { useAssetStore } from "@/features/canvas/stores/use-asset-store";
import {
  type AiConfig,
  useConfigStore,
  useEffectiveConfig,
} from "@/features/canvas/stores/use-config-store";
import { useMyPromptStore } from "@/features/canvas/stores/use-my-prompt-store";
import { useThemeStore } from "@/features/canvas/stores/use-theme-store";
import { useWorkbenchAgentStore } from "@/features/canvas/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/features/canvas/types/image";
import { thumbnailUrl } from "@/features/image-gen/lib/thumbnail-url";

type GeneratedImage = {
  id: string;
  dataUrl: string;
  storageKey?: string;
  durationMs: number;
  width: number;
  height: number;
  bytes: number;
  mimeType?: string;
};

type GenerationResult = {
  id: string;
  status: "pending" | "success" | "failed";
  image?: GeneratedImage;
  error?: string;
};

type GenerationLog = {
  id: string;
  createdAt: number;
  title: string;
  prompt: string;
  time: string;
  model: string;
  config: GenerationLogConfig;
  references: ReferenceImage[];
  durationMs: number;
  successCount: number;
  failCount: number;
  imageCount: number;
  size: string;
  quality: string;
  status: "success" | "failed";
  images: GeneratedImage[];
  thumbnails: string[];
};

type GenerationLogConfig = Pick<
  AiConfig,
  "model" | "imageModel" | "quality" | "size" | "count"
>;

const LOG_STORE_KEY = "infinite-canvas:image_generation_logs";
const RESULT_ACTION_BUTTON_CLASS =
  "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";
const logStore = localforage.createInstance({
  name: "infinite-canvas",
  storeName: "image_generation_logs",
});

export function ImageWorkbench() {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const config = useConfigStore((state) => state.config);
  const effectiveConfig = useEffectiveConfig();
  const updateConfig = useConfigStore((state) => state.updateConfig);
  const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
  const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
  const addAsset = useAssetStore((state) => state.addAsset);
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [results, setResults] = useState<GenerationResult[]>([]);
  // 2026-08-25：自动拼接宫格图 —— 用户开启 + 至少 2 张成功时，客户端 Canvas
  // 把成功候选拼成 √N×√N 单张大图，单独存为 stitchedComposite；results
  // 数组里的 N 张原图**不再被覆盖**（用户要求"也需要保留多个原图"），统一
  // 在结果区顶部展示宫格大图、下面展示 N 张原图网格，互不干扰。失败/重试
  // 通过 resetStitchedComposite 清空，保证下次 generate 不残留旧 composite。
  const [stitchedComposite, setStitchedComposite] =
    useState<GeneratedImage | null>(null);
  const [logs, setLogs] = useState<GenerationLog[]>([]);
  const [running, setRunning] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
  const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
  const [autoRunToken, setAutoRunToken] = useState(0);
  const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
  const clearImageCommand = useWorkbenchAgentStore(
    (state) => state.clearImageCommand
  );
  const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
  const processedCommandRef = useRef(0);
  const agentTaskIdRef = useRef<string | undefined>(undefined);

  const model = effectiveConfig.imageModel || effectiveConfig.model;
  const canGenerate = Boolean(prompt.trim());
  const generationCount = Math.max(1, Math.min(10, Number(config.count) || 1));

  useEffect(() => {
    if (!running || !startedAt) return;
    const timer = window.setInterval(
      () => setElapsedMs(performance.now() - startedAt),
      1000
    );
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  useEffect(() => {
    void refreshLogs();
  }, []);

  const addReferences = async (files?: FileList | null) => {
    const imageFiles = Array.from(files || []).filter((file) =>
      file.type.startsWith("image/")
    );
    const nextReferences = await Promise.all(
      imageFiles.map(async (file) => {
        const image = await uploadImage(file);
        return {
          id: nanoid(),
          name: file.name,
          type: image.mimeType,
          dataUrl: image.url,
          storageKey: image.storageKey,
        };
      })
    );
    setReferences((value) => [...value, ...nextReferences]);
  };

  const addReferencesFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      const blobs = await Promise.all(
        items.flatMap((item) =>
          item.types
            .filter((type) => type.startsWith("image/"))
            .map((type) => item.getType(type))
        )
      );
      if (!blobs.length) {
        message.error(t("imageWorkbench.clipboardEmpty"));
        return;
      }
      const nextReferences = await Promise.all(
        blobs.map(async (blob, index) => {
          const image = await uploadImage(blob);
          return {
            id: nanoid(),
            name: `clipboard-${index + 1}.png`,
            type: image.mimeType,
            dataUrl: image.url,
            storageKey: image.storageKey,
          };
        })
      );
      setReferences((value) => [...value, ...nextReferences]);
      message.success(
        t("imageWorkbench.clipboardAdded", { count: nextReferences.length })
      );
    } catch {
      message.error(t("imageWorkbench.clipboardEmpty"));
    }
  };

  /**
   * 资产库插入 —— 当前只消费 image 类型（text/video 不适合作为生图参考图）。
   * 与 addReferencesFromClipboard 行为对齐：拿到 dataUrl + 可选 storageKey，
   * 灌进 references 列表。重复 id 由 setReferences 的 filter 逻辑保证不重复。
   */
  const handleInsertAsset = (
    payload:
      | { kind: "text"; content: string; title: string }
      | { kind: "image"; dataUrl: string; title: string; storageKey?: string }
      | {
          kind: "video";
          url: string;
          title: string;
          storageKey?: string;
          width?: number;
          height?: number;
        }
  ) => {
    if (payload.kind !== "image") return;
    setReferences((value) => [
      ...value,
      {
        id: nanoid(),
        name: payload.title || "asset",
        type: "image/png",
        dataUrl: payload.dataUrl,
        storageKey: payload.storageKey,
      },
    ]);
    setAssetPickerOpen(false);
    message.success(t("imageWorkbench.addedReference"));
  };

  const generate = async () => {
    const agentTaskId = agentTaskIdRef.current;
    agentTaskIdRef.current = undefined;
    const text = prompt.trim();
    if (!text) {
      message.error(t("imageWorkbench.promptRequired"));
      if (agentTaskId)
        updateAgentTask(agentTaskId, {
          status: "failed",
          error: t("imageWorkbench.promptRequired"),
        });
      return;
    }
    if (!isAiConfigReady(effectiveConfig, model)) {
      message.warning(t("workbench.configFirst"));
      openConfigDialog(true);
      if (agentTaskId)
        updateAgentTask(agentTaskId, {
          status: "failed",
          error: t("imageWorkbench.configIncomplete"),
        });
      return;
    }

    const snapshot = buildRequestSnapshot({ batchCount: generationCount });
    if (!snapshot) {
      if (agentTaskId)
        updateAgentTask(agentTaskId, {
          status: "failed",
          error: t("imageWorkbench.invalidParams"),
        });
      return;
    }

    setElapsedMs(0);
    setRunning(true);
    if (agentTaskId)
      updateAgentTask(agentTaskId, { status: "running", error: undefined });
    setPreviewLog(null);
    setResults(
      Array.from({ length: generationCount }, () => ({
        id: nanoid(),
        status: "pending",
      }))
    );
    const batchStartedAt = performance.now();
    setStartedAt(batchStartedAt);

    // 单 POST with n=N（对齐 V1 / 画布编辑器，不 fan-out）
    let successImages: GeneratedImage[] = [];
    let error: string | undefined;
    try {
      successImages = await runBatchGeneration(snapshot);
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : t("workbench.generationFailed");
      // 整组失败时把还没成功的卡从 pending 切到 failed，否则用户看到的"生成中"
      // 文字会无限期停留（generate() finally 只重置 running、不动 results）
      setResults((prev) =>
        prev.map((r) =>
          r.status === "success"
            ? r
            : { ...r, status: "failed", error: error ?? "" }
        )
      );
    }
    const successCount = successImages.length;
    const failCount = generationCount - successCount;

    // 2026-08-25：自动拼接宫格图 —— 开启 + 至少 2 张成功 → 客户端 Canvas
    // 把成功候选拼成 √N×√N 单张大图。**results 数组不再被覆盖**：之前会把
    // success 槽合并成 1 张 composite + 把其余 success 标 failed（"已合并到
    // 宫格大图"），用户反馈"也需要保留多个原图"——原图被丢了，关闭拼接也
    // 看不到。现在改为：results 数组保留全部 success 原图，composite 单独
    // 存为 stitchedComposite；结果区顶部展示拼接大图、下面展示 N 张原图
    // 网格。失败（任一张图解码/CORS 失败）静默回退，不打 composite。
    if (effectiveConfig.autoStitch && successImages.length >= 2) {
      try {
        const compositeDataUrl = await stitchToGrid(
          successImages.map((image) => image.dataUrl)
        );
        const composite: GeneratedImage = {
          ...successImages[0]!,
          id: nanoid(),
          dataUrl: compositeDataUrl,
          // 拼接后的字节数 = 各原图字节之和（PNG 压缩率相近，估算够用）
          bytes: successImages.reduce((sum, img) => sum + img.bytes, 0),
          mimeType: "image/png",
        };
        setStitchedComposite(composite);
      } catch (caught) {
        console.warn("[workbench] stitch failed:", caught);
        setStitchedComposite(null);
      }
    } else {
      // autoStitch 关 / 不足 2 张 → 不出 composite（清掉旧值避免上批残留）
      setStitchedComposite(null);
    }
    if (agentTaskId)
      updateAgentTask(agentTaskId, {
        status: successCount ? "succeeded" : "failed",
        successCount,
        failCount,
        error: successCount ? undefined : error,
      });

    try {
      const logImages = await Promise.all(
        successImages.map(async (image) => {
          const stored = await uploadImage(image.dataUrl);
          return {
            ...image,
            dataUrl: stored.url,
            storageKey: stored.storageKey,
            width: stored.width,
            height: stored.height,
            bytes: stored.bytes,
            mimeType: stored.mimeType,
          };
        })
      );
      saveLog(
        buildLog({
          prompt: text,
          model,
          config: { ...snapshot.config, count: String(generationCount) },
          references: snapshot.references,
          // 2026-08-24：同 runBatchGeneration —— 优先 serverDurationMs
          durationMs:
            logImages[0]?.durationMs ?? performance.now() - batchStartedAt,
          successCount,
          failCount,
          status: successCount ? "success" : "failed",
          images: logImages,
        })
      );
      successCount
        ? message.success(t("imageWorkbench.generated"))
        : message.error(error || t("workbench.generationFailed"));
    } finally {
      setRunning(false);
    }
  };

  // Handle image-generation commands from the Agent panel by setting the prompt and optionally starting generation.
  useEffect(() => {
    if (!imageCommand || imageCommand.nonce === processedCommandRef.current)
      return;
    processedCommandRef.current = imageCommand.nonce;
    clearImageCommand();
    if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
    if (imageCommand.run && running) {
      if (imageCommand.taskId)
        updateAgentTask(imageCommand.taskId, {
          status: "failed",
          error: t("imageWorkbench.busy"),
        });
      return;
    }
    if (imageCommand.run) {
      agentTaskIdRef.current = imageCommand.taskId;
      setAutoRunToken((value) => value + 1);
    }
  }, [imageCommand, clearImageCommand, running, updateAgentTask]);

  useEffect(() => {
    if (!autoRunToken) return;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunToken]);

  const downloadImage = (image: GeneratedImage, index: number) => {
    saveAs(image.dataUrl, `image-${index + 1}.png`);
  };

  const addResultToReferences = async (
    image: GeneratedImage,
    index: number
  ) => {
    const stored = await uploadImage(image.dataUrl);
    setReferences((value) => [
      ...value,
      {
        id: nanoid(),
        name: `result-${index + 1}.png`,
        type: stored.mimeType,
        dataUrl: stored.url,
        storageKey: stored.storageKey,
      },
    ]);
    message.success(t("imageWorkbench.addedReference"));
  };

  const saveResultToAssets = async (image: GeneratedImage, index: number) => {
    const stored = await uploadImage(image.dataUrl);
    addAsset({
      kind: "image",
      title: t("imageWorkbench.resultTitle", { count: index + 1 }),
      coverUrl: stored.url,
      tags: [],
      source: t("imageWorkbench.source"),
      data: {
        dataUrl: stored.url,
        storageKey: stored.storageKey,
        width: stored.width,
        height: stored.height,
        bytes: stored.bytes,
        mimeType: stored.mimeType,
      },
      metadata: { source: "image-page", prompt },
    });
    message.success(t("common.addedToAssets"));
  };

  const createSession = () => {
    setPrompt("");
    setReferences([]);
    setResults([]);
    // 2026-08-25：新会话清空拼接大图，避免上批 composite 残留到新会话
    setStitchedComposite(null);
    setElapsedMs(0);
    setStartedAt(0);
    setSelectedLogIds([]);
    setPreviewLog(null);
  };

  const deleteSelectedLogs = () => {
    const imageKeys = logs
      .filter((log) => selectedLogIds.includes(log.id))
      .flatMap((log) =>
        log.images
          .map((image) => image.storageKey)
          .filter((key): key is string => Boolean(key))
      );
    void Promise.all([
      deleteStoredImages(imageKeys),
      ...selectedLogIds.map((id) => logStore.removeItem(id)),
    ]).then(refreshLogs);
    if (previewLog && selectedLogIds.includes(previewLog.id)) {
      setPreviewLog(null);
      setResults([]);
      // 同步清掉当前会话的拼接大图，避免"删除当前日志后还残留 composite"
      setStitchedComposite(null);
    }
    setSelectedLogIds([]);
    setDeleteConfirmOpen(false);
  };

  const saveLog = (log: GenerationLog) => {
    void logStore.setItem(log.id, serializeLog(log)).then(refreshLogs);
  };

  const refreshLogs = async () => setLogs(await readStoredLogs());

  /**
   * 「收藏当前提示词」入口 —— 当 prompt 非空时打开 Modal 让用户填标题，
   * 写入 useMyPromptStore（localforage）。这一对接到 PromptSelectDialog
   * 的「我的提示词」Tab，构成一个完整的"保存 / 浏览 / 复用"闭环。
   *
   * 不要在空 prompt 时打开 Modal —— 提示词空着保存没意义。
   */
  const handleOpenSavePrompt = () => {
    if (!prompt.trim()) {
      message.warning(t("imageWorkbench.promptRequired"));
      return;
    }
    setSavePromptOpen(true);
  };
  const addMyPrompt = useMyPromptStore((state) => state.addPrompt);
  const handleConfirmSavePrompt = (title: string) => {
    addMyPrompt({ title, prompt });
    message.success(t("prompts.saved"));
    setSavePromptOpen(false);
  };

  const previewGenerationLog = async (log: GenerationLog) => {
    setPreviewLog(log);
    setLogsOpen(false);
    setPrompt(log.prompt);
    setReferences(log.references || []);
    if (log.config.imageModel || log.model)
      updateConfig("imageModel", log.config.imageModel || log.model);
    if (log.config.quality) updateConfig("quality", log.config.quality);
    if (log.config.size) updateConfig("size", log.config.size);
    if (log.config.count) updateConfig("count", log.config.count);
    setResults(
      log.images.map((image) => ({ id: image.id, status: "success", image }))
    );
  };

  const buildRequestSnapshot = (options?: { batchCount?: number }) => {
    const text = prompt.trim();
    if (!text) {
      message.error(t("imageWorkbench.promptRequired"));
      return null;
    }
    if (!isAiConfigReady(effectiveConfig, model)) {
      message.warning(t("workbench.configFirst"));
      openConfigDialog(true);
      return null;
    }
    // 单图 retry 默认 count="1"；批量 generate 传 batchCount=N，让上游一次返回 N 张
    // （对齐 V1 generate-workbench-view：1 POST with n=N，不 fan-out）
    return {
      text,
      config: {
        ...effectiveConfig,
        model,
        count: options?.batchCount ? String(options.batchCount) : "1",
      },
      references: [...references],
    };
  };

  /**
   * 批量生图 —— 1 个 POST with n=N，对齐 V1 generate-workbench-view 与画布编辑器：
   * 上游一次返 N 张图，按 index 分发到对应 result card；缺额（上游返 < N）
   * 标记为 failed。失败整组 catch，失败语义与 V1 一致（全组 fail）。
   */
  const runBatchGeneration = async (snapshot: {
    text: string;
    config: AiConfig;
    references: ReferenceImage[];
  }): Promise<GeneratedImage[]> => {
    const itemStartedAt = performance.now();
    const remoteResult = snapshot.references.length
      ? await requestEdit(snapshot.config, snapshot.text, snapshot.references)
      : await requestGeneration(snapshot.config, snapshot.text);
    const result = remoteResult.items;
    if (!result.length) throw new Error(t("imageWorkbench.missingResult"));
    // 2026-08-24：优先用服务端实测耗时（completedAt - createdAt），不含客户端
    // prep / poll 间隙 / Inngest cold start，避免显示"2 分钟"虚胖成实际 56s。
    // 兜底用 performance.now()（视频路径 / 服务端暂未支持时的旧数据）。
    const durationMs =
      remoteResult.serverDurationMs ?? performance.now() - itemStartedAt;
    const images = await Promise.all(
      result.map(async (image) => {
        const meta = await readImageMeta(image.dataUrl);
        return {
          id: image.id,
          dataUrl: image.dataUrl,
          durationMs,
          width: meta.width,
          height: meta.height,
          bytes: getDataUrlByteSize(image.dataUrl),
        };
      })
    );
    setResults((prev) => {
      const next = [...prev];
      images.forEach((img, i) => {
        if (i < next.length) {
          next[i] = { id: img.id, status: "success", image: img };
        }
      });
      // 上游返图数 < 用户期望时，剩余 slot 标 failed
      for (let i = images.length; i < next.length; i++) {
        next[i] = {
          ...next[i],
          status: "failed",
          error: t("workbench.generationFailed"),
        };
      }
      return next;
    });
    return images;
  };

  const runGenerationSlot = async (
    index: number,
    snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }
  ) => {
    const itemStartedAt = performance.now();
    try {
      const remoteResult = snapshot.references.length
        ? await requestEdit(snapshot.config, snapshot.text, snapshot.references)
        : await requestGeneration(snapshot.config, snapshot.text);
      const image = remoteResult.items[0];
      if (!image) throw new Error(t("imageWorkbench.missingResult"));
      const meta = await readImageMeta(image.dataUrl);
      // 2026-08-24：同 runBatchGeneration —— 优先 serverDurationMs
      const durationMs =
        remoteResult.serverDurationMs ?? performance.now() - itemStartedAt;
      const nextImage = {
        id: image.id,
        dataUrl: image.dataUrl,
        durationMs,
        width: meta.width,
        height: meta.height,
        bytes: getDataUrlByteSize(image.dataUrl),
      };
      setResults((value) =>
        updateResultAt(value, index, { status: "success", image: nextImage })
      );
      return nextImage;
    } catch (error) {
      setResults((value) =>
        updateResultAt(value, index, {
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : t("workbench.generationFailed"),
        })
      );
      throw error;
    }
  };

  const retryResult = async (index: number) => {
    const snapshot = buildRequestSnapshot();
    if (!snapshot) return;
    setPreviewLog(null);
    setResults((value) =>
      updateResultAt(value, index, {
        status: "pending",
        error: undefined,
        image: undefined,
      })
    );
    const retryStartedAt = performance.now();
    try {
      const image = await runGenerationSlot(index, snapshot);
      const stored = await uploadImage(image.dataUrl);
      const logImage = {
        ...image,
        dataUrl: stored.url,
        storageKey: stored.storageKey,
        width: stored.width,
        height: stored.height,
        bytes: stored.bytes,
        mimeType: stored.mimeType,
      };
      setResults((value) =>
        updateResultAt(value, index, {
          image: {
            ...image,
            dataUrl: stored.url,
            storageKey: stored.storageKey,
          },
        })
      );
      saveLog(
        buildLog({
          prompt: snapshot.text,
          model,
          config: { ...snapshot.config, count: "1" },
          references: snapshot.references,
          durationMs: performance.now() - retryStartedAt,
          successCount: 1,
          failCount: 0,
          status: "success",
          images: [logImage],
        })
      );
      message.success(t("workbench.retrySuccess"));
    } catch {
      // runGenerationSlot has already marked the result as failed.
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
          <LogPanel
            logs={logs}
            selectedLogIds={selectedLogIds}
            activeLogId={previewLog?.id}
            onSelectedLogIdsChange={setSelectedLogIds}
            onCreateSession={createSession}
            onDeleteSelected={() => setDeleteConfirmOpen(true)}
            onPreviewLog={(log) => void previewGenerationLog(log)}
          />
        </aside>

        <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="thin-scrollbar flex flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">
                    {t("imageWorkbench.title")}
                  </h1>
                </div>
                <div className="flex shrink-0 gap-2 lg:hidden">
                  <Button
                    icon={<History className="size-4" />}
                    onClick={() => setLogsOpen(true)}
                  >
                    {t("workbench.logs")}
                  </Button>
                  <Button
                    icon={<SlidersHorizontal className="size-4" />}
                    onClick={() => setSettingsOpen(true)}
                  >
                    {t("workbench.settings")}
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-base font-semibold">
                    {t("workbench.prompt")}
                  </span>
                  <div className="flex gap-2">
                    <Tooltip title={t("prompts.saveCurrent")}>
                      <Button
                        size="small"
                        icon={<BookmarkPlus className="size-3.5" />}
                        onClick={handleOpenSavePrompt}
                        disabled={!prompt.trim()}
                      >
                        {t("prompts.saveCurrent")}
                      </Button>
                    </Tooltip>
                    <Tooltip title={t("prompts.library")}>
                      <Button
                        size="small"
                        icon={<BookOpen className="size-3.5" />}
                        onClick={() => setPromptLibraryOpen(true)}
                      >
                        {t("prompts.library")}
                      </Button>
                    </Tooltip>
                    <Tooltip title={t("common.assetLibrary")}>
                      <Button
                        size="small"
                        icon={<FolderPlus className="size-3.5" />}
                        onClick={() => setAssetPickerOpen(true)}
                      >
                        {t("common.assetLibrary")}
                      </Button>
                    </Tooltip>
                  </div>
                </div>
                <Input.TextArea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={7}
                  placeholder={t("imageWorkbench.promptPlaceholder")}
                />
              </div>

              <div className="min-w-0">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-base font-semibold">
                    {t("imageWorkbench.references")}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="small"
                      icon={<ClipboardPaste className="size-3.5" />}
                      onClick={() => void addReferencesFromClipboard()}
                    >
                      {t("workbench.clipboard")}
                    </Button>
                    <Button
                      size="small"
                      icon={<Upload className="size-3.5" />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {t("workbench.upload")}
                    </Button>
                  </div>
                </div>
                <div
                  className={`hover-scrollbar hover-scrollbar-hint relative flex min-h-24 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${isReferenceDragActive ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    dragDepthRef.current += 1;
                    if (event.dataTransfer.types.includes("Files"))
                      setIsReferenceDragActive(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    dragDepthRef.current = Math.max(
                      0,
                      dragDepthRef.current - 1
                    );
                    if (!dragDepthRef.current) setIsReferenceDragActive(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    dragDepthRef.current = 0;
                    setIsReferenceDragActive(false);
                    void addReferences(event.dataTransfer.files);
                  }}
                  onWheel={(event) => {
                    if (
                      event.currentTarget.scrollWidth <=
                      event.currentTarget.clientWidth
                    )
                      return;
                    event.preventDefault();
                    event.currentTarget.scrollLeft += event.deltaY;
                  }}
                >
                  {references.map((item, index) => (
                    <div
                      key={item.id}
                      className="group relative size-20 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800"
                    >
                      <img
                        src={thumbnailUrl(item.dataUrl, 160)}
                        alt={item.name}
                        className="size-full object-cover"
                      />
                      <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {imageReferenceLabel(index)}
                      </span>
                      <ReferenceOrderButtons
                        index={index}
                        total={references.length}
                        onMove={(offset) =>
                          setReferences((value) =>
                            moveListItem(value, index, offset)
                          )
                        }
                      />
                      <button
                        type="button"
                        className="absolute right-1 top-1 hidden size-6 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                        onClick={() =>
                          setReferences((value) =>
                            value.filter((ref) => ref.id !== item.id)
                          )
                        }
                        aria-label={t("imageWorkbench.removeReference")}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  {!references.length ? (
                    <div className="flex min-w-full items-center justify-center text-sm text-stone-500">
                      {isReferenceDragActive
                        ? t("imageWorkbench.dropReferences")
                        : t("imageWorkbench.noReferences")}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">
                    {t("workbench.model")}
                  </span>
                  <ModelPicker
                    config={effectiveConfig}
                    value={model}
                    onChange={(value) => updateConfig("imageModel", value)}
                    capability="image"
                    fullWidth
                    onMissingConfig={() => openConfigDialog(false)}
                  />
                </label>
                <SettingsSummary
                  sizeLabel={imageSizeLabel(effectiveConfig.size || "auto")}
                  qualityLabel={imageQualityLabel(
                    effectiveConfig.quality || "auto"
                  )}
                  count={generationCount}
                  transparent={config.background === "transparent"}
                  autoStitch={Boolean(config.autoStitch)}
                  onAdjust={() => setSettingsOpen(true)}
                />
              </div>
            </div>

            <div className="mt-auto pt-6">
              <Button
                type="primary"
                size="large"
                block
                icon={<Sparkles className="size-4" />}
                loading={running}
                disabled={!canGenerate || running}
                onClick={() => void generate()}
              >
                {t("workbench.generate")}
              </Button>
            </div>
          </div>

          <div className="thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  {t("workbench.results")}
                </h2>
              </div>
              {running ? (
                <Tag className="m-0 px-2 py-1">
                  {t("workbench.waiting", { time: formatDuration(elapsedMs) })}
                </Tag>
              ) : null}
            </div>
            {results.length ? (
              /* 2026-08-28：composite + 下方 conditional block 包到同一个
               * wrapper 里（space-y-3）保证左对齐一致 —— 之前 composite
               * 在 `<div mb-4 flex justify-center>` 居中、ResultThumbnailStrip
               * 默认左对齐，stitched 完成后 composite 居中、N 张原图却左
               * 对齐，左右边对不齐，视觉"分开"。改成统一左对齐 + space-y-3
               * 控制两个区块的间距，整组视觉重量与 V1 SubmissionNode
               * stitched 分支保持一致（composite 上 + N 张原图下，同宽 360px）。 */
              <div className="space-y-3">
                {/* 2026-08-25：自动拼接宫格图 —— 开启 + 至少 2 张成功 → 在
                 * 结果区顶部额外展示一张宫格大图，下方仍是 N 张原图网格。
                 * 用户要求"宫格大图太大了，需要统一，而且也需要保留多个原图"——
                 * 宫格大图宽度限制 max-w-[360px]（与 V1 SubmissionNode 一致），
                 * 下面原图网格保留完整编辑 / 下载 / 收藏动作。结果区头部加
                 * ≡ icon chip 标识"宫格"，方便用户一眼区分。
                 *
                 * 2026-08-28：composite 不再外层居中容器（之前
                 * `<div mb-4 flex justify-center>`），由外层 wrapper
                 * `space-y-3` 统一控制间距，避免与下方 ResultThumbnailStrip
                 * 左对齐错位。 */}
                {stitchedComposite ? (
                  <div
                    className="group relative w-full max-w-[360px] overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800"
                    title={t("imageWorkbench.stitchedComposite")}
                  >
                    <Image
                      src={stitchedComposite.dataUrl}
                      alt={t("imageWorkbench.stitchedCompositeAlt")}
                      className="block w-full h-auto transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                    <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium leading-none">
                      <LayoutGrid className="size-3" />
                      {t("settingsPanels.image.autoStitch")}
                    </span>
                    {/* 下载按钮：直接复用 downloadImage(GeneratedImage) 形态 */}
                    <div className="absolute top-1.5 right-1.5">
                      <Tooltip title={t("common.download")}>
                        <Button
                          size="small"
                          type="text"
                          className="!h-7 !w-7 !bg-black/60 !p-0 !text-white hover:!bg-black/80"
                          icon={<Download className="size-3.5" />}
                          onClick={() => downloadImage(stitchedComposite, 0)}
                        />
                      </Tooltip>
                    </div>
                  </div>
                ) : null}
                {/* 2026-08-27：autoStitch 开启 + count ≥ 2 时：
                 *   - 生成中（全 pending 且未出 composite）→ 显示一张合并占位卡（PendingGridCard）
                 *     对齐 V1 SubmissionNode 视觉,避免 "4 张独立 spinner" 与
                 *     "最终会拼成 1 张宫格" 的心智冲突。
                 *   - 完成态（stitchedComposite 出）→ 顶部 composite 主导 + 下方
                 *     N 张原图压缩成 1 行缩略图条（ResultThumbnailStrip），保留
                 *     [[workbench-auto-stitch-coexist-with-originals]] 原图
                 *     编辑/下载/收藏入口,视觉重量较之前下降约 60%。
                 *   - 部分失败 / autoStitch 关 / count<2 → 仍走原 N 张独立卡 grid
                 *     让用户看到每张卡的 success/failed 状态。 */}
                {effectiveConfig.autoStitch &&
                generationCount >= 2 &&
                results.some((r) => r.status === "pending") &&
                !stitchedComposite ? (
                  <PendingGridCard count={generationCount} />
                ) : stitchedComposite ? (
                  <ResultThumbnailStrip
                    images={results
                      .filter(
                        (
                          r
                        ): r is GenerationResult & { image: GeneratedImage } =>
                          r.status === "success" && !!r.image
                      )
                      .map((r) => ({ id: r.id, image: r.image }))}
                    onEdit={addResultToReferences}
                    onDownload={downloadImage}
                    onSaveAsset={saveResultToAssets}
                  />
                ) : (
                  /* 非拼接的单次生成多张图:水平 flex-wrap,每张卡 w-[280px],
                   * 放不下自动换行(2026-08-28) —— 对齐 V1 SubmissionNode
                   * "水平排列,一行放不下才换行"的产品意图。之前是
                   * grid sm:grid-cols-2 2xl:grid-cols-3,1-2 张图时纵向堆,
                   * 与 V1 timeline 的横向行为不一致。 */
                  <div className="flex flex-wrap gap-4">
                    {results.map((result, index) =>
                      result.status === "success" && result.image ? (
                        <ResultImageCard
                          key={result.id}
                          image={result.image}
                          index={index}
                          onEdit={addResultToReferences}
                          onDownload={downloadImage}
                          onSaveAsset={saveResultToAssets}
                        />
                      ) : result.status === "failed" ? (
                        <FailedImageCard
                          key={result.id}
                          error={
                            result.error || t("workbench.generationFailed")
                          }
                          onRetry={() => retryResult(index)}
                        />
                      ) : (
                        <PendingImageCard key={result.id} />
                      )
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                <ImagePlus className="mb-4 size-11 text-stone-400" />
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("imageWorkbench.empty")}
                />
              </div>
            )}
          </div>
        </section>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void addReferences(event.target.files);
          event.target.value = "";
        }}
      />
      <Drawer
        title={t("workbench.logs")}
        placement="bottom"
        size="large"
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
      >
        <LogPanel
          logs={logs}
          selectedLogIds={selectedLogIds}
          activeLogId={previewLog?.id}
          onSelectedLogIdsChange={setSelectedLogIds}
          onCreateSession={createSession}
          onDeleteSelected={() => setDeleteConfirmOpen(true)}
          onPreviewLog={(log) => void previewGenerationLog(log)}
        />
      </Drawer>
      <Modal
        title={t("workbench.settings")}
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        footer={null}
        width={680}
        centered
        destroyOnHidden
      >
        <ImageSettingsPanel
          config={effectiveConfig}
          onConfigChange={(key, value) => updateConfig(key, value)}
          theme={canvasThemes[useThemeStore((state) => state.theme)]}
          showTitle={false}
          className="space-y-4"
          maxCount={10}
          showQuickCount={false}
        />
      </Modal>
      <SavePromptModal
        open={savePromptOpen}
        prompt={prompt}
        onClose={() => setSavePromptOpen(false)}
        onConfirm={handleConfirmSavePrompt}
      />
      <PromptSelectDialog
        open={promptLibraryOpen}
        onOpenChange={setPromptLibraryOpen}
        onSelect={(value) => setPrompt(value)}
      />
      <AssetPickerModal
        open={assetPickerOpen}
        onInsert={handleInsertAsset}
        onClose={() => setAssetPickerOpen(false)}
      />
      <Modal
        title={t("workbench.deleteLogs")}
        open={deleteConfirmOpen}
        onCancel={() => setDeleteConfirmOpen(false)}
        onOk={deleteSelectedLogs}
        okText={t("common.delete")}
        okButtonProps={{ danger: true }}
        cancelText={t("common.cancel")}
      >
        {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
      </Modal>
      {/* 2026-08-20：挂载 AppConfigModal 让 V2 工作台也能调起"内置/自定义"
          切换弹窗（之前只有画布编辑器的 app-top-nav.tsx 挂过，V2 工作台
          调 openConfigDialog(true) 弹窗不显示）。订阅 useConfigStore.isConfigOpen，
          自动响应 openConfigDialog(true/false) 调用。*/}
      <AppConfigModal />
    </div>
  );
}

/**
 * 收藏当前提示词的对话框 —— 让用户输入标题（必填），保存到 useMyPromptStore。
 *
 * 不让用户在 dialog 内编辑 prompt 文本（避免和主输入区不一致）—— 直接读主
 * 输入区的 prompt 快照。tags 在这里先不收（store 支持但 UI 暂不做，V1 工作台
 * 风格的"标题 + 标签"两步输入会显得重）。
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
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [title, setTitle] = useState("");

  // 关闭时清空 title，避免下次打开残留
  useEffect(() => {
    if (!open) setTitle("");
  }, [open]);

  const handleOk = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      message.warning(t("prompts.saveTitleRequired"));
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <Modal
      title={t("prompts.saveCurrent")}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText={t("common.save")}
      cancelText={t("common.cancel")}
      destroyOnHidden
      width={520}
    >
      <div className="space-y-3 py-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onPressEnter={handleOk}
          placeholder={t("prompts.saveTitlePlaceholder")}
          maxLength={64}
          autoFocus
        />
        <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-stone-400">
            {t("workbench.prompt")}
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
 * 设置摘要条 —— 把当前生效的生图参数压缩成一行可读的 chip 串，
 * 右侧"调整"按钮打开 SettingsModal。
 *
 * 设计要点：
 * - Model 已在摘要上方常驻展示，摘要只承载次级参数
 * - 字段顺序：宽高比 → 质量 → 张数 → (可选) 透明背景
 * - 字段之间用 "·" 分隔，溢出时用 truncate 截断
 * - transparent 仅在开启时显示 chip（开启是少数场景，默认隐藏降噪）
 */
function SettingsSummary({
  sizeLabel,
  qualityLabel,
  count,
  transparent,
  autoStitch,
  onAdjust,
}: {
  sizeLabel: string;
  qualityLabel: string;
  count: number;
  transparent: boolean;
  /**
   * 2026-08-25：自动拼接宫格图开关状态。开启时在摘要条多显示一段，
   * 让用户不进 Modal 也能看到当前开关状态（Modal 里有真正的 Switch）。
   */
  autoStitch: boolean;
  onAdjust: () => void;
}) {
  const { t } = useTranslation();
  const parts = [
    sizeLabel,
    qualityLabel,
    t("settingsPanels.image.images", { count }),
  ];
  if (transparent) parts.push(t("settingsPanels.image.transparent"));
  if (autoStitch) parts.push(t("settingsPanels.image.autoStitch"));
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-stone-500 dark:text-stone-400">
        {parts.map((part, index) => (
          <span key={`${part}-${index}`} className="flex items-center gap-x-2">
            {index > 0 ? (
              <span aria-hidden className="opacity-50">
                ·
              </span>
            ) : null}
            <span className="truncate">{part}</span>
          </span>
        ))}
      </div>
      <Button
        size="small"
        type="text"
        icon={<SlidersHorizontal className="size-4" />}
        onClick={onAdjust}
      >
        {t("workbench.adjust")}
      </Button>
    </div>
  );
}

function ResultImageCard({
  image,
  index,
  onEdit,
  onDownload,
  onSaveAsset,
}: {
  image: GeneratedImage;
  index: number;
  onEdit: (image: GeneratedImage, index: number) => void;
  onDownload: (image: GeneratedImage, index: number) => void;
  onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="w-[280px] shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
      <Image
        src={thumbnailUrl(image.dataUrl, 400)}
        alt={t("imageWorkbench.resultAlt", { count: index + 1 })}
        className="aspect-square object-cover"
      />
      <div className="space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
        <div className="flex min-w-0 gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
          <span>
            {image.width}x{image.height}
          </span>
          <span>{formatBytes(image.bytes)}</span>
          <span>{formatDuration(image.durationMs)}</span>
        </div>
        <div className="grid min-w-0 grid-cols-3 gap-2">
          <Tooltip title={t("common.addToAssets")}>
            <Button
              className={RESULT_ACTION_BUTTON_CLASS}
              size="small"
              icon={<FolderPlus className="size-3.5" />}
              onClick={() => void onSaveAsset(image, index)}
            ></Button>
          </Tooltip>
          <Tooltip title={t("imageWorkbench.addReference")}>
            <Button
              className={RESULT_ACTION_BUTTON_CLASS}
              size="small"
              icon={<PenLine className="size-3.5" />}
              onClick={() => void onEdit(image, index)}
            ></Button>
          </Tooltip>
          <Tooltip title={t("common.download")}>
            <Button
              className={RESULT_ACTION_BUTTON_CLASS}
              size="small"
              icon={<Download className="size-3.5" />}
              onClick={() => onDownload(image, index)}
            ></Button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function PendingImageCard() {
  const { t } = useTranslation();
  return (
    <div className="relative aspect-square w-[280px] shrink-0 overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
          backgroundSize: "16px 16px",
        }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
        <LoaderCircle className="size-6 animate-spin" />
        <span>{t("workbench.generating")}</span>
      </div>
    </div>
  );
}

/**
 * autoStitch 开启 + count ≥ 2 时,生成中只显示这一张合并占位卡,
 * 对齐 V1 SubmissionNode 的 processing 视觉 —— 一次提交 = 一个 spinner,
 * 而不是 N 张独立 spinner 与最终 "拼接成 1 张宫格" 的心智冲突。
 *
 * 仅生成中时(仍有 pending 但还没出 stitchedComposite)展示;
 * runBatchGeneration 完成 → status 切到 success/failed → 走回原 N 张卡
 * 的渲染分支显示 N 张原图 + 顶部宫格大图。
 */
function PendingGridCard({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <div className="relative overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 p-6 dark:border-stone-700 dark:bg-stone-900">
      <div className="flex items-start gap-3">
        <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-stone-500 dark:text-stone-400" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-stone-700 dark:text-stone-200">
            {t("workbench.generating")}
            <span className="ml-2 text-xs font-mono text-stone-500 dark:text-stone-400">
              · {count} {t("workbench.candidates")}
            </span>
          </p>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {t("imageWorkbench.stitchOnFinish", { count })}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * 宫格完成态下方的"N 张原图缩略图条"。
 *
 * 2026-08-27：B 方案 —— composite 在顶部占主导，下方 N 张原图从
 * `grid-cols-2 2xl:grid-cols-3`（每张占满宽 + 3 按钮大条）的独立卡
 * 压缩成 1 行 80×80 缩略图 + 紧凑按钮列，flex 横排。
 *
 * 仍保留 [[workbench-auto-stitch-coexist-with-originals]] 的原图
 * 编辑/下载/收藏入口（只是视觉压缩）；antd `<Image preview>` 仍支持
 * 点击放大。视觉重量较之前下降约 60%，与 360px 宫格并列时不再
 * 视觉打架。
 *
 * max-w-[360px] 与宫格大图同宽，4 个 80px cell + 3*8px gap ≈ 344px 装下。
 */
function ResultThumbnailStrip({
  images,
  onEdit,
  onDownload,
  onSaveAsset,
}: {
  images: { id?: string; image: GeneratedImage }[];
  onEdit: (image: GeneratedImage, index: number) => void;
  onDownload: (image: GeneratedImage, index: number) => void;
  onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex max-w-[360px] flex-wrap gap-2">
      {images.map(({ id, image }, index) => (
        <div
          key={id ?? image.dataUrl ?? `${index}`}
          className="flex w-[80px] flex-col overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800"
        >
          <Image
            src={thumbnailUrl(image.dataUrl, 160)}
            alt={t("imageWorkbench.resultAlt", { count: index + 1 })}
            className="!w-[80px] aspect-square object-cover"
            // 不主动打开 antd preview mask:缩略图就是入口,点开看大图由
            // 顶部 stitchedComposite 的 onClick 弹 lightbox 提供。
            preview={false}
          />
          <div className="flex border-t border-stone-200 dark:border-stone-800">
            <Tooltip title={t("common.addToAssets")}>
              <Button
                size="small"
                type="text"
                className="!h-6 !min-w-0 flex-1 !rounded-none !px-0"
                icon={<FolderPlus className="size-3" />}
                onClick={() => void onSaveAsset(image, index)}
              />
            </Tooltip>
            <Tooltip title={t("imageWorkbench.addReference")}>
              <Button
                size="small"
                type="text"
                className="!h-6 !min-w-0 flex-1 !rounded-none !px-0"
                icon={<PenLine className="size-3" />}
                onClick={() => onEdit(image, index)}
              />
            </Tooltip>
            <Tooltip title={t("common.download")}>
              <Button
                size="small"
                type="text"
                className="!h-6 !min-w-0 flex-1 !rounded-none !px-0"
                icon={<Download className="size-3" />}
                onClick={() => onDownload(image, index)}
              />
            </Tooltip>
          </div>
        </div>
      ))}
    </div>
  );
}

function FailedImageCard({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="w-[280px] shrink-0 overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
      <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
        <div className="text-sm font-medium text-red-600 dark:text-red-300">
          {t("workbench.failed")}
        </div>
        <Typography.Paragraph
          ellipsis={{ rows: 4 }}
          className="!mb-0 !text-xs !text-red-500 dark:!text-red-300"
        >
          {error}
        </Typography.Paragraph>
      </div>
      <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
        <Button size="small" danger onClick={onRetry}>
          {t("workbench.retry")}
        </Button>
      </div>
    </div>
  );
}

function updateResultAt(
  results: GenerationResult[],
  index: number,
  next: Partial<GenerationResult>
) {
  return results.map((item, itemIndex) =>
    itemIndex === index ? { ...item, ...next } : item
  );
}

function LogPanel({
  logs,
  selectedLogIds,
  activeLogId,
  onSelectedLogIdsChange,
  onCreateSession,
  onDeleteSelected,
  onPreviewLog,
}: {
  logs: GenerationLog[];
  selectedLogIds: string[];
  activeLogId?: string;
  onSelectedLogIdsChange: (ids: string[]) => void;
  onCreateSession: () => void;
  onDeleteSelected: () => void;
  onPreviewLog: (log: GenerationLog) => void;
}) {
  const { t } = useTranslation();
  const allSelected =
    Boolean(logs.length) && selectedLogIds.length === logs.length;
  const toggleAll = () =>
    onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
        </div>
        <Tag className="m-0">{logs.length}</Tag>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          size="small"
          icon={<Plus className="size-3.5" />}
          onClick={onCreateSession}
        >
          {t("workbench.new")}
        </Button>
        <Button
          size="small"
          icon={<CheckSquare className="size-3.5" />}
          disabled={!logs.length}
          onClick={toggleAll}
        >
          {allSelected ? t("common.cancel") : t("workbench.selectAll")}
        </Button>
        <Button
          size="small"
          danger
          icon={<Trash2 className="size-3.5" />}
          disabled={!selectedLogIds.length}
          onClick={onDeleteSelected}
        >
          {t("common.delete")}
        </Button>
      </div>
      <div className="space-y-3">
        {logs.map((log) => (
          <LogCard
            key={log.id}
            log={log}
            selected={selectedLogIds.includes(log.id)}
            active={activeLogId === log.id}
            onSelectedChange={(checked) =>
              onSelectedLogIdsChange(
                checked
                  ? [...selectedLogIds, log.id]
                  : selectedLogIds.filter((id) => id !== log.id)
              )
            }
            onClick={() => onPreviewLog(log)}
          />
        ))}
        {!logs.length ? (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">
            {t("workbench.noLogs")}
          </div>
        ) : null}
      </div>
    </>
  );
}

function LogCard({
  log,
  selected,
  active,
  onSelectedChange,
  onClick,
}: {
  log: GenerationLog;
  selected: boolean;
  active: boolean;
  onSelectedChange: (checked: boolean) => void;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const thumbnails = (log.thumbnails || []).filter(Boolean).slice(0, 4);

  return (
    <button
      type="button"
      className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
      onClick={onClick}
    >
      <div className="grid grid-cols-[minmax(128px,1fr)_auto] gap-2">
        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
          <Checkbox
            className="mt-0.5"
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onSelectedChange(event.target.checked)}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-5">
              {log.title}
            </div>
            {thumbnails.length ? (
              <div className="mt-2 flex gap-1 overflow-hidden">
                {thumbnails.map((image, index) => (
                  <img
                    key={`${log.id}-${index}`}
                    src={thumbnailUrl(image, 64)}
                    alt=""
                    className="size-8 shrink-0 rounded-md object-cover"
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid justify-items-end gap-2">
          <div className="flex gap-1">
            <Tag
              className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none"
              color="blue"
            >
              {t("workbench.successCount", {
                count: log.successCount ?? log.imageCount,
              })}
            </Tag>
            {log.failCount ? (
              <Tag
                className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none"
                color="red"
              >
                {t("workbench.failCount", { count: log.failCount })}
              </Tag>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">
              {t("workbench.itemCount", { count: log.imageCount })}
            </Tag>
            <Tag
              className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none"
              color="green"
            >
              {formatDuration(log.durationMs)}
            </Tag>
          </div>
          <div className="flex justify-end">
            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">
              {log.time}
            </Tag>
          </div>
        </div>
      </div>
    </button>
  );
}

async function readStoredLogs() {
  if (typeof window === "undefined") return [];
  try {
    const values: GenerationLog[] = [];
    await logStore.iterate<GenerationLog, void>((value) => {
      values.push(value);
    });
    const logs = await Promise.all(values.map(normalizeLog));
    return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch {
    return [];
  }
}

async function normalizeLog(
  log: Partial<GenerationLog>
): Promise<GenerationLog> {
  const references = await Promise.all(
    (log.references || []).map(async (item) => ({
      ...item,
      dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
    }))
  );
  const images = await Promise.all(
    (log.images || []).map(async (item) => ({
      ...item,
      dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
    }))
  );
  const config = normalizeLogConfig(log);
  return {
    id: log.id || nanoid(),
    createdAt: log.createdAt || Date.now(),
    title: log.title || log.model || i18n.t("workbench.untitled"),
    prompt: log.prompt || log.title || "",
    time:
      log.time ||
      new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
    model: log.model || config.imageModel || "",
    config,
    references,
    durationMs: log.durationMs || 0,
    successCount: log.successCount ?? log.imageCount ?? 0,
    failCount: log.failCount || 0,
    imageCount: log.imageCount || log.successCount || 0,
    size: log.size || config.size || "",
    quality: log.quality || config.quality || "",
    status: log.status || "success",
    images,
    thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
  };
}

function serializeLog(log: GenerationLog): GenerationLog {
  return {
    ...log,
    references: log.references.map((item) => ({
      ...item,
      dataUrl: item.storageKey ? "" : item.dataUrl,
    })),
    images: log.images.map((image) => ({
      ...image,
      dataUrl: image.storageKey ? "" : image.dataUrl,
    })),
    thumbnails: [],
  };
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
  return {
    model: log.config?.model || log.model || "",
    imageModel: log.config?.imageModel || log.model || "",
    quality: log.config?.quality || log.quality || "",
    size: log.config?.size || log.size || "",
    count: log.config?.count || String(log.imageCount || log.successCount || 1),
  };
}

function moveListItem<T>(items: T[], index: number, offset: number) {
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= items.length) return items;
  const next = [...items];
  const tmp = next[index];
  next[index] = next[targetIndex] as T;
  next[targetIndex] = tmp as T;
  return next;
}

function ReferenceOrderButtons({
  index,
  total,
  onMove,
}: {
  index: number;
  total: number;
  onMove: (offset: number) => void;
}) {
  if (total <= 1) return null;
  return (
    <div className="absolute inset-x-1 bottom-1 flex justify-between">
      <Button
        size="small"
        className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm"
        icon={<ArrowLeft className="size-3" />}
        disabled={index <= 0}
        onClick={() => onMove(-1)}
      />
      <Button
        size="small"
        className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm"
        icon={<ArrowRight className="size-3" />}
        disabled={index >= total - 1}
        onClick={() => onMove(1)}
      />
    </div>
  );
}

function buildLog({
  prompt,
  model,
  config,
  references,
  durationMs,
  successCount,
  failCount,
  status,
  images,
}: {
  prompt: string;
  model: string;
  config: GenerationLogConfig;
  references: ReferenceImage[];
  durationMs: number;
  successCount: number;
  failCount: number;
  status: GenerationLog["status"];
  images: GeneratedImage[];
}): GenerationLog {
  const logConfig = {
    model: config.model,
    imageModel: config.imageModel,
    quality: config.quality,
    size: config.size,
    count: config.count,
  };
  return {
    id: nanoid(),
    createdAt: Date.now(),
    title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
    prompt,
    time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
    model,
    config: logConfig,
    references,
    durationMs,
    successCount,
    failCount,
    imageCount: Number(logConfig.count) || successCount,
    size: logConfig.size,
    quality: logConfig.quality,
    status,
    images,
    thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
  };
}
