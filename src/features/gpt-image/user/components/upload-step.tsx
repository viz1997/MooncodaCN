"use client";

import {
  ArrowRight,
  ImageIcon,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

interface UploadStepProps {
  /** 订单模板名（标题用） */
  templateName: string;
  /** 用户需要上传的图片数量（1-50） */
  uploadCount: number;
  /** 已上传的图片张数（0..uploadCount） */
  uploadedImageCount: number;
  /** 单次生图候选数（"将生成 N 种效果的宫格图"） */
  candidateCount: number;
  /** 失败重试 vs 首次 / 续传 */
  hasFailure?: boolean;
  /** 上传中——禁用按钮防止重复点击 */
  uploading: boolean;
  /** 上传单张图片的回调（由父组件接 R2 预签名 + /upload API） */
  onUpload: (files: File[]) => Promise<boolean>;
}

/**
 * 上传步骤 —— mobile-first 单列布局。
 *
 * UI 借鉴参考 upload-step.tsx：
 * - 拖拽虚线框（hover 变 indigo）
 * - 选完显示预览 + X 移除
 * - "开始生成" indigo→blue 渐变按钮
 *
 * 保留原 upload-stage 的全部业务逻辑：
 * - 单图模式只取第一张
 * - 10MB 限制
 * - blob URL 预览（不用 FileReader，避免 base64）
 * - 父组件负责 R2 预签名 + PUT + /upload
 */
export function UploadStep({
  templateName,
  uploadCount,
  uploadedImageCount,
  candidateCount,
  hasFailure = false,
  uploading,
  onUpload,
}: UploadStepProps) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{
    name: string;
    size: number;
    objectUrl: string;
    file: File;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);

  const quotaFull = uploadedImageCount >= uploadCount;
  // FAILED 重传会替换之前的图片（见 /upload API），所以"本次可传"按 uploadCount 上限算。
  const remainingForThisRound = hasFailure
    ? uploadCount
    : Math.max(0, uploadCount - uploadedImageCount);

  // 头部标题：失败重试 vs 首次 / 续传
  let nextLabel: string;
  if (hasFailure) {
    nextLabel = "重新上传照片";
  } else if (uploadedImageCount > 0) {
    nextLabel = "继续上传下一张";
  } else {
    nextLabel = "上传你的照片";
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  // 卸载时回收最新一次 blob URL
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
    const objectUrl = URL.createObjectURL(file);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = objectUrl;
    setPreview({ name: file.name, size: file.size, objectUrl, file });
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

  return (
    <section className="flex flex-col items-center px-5 pt-6 pb-8 animate-[fadeIn_.3s_ease-out]">
      {/* 标题 */}
      <div className="mb-5 text-center">
        <h2 className="text-xl font-bold text-stone-900">{nextLabel}</h2>
        <p className="mt-1 text-sm text-stone-400">
          {templateName} · 上传照片后将生成 {candidateCount} 种候选效果图
        </p>
      </div>

      {/* 拖拽框 / 预览区 */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone 容器 */}
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
          "w-full max-w-xs rounded-2xl border-2 transition-all duration-300",
          preview
            ? "border-solid border-stone-200 p-4"
            : dragging
              ? "scale-[1.02] border-indigo-400 bg-indigo-50/50"
              : "border-dashed border-stone-200 bg-stone-50/30 hover:border-indigo-300 hover:bg-indigo-50/30",
        ].join(" ")}
      >
        {preview ? (
          <div className="space-y-4">
            <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-stone-100">
              {/* biome-ignore lint/performance/noImgElement: blob URL 本地预览 */}
              <img
                src={preview.objectUrl}
                alt={preview.name}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={clearPreview}
                aria-label="移除已选图片"
                className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-3 rounded-xl bg-stone-50 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-stone-700">
                  {preview.name}
                </p>
                <p className="mt-0.5 text-xs text-stone-500">
                  {formatSize(preview.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={clearPreview}
                disabled={uploading}
                aria-label="换一张"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={uploading}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-blue-500 text-sm font-medium text-white shadow-lg shadow-indigo-200/50 transition-shadow hover:shadow-indigo-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploading ? (
                "上传中…"
              ) : (
                <>
                  开始生成
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>

            {!quotaFull && (
              <p className="text-center text-xs text-stone-500">
                本订单还差 {uploadCount - uploadedImageCount} 张未上传
              </p>
            )}
          </div>
        ) : (
          <label
            htmlFor="upload-step-input"
            className="block cursor-pointer px-6 py-12 text-center"
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50">
              <ImageIcon
                className="h-6 w-6 text-indigo-500"
                strokeWidth={1.75}
              />
            </div>
            <p className="text-sm font-medium text-stone-700">
              {dragging ? "松开即可选择" : "拖拽照片到这里"}
            </p>
            <p className="mt-1 text-sm text-stone-400">
              或
              <span className="mx-0.5 font-medium text-indigo-500 hover:underline">
                点击选择文件
              </span>
            </p>
            <p className="mt-3 text-[11px] text-stone-300">
              JPG / PNG / WebP · 最大 10MB
            </p>
          </label>
        )}

        <input
          id="upload-step-input"
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          disabled={uploading}
          className="sr-only"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* 进度条：上传中 / 已完成 / 还差多少 */}
      <div className="mt-5 w-full max-w-xs">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-stone-500">
            进度 {uploadedImageCount} / {uploadCount} 张
          </span>
          <span
            className={[
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              hasFailure
                ? "bg-red-50 text-red-600"
                : quotaFull
                  ? "bg-emerald-500 text-white"
                  : "bg-stone-100 text-stone-600",
            ].join(" ")}
          >
            {hasFailure
              ? "上次失败，将替换之前图片"
              : quotaFull
                ? "本订单已完成"
                : `还需 ${remainingForThisRound} 张`}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-stone-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 transition-[width] duration-300 motion-reduce:transition-none"
            style={{
              width: `${
                uploadCount > 0
                  ? Math.min(100, (uploadedImageCount / uploadCount) * 100)
                  : 0
              }%`,
            }}
          />
        </div>
      </div>
    </section>
  );
}
