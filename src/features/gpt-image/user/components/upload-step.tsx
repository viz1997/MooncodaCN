"use client";

import { ArrowRight, ImageIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { resizeImage, wrapBlobAsFile } from "@/lib/image-client-resize";

// 单张参考图硬上限：超过此值直接 toast 拒绝（避免浏览器 File API / canvas OOM）
// 5MB ~ 10MB 之间的图由 handleConfirm 的 resizeImage 自动压到 ≤5MB
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

interface UploadStepProps {
  /** 订单模板名（标题用） */
  templateName: string;
  /** 用户可上传的批次次数（默认 1） */
  uploadCount: number;
  /** 每批上传的原图参考图数量（1-3，默认 3） */
  imagesPerUpload: number;
  /** 已上传的图片张数（0..uploadCount × imagesPerUpload） */
  uploadedImageCount: number;
  /** 单次生图候选数（"将生成 N 种效果的宫格图"） */
  candidateCount: number;
  /** 失败重试 vs 首次 / 续传 */
  hasFailure?: boolean;
  /** 上传中——禁用按钮防止重复点击 */
  uploading: boolean;
  /** 上传图片数组的回调（由父组件接 R2 预签名 + /upload API） */
  onUpload: (files: File[]) => Promise<boolean>;
}

/**
 * 上传步骤 —— mobile-first 单列布局。
 *
 * 上传上限语义（2026-08-15 重构）：
 * - 单批最多塞 imagesPerUpload 张参考图
 * - 总容量 = uploadCount × imagesPerUpload
 *
 * 保留原 upload-stage 的全部业务逻辑：
 * - 多文件上传（受 imagesPerUpload 限制）
 * - 5MB 上限 / 张（前端先 resize 再上传，避开 Lingting/WellAPI 上游 8MB body 限制）
 * - blob URL 预览（不用 FileReader，避免 base64）
 * - 父组件负责 R2 预签名 + PUT + /upload
 */
export function UploadStep({
  templateName,
  uploadCount,
  imagesPerUpload,
  uploadedImageCount,
  candidateCount,
  hasFailure = false,
  uploading,
  onUpload,
}: UploadStepProps) {
  const totalCapacity = uploadCount * imagesPerUpload;
  // 已"塞满"的批数（floor：3 张/批时 1-3 张都算第 1 批）。
  // 对用户讲"已传 X 个效果图"时用这个，比用 uploadedImageCount 更直观。
  const safeImagesPerUpload = Math.max(1, imagesPerUpload);
  const filledBatchCount = Math.min(
    uploadCount,
    Math.floor(uploadedImageCount / safeImagesPerUpload)
  );
  const [dragging, setDragging] = useState(false);
  const [previews, setPreviews] = useState<
    Array<{
      id: string;
      name: string;
      size: number;
      objectUrl: string;
      file: File;
    }>
  >([]);
  // 2026-09-03：上传后点击缩略图的全屏预览。仅用本地 blob URL，无
  // token/updatedAt 等订单上下文，所以不复用 select-step 的 Lightbox
  // （那个还要管选 candidate / 翻页 / 对比模式）。点遮罩或 Esc 关闭。
  const [previewing, setPreviewing] = useState<
    { url: string; name: string } | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRefs = useRef<Map<string, string>>(new Map());

  const quotaFull = uploadedImageCount >= totalCapacity;
  // FAILED 重传会替换之前的图片（见 /upload API），所以"本次可传"按 totalCapacity 上限算。
  const remainingForThisRound = hasFailure
    ? imagesPerUpload
    : Math.max(0, totalCapacity - uploadedImageCount);
  // 不再算"本批已传 X / N 张"——之前那个 "0/3 张" 里的 3 等于"每批参考图上限"，
  // 用户会误读为"必须传够 3 张才能进下一批"。直接把上限写清楚即可，进度
  // 由下方彩色进度条 + 右侧状态 chip + "已传 X/Y 个效果图"文案承担。

  // 头部标题：失败重试 vs 首次 / 续传
  let nextLabel: string;
  if (hasFailure) {
    nextLabel = "重新上传照片";
  } else if (uploadedImageCount > 0) {
    nextLabel = "继续上传下一批";
  } else {
    nextLabel = "上传你的照片";
  }

  // 卸载时回收全部 blob URL
  useEffect(() => {
    return () => {
      for (const url of previewRefs.current.values()) {
        URL.revokeObjectURL(url);
      }
      previewRefs.current.clear();
    };
  }, []);

  // 预览打开时锁 Esc → 关闭（不锁 body scroll：遮罩就是 fixed inset-0，
  // 用户点遮罩 / 按 Esc 退出即可，不要把滚动也锁掉）
  useEffect(() => {
    if (!previewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewing]);

  const handleFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files as ArrayLike<File>);
    if (list.length === 0) return;

    // 2026-09-02：改累加式。
    // 原本是"替换式预览"（return valid），用户连选两次会只剩最后
    // 一张 —— 体感"只能看到最新的参考图"。现在改为追加：
    // - 本批上限 = imagesPerUpload（不变）
    // - 已选了 previews.length 张，本次再选 list，最多累计到
    //   min(remainingForThisRound, imagesPerUpload) 张
    // - 超出 rejected 走 toast 提示（同旧语义）
    // 第二批由 clearPreviews() 在 handleConfirm 成功后归零，自然重新累计。
    //
    // stale closure 处理：闭包外 previews.length 来自 React 渲染快照。
    // 用户每次点开文件选择对话框是 async（OS 弹窗 → 选择 → 关闭），相
    // 邻两次 handleFiles 之间必经过 React 重新渲染（setPreviews 触发），
    // 新一次调用拿到的是新 previews 长度。但 setPreviews 内仍用 prev
    // 做长度校验，避免任何极端时序错位。
    const remainingSlots = Math.max(
      0,
      Math.min(remainingForThisRound, imagesPerUpload) - previews.length
    );
    const accepted = list.slice(0, Math.min(list.length, remainingSlots));
    const rejected = list.slice(remainingSlots);

    if (rejected.length > 0) {
      toast.error(
        rejected.length === 1
          ? `本批最多 ${imagesPerUpload} 张，超出的图片已忽略`
          : `本批最多 ${imagesPerUpload} 张，超出的 ${rejected.length} 张已忽略`
      );
    }
    if (accepted.length === 0) return;

    const valid: typeof previews = [];
    for (const file of accepted) {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} 不是图片文件`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        // 10MB 硬卡：避免浏览器 File API / canvas resize 的 memory OOM；
        // 5~10MB 之间的图会自动压缩到 5MB（见 handleConfirm 的 resizeImage）
        toast.error(`${file.name} 超过 10MB`);
        continue;
      }
      const objectUrl = URL.createObjectURL(file);
      const id = `${file.name}_${file.size}_${Date.now()}_${Math.random()}`;
      previewRefs.current.set(id, objectUrl);
      valid.push({
        id,
        name: file.name,
        size: file.size,
        objectUrl,
        file,
      });
    }

    if (valid.length === 0) return;
    setPreviews((prev) => {
      // 累加后再次截断：闭包外的 previews.length 与 setState 内的 prev
      // 可能差 1（连续触发），这里用 prev 兜底，避免越界入预览区。
      const cap = Math.min(remainingForThisRound, imagesPerUpload);
      const merged = [...prev, ...valid];
      return merged.slice(0, cap);
    });
  };

  const clearPreviews = () => {
    setPreviews((prev) => {
      for (const p of prev) {
        const url = previewRefs.current.get(p.id);
        if (url) URL.revokeObjectURL(url);
        previewRefs.current.delete(p.id);
      }
      return [];
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeOne = (id: string) => {
    setPreviews((prev) => {
      const url = previewRefs.current.get(id);
      if (url) URL.revokeObjectURL(url);
      previewRefs.current.delete(id);
      return prev.filter((p) => p.id !== id);
    });
  };

  const handleConfirm = async () => {
    if (previews.length === 0) return;
    // 客户端降采样到 ≤5MB：避开 Lingting/WellAPI `/v1/images/edits` 的
    // 8MB multipart body 上限。服务端 submitLingtingTask 跑在 Inngest 上，
    // 不能在 server 侧 resize；sharp 被部署 hardblock（Vercel libvips 装不稳）。
    // 任何一张 resize 失败就按原图上传（≤10MB），由 presign 端再做兜底。
    const files: File[] = [];
    for (const p of previews) {
      try {
        const resized = await resizeImage(p.file);
        if (resized.resized) {
          if (resized.finalBytes < resized.originalBytes * 0.95) {
            const origMb = (resized.originalBytes / 1024 / 1024).toFixed(1);
            const finalMb = (resized.finalBytes / 1024 / 1024).toFixed(1);
            toast.success(`已自动压缩 ${p.name} ${origMb}MB → ${finalMb}MB`);
          }
          files.push(wrapBlobAsFile(resized.blob, p.name, p.file.type));
        } else {
          files.push(p.file);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[upload-step] resize failed, uploading original:", err);
        files.push(p.file);
      }
    }
    const ok = await onUpload(files);
    if (ok) clearPreviews();
  };

  return (
    <section className="flex flex-col items-center px-5 pt-6 pb-8 animate-[fadeIn_.3s_ease-out]">
      {/* 标题 */}
      <div className="mb-5 text-center">
        <h2 className="text-xl font-bold text-stone-900">{nextLabel}</h2>
        <p className="mt-1 text-sm text-stone-400">
          {templateName} · 上传后将生成 {candidateCount} 种候选效果图
        </p>
        <p className="mt-1 text-xs text-stone-400">
          一次最多 {imagesPerUpload} 张，共需 {uploadCount} 张效果图
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
          previews.length > 0
            ? "border-solid border-stone-200 p-4"
            : dragging
              ? "scale-[1.02] border-indigo-400 bg-indigo-50/50"
              : "border-dashed border-stone-200 bg-stone-50/30 hover:border-indigo-300 hover:bg-indigo-50/30",
        ].join(" ")}
      >
        {previews.length > 0 ? (
          <div className="space-y-4">
            {/* 多图预览网格（1/2/3 张自适应） */}
            <div
              className={[
                "grid gap-2",
                previews.length === 1
                  ? "grid-cols-2"
                  : previews.length === 2
                    ? "grid-cols-3"
                    : "grid-cols-3",
              ].join(" ")}
            >
              {previews.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setPreviewing({ url: p.objectUrl, name: p.name })
                  }
                  className="group relative aspect-square cursor-zoom-in overflow-hidden rounded-xl bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  aria-label={`放大预览 ${p.name}`}
                >
                  {/* biome-ignore lint/performance/noImgElement: blob URL 本地预览 */}
                  <img
                    src={p.objectUrl}
                    alt={p.name}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                  <button
                    type="button"
                    // 阻止冒泡：点 X 不触发外层的"打开预览"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeOne(p.id);
                    }}
                    aria-label="移除此图片"
                    className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/60"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </button>
              ))}
              {/* 2026-09-02：剩余可加的空位。
                  原本每个空位都渲染一个独立「+」按钮，imagesPerUpload=3
                  时上传 1 张后预览区会出现 2 个空格子——用户感知成「多
                  个上传区域」(issue #21)。改为只渲染 1 个「+」按钮，
                  表达「可以再加更多」即可；点开后单文件选择可连选多张。
                  这样视觉上跟 preview 1:N 分离，更像「已有图 + 添加」两个动作。 */}
              {previews.length > 0 &&
                previews.length < imagesPerUpload &&
                previews.length < remainingForThisRound && (
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading}
                    className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-stone-200 text-stone-400 transition-colors hover:border-indigo-300 hover:bg-indigo-50/30 hover:text-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="添加更多图片"
                  >
                    +
                  </button>
                )}
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
                  上传 {previews.length} 张并生成
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>

            {!quotaFull && uploadCount > 1 && (
              // 单数任务（uploadCount === 1）不显示这条 —— 没进度概念。
              // 当前在做的"下一个"也不复述：用户刚上传完马上看到 1/2 → 2/2，
              // 进度感全靠这条文案本身，不靠"还要做几次"这种脑补。
              <p className="text-center text-xs text-stone-500">
                已传 {filledBatchCount} / {uploadCount} 个效果图
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
              支持多选 · 本批最多 {imagesPerUpload} 张 · 单张 ≤ 5MB（自动压缩）
            </p>
          </label>
        )}

        <input
          id="upload-step-input"
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          disabled={uploading}
          className="sr-only"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* 状态行 + 进度条（视觉反馈）。文案层面只用"已传 X/Y 个效果图"表达进度，
        且仅在 uploadCount > 1 时显示 —— 单数任务没进度概念。参考图张数不当作
        进度计数（之前 "0/3 张" 里的 3 等于每批上限 3 张，用户会误读）。 */}
      <div className="mt-5 w-full max-w-xs">
        {uploading || quotaFull ? (
          <div className="mb-2 flex items-center justify-end text-xs">
            {(() => {
              // chip 只在有"状态"可告知时才出现
              if (hasFailure) {
                return (
                  <span className="rounded-full bg-red-50 px-2.5 py-0.5 font-medium text-red-600 text-xs">
                    上次失败，将替换之前图片
                  </span>
                );
              }
              if (uploading) {
                return (
                  <span className="rounded-full bg-stone-100 px-2.5 py-0.5 font-medium text-stone-600 text-xs">
                    上传中...
                  </span>
                );
              }
              if (quotaFull) {
                return (
                  <span className="rounded-full bg-emerald-500 px-2.5 py-0.5 font-medium text-white text-xs">
                    本订单已完成
                  </span>
                );
              }
              return null;
            })()}
          </div>
        ) : null}
        <div className="h-1 overflow-hidden rounded-full bg-stone-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-blue-500 transition-[width] duration-300 motion-reduce:transition-none"
            style={{
              width: `${
                totalCapacity > 0
                  ? Math.min(100, (uploadedImageCount / totalCapacity) * 100)
                  : 0
              }%`,
            }}
          />
        </div>
      </div>

      {/* 2026-09-03：上传预览全屏灯箱。点遮罩或右上 X 关闭；Esc 也行。
          不复用 select-step 的 Lightbox，那个组件是为已生成图设计的，依赖
          token / updatedAt / candidate 翻页 / 对比模式。这里只有本地 blob URL，
          用最简实现即可。 */}
      {previewing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setPreviewing(null)}
        >
          {/* biome-ignore lint/performance/noImgElement: blob URL 本地预览 */}
          <img
            src={previewing.url}
            alt={previewing.name}
            // 点图本身也走关闭（点遮罩同一处理：stopPropagation 阻止）
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setPreviewing(null)}
            aria-label="关闭预览"
            className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/90 backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <X className="h-5 w-5" />
          </button>
          <p className="absolute bottom-4 left-1/2 max-w-[80vw] -translate-x-1/2 truncate rounded-full bg-black/40 px-3 py-1 text-xs text-white/80 backdrop-blur-sm">
            {previewing.name}
          </p>
        </div>
      )}
    </section>
  );
}
