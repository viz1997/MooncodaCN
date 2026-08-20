// @ts-nocheck

/**
 * 提示词选择对话框 —— 三 Tab 合一：
 *   1. 外部源（usePromptList → usePromptSourceStore 后端的 GitHub raw JSON）
 *   2. 模板库（/api/image-gen/prompt-templates → promptTemplate 表，非管理员可读）
 *   3. 我的提示词（useMyPromptStore → localforage，用户自存）
 *
 * 每个 Tab 独立的搜索 + 网格 + 选中回调。统一 onSelect(string) 输出提示词文本。
 *
 * 设计取舍：
 *   - 用 antd Tabs 而不是自实现 tabs，跟画布其他 dialog（AssetPickerModal / ModelPicker 等）一致
 *   - 我的提示词 Tab 是只读 + 删除，不在 dialog 里加编辑（编辑入口在「我的资产」页更顺）
 *   - 模板库 Tab 显示 DB 模板时直接渲染模板的 prompt（含 {{变量}}），调用方
 *     负责后续替换逻辑 —— V2 工作台目前只把模板文本灌进 prompt 输入框，
 *     不做变量替换，因为变量替换需要 UI（让用户填 value）
 */

import { useQuery } from "@tanstack/react-query";
import {
  App,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Spin,
  Tabs,
  Tag,
  Tooltip,
} from "antd";
import {
  FolderPlus,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { type UIEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/features/canvas/lib/utils";
import { ALL_PROMPTS_OPTION } from "@/features/canvas/services/api/prompts";
import {
  type SavedPrompt,
  useMyPromptStore,
} from "@/features/canvas/stores/use-my-prompt-store";
import { PromptCard } from "./prompt-card";
import { usePromptList } from "./use-prompt-list";

type DbTemplate = {
  id: string;
  name: string;
  description?: string | null;
  prompt: string;
  coverUrl?: string | null;
  candidateCount?: number | null;
  variables?: Array<{
    key: string;
    label: string;
    required?: boolean;
    defaultValue?: string;
  }>;
};

type DbTemplateListResponse = {
  success: boolean;
  data?: { templates: DbTemplate[] };
  error?: string;
};

async function fetchDbTemplates(): Promise<DbTemplate[]> {
  const res = await fetch("/api/image-gen/prompt-templates", {
    method: "GET",
    credentials: "include",
  });
  const body = (await res.json()) as DbTemplateListResponse;
  if (!res.ok || !body.success) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data?.templates ?? [];
}

export function PromptSelectDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (prompt: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      title={t("prompts.library")}
      open={open}
      onCancel={() => onOpenChange(false)}
      footer={null}
      width={880}
      centered
    >
      <PromptLibraryContent
        onSelect={onSelect}
        onClose={() => onOpenChange(false)}
      />
    </Modal>
  );
}

/**
 * 「加入我的资产」回调入参 —— 携带足够元数据以便调用方写入 AssetStore。
 *
 * 不强行约束 source 字符串，调用方按来源 Tab 自己填（"External" /
 * "Templates" / "My Prompts" 等），metadata 留给调用方记录额外信息
 * （如 GitHub URL / templateId）。
 */
export type AddPromptToAssetsPayload = {
  prompt: string;
  title: string;
  source: string;
  coverUrl?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

/**
 * 提示词库主体内容 —— 三 Tab 合一：
 *   1. external：usePromptList → 后端 GitHub raw JSON
 *   2. templates：/api/image-gen/prompt-templates → promptTemplate 表
 *   3. mine：useMyPromptStore → localforage，用户自存
 *
 * 不包 Modal —— 既可被 PromptSelectDialog 包成弹窗，也可被 PromptLibraryView
 * 独立成页（/dashboard/prompts）。
 *
 * - onSelect：点击卡片主区域触发（弹窗模式 = "使用此提示词"；页面模式 = 复制到剪贴板）
 * - onClose：可选；弹窗模式必传（关闭 modal），页面模式可省略
 * - onAddToAssets：可选；只在独立成页时传入，每张卡渲染"加入我的资产"按钮
 */
export function PromptLibraryContent({
  onSelect,
  onClose,
  onAddToAssets,
  className,
}: {
  onSelect: (prompt: string) => void;
  onClose?: () => void;
  onAddToAssets?: (payload: AddPromptToAssetsPayload) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"external" | "templates" | "mine">(
    "external"
  );

  return (
    <div className={className}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) =>
          setActiveTab(key as "external" | "templates" | "mine")
        }
        destroyOnHidden
        items={[
          {
            key: "external",
            label: t("prompts.tabs.external"),
            children: (
              <ExternalPromptTab
                onSelect={onSelect}
                onClose={onClose}
                onAddToAssets={onAddToAssets}
              />
            ),
          },
          {
            key: "templates",
            label: t("prompts.tabs.templates"),
            children: (
              <TemplatesTab
                onSelect={onSelect}
                onClose={onClose}
                onAddToAssets={onAddToAssets}
              />
            ),
          },
          {
            key: "mine",
            label: t("prompts.tabs.mine"),
            children: (
              <MyPromptsTab
                onSelect={onSelect}
                onClose={onClose}
                onAddToAssets={onAddToAssets}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * 外部源 Tab —— 现有 usePromptList 行为
 */
function ExternalPromptTab({
  onSelect,
  onClose,
  onAddToAssets,
}: {
  onSelect: (prompt: string) => void;
  onClose?: () => void;
  onAddToAssets?: (payload: AddPromptToAssetsPayload) => void;
}) {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
  const {
    query,
    items,
    tags: promptTags,
    categories: promptCategories,
  } = usePromptList({
    keyword,
    tags: selectedTags,
    category: selectedCategory,
    enabled: true,
  });
  const toggleTag = (tag: string) => {
    if (tag === ALL_PROMPTS_OPTION) return setSelectedTags([]);
    setSelectedTags((items) =>
      items.includes(tag)
        ? items.filter((item) => item !== tag)
        : [...items, tag]
    );
  };
  const selectPrompt = (prompt: string) => {
    onSelect(prompt);
    onClose?.();
  };
  const handleAddToAssets = (item: (typeof items)[number]) => {
    onAddToAssets?.({
      prompt: item.prompt,
      title: item.title,
      coverUrl: item.coverUrl,
      tags: item.tags,
      source: item.category,
      metadata: {
        source: "prompt-library:external",
        promptId: item.id,
        githubUrl: item.githubUrl,
      },
    });
  };

  useEffect(() => {
    if (query.isError)
      message.error(
        query.error instanceof Error
          ? query.error.message
          : t("prompts.loadFailed")
      );
  }, [message, query.error, query.isError, t]);

  const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (
      query.hasNextPage &&
      !query.isFetchingNextPage &&
      target.scrollTop + target.clientHeight >= target.scrollHeight - 160
    )
      void query.fetchNextPage();
  };

  return (
    <div
      className="grid h-[62dvh] min-h-0 gap-5 sm:grid-cols-[200px_minmax(0,1fr)]"
      data-canvas-no-zoom
      onWheelCapture={(event) => event.stopPropagation()}
    >
      <aside className="thin-scrollbar min-h-0 overflow-y-auto border-r border-stone-200 pr-4 dark:border-stone-800">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">
          {t("prompts.category")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {promptCategories.map((category) => (
            <Tag.CheckableTag
              key={category}
              checked={selectedCategory === category}
              className={cn(
                "prompt-filter-tag",
                selectedCategory === category && "is-active"
              )}
              onChange={() => setSelectedCategory(category)}
            >
              {category === ALL_PROMPTS_OPTION ? t("common.all") : category}
            </Tag.CheckableTag>
          ))}
        </div>
        <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">
          {t("prompts.tags")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {promptTags.map((tag) => {
            const active =
              tag === ALL_PROMPTS_OPTION
                ? selectedTags.length === 0
                : selectedTags.includes(tag);
            return (
              <Tag.CheckableTag
                key={tag}
                checked={active}
                className={cn("prompt-filter-tag", active && "is-active")}
                onChange={() => toggleTag(tag)}
              >
                {tag === ALL_PROMPTS_OPTION ? t("common.all") : tag}
              </Tag.CheckableTag>
            );
          })}
        </div>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col">
        <Input
          size="large"
          prefix={<Search className="size-4 text-stone-400" />}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t("prompts.searchTitle")}
        />
        <div
          className="thin-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-2"
          data-canvas-no-zoom
          onScroll={handleListScroll}
          onWheelCapture={(event) => event.stopPropagation()}
        >
          {query.isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Spin />
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {items.map((item) => (
              <PromptCard
                key={item.id}
                item={item}
                onOpen={() => selectPrompt(item.prompt)}
                onCopy={() => selectPrompt(item.prompt)}
                compact
                extraAction={
                  onAddToAssets ? (
                    <Button
                      size="small"
                      type="primary"
                      icon={<FolderPlus className="size-3.5" />}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleAddToAssets(item);
                      }}
                    >
                      {t("common.addToAssets")}
                    </Button>
                  ) : null
                }
              />
            ))}
          </div>
          {!query.isLoading && items.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("prompts.empty")}
              className="py-8"
            />
          ) : null}
          {query.isFetchingNextPage ? (
            <div className="py-4 text-center">
              <Spin size="small" />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/**
 * 模板库 Tab —— 走 DB promptTemplate 表（非管理员可读）
 */
function TemplatesTab({
  onSelect,
  onClose,
  onAddToAssets,
}: {
  onSelect: (prompt: string) => void;
  onClose?: () => void;
  onAddToAssets?: (payload: AddPromptToAssetsPayload) => void;
}) {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState("");
  const query = useQuery({
    queryKey: ["prompt-templates"],
    queryFn: fetchDbTemplates,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.isError)
      message.error(
        query.error instanceof Error
          ? query.error.message
          : t("prompts.templatesLoadFailed")
      );
  }, [message, query.error, query.isError, t]);

  const filtered = useMemo(() => {
    const list = query.data ?? [];
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return list;
    return list.filter((item) =>
      [item.name, item.description ?? "", item.prompt]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [keyword, query.data]);

  const selectPrompt = (prompt: string) => {
    onSelect(prompt);
    onClose?.();
  };
  const handleAddToAssets = (item: DbTemplate) => {
    onAddToAssets?.({
      prompt: item.prompt,
      title: item.name,
      coverUrl: item.coverUrl ?? undefined,
      tags: undefined,
      source: "Templates",
      metadata: {
        source: "prompt-library:templates",
        templateId: item.id,
      },
    });
  };

  return (
    <div
      className="flex h-[62dvh] min-h-0 flex-col"
      data-canvas-no-zoom
      onWheelCapture={(event) => event.stopPropagation()}
    >
      <Input
        size="large"
        prefix={<Search className="size-4 text-stone-400" />}
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder={t("prompts.searchTitle")}
      />
      <div className="thin-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-2">
        {query.isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Spin />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <TemplateCard
              key={item.id}
              item={item}
              onUse={() => selectPrompt(item.prompt)}
              onAddToAssets={
                onAddToAssets ? () => handleAddToAssets(item) : undefined
              }
            />
          ))}
        </div>
        {!query.isLoading && filtered.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("prompts.empty")}
            className="py-8"
          />
        ) : null}
      </div>
    </div>
  );
}

function TemplateCard({
  item,
  onUse,
  onAddToAssets,
}: {
  item: DbTemplate;
  onUse: () => void;
  onAddToAssets?: () => void;
}) {
  const { t } = useTranslation();
  const variableCount = item.variables?.length ?? 0;
  return (
    <button
      type="button"
      onClick={onUse}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500"
    >
      {item.coverUrl ? (
        <img
          src={item.coverUrl}
          alt={item.name}
          className="aspect-[4/3] w-full object-cover"
        />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-3 text-center text-xs leading-5 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          {item.name}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="line-clamp-1 text-xs font-medium text-stone-800 dark:text-stone-200">
            {item.name}
          </span>
          {variableCount > 0 ? (
            <Tag className="m-0 shrink-0 text-[10px]">
              {t("common.variables", { count: variableCount }) ||
                `${variableCount} vars`}
            </Tag>
          ) : null}
        </div>
        {item.description ? (
          <p className="line-clamp-2 text-[11px] leading-4 text-stone-500 dark:text-stone-400">
            {item.description}
          </p>
        ) : null}
      </div>
      {onAddToAssets ? (
        <div className="absolute right-2 bottom-2 opacity-0 transition group-hover:opacity-100">
          <Button
            size="small"
            type="primary"
            icon={<FolderPlus className="size-3.5" />}
            onClick={(event) => {
              event.stopPropagation();
              onAddToAssets();
            }}
          >
            {t("common.addToAssets")}
          </Button>
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100">
        {t("prompts.use")}
      </div>
    </button>
  );
}

/**
 * 我的提示词 Tab —— localforage 用户自存提示词
 *
 * 支持：搜索、点击使用、删除。编辑入口留给后续「我的资产」页（dialog 里编辑
 * 太挤）。
 */
function MyPromptsTab({
  onSelect,
  onClose,
  onAddToAssets,
}: {
  onSelect: (prompt: string) => void;
  onClose?: () => void;
  onAddToAssets?: (payload: AddPromptToAssetsPayload) => void;
}) {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const prompts = useMyPromptStore((state) => state.prompts);
  const removePrompt = useMyPromptStore((state) => state.removePrompt);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return prompts;
    return prompts.filter((item) =>
      [item.title, item.prompt, ...item.tags]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [keyword, prompts]);

  const selectPrompt = (prompt: string) => {
    onSelect(prompt);
    onClose?.();
  };

  const handleAddToAssets = (item: SavedPrompt) => {
    onAddToAssets?.({
      prompt: item.prompt,
      title: item.title,
      coverUrl: "",
      tags: item.tags,
      source: "My Prompts",
      metadata: {
        source: "prompt-library:mine",
        promptId: item.id,
      },
    });
  };

  const handleDelete = (id: string) => {
    removePrompt(id);
    message.success(t("prompts.deleted"));
  };

  return (
    <div
      className="flex h-[62dvh] min-h-0 flex-col"
      data-canvas-no-zoom
      onWheelCapture={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <Input
          size="large"
          prefix={<Search className="size-4 text-stone-400" />}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t("prompts.searchTitle")}
          className="flex-1"
        />
        <Button
          type="primary"
          size="large"
          icon={<Plus className="size-4" />}
          onClick={() => setCreateOpen(true)}
        >
          {t("prompts.create")}
        </Button>
      </div>
      <div className="thin-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-2">
        {filtered.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              prompts.length === 0 ? t("prompts.mineEmpty") : t("prompts.empty")
            }
            className="py-8"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => (
              <MyPromptCard
                key={item.id}
                item={item}
                onUse={() => selectPrompt(item.prompt)}
                onDelete={() => handleDelete(item.id)}
                onAddToAssets={
                  onAddToAssets ? () => handleAddToAssets(item) : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
      <CreateMyPromptModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function MyPromptCard({
  item,
  onUse,
  onDelete,
  onAddToAssets,
}: {
  item: SavedPrompt;
  onUse: () => void;
  onDelete: () => void;
  onAddToAssets?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white transition hover:border-stone-400 hover:shadow-md dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500">
      <button
        type="button"
        onClick={onUse}
        className="flex flex-1 flex-col gap-1.5 p-2.5 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="line-clamp-1 text-xs font-medium text-stone-800 dark:text-stone-200">
            {item.title}
          </span>
          {item.tags.length > 0 ? (
            <Tag className="m-0 shrink-0 text-[10px]">{item.tags[0]}</Tag>
          ) : null}
        </div>
        <p className="line-clamp-4 whitespace-pre-wrap text-[11px] leading-5 text-stone-600 dark:text-stone-300">
          {item.prompt}
        </p>
      </button>
      <div className="flex items-center justify-between gap-2 border-t border-stone-200 px-2.5 py-1.5 dark:border-stone-800">
        <span className="text-[10px] text-stone-400">
          {new Date(item.createdAt).toLocaleDateString()}
        </span>
        <div className="flex items-center gap-1">
          {onAddToAssets ? (
            <Tooltip title={t("common.addToAssets")}>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onAddToAssets();
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              >
                <FolderPlus className="size-3" />
              </button>
            </Tooltip>
          ) : null}
          <Popconfirm
            title={t("prompts.deleteConfirm")}
            onConfirm={(e) => {
              e?.stopPropagation?.();
              onDelete();
            }}
            onCancel={(e) => e?.stopPropagation?.()}
            okText={t("common.delete")}
            cancelText={t("common.cancel")}
            okButtonProps={{ danger: true }}
          >
            <button
              type="button"
              onClick={(event) => event.stopPropagation()}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-stone-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
            >
              <Trash2 className="size-3" />
            </button>
          </Popconfirm>
        </div>
      </div>
    </div>
  );
}

/**
 * 「我的提示词」自建弹窗 —— 不依赖工作台当前输入，直接收集 标题 / 提示词正文 /
 * 可选标签 三项，写入 useMyPromptStore。
 *
 * 与 SavePromptModal（image-workbench.tsx 内）的区别：
 * - SavePromptModal 只能保存工作台当前 prompt；标题用户填，正文只读
 * - CreateMyPromptModal 完全自给自足，弹窗内允许自由编辑正文
 *
 * tags 用逗号或空白分隔，按非空 trim 后去重；空字符串允许（不存 tags）。
 * 校验：标题和正文都非空。
 */
function CreateMyPromptModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const addPrompt = useMyPromptStore((state) => state.addPrompt);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [expanded, setExpanded] = useState(false);

  // 关闭时清空，避免下次打开残留
  useEffect(() => {
    if (!open) {
      setTitle("");
      setPrompt("");
      setTagsText("");
      setExpanded(false);
    }
  }, [open]);

  const handleOk = () => {
    const trimmedTitle = title.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedTitle) {
      message.warning(t("prompts.saveTitleRequired"));
      return;
    }
    if (!trimmedPrompt) {
      message.warning(t("prompts.contentRequired"));
      return;
    }
    const tags = Array.from(
      new Set(
        tagsText
          .split(/[\s,，]+/u)
          .map((tag) => tag.trim())
          .filter(Boolean)
      )
    );
    addPrompt({ title: trimmedTitle, prompt: trimmedPrompt, tags });
    message.success(t("prompts.created"));
    onClose();
  };

  return (
    <>
      <Modal
        title={t("prompts.create")}
        open={open}
        onOk={handleOk}
        onCancel={onClose}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnHidden
        width={680}
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
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs text-stone-500 dark:text-stone-400">
                {t("prompts.contentLabel")}
              </span>
              <div className="flex items-center gap-2">
                <span className="hidden text-[10px] text-stone-400 sm:inline">
                  {t("prompts.resizeHint")}
                </span>
                <Tooltip title={t("prompts.expandEditor")}>
                  <Button
                    type="text"
                    size="small"
                    icon={<Maximize2 className="size-3.5" />}
                    onClick={() => setExpanded(true)}
                  />
                </Tooltip>
              </div>
            </div>
            <Input.TextArea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t("prompts.contentPlaceholder")}
              rows={10}
              style={{ resize: "vertical", minHeight: 220, maxHeight: 520 }}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-stone-500 dark:text-stone-400">
              {t("prompts.tagsLabel")}
            </div>
            <Input
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder={t("prompts.tagsHint")}
              maxLength={120}
            />
          </div>
        </div>
      </Modal>
      <Modal
        title={t("prompts.editorTitle")}
        open={expanded}
        onCancel={() => setExpanded(false)}
        footer={null}
        centered
        width={920}
        destroyOnHidden
      >
        <div className="flex h-[58dvh] min-h-72 flex-col gap-2 pt-2">
          <Input.TextArea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("prompts.contentPlaceholder")}
            className="!h-full"
            style={{ resize: "none" }}
            autoFocus
          />
          <div className="flex items-center justify-between text-[11px] text-stone-400">
            <span>{t("prompts.resizeHint")}</span>
            <Button
              type="text"
              size="small"
              icon={<Minimize2 className="size-3.5" />}
              onClick={() => setExpanded(false)}
            >
              {t("prompts.collapseEditor")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
