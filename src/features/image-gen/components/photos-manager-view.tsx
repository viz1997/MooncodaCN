"use client";

import {
  Check,
  Copy,
  Grid3x3,
  ImageIcon,
  List as ListIcon,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Photo } from "@/db/schema";
import {
  createPhotoAction,
  deletePhotoAction,
} from "@/features/image-gen/actions";
import { SafeImage } from "@/features/image-gen/components/safe-image";
import { thumbnailUrl } from "@/features/image-gen/lib/thumbnail-url";
import { resizeImage, wrapBlobAsFile } from "@/lib/image-client-resize";
import { cn } from "@/lib/utils";

interface PhotosManagerViewProps {
  initialPhotos: Photo[];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(date: Date | string | null): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("zh-CN");
}

export function PhotosManagerView({ initialPhotos }: PhotosManagerViewProps) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  // 2026-08-23：资产统一后，photo 表承载"本地上传 + 生图结果"。
  // sourceFilter 决定显示哪一类；默认 "all" 让用户先看到全部。
  const [sourceFilter, setSourceFilter] = useState<
    "all" | "upload" | "generation"
  >("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<Photo | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { execute: createPhoto } = useAction(createPhotoAction, {
    onSuccess: ({ data }) => {
      if (data?.photo) {
        setPhotos((prev) => [data.photo, ...prev]);
        toast.success("上传成功");
      }
      setUploading(false);
      setUploadOpen(false);
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "创建照片记录失败");
      setUploading(false);
    },
  });

  const { execute: deletePhoto } = useAction(deletePhotoAction, {
    onSuccess: ({ input }) => {
      setPhotos((prev) => prev.filter((p) => p.id !== input.photoId));
      toast.success("删除成功");
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "删除失败");
    },
  });

  const filtered = photos.filter(
    (p) =>
      (sourceFilter === "all" || p.source === sourceFilter) &&
      (p.fileName.toLowerCase().includes(search.toLowerCase()) ||
        p.id.toLowerCase().includes(search.toLowerCase()))
  );

  const handleCopyId = (photo: Photo) => {
    navigator.clipboard.writeText(photo.id);
    setCopiedId(photo.id);
    setTimeout(() => setCopiedId(null), 1500);
    toast.success("已复制ID");
  };

  const uploadFile = useCallback(
    async (file: File) => {
      if (
        !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(
          file.type
        )
      ) {
        toast.error("格式不支持，仅 JPG/PNG/WEBP");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        // 10MB 硬卡：避免浏览器 File API / canvas OOM；5~10MB 走 resizeImage
        // 自动压到 ≤5MB（见下方），与 Lingting/WellAPI 8MB body 上限对齐
        toast.error("文件过大，最大 10MB");
        return;
      }

      setUploading(true);
      try {
        // 客户端降采样到 ≤5MB —— 与 /api/image/upload 的服务端 MAX_BYTES 对齐
        let toUpload: File = file;
        let finalSize = file.size;
        try {
          const resized = await resizeImage(file);
          if (resized.resized) {
            if (resized.finalBytes < resized.originalBytes * 0.95) {
              const origMb = (resized.originalBytes / 1024 / 1024).toFixed(1);
              const finalMb = (resized.finalBytes / 1024 / 1024).toFixed(1);
              toast.success(
                `已自动压缩 ${file.name} ${origMb}MB → ${finalMb}MB`
              );
            }
            toUpload = wrapBlobAsFile(resized.blob, file.name, file.type);
            finalSize = resized.finalBytes;
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            "[photos-manager] resize failed, uploading original:",
            err
          );
        }

        const ext = toUpload.name.split(".").pop() ?? "jpg";
        const presignRes = await fetch("/api/image/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType: toUpload.type,
            size: toUpload.size,
            ext,
          }),
        });
        const presign = await presignRes.json();
        if (!presign.success) {
          throw new Error(presign.error ?? "获取上传签名失败");
        }

        const uploadRes = await fetch(presign.uploadUrl, {
          method: "PUT",
          body: toUpload,
          headers: { "Content-Type": toUpload.type },
        });
        if (!uploadRes.ok) {
          throw new Error("文件上传失败");
        }

        // fileSize 写入压缩后大小：UI 显示与 R2 实际存储一致
        createPhoto({
          fileName: toUpload.name,
          fileUrl: presign.publicUrl,
          thumbnailUrl: presign.publicUrl,
          md5: "",
          width: 0,
          height: 0,
          format: ext,
          fileSize: finalSize,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "上传失败";
        toast.error(msg);
        setUploading(false);
      }
    },
    [createPhoto]
  );

  const handleFileSelect = (file: File | undefined) => {
    if (file) uploadFile(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索文件名或ID..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            共 {filtered.length} 张
          </Badge>
          <div className="flex items-center rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => setView("grid")}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                view === "grid" ? "bg-muted" : "hover:bg-muted/50"
              )}
              aria-label="grid view"
            >
              <Grid3x3 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                view === "list" ? "bg-muted" : "hover:bg-muted/50"
              )}
              aria-label="list view"
            >
              <ListIcon className="h-4 w-4" />
            </button>
          </div>
          <Button
            onClick={() => setUploadOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Upload className="h-4 w-4 mr-1.5" />
            上传图片
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-lg border p-0.5 w-fit">
        <button
          type="button"
          onClick={() => setSourceFilter("all")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5",
            sourceFilter === "all"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          全部
          <Badge variant="outline" className="text-[10px] h-4 px-1">
            {photos.length}
          </Badge>
        </button>
        <button
          type="button"
          onClick={() => setSourceFilter("upload")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5",
            sourceFilter === "upload"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          <Upload className="h-3.5 w-3.5" />
          本地上传
          <Badge variant="outline" className="text-[10px] h-4 px-1">
            {photos.filter((p) => p.source === "upload").length}
          </Badge>
        </button>
        <button
          type="button"
          onClick={() => setSourceFilter("generation")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5",
            sourceFilter === "generation"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
          生图结果
          <Badge variant="outline" className="text-[10px] h-4 px-1">
            {photos.filter((p) => p.source === "generation").length}
          </Badge>
        </button>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground">
              <ImageIcon className="h-10 w-10 mb-3" />
              <p className="font-medium">暂无图片</p>
              <p className="text-sm">点击右上角上传图片，开始创建你的作品</p>
            </div>
          </CardContent>
        </Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map((photo) => (
            <Card
              key={photo.id}
              className="overflow-hidden group hover:shadow-md transition-all"
            >
              <button
                type="button"
                className="aspect-square bg-muted cursor-pointer relative w-full text-left"
                onClick={() => setPreviewPhoto(photo)}
                aria-label={`查看 ${photo.fileName}`}
              >
                <SafeImage
                  src={thumbnailUrl(photo.thumbnailUrl ?? photo.fileUrl, 400)}
                  alt={photo.fileName}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <span className="inline-flex items-center justify-center rounded-md text-xs font-medium bg-secondary text-secondary-foreground h-8 px-3">
                    查看
                  </span>
                </div>
                <Badge className="absolute top-1.5 right-1.5 text-[10px] uppercase">
                  {photo.format}
                </Badge>
                {photo.source === "generation" ? (
                  <Badge className="absolute top-1.5 left-1.5 text-[10px] gap-1 bg-violet-500/90 hover:bg-violet-500/90 text-white">
                    <Sparkles className="h-2.5 w-2.5" />
                    生图
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="absolute top-1.5 left-1.5 text-[10px] gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15"
                  >
                    <Upload className="h-2.5 w-2.5" />
                    上传
                  </Badge>
                )}
              </button>
              <div className="p-2.5 space-y-1">
                <p
                  className="text-xs font-medium truncate"
                  title={photo.fileName}
                >
                  {photo.fileName}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {photo.fileSize ? formatFileSize(photo.fileSize) : "-"} ·{" "}
                  {photo.width ?? 0}×{photo.height ?? 0}
                </p>
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => handleCopyId(photo)}
                    className="text-[10px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {copiedId === photo.id ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {photo.id.slice(0, 12)}...
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePhoto({ photoId: photo.id })}
                    className="text-muted-foreground hover:text-rose-600 p-1 rounded transition-colors"
                    aria-label="delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {filtered.map((photo) => (
                <div
                  key={photo.id}
                  className="flex items-center gap-4 p-3 hover:bg-muted/50 transition-colors"
                >
                  <SafeImage
                    src={thumbnailUrl(photo.thumbnailUrl ?? photo.fileUrl, 112)}
                    alt={photo.fileName}
                    className="h-14 w-14 rounded-lg object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {photo.fileName}
                      </p>
                      {photo.source === "generation" ? (
                        <Badge className="text-[10px] gap-1 bg-violet-500/90 hover:bg-violet-500/90 text-white">
                          <Sparkles className="h-2.5 w-2.5" />
                          生图
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="text-[10px] gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15"
                        >
                          <Upload className="h-2.5 w-2.5" />
                          上传
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {photo.id} ·{" "}
                      {photo.fileSize ? formatFileSize(photo.fileSize) : "-"} ·{" "}
                      {photo.width ?? 0}×{photo.height ?? 0} ·{" "}
                      {formatDate(photo.createdAt)}
                    </p>
                    {photo.source === "generation" && photo.prompt && (
                      <p
                        className="text-xs text-muted-foreground truncate mt-0.5"
                        title={photo.prompt}
                      >
                        提示词：{photo.prompt}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="uppercase text-[10px]">
                    {photo.format}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPreviewPhoto(photo)}
                  >
                    查看
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-rose-600 hover:text-rose-700"
                    onClick={() => deletePhoto({ photoId: photo.id })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上传图片</DialogTitle>
            <DialogDescription>
              支持 JPG/JPEG/PNG/WEBP 格式，单文件最大 10MB
            </DialogDescription>
          </DialogHeader>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files?.[0])}
          />
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
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer w-full",
              dragOver
                ? "border-emerald-500 bg-emerald-500/5"
                : "border-muted-foreground/30 hover:border-emerald-500/50"
            )}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin text-emerald-500" />
            ) : (
              <Upload
                className={cn(
                  "h-10 w-10 mx-auto mb-3 transition-colors",
                  dragOver ? "text-emerald-500" : "text-muted-foreground"
                )}
              />
            )}
            <p className="text-sm font-medium mb-1">
              {uploading ? "上传中..." : "点击或拖拽图片到此处"}
            </p>
            <p className="text-xs text-muted-foreground">
              MD5 自动去重 · OSS 云存储
            </p>
          </button>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUploadOpen(false)}
              disabled={uploading}
            >
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!previewPhoto}
        onOpenChange={(open) => !open && setPreviewPhoto(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewPhoto?.fileName}</DialogTitle>
            <DialogDescription>
              ID: {previewPhoto?.id} ·{" "}
              {previewPhoto?.fileSize
                ? formatFileSize(previewPhoto.fileSize)
                : "-"}{" "}
              ·{" "}
              {previewPhoto &&
                `${previewPhoto.width ?? 0}×${previewPhoto.height ?? 0}`}
            </DialogDescription>
          </DialogHeader>
          {previewPhoto && (
            <div className="space-y-3">
              <SafeImage
                src={previewPhoto.fileUrl}
                alt={previewPhoto.fileName}
                className="w-full max-h-[60vh] object-contain rounded-lg bg-muted"
              />
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-muted/50 rounded-lg p-2.5">
                  <p className="text-muted-foreground mb-0.5">MD5</p>
                  <p className="font-mono break-all">
                    {previewPhoto.md5 || "-"}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-lg p-2.5">
                  <p className="text-muted-foreground mb-0.5">上传时间</p>
                  <p>{formatDate(previewPhoto.createdAt)}</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => previewPhoto && handleCopyId(previewPhoto)}
            >
              <Copy className="h-4 w-4 mr-1.5" />
              复制ID
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (previewPhoto) {
                  deletePhoto({ photoId: previewPhoto.id });
                  setPreviewPhoto(null);
                }
              }}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
