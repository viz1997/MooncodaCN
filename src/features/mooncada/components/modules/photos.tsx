"use client";

import {
  Check,
  Copy,
  Grid3x3,
  Image as ImageIcon,
  List as ListIcon,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
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
import {
  EmptyState,
  formatDate,
  formatFileSize,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import { MOCK_PHOTOS } from "@/features/mooncada/lib/mock-data";
import type { Photo } from "@/features/mooncada/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function PhotosModule() {
  const { toast } = useToast();
  const [photos, setPhotos] = useState<Photo[]>(MOCK_PHOTOS);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<Photo | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const filtered = photos.filter(
    (p) =>
      p.fileName.toLowerCase().includes(search.toLowerCase()) ||
      p.photoId.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = (photo: Photo) => {
    setPhotos((prev) => prev.filter((p) => p.photoId !== photo.photoId));
    toast({
      title: "删除成功",
      description: `图片 ${photo.fileName} 已删除`,
    });
  };

  const handleCopyId = (photo: Photo) => {
    setCopiedId(photo.photoId);
    setTimeout(() => setCopiedId(null), 1500);
    toast({ title: "已复制", description: `图片ID: ${photo.photoId}` });
  };

  const handleUpload = () => {
    setUploading(true);
    setTimeout(() => {
      const newPhoto: Photo = {
        photoId: `PH_${String(Date.now()).slice(-6)}`,
        userId: "U_USER_001",
        fileName: `upload_${Date.now()}.jpg`,
        fileSize: Math.floor(Math.random() * 3 * 1024 * 1024) + 500 * 1024,
        fileUrl: `https://picsum.photos/seed/new${Date.now()}/800/800`,
        thumbnailUrl: `https://picsum.photos/seed/new${Date.now()}/200/200`,
        md5: `new${Date.now()}`,
        width: 1080,
        height: 1080,
        format: "jpg",
        uploadedAt: new Date().toISOString(),
      };
      setPhotos((prev) => [newPhoto, ...prev]);
      setUploading(false);
      setUploadOpen(false);
      toast({
        title: "上传成功",
        description: `${newPhoto.fileName} 已上传`,
      });
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="图片管理"
        description="上传、查看与管理用户照片 · 支持 JPG/PNG/WEBP 格式，单文件最大 10MB"
        actions={
          <Button
            onClick={() => setUploadOpen(true)}
            className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
          >
            <Upload className="h-4 w-4 mr-1.5" />
            上传图片
          </Button>
        }
      />

      {/* 工具栏 */}
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
        </div>
      </div>

      {/* 图片列表 */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={ImageIcon}
              title="暂无图片"
              description="点击右上角上传图片，开始创建您的3D打印之旅"
            />
          </CardContent>
        </Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map((photo) => (
            <Card
              key={photo.photoId}
              className="overflow-hidden group hover:shadow-md transition-all"
            >
              <div
                className="aspect-square bg-muted cursor-pointer relative"
                onClick={() => setPreviewPhoto(photo)}
              >
                <img
                  src={photo.thumbnailUrl}
                  alt={photo.fileName}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <Button size="sm" variant="secondary">
                    查看
                  </Button>
                </div>
                <Badge className="absolute top-1.5 right-1.5 text-[10px] uppercase">
                  {photo.format}
                </Badge>
              </div>
              <div className="p-2.5 space-y-1">
                <p
                  className="text-xs font-medium truncate"
                  title={photo.fileName}
                >
                  {photo.fileName}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatFileSize(photo.fileSize)} · {photo.width}×
                  {photo.height}
                </p>
                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => handleCopyId(photo)}
                    className="text-[10px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {copiedId === photo.photoId ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {photo.photoId}
                  </button>
                  <button
                    onClick={() => handleDelete(photo)}
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
                  key={photo.photoId}
                  className="flex items-center gap-4 p-3 hover:bg-muted/50 transition-colors"
                >
                  <img
                    src={photo.thumbnailUrl}
                    alt={photo.fileName}
                    className="h-14 w-14 rounded-lg object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {photo.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {photo.photoId} · {formatFileSize(photo.fileSize)} ·{" "}
                      {photo.width}×{photo.height} ·{" "}
                      {formatDate(photo.uploadedAt, true)}
                    </p>
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
                    onClick={() => handleDelete(photo)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 上传对话框 */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上传图片</DialogTitle>
            <DialogDescription>
              支持 JPG/JPEG/PNG/WEBP 格式，单文件最大 10MB
            </DialogDescription>
          </DialogHeader>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleUpload();
            }}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
              dragOver
                ? "border-emerald-500 bg-emerald-500/5"
                : "border-muted-foreground/30 hover:border-emerald-500/50"
            )}
            onClick={handleUpload}
          >
            <Upload
              className={cn(
                "h-10 w-10 mx-auto mb-3 transition-colors",
                dragOver ? "text-emerald-500" : "text-muted-foreground"
              )}
            />
            <p className="text-sm font-medium mb-1">
              {uploading ? "上传中..." : "点击或拖拽图片到此处"}
            </p>
            <p className="text-xs text-muted-foreground">
              MD5 自动去重 · OSS 云存储
            </p>
            {uploading && (
              <div className="mt-3 h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 animate-pulse"
                  style={{ width: "60%" }}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              取消
            </Button>
            <Button
              onClick={handleUpload}
              disabled={uploading}
              className="bg-gradient-to-r from-emerald-500 to-teal-600"
            >
              {uploading ? "上传中..." : "开始上传"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 预览对话框 */}
      <Dialog
        open={!!previewPhoto}
        onOpenChange={(open) => !open && setPreviewPhoto(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewPhoto?.fileName}</DialogTitle>
            <DialogDescription>
              ID: {previewPhoto?.photoId} ·{" "}
              {previewPhoto && formatFileSize(previewPhoto.fileSize)} ·{" "}
              {previewPhoto && `${previewPhoto.width}×${previewPhoto.height}`}
            </DialogDescription>
          </DialogHeader>
          {previewPhoto && (
            <div className="space-y-3">
              <img
                src={previewPhoto.fileUrl}
                alt={previewPhoto.fileName}
                className="w-full max-h-[60vh] object-contain rounded-lg bg-muted"
              />
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-muted/50 rounded-lg p-2.5">
                  <p className="text-muted-foreground mb-0.5">MD5</p>
                  <p className="font-mono break-all">{previewPhoto.md5}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-2.5">
                  <p className="text-muted-foreground mb-0.5">上传时间</p>
                  <p>{formatDate(previewPhoto.uploadedAt, true)}</p>
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
                  handleDelete(previewPhoto);
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
