"use client";

/**
 * 后台文件管理 —— /admin/files
 *
 * 工作室所有文件都落在 Cloudflare R2 的一个桶里。这一页是**整个桶**的浏览器:
 * 进目录、复制链接、下载、预览、删除。
 *
 * ## 落地页停在 `print-orders/`
 *
 * 桶里有 7 个前缀,工作室日常要看的只有「打印模型」那一支。所以默认落在
 * `print-orders/`,但面包屑能一路走回根目录 —— 其它前缀随时能看。
 *
 * ## 「文件夹 + 文件」两层视图
 *
 * 服务端列目录用的是 `Delimiter: "/"`:
 *
 * - `CommonPrefixes` = 这一层的**子目录**
 * - `Contents` = 这一层**直接放着**的文件
 *
 * 所以界面上是两张表(目录一张、文件一张),不是一棵无限展开的树 —— 一层一层
 * 点进去,跟网盘一个样。
 *
 * ## 归属是**反查**出来的
 *
 * 打印模型的目录名是 `sha256(userId)` 的前 16 位(`print-orders/a08b4fd7fed13968/`),
 * 光看这个认不出是谁传的。服务端把用户表里每个 id 都算一遍哈希建一张
 * 「哈希 → 用户」的表,反查得到就显示用户名 + 邮箱,认不出就摆「—」。
 *
 * ## 删除大概率会失败 —— 而且失败是**预期内**的
 *
 * 这个桶的桶策略锁着对象(`ObjectLockedByBucketPolicy`,HTTP 409),桶策略在
 * Cloudflare 后台配,**代码改不了**。所以界面上对那个错单独摆一句话:
 * 「要去 Cloudflare 后台改桶策略」,而不是一句没用的「请稍后重试」。
 *
 * 哪天桶策略解锁了,这个按钮**不用改**就能删。
 */

import { App, Button, Input, Select } from "antd";
import {
  Copy,
  Download,
  Eye,
  FileArchive,
  FileBox,
  File as FileIcon,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SafeImage } from "@/features/image-gen/components/safe-image";
import {
  EmptyState,
  formatDate,
  formatFileSize,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import {
  adminDeleteFileAction,
  adminGetFileDownloadAction,
  adminListFilesAction,
} from "@/features/storage/admin/actions";
import { buildBreadcrumb, fileKind } from "@/features/storage/admin/lib/paths";
import type {
  AdminFileFolder,
  AdminFileObject,
  AdminFilesErrorCode,
  AdminListFilesResult,
} from "@/features/storage/admin/types";
import { cn } from "@/lib/utils";

/** 落地页默认停在这一层 —— 工作室日常看的是打印模型 */
const DEFAULT_PREFIX = "print-orders/";

/** 排序方式 */
type SortKey = "timeDesc" | "timeAsc" | "sizeDesc";

/**
 * 错误码 → i18n key
 *
 * 模块级常量 —— 不放组件里,免得每次渲染都造一个新对象(那会让
 * `useEffect` 的依赖一变就重跑,变成死循环刷 R2)。
 *
 * 界面上按码查文案,**认不出来的码退回笼统那句** —— 不摆 key 名。
 */
const ERROR_KEY: Record<AdminFilesErrorCode, string> = {
  R2_NOT_CONFIGURED: "errors.R2_NOT_CONFIGURED",
  INVALID_PREFIX: "errors.INVALID_PREFIX",
  INVALID_KEY: "errors.INVALID_KEY",
  LIST_FAILED: "errors.LIST_FAILED",
  R2_DELETE_BLOCKED: "errors.R2_DELETE_BLOCKED",
  NOT_FOUND: "errors.NOT_FOUND",
  DELETE_FAILED: "errors.DELETE_FAILED",
  DOWNLOAD_FAILED: "errors.DOWNLOAD_FAILED",
};

/** 文件种类 → 图标 */
const KIND_ICON = {
  image: FileImage,
  model: FileBox,
  archive: FileArchive,
  document: FileText,
  other: FileIcon,
} as const;

/** 文件种类 → i18n key */
const KIND_KEY = {
  image: "types.image",
  model: "types.model",
  archive: "types.archive",
  document: "types.document",
  other: "types.other",
} as const;

export function FilesAdminView() {
  const { message, modal } = App.useApp();
  const t = useTranslations("AdminFiles");

  /** 当前所在的前缀(根是 `""`) */
  const [prefix, setPrefix] = useState(DEFAULT_PREFIX);
  /** 这一层的子目录 */
  const [folders, setFolders] = useState<AdminFileFolder[]>([]);
  /** 这一层直接放着的文件 */
  const [files, setFiles] = useState<AdminFileObject[]>([]);
  /** 下一页的游标;null = 没有下一页 */
  const [nextToken, setNextToken] = useState<string | null>(null);
  /** 公开访问域名配了没 —— 没配就不摆缩略图(那是一排裂图) */
  const [publicBaseConfigured, setPublicBaseConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 文件名过滤(当前层内) */
  const [nameFilter, setNameFilter] = useState("");
  /** 排序 */
  const [sort, setSort] = useState<SortKey>("timeDesc");

  /**
   * 拉一层目录 —— 只取数,不碰状态
   *
   * 依赖是空的 ⇒ 这个函数**永远稳定** ⇒ 下面那些 `useCallback` 也不会
   * 因为它而变身份。
   */
  const fetchListing = useCallback(
    async (
      target: string,
      token?: string
    ): Promise<AdminListFilesResult | null> => {
      try {
        const res = await adminListFilesAction({
          prefix: target,
          ...(token ? { continuationToken: token } : {}),
        });
        const data = res?.data;
        if (!data) return null;
        return data;
      } catch {
        return null;
      }
    },
    []
  );

  /** 把一次列目录的结果铺到状态上 */
  const applyListing = useCallback(
    (result: AdminListFilesResult | null) => {
      if (!result) {
        message.error(t("messages.loadFailed"));
        return;
      }
      if (!result.ok) {
        message.error(t(ERROR_KEY[result.code] ?? "errors.LIST_FAILED"));
        return;
      }
      setFolders(result.listing.folders);
      setFiles(result.listing.files);
      setNextToken(result.listing.nextContinuationToken);
      setPublicBaseConfigured(result.listing.publicBaseConfigured);
    },
    [message, t]
  );

  /** 重新拉当前这一层(换目录 / 刷新 / 删完一个文件之后) */
  const reload = useCallback(
    async (target: string) => {
      setLoading(true);
      try {
        const result = await fetchListing(target);
        applyListing(result);
      } finally {
        setLoading(false);
      }
    },
    [applyListing, fetchListing]
  );

  // 换目录就重新拉 —— 依赖是前缀本身(primitive),`reload` 稳定
  useEffect(() => {
    void reload(prefix);
  }, [prefix, reload]);

  /** 进一个子目录 */
  const openFolder = useCallback((target: string) => {
    setNameFilter("");
    setPrefix(target);
  }, []);

  /** 加载更多(翻页) */
  const loadMore = useCallback(async () => {
    if (!nextToken) return;
    setLoadingMore(true);
    try {
      const result = await fetchListing(prefix, nextToken);
      if (!result) {
        message.error(t("messages.loadMoreFailed"));
        return;
      }
      if (!result.ok) {
        message.error(t(ERROR_KEY[result.code] ?? "errors.LIST_FAILED"));
        return;
      }
      // 追加 —— 不是替换
      setFolders((prev) => [...prev, ...result.listing.folders]);
      setFiles((prev) => [...prev, ...result.listing.files]);
      setNextToken(result.listing.nextContinuationToken);
    } finally {
      setLoadingMore(false);
    }
  }, [fetchListing, message, nextToken, prefix, t]);

  /** 复制公开链接 */
  const copyLink = useCallback(
    async (file: AdminFileObject) => {
      if (!publicBaseConfigured) {
        message.warning(t("messages.publicBaseMissing"));
        return;
      }
      try {
        await navigator.clipboard.writeText(file.publicUrl);
        message.success(t("messages.copied"));
      } catch {
        message.error(t("messages.copyFailed"));
      }
    },
    [message, publicBaseConfigured, t]
  );

  const { executeAsync: getDownloadUrl } = useAction(
    adminGetFileDownloadAction
  );

  /**
   * 打开一个文件
   *
   * `inline` = 让浏览器自己决定(图片看图);`attachment` = 强制存成文件
   * (模型 zip 在浏览器里打开就是一堆乱码)。
   */
  const openFile = useCallback(
    async (file: AdminFileObject, disposition: "inline" | "attachment") => {
      const res = await getDownloadUrl({ key: file.key, disposition });
      const data = res?.data;
      if (!data) {
        message.error(t("messages.downloadFailed"));
        return;
      }
      if (!data.ok) {
        message.error(t(ERROR_KEY[data.code] ?? "errors.DOWNLOAD_FAILED"));
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    },
    [getDownloadUrl, message, t]
  );

  const { executeAsync: deleteFile } = useAction(adminDeleteFileAction);

  /** 删除 —— 二次确认 */
  const requestDelete = useCallback(
    (file: AdminFileObject) => {
      modal.confirm({
        title: t("messages.deleteTitle"),
        content: t("messages.deleteContent", { key: file.key }),
        okText: t("actions.delete"),
        cancelText: t("actions.cancel"),
        okButtonProps: { danger: true },
        onOk: async () => {
          const res = await deleteFile({ key: file.key });
          const data = res?.data;
          if (!data) {
            message.error(t("messages.deleteFailed"));
            return;
          }
          if (!data.ok) {
            // 桶策略锁着 → 那句话要说清楚「重试没用」
            message.error(t(ERROR_KEY[data.code] ?? "errors.DELETE_FAILED"));
            return;
          }
          message.success(t("messages.deleteSuccess"));
          void reload(prefix);
        },
      });
    },
    [deleteFile, message, modal, prefix, reload, t]
  );

  /** 面包屑 */
  const crumbs = useMemo(() => buildBreadcrumb(prefix), [prefix]);

  /** 过滤 + 排序后的文件 */
  const visibleFiles = useMemo(() => {
    const needle = nameFilter.trim().toLowerCase();
    const list = needle
      ? files.filter((f) => f.name.toLowerCase().includes(needle))
      : files;
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sort === "sizeDesc") return b.size - a.size;
      const at = a.lastModified ? Date.parse(a.lastModified) : 0;
      const bt = b.lastModified ? Date.parse(b.lastModified) : 0;
      return sort === "timeAsc" ? at - bt : bt - at;
    });
    return sorted;
  }, [files, nameFilter, sort]);

  /** 当前层的合计 */
  const totalSize = useMemo(
    () => files.reduce((sum, f) => sum + f.size, 0),
    [files]
  );

  const isEmpty = folders.length === 0 && files.length === 0;

  return (
    <div>
      <ModuleHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void reload(prefix)}
            loading={loading}
          >
            {t("actions.refresh")}
          </Button>
        }
      />

      {/* 面包屑 —— 点哪一节回哪一层 */}
      <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        <button
          type="button"
          onClick={() => openFolder("")}
          className={cn(
            "rounded px-1.5 py-0.5 hover:bg-muted",
            prefix === "" && "font-semibold text-foreground"
          )}
        >
          {t("breadcrumb.root")}
        </button>
        {crumbs.map((crumb, i) => (
          <span key={crumb.prefix} className="flex items-center gap-1">
            <span className="text-muted-foreground">/</span>
            <button
              type="button"
              onClick={() => openFolder(crumb.prefix)}
              className={cn(
                "rounded px-1.5 py-0.5 hover:bg-muted",
                i === crumbs.length - 1 && "font-semibold text-foreground"
              )}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      {/* 工具条 —— 过滤 + 排序 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          prefix={<Search className="h-4 w-4 text-muted-foreground" />}
          placeholder={t("filter.placeholder")}
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          allowClear
        />
        <Select
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
          className="w-40"
          options={[
            { value: "timeDesc", label: t("sort.timeDesc") },
            { value: "timeAsc", label: t("sort.timeAsc") },
            { value: "sizeDesc", label: t("sort.sizeDesc") },
          ]}
        />
      </div>

      {/* 子目录 */}
      {folders.length > 0 && (
        <div className="mb-4 rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">
                    {t("table.folder")}
                  </th>
                  <th className="text-left font-medium px-3 py-2">
                    {t("table.owner")}
                  </th>
                  <th className="text-right font-medium px-3 py-2">
                    {t("table.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {folders.map((folder) => (
                  <tr key={folder.prefix} className="hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => openFolder(folder.prefix)}
                        className="flex items-center gap-2 text-left hover:underline"
                      >
                        <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                        <span className="truncate">{folder.name}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {folder.owner ? (
                        <span>
                          {folder.owner.name}
                          <span className="ml-1 opacity-70">
                            {folder.owner.email}
                          </span>
                        </span>
                      ) : (
                        t("owner.unknown")
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="small"
                        icon={<FolderOpen className="h-3.5 w-3.5" />}
                        onClick={() => openFolder(folder.prefix)}
                      >
                        {t("actions.open")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 文件 */}
      {loading && files.length === 0 && folders.length === 0 ? (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-6">
            <EmptyState
              icon={Loader2}
              title={t("messages.loading")}
              description={t("messages.loadingHint")}
            />
          </div>
        </div>
      ) : isEmpty ? (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-6">
            <EmptyState
              icon={FolderOpen}
              title={t("messages.empty")}
              description={t("messages.emptyHint")}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">
                    {t("table.name")}
                  </th>
                  <th className="text-right font-medium px-3 py-2">
                    {t("table.size")}
                  </th>
                  <th className="text-left font-medium px-3 py-2">
                    {t("table.type")}
                  </th>
                  <th className="text-left font-medium px-3 py-2">
                    {t("table.owner")}
                  </th>
                  <th className="text-left font-medium px-3 py-2">
                    {t("table.updatedAt")}
                  </th>
                  <th className="text-right font-medium px-3 py-2">
                    {t("table.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleFiles.map((file) => {
                  const kind = fileKind(file.key);
                  const Icon = KIND_ICON[kind];
                  return (
                    <tr key={file.key} className="hover:bg-muted/20">
                      <td className="px-3 py-2 max-w-72">
                        <div className="flex items-center gap-2">
                          {/* 缩略图只在公开域名配了的时候才摆 —— 否则是一排裂图 */}
                          {file.isImage && publicBaseConfigured ? (
                            <SafeImage
                              src={file.publicUrl}
                              alt={file.name}
                              className="h-8 w-8 shrink-0 rounded object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate text-xs" title={file.key}>
                            {file.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
                        {formatFileSize(file.size)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {t(KIND_KEY[kind])}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {file.owner ? (
                          <span>
                            {file.owner.name}
                            <span className="ml-1 opacity-70">
                              {file.owner.email}
                            </span>
                          </span>
                        ) : (
                          t("owner.unknown")
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {file.lastModified
                          ? formatDate(file.lastModified, true)
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="small"
                            icon={<Copy className="h-3.5 w-3.5" />}
                            onClick={() => void copyLink(file)}
                          >
                            {t("actions.copyLink")}
                          </Button>
                          <Button
                            size="small"
                            icon={<Eye className="h-3.5 w-3.5" />}
                            onClick={() => void openFile(file, "inline")}
                          >
                            {t("actions.preview")}
                          </Button>
                          <Button
                            size="small"
                            icon={<Download className="h-3.5 w-3.5" />}
                            onClick={() => void openFile(file, "attachment")}
                          >
                            {t("actions.download")}
                          </Button>
                          <Button
                            size="small"
                            danger
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            onClick={() => requestDelete(file)}
                          >
                            {t("actions.delete")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 底部 —— 加载更多 + 本层合计 */}
      {!isEmpty && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {t("messages.total", {
              count: visibleFiles.length,
              size: formatFileSize(totalSize),
            })}
          </p>
          {nextToken && (
            <Button
              onClick={() => void loadMore()}
              loading={loadingMore}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              {t("actions.loadMore")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
