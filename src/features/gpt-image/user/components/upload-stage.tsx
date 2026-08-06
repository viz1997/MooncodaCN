"use client";

import { ImagePlus, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

interface UploadStageProps {
  uploadCount: number;
  uploadedImageCount: number;
  candidateCount: number;
  isAppending: boolean;
  uploading: boolean;
  onUpload: (files: File[]) => Promise<boolean>;
}

/**
 * 单图模式上传阶段
 *
 * 每次只接受 1 张图片：选 1 张 → 预览 → 点上传 → 后台触发生成。
 * 多张订单（uploadCount > 1）通过"选 → 生成 → 选择效果 → 再选下一张"的顺序串行完成。
 *
 * 预览用 `URL.createObjectURL(file)`（blob: URL），不再用 FileReader.readAsDataURL，
 * 原图二进制在客户端直传 R2，链路全程无 base64。
 */
export function UploadStage({
  uploadCount,
  uploadedImageCount,
  candidateCount,
  isAppending,
  uploading,
  onUpload,
}: UploadStageProps) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{
    name: string;
    objectUrl: string;
    file: File;
  } | null>(null);
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 持有最新 objectUrl，仅在组件卸载时回收，避免 lint 抱怨依赖数组
  const previewRef = useRef<string | null>(null);

  const quotaFull = uploadedImageCount >= uploadCount;

  useEffect(() => {
    const current = previewRef.current;
    return () => {
      if (current) URL.revokeObjectURL(current);
    };
  }, []);

  const readFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(`${file.name} 不是图片文件`);
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`${file.name} 超过 10MB`);
      return;
    }
    setReading(true);
    const objectUrl = URL.createObjectURL(file);
    previewRef.current = objectUrl;
    setPreview({ name: file.name, objectUrl, file });
    setReading(false);
  };

  const handleFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files as ArrayLike<File>);
    if (list.length === 0) return;
    // 单图模式：只取第一张
    readFile(list[0] as File);
  };

  const clearPreview = () => {
    setPreview((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.objectUrl);
        previewRef.current = null;
      }
      return null;
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleConfirm = async () => {
    if (!preview) return;
    const ok = await onUpload([preview.file]);
    if (ok) clearPreview();
  };

  const handleCancel = () => {
    clearPreview();
  };

  const nextLabel = isAppending ? "继续上传下一张" : "上传你的照片";

  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-white">
      <div className="border-b border-zinc-100 px-4 py-3.5 sm:px-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
          <ImagePlus className="h-4 w-4 text-emerald-600" />
          {nextLabel}
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
          单张图片逐张上传，每张会生成 1 张包含 {candidateCount}{" "}
          种效果的宫格图。本订单共需{" "}
          <span className="font-medium text-emerald-700">{uploadCount} 张</span>
          ，已上传{" "}
          <span className="font-medium text-emerald-700">
            {uploadedImageCount}
          </span>{" "}
          张。
        </p>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        {/* 进度 */}
        <div>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-zinc-500">
              进度 {uploadedImageCount} / {uploadCount} 张
            </span>
            <span className="text-zinc-500">
              {quotaFull
                ? "本订单已完成"
                : `还需 ${uploadCount - uploadedImageCount} 张`}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-[width] duration-300 motion-reduce:transition-none"
              style={{
                width: `${uploadCount > 0 ? Math.min(100, (uploadedImageCount / uploadCount) * 100) : 0}%`,
              }}
            />
          </div>
        </div>

        {/* 选中的预览（单图） */}
        {preview && (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-center gap-3">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-white">
                {/* 本地 blob 预览，next/image 无法优化；手动跳过 lint 提示 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {/* biome-ignore lint/performance/noImgElement: blob URL 本地预览 */}
                <img
                  src={preview.objectUrl}
                  alt={preview.name}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-800">
                  {preview.name}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  确认无误后点击下方按钮上传，将立即开始生成效果图
                </p>
              </div>
              <button
                type="button"
                onClick={handleCancel}
                disabled={uploading}
                aria-label="移除已选图片"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-zinc-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* 拖拽 / 点选区 */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone 容器，仅作为 <label> 的视觉框 */}
        <div
          role="presentation"
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragging(false);
          }}
          className={[
            "rounded-2xl border-2 border-dashed transition-colors",
            preview
              ? "border-zinc-200 bg-zinc-50/40"
              : dragging
                ? "border-emerald-500 bg-emerald-50/60"
                : "border-zinc-300 hover:border-emerald-400 hover:bg-emerald-50/30",
          ].join(" ")}
        >
          <label
            htmlFor="user-file-input"
            className="flex cursor-pointer flex-col items-center justify-center px-4 py-8 text-center"
          >
            <span
              className={[
                "mb-3 flex h-12 w-12 items-center justify-center rounded-2xl transition-colors",
                dragging ? "bg-emerald-100" : "bg-zinc-100",
              ].join(" ")}
            >
              <Upload
                className={
                  dragging
                    ? "h-5 w-5 text-emerald-600"
                    : "h-5 w-5 text-zinc-400"
                }
              />
            </span>
            <span className="text-sm font-medium text-zinc-800">
              {preview
                ? "重新选择另一张"
                : dragging
                  ? "松开即可选择"
                  : "点击选择照片"}
            </span>
            <span className="mt-1 text-xs text-zinc-400">
              单张 JPG / PNG / WebP · ≤ 10MB
            </span>
          </label>
          <input
            id="user-file-input"
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            disabled={reading || uploading}
            className="sr-only"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-12 flex-1"
            onClick={handleCancel}
            disabled={!preview || uploading}
          >
            换一张
          </Button>
          <Button
            className="h-12 flex-[2] bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => void handleConfirm()}
            disabled={!preview || uploading || reading}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> 上传中…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> 上传并生成效果图
              </>
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}
