// @ts-nocheck

/**
 * 资产选择 Modal —— 两 Tab：
 *   1. 我的资产：本地 localforage 资产库（useAssetStore，含 text/image/video）
 *   2. 我的图片：服务端 photo 表（用户上传到 /dashboard/photos 的图片库）
 *
 * 选 image 资产时统一返回 InsertAssetPayload 的 image 形态：
 *   - 走 dataUrl + storageKey（如果有），调用方负责把 blob URL 转 R2 URL（参考
 *     gpt-image /p/[token] 的 use-order-actions 中的 presignOne + putToR2 模式）
 *
 * 视频 / 文本 Tab 仍只在「我的资产」里提供 —— 服务端 photo 表只存图片；
 * 这是和 admin-photos 区分的最简方式。
 *
 * 设计取舍：
 *   - 用 antd Tabs，跟 PromptSelectDialog 保持一致
 *   - 「我的图片」Tab 走 /api/image-gen/photos/list，仅当前用户可见，photo.userId 过滤
 *   - 两个 Tab 各自一套搜索 + 分页，状态独立
 */

import { useQuery } from "@tanstack/react-query";
import { Empty, Input, Modal, Pagination, Tabs, Tag } from "antd";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/features/canvas/lib/utils";
import {
  type Asset,
  useAssetStore,
} from "@/features/canvas/stores/use-asset-store";

export type InsertAssetPayload =
  | { kind: "text"; content: string; title: string }
  | { kind: "image"; dataUrl: string; title: string; storageKey?: string }
  | {
      kind: "video";
      url: string;
      title: string;
      storageKey?: string;
      width?: number;
      height?: number;
    };

type Props = {
  open: boolean;
  defaultTab?: string;
  onInsert: (payload: InsertAssetPayload) => void;
  onClose: () => void;
};

export function AssetPickerModal({ open, onInsert, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      title={t("canvas.assetPicker.title")}
      open={open}
      onCancel={onClose}
      footer={null}
      width={860}
      destroyOnHidden
      styles={{ body: { padding: "0 24px 24px", minHeight: 480 } }}
    >
      <AssetLibraryContent onInsert={onInsert} />
    </Modal>
  );
}

/**
 * 资产库主体内容 —— 两 Tab 合一：
 *   1. mine：本地 localforage 资产库（useAssetStore，text/image/video）
 *   2. photos：服务端 photo 表（用户上传到 /dashboard/photos 的图片库）
 *
 * 不包 Modal —— 既被 AssetPickerModal 包成弹窗，也被 AssetLibraryView
 * 独立成页（/dashboard/assets）。
 */
export function AssetLibraryContent({
  onInsert,
  className,
}: {
  onInsert: (payload: InsertAssetPayload) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={className}>
      <Tabs
        defaultActiveKey="mine"
        destroyOnHidden
        items={[
          {
            key: "mine",
            label: t("canvas.assetPicker.tabs.mine"),
            children: <MyAssetsTab onInsert={onInsert} />,
          },
          {
            key: "photos",
            label: t("canvas.assetPicker.tabs.photos"),
            children: <PhotosTab onInsert={onInsert} />,
          },
        ]}
      />
    </div>
  );
}

const PAGE_SIZE = 8;

const kindOptions = ["all", "text", "image", "video"];

function PickerCard({
  title,
  kind,
  cover,
  sourceLabel,
  onClick,
}: {
  title: string;
  kind: string;
  cover: string;
  sourceLabel?: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="group relative cursor-pointer overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500"
      onClick={onClick}
    >
      {cover ? (
        <img
          src={cover}
          alt={title}
          className="aspect-[4/3] w-full object-cover"
        />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-3 text-center text-xs leading-5 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          {title}
        </div>
      )}
      <div className="p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="line-clamp-1 text-xs font-medium text-stone-800 dark:text-stone-200">
            {title}
          </span>
          <Tag className="m-0 shrink-0 text-[10px]">
            {t(`assets.kinds.${kind}`)}
          </Tag>
        </div>
        {sourceLabel ? (
          <div className="mt-1 text-[10px] text-stone-400 dark:text-stone-500">
            {sourceLabel}
          </div>
        ) : null}
      </div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100">
        {t("canvas.assetPicker.insert")}
      </div>
    </button>
  );
}

function MyAssetsTab({
  onInsert,
}: {
  onInsert: (payload: InsertAssetPayload) => void;
}) {
  const { t } = useTranslation();
  const assets = useAssetStore((state) => state.assets);
  const [keyword, setKeyword] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return assets
      .filter(
        (a) => a.kind === "text" || a.kind === "image" || a.kind === "video"
      )
      .filter((a) => kindFilter === "all" || a.kind === kindFilter)
      .filter(
        (a) =>
          !query ||
          [a.title, ...(a.tags || [])].join(" ").toLowerCase().includes(query)
      );
  }, [assets, keyword, kindFilter]);

  const visible = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    setPage((v) => Math.min(v, maxPage));
  }, [filtered.length]);

  const handleInsert = (asset: Asset) => {
    if (asset.kind === "text") {
      onInsert({
        kind: "text",
        content: asset.data.content,
        title: asset.title,
      });
    } else {
      onInsert(
        asset.kind === "video"
          ? {
              kind: "video",
              url: asset.data.url,
              storageKey: asset.data.storageKey,
              title: asset.title,
              width: asset.data.width,
              height: asset.data.height,
            }
          : {
              kind: "image",
              dataUrl: asset.data.dataUrl,
              storageKey: asset.data.storageKey,
              title: asset.title,
            }
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="w-56"
          size="small"
          prefix={<Search className="size-3.5 text-stone-400" />}
          placeholder={t("canvas.assetPicker.search")}
          value={keyword}
          allowClear
          onChange={(e) => {
            setPage(1);
            setKeyword(e.target.value);
          }}
        />
        <div className="flex gap-1.5">
          {kindOptions.map((option) => (
            <Tag.CheckableTag
              key={option}
              checked={kindFilter === option}
              className={cn(
                "prompt-filter-tag",
                kindFilter === option && "is-active"
              )}
              onChange={() => {
                setPage(1);
                setKindFilter(option);
              }}
            >
              {option === "all"
                ? t("canvas.assetPicker.typeFilter.all")
                : t(`canvas.assetPicker.typeFilter.${option}`)}
            </Tag.CheckableTag>
          ))}
        </div>
      </div>

      {visible.length ? (
        <div className="grid grid-cols-4 gap-3">
          {visible.map((asset) => (
            <PickerCard
              key={asset.id}
              title={asset.title}
              kind={asset.kind}
              cover={
                asset.coverUrl ||
                (asset.kind === "image" ? asset.data.dataUrl : "")
              }
              onClick={() => handleInsert(asset)}
            />
          ))}
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("canvas.assetPicker.empty")}
          className="py-12"
        />
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="flex justify-center">
          <Pagination
            size="small"
            current={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onChange={setPage}
            showSizeChanger={false}
          />
        </div>
      )}
    </div>
  );
}

/**
 * 我的图片 Tab —— 合并两个数据源：
 *   1. 服务端 photo 表（/api/image-gen/photos/list）—— 用户在「照片库」上传的参考图
 *   2. useAssetStore 中 kind="image" 的条目 —— 生图工作台「加入我的资产」保存的生成图
 *
 * 两个来源都标 source：photo 表用 fileName 作 title；asset-store 用 asset.title
 * + 卡片 Tag 区分（"生图工作台" vs "照片库"）。
 *
 * 这样生图工作台保存的图自然出现在「我的图片」Tab，不需要 R2 上传。
 */
function PhotosTab({
  onInsert,
}: {
  onInsert: (payload: InsertAssetPayload) => void;
}) {
  const { t, i18n } = useTranslation();
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  // 选择器必须返回稳定引用，否则 React useSyncExternalStore 检测到引用
  // 变化会判为 "store changed"，触发无限重渲染 —— 这里只取 state.assets
  // （本身在 store mutation 时才换引用），过滤挪到下面 useMemo 里做。
  const allAssets = useAssetStore((state) => state.assets);

  const query = useQuery({
    queryKey: ["asset-picker-photos"],
    queryFn: async () => {
      const res = await fetch("/api/image-gen/photos/list?limit=100", {
        method: "GET",
        credentials: "include",
      });
      const body = (await res.json()) as {
        success: boolean;
        data?: { photos: Photo[] };
        error?: string;
      };
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return body.data?.photos ?? [];
    },
    staleTime: 30_000,
  });

  // 合并：photo 表项 + 本地 asset image 项，统一为 PhotoEntry 形态
  const merged = useMemo<PhotoEntry[]>(() => {
    const fromServer: PhotoEntry[] = (query.data ?? []).map((item) => ({
      id: `photo:${item.id}`,
      title: item.fileName,
      cover: item.thumbnailUrl ?? item.fileUrl,
      source: "photo",
      photo: item,
    }));
    const fromAssets: PhotoEntry[] = allAssets
      .filter((asset) => asset.kind === "image")
      .map((asset) => ({
        id: `asset:${asset.id}`,
        title: asset.title,
        cover:
          asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : ""),
        source: "asset",
        asset,
      }));
    // 工作台保存的最新，按 createdAt 排前面；photo 表默认按 desc(createdAt) 服务端排好
    return [...fromAssets, ...fromServer];
  }, [allAssets, query.data]);

  const filtered = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return merged;
    return merged.filter((item) =>
      item.title.toLowerCase().includes(normalized)
    );
  }, [keyword, merged]);

  const visible = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    setPage((v) => Math.min(v, maxPage));
  }, [filtered.length]);

  const handleInsert = (entry: PhotoEntry) => {
    if (entry.source === "photo" && entry.photo) {
      onInsert({
        kind: "image",
        dataUrl: entry.photo.fileUrl,
        title: entry.photo.fileName,
      });
      return;
    }
    if (
      entry.source === "asset" &&
      entry.asset &&
      entry.asset.kind === "image"
    ) {
      onInsert({
        kind: "image",
        dataUrl: entry.asset.data.dataUrl,
        storageKey: entry.asset.data.storageKey,
        title: entry.asset.title,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="w-56"
          size="small"
          prefix={<Search className="size-3.5 text-stone-400" />}
          placeholder={t("canvas.assetPicker.search")}
          value={keyword}
          allowClear
          onChange={(e) => {
            setPage(1);
            setKeyword(e.target.value);
          }}
        />
        {query.isError ? (
          <span className="text-xs text-rose-500">
            {t("canvas.assetPicker.photosLoadFailed")}
          </span>
        ) : null}
      </div>

      {query.isLoading ? (
        <div className="flex items-center justify-center py-12 text-xs text-stone-400">
          {t("common.loading")}
        </div>
      ) : visible.length ? (
        <div className="grid grid-cols-4 gap-3">
          {visible.map((entry) => (
            <PickerCard
              key={entry.id}
              title={entry.title}
              kind="image"
              cover={entry.cover}
              sourceLabel={
                entry.source === "asset"
                  ? t("imageWorkbench.source")
                  : t("canvas.assetPicker.tabs.photos")
              }
              onClick={() => handleInsert(entry)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-12">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("canvas.assetPicker.photosEmpty")}
            className="py-2"
          />
          <a
            href={`/${i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en"}/dashboard/photos`}
            className="text-xs text-primary hover:underline"
          >
            {t("canvas.assetPicker.goUpload")}
          </a>
        </div>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="flex justify-center">
          <Pagination
            size="small"
            current={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onChange={setPage}
            showSizeChanger={false}
          />
        </div>
      )}
    </div>
  );
}

/**
 * photo 表行类型 —— 与 db.schema 中 photo 表的查询形态对齐。
 *
 * 不直接 import @/db/schema 是为了不把服务端 drizzle 类型拽到客户端组件；
 * 这个 type 是结构性子集，足以覆盖 UI 所需的字段。
 */
type Photo = {
  id: string;
  userId: string;
  fileName: string;
  fileUrl: string;
  thumbnailUrl?: string | null;
  width?: number | null;
  height?: number | null;
  format?: string | null;
  fileSize?: number | null;
  createdAt: string | Date;
};

/**
 * 我的图片 Tab 合并后的统一条目：
 *   - source="photo"：来自服务端 photo 表（用户上传的参考图）
 *   - source="asset"：来自 useAssetStore（生图工作台保存的生成图）
 *
 * 两种来源的 id 用前缀避免冲突（photo:{id} / asset:{id}）。
 */
type PhotoEntry = {
  id: string;
  title: string;
  cover: string;
  source: "photo" | "asset";
  photo?: Photo;
  asset?: Asset;
};
