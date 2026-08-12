"use client";

import { ChevronLeft, ChevronRight, Download, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { candidateUrl, preloadImages } from "./image-urls";

interface ResultStepProps {
  token: string;
  orderNo: string;
  updatedAt: string;
  imageCount: number;
  candidateCount: number;
  selections: (number | null)[];
  onDownload: (
    orderNo: string,
    imageIdx: number,
    candIdx: number
  ) => Promise<void>;
}

const SWIPE_THRESHOLD = 50; // px

/**
 * 完成步骤 —— 简洁浏览视图。
 *
 * 设计要点（2026-08-12 重设计）：
 * - 一次只显示一张主图（避免 9 张垂直堆叠导致页面 5000px+）
 * - 切图方式：移动端左右滑动、桌面端 chevron（sm: 可见）
 * - 终态固定显示每张照片的已选效果
 * - 单图订单：所有切图控件隐藏，仅展示主图 + 下载
 */
export function ResultStep({
  token,
  orderNo,
  updatedAt,
  imageCount,
  selections,
  onDownload,
}: ResultStepProps) {
  const [photoIdx, setPhotoIdx] = useState(0);

  const safePhoto = Math.min(photoIdx, Math.max(0, imageCount - 1));
  const selectedCand = selections[safePhoto] ?? 0;
  const candidateSrc = candidateUrl(token, safePhoto, selectedCand, updatedAt);

  const hasNavigation = imageCount > 1;
  const isFirst = safePhoto === 0;
  const isLast = safePhoto === imageCount - 1;

  const goPrev = useCallback(() => {
    setPhotoIdx((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setPhotoIdx((i) => Math.min(imageCount - 1, i + 1));
  }, [imageCount]);

  // 预热当前 + 前后各一张，切图时不闪白
  useEffect(() => {
    const urls: string[] = [candidateSrc];
    if (safePhoto > 0) {
      const prevSel = selections[safePhoto - 1] ?? 0;
      urls.push(candidateUrl(token, safePhoto - 1, prevSel, updatedAt));
    }
    if (safePhoto < imageCount - 1) {
      const nextSel = selections[safePhoto + 1] ?? 0;
      urls.push(candidateUrl(token, safePhoto + 1, nextSel, updatedAt));
    }
    preloadImages(urls);
  }, [
    token,
    updatedAt,
    safePhoto,
    imageCount,
    candidateSrc,
    selections,
  ]);

  // 移动端横向滑动切照片
  const swipeAreaRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!hasNavigation) return;
    const el = swipeAreaRef.current;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      touchStart.current = { x: t.clientX, y: t.clientY };
    };
    const onTouchEnd = (e: TouchEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;
      if (Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) goNext();
      else goPrev();
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [hasNavigation, goPrev, goNext]);

  const handleDownloadAll = () => {
    // 浏览器对多文件下载有限制，按顺序带小延迟触发
    selections.forEach((c, i) => {
      const idx = c ?? 0;
      setTimeout(() => {
        void onDownload(orderNo, i, idx);
      }, i * 400);
    });
  };

  return (
    <section className="mx-auto flex w-full max-w-md flex-col items-stretch px-5 pt-6 pb-8 animate-[fadeIn_.3s_ease-out]">
      {/* ── 锁定提示条 ── */}
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2">
        <Lock
          className="h-3.5 w-3.5 shrink-0 text-amber-500"
          strokeWidth={2.5}
        />
        <p className="text-xs leading-relaxed text-amber-700">
          结果已锁定 · 如需调整请联系服务方重新开启
        </p>
      </div>

      {/* ── 位置显示 ── */}
      <div className="mb-3 text-center">
        <p className="text-2xl font-bold tracking-tight text-stone-900 tabular-nums">
          照片 {safePhoto + 1} / {imageCount}
        </p>
        <p className="mt-0.5 text-sm text-stone-500 tabular-nums">
          已选 #{selectedCand + 1}
        </p>
      </div>

      {/* ── 主卡（包含触摸手势 + 左右 chevron） ── */}
      <div ref={swipeAreaRef} className="relative">
        <article className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
          <div className="relative">
            {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
            <img
              src={candidateSrc}
              alt={`第 ${safePhoto + 1} 张照片的效果图`}
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
            />
            <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white shadow-sm backdrop-blur-sm">
              已选 #{selectedCand + 1}
            </span>

            {hasNavigation && (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={isFirst}
                  aria-label="上一张"
                  className="absolute top-1/2 left-2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-stone-700 shadow-md ring-1 ring-stone-200 backdrop-blur-sm transition-all hover:scale-105 hover:bg-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:scale-100 sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <ChevronLeft className="h-5 w-5" strokeWidth={2.25} />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={isLast}
                  aria-label="下一张"
                  className="absolute top-1/2 right-2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-stone-700 shadow-md ring-1 ring-stone-200 backdrop-blur-sm transition-all hover:scale-105 hover:bg-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:scale-100 sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <ChevronRight className="h-5 w-5" strokeWidth={2.25} />
                </button>
              </>
            )}
          </div>
        </article>
      </div>

      {/* ── 下载全部（多图时，放图像下方） ── */}
      {imageCount > 1 && (
        <button
          type="button"
          onClick={handleDownloadAll}
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-blue-500 text-sm font-medium text-white shadow-lg shadow-indigo-200/50 transition-all hover:shadow-indigo-300/60 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <Download className="h-4 w-4" />
          下载全部 {imageCount} 张
        </button>
      )}
    </section>
  );
}