"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  Layers,
  Lock,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { candidateUrl, preloadImages } from "./image-urls";

interface ResultStepProps {
  token: string;
  orderNo: string;
  updatedAt: string;
  /**
   * 2026-09-02：批次数（= ceil(uploadedImageCount / imagesPerUpload)）。
   * 索引语义从 imageIdx（张数）改成 batchIdx（批次槽位）。
   */
  batchCount: number;
  candidateCount: number;
  /** 长度 = batchCount，按 batchIdx 索引 */
  selections: (number | null)[];
  /**
   * 2026-09-02：每批参考图张数（用于详情说明 / 下载文件名）。
   */
  imagesPerUpload: number;
  onDownload: (
    orderNo: string,
    batchIdx: number,
    candIdx: number
  ) => Promise<void>;
}

const SWIPE_THRESHOLD = 50; // px

/**
 * 完成步骤 —— 简洁浏览视图（批次索引版）。
 *
 * 2026-09-02：从「按张数展示 N 张照片」改成「按批次展示 N 个候选组」。
 * - 一次只显示一个候选组（避免 N 个垂直堆叠导致页面 5000px+）
 * - 切批次方式：移动端左右滑动、桌面端 chevron（sm: 可见）
 * - 终态固定显示每批已选效果
 * - 单批订单：所有切批控件隐藏，仅展示主图 + 下载
 */
export function ResultStep({
  token,
  orderNo,
  updatedAt,
  batchCount,
  selections,
  imagesPerUpload,
  onDownload,
}: ResultStepProps) {
  const [batchIdx, setBatchIdx] = useState(0);

  const safeBatchIdx = Math.min(batchIdx, Math.max(0, batchCount - 1));
  const selectedCand = selections[safeBatchIdx] ?? 0;
  const candidateSrc = candidateUrl(
    token,
    safeBatchIdx,
    selectedCand,
    updatedAt
  );

  const hasNavigation = batchCount > 1;
  const isFirst = safeBatchIdx === 0;
  const isLast = safeBatchIdx === batchCount - 1;

  const goPrev = useCallback(() => {
    setBatchIdx((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setBatchIdx((i) => Math.min(batchCount - 1, i + 1));
  }, [batchCount]);

  // 预热当前 + 前后各一批，切批时不闪白
  useEffect(() => {
    const urls: string[] = [candidateSrc];
    if (safeBatchIdx > 0) {
      const prevSel = selections[safeBatchIdx - 1] ?? 0;
      urls.push(candidateUrl(token, safeBatchIdx - 1, prevSel, updatedAt));
    }
    if (safeBatchIdx < batchCount - 1) {
      const nextSel = selections[safeBatchIdx + 1] ?? 0;
      urls.push(candidateUrl(token, safeBatchIdx + 1, nextSel, updatedAt));
    }
    preloadImages(urls);
  }, [token, updatedAt, safeBatchIdx, batchCount, candidateSrc, selections]);

  // 移动端横向滑动切批次
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
      {/* ── 位置显示 ── */}
      <div className="mb-3 text-center">
        <p className="text-2xl font-bold tracking-tight text-stone-900 tabular-nums">
          第 {safeBatchIdx + 1} / {batchCount} 批
        </p>
        <p className="mt-0.5 flex items-center justify-center gap-1 text-sm text-stone-500">
          {imagesPerUpload > 1 && (
            <Layers className="h-3.5 w-3.5" strokeWidth={2.25} />
          )}
          {imagesPerUpload > 1
            ? `${imagesPerUpload} 张参考图合一次生成 · 已选候选`
            : "已选候选"}
        </p>
      </div>

      {/* ── 主卡（包含触摸手势 + 左右 chevron） ── */}
      <div ref={swipeAreaRef} className="relative">
        <article className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
          <div className="relative">
            {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
            <img
              src={candidateSrc}
              alt={`第 ${safeBatchIdx + 1} 批的效果图`}
              className="aspect-[4/3] w-full object-cover"
              loading="lazy"
            />
            <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white shadow-sm backdrop-blur-sm">
              已选
            </span>

            {hasNavigation && (
              <>
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={isFirst}
                  aria-label="上一批"
                  className="absolute top-1/2 left-2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-stone-700 shadow-md ring-1 ring-stone-200 backdrop-blur-sm transition-all hover:scale-105 hover:bg-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:scale-100 sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <ChevronLeft className="h-5 w-5" strokeWidth={2.25} />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={isLast}
                  aria-label="下一批"
                  className="absolute top-1/2 right-2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-stone-700 shadow-md ring-1 ring-stone-200 backdrop-blur-sm transition-all hover:scale-105 hover:bg-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:scale-100 sm:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <ChevronRight className="h-5 w-5" strokeWidth={2.25} />
                </button>
              </>
            )}
          </div>
        </article>
      </div>

      {/* ── 锁定提示条（下载按钮上方） ── */}
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2">
        <Lock
          className="h-3.5 w-3.5 shrink-0 text-amber-500"
          strokeWidth={2.5}
        />
        <p className="text-xs leading-relaxed text-amber-700">
          结果已锁定 · 如需调整请联系服务方重新开启
        </p>
      </div>

      {/* ── 安排打印提示（下载按钮上方） ── */}
      <div className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-stone-50 px-4 py-3 text-xs text-stone-500">
        <span>已收到你的选择 · 会尽快安排打印</span>
      </div>

      {/* ── 下载全部（多批时） ── */}
      {batchCount > 1 && (
        <button
          type="button"
          onClick={handleDownloadAll}
          className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-blue-500 text-sm font-medium text-white shadow-lg shadow-indigo-200/50 transition-all hover:shadow-indigo-300/60 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <Download className="h-4 w-4" />
          下载全部 {batchCount} 批
        </button>
      )}
    </section>
  );
}
