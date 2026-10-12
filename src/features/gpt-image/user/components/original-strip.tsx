"use client";

import { Check, Layers, Lock } from "lucide-react";
import { useEffect, useRef } from "react";

import { originalUrl } from "./image-urls";

interface OriginalStripProps {
  token: string;
  updatedAt: string;
  /**
   * 2026-09-02：count 现在 = batchCount（每批 N 张参考图合一次生图），
   * 不再是 uploadedImageCount。tab 显示的是批次代表图（每批第一张原图）。
   */
  count: number;
  /**
   * 当前选中的 batchIdx（不再是 imageIdx）。
   */
  currentIdx: number;
  /** 长度 = batchCount，按 batchIdx 索引 */
  selections: (number | null)[];
  onChange: (batchIdx: number) => void;
  /**
   * 判定某 batchIdx 是否已服务端锁定（CANDIDATES_READY 下 partial submit
   * 已写入）。已锁定批：永久 emerald 边框 + 锁定角标，仍可点击切换查看。
   */
  isLocked: (batchIdx: number) => boolean;
  /**
   * 2026-09-02：每批 imagesPerUpload 张参考图。第 i 批代表图下标 =
   * i * imagesPerUpload（上传顺序中的首张）。
   */
  imagesPerUpload: number;
}

/**
 * 批次缩略图条 —— 2026-09-02 从「原图条」改成「批次条」。
 *
 * 多参考图（uploadCount=1 + imagesPerUpload>1）场景下，用户上传 N 张图
 * 合 1 次生图 = 1 个候选组 = 1 个 tab。这里 count 传 batchCount（=1），
 * 组件因 count<=1 直接返回 null（不渲染多张 tab UI）。
 *
 * 多批次场景下，每批展示其**首张原图**作为代表缩略图，tab 角标显示「批 N」
 * + 该批 imagesPerUpload 张徽标，让用户区分"看哪个批次"。
 */
export function OriginalStrip({
  token,
  updatedAt,
  count,
  currentIdx,
  selections,
  onChange,
  isLocked,
  imagesPerUpload,
}: OriginalStripProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#batch-tab-${currentIdx}`)
      ?.scrollIntoView({
        block: "nearest",
        inline: "center",
        behavior: "smooth",
      });
  }, [currentIdx]);

  if (count <= 1) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (currentIdx + 1) % count;
    else if (e.key === "ArrowLeft") next = (currentIdx - 1 + count) % count;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#batch-tab-${next}`)
      ?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="切换要处理的批次"
      onKeyDown={onKeyDown}
      className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1"
    >
      {Array.from({ length: count }).map((_, batchIdx) => {
        const chosen =
          selections[batchIdx] !== null && selections[batchIdx] !== undefined;
        const locked = isLocked(batchIdx);
        const isCurrent = batchIdx === currentIdx;
        // 第 i 批代表图下标 = i * imagesPerUpload（拍平语义下 uploadedImages
        // 是按张数存的，批次 i 的第一张就是 uploadedImages[i * imagesPerUpload]）。
        // FAILED 替换场景下 index 可能超界；裁剪为 [0, uploadedCount) 兜底。
        const repImageIdx = batchIdx * Math.max(1, imagesPerUpload);
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: 顺序固定，与 batchIdx 一一对应
            key={batchIdx}
            id={`batch-tab-${batchIdx}`}
            type="button"
            role="tab"
            aria-selected={isCurrent}
            tabIndex={isCurrent ? 0 : -1}
            onClick={() => onChange(batchIdx)}
            aria-label={
              locked
                ? `第 ${batchIdx + 1} 批（${imagesPerUpload} 张参考图），已提交锁定`
                : chosen
                  ? `第 ${batchIdx + 1} 批（${imagesPerUpload} 张参考图），已选好`
                  : `第 ${batchIdx + 1} 批（${imagesPerUpload} 张参考图），还没选`
            }
            className={[
              "relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition-all sm:h-[72px] sm:w-[72px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-2 focus-visible:ring-offset-2",
              isCurrent
                ? "border-emerald-500 ring-2 ring-emerald-500/40"
                : locked
                  ? "border-zinc-400 ring-2 ring-zinc-400/30"
                  : chosen
                    ? "border-emerald-300 ring-2 ring-emerald-300/40"
                    : "border-zinc-200 opacity-70 hover:opacity-100",
            ].join(" ")}
          >
            {/* biome-ignore lint/performance/noImgElement: R2 远程 URL，next/image 域名白名单外 */}
            <img
              src={originalUrl(token, repImageIdx, updatedAt)}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
            {/* 批号徽标（左上）+ 参考图数量徽标（右上） */}
            <span className="absolute top-1 left-1 rounded bg-black/55 px-1 text-xs text-white backdrop-blur-sm">
              批 {batchIdx + 1}
            </span>
            {imagesPerUpload > 1 && (
              <span
                title={`本批 ${imagesPerUpload} 张参考图合一次生图`}
                className="absolute top-1 right-1 flex items-center gap-0.5 rounded bg-indigo-500/85 px-1 text-[10px] font-medium text-white backdrop-blur-sm"
              >
                <Layers className="h-2.5 w-2.5" strokeWidth={2.5} />
                {imagesPerUpload}
              </span>
            )}
            {locked ? (
              <span className="absolute right-1 bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-stone-700 text-white shadow-sm">
                <Lock className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : chosen ? (
              <span className="absolute right-1 bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-white shadow-sm ring-2 ring-emerald-300/50">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : isCurrent ? (
              <span className="absolute right-1 bottom-1 h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm ring-2 ring-emerald-500/30" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
