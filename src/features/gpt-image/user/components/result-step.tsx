"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { candidateUrl, originalUrl, preloadImages } from "./image-urls";
import { Lightbox, type LightboxTarget } from "./lightbox";

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
 * 完成步骤 —— 单卡轮播切换模式。
 *
 * 设计要点（2026-08-12 重设计）：
 * - 一次只显示一张主卡（避免 9 张垂直堆叠导致页面 5000px+）
 * - 切图控件：左/右 chevron（sm+ 桌面端）、移动端左右滑动、键盘 ←/→、缩略图条
 * - 大图查看走 Lightbox（已实现，含 compare / 长按看原图）
 * - 单图订单时所有切图控件隐藏，仅展示主卡 + 下载
 */
export function ResultStep({
  token,
  orderNo,
  updatedAt,
  imageCount,
  candidateCount,
  selections,
  onDownload,
}: ResultStepProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null);

  const safeIdx = Math.min(currentIdx, Math.max(0, imageCount - 1));
  const cand = selections[safeIdx] ?? 0;
  const candidateSrc = candidateUrl(token, safeIdx, cand, updatedAt);
  const originalSrc = originalUrl(token, safeIdx, updatedAt);

  const hasNavigation = imageCount > 1;
  const isFirst = safeIdx === 0;
  const isLast = safeIdx === imageCount - 1;

  const closeLightbox = () => setLightbox(null);

  const goPrev = useCallback(() => {
    setCurrentIdx((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setCurrentIdx((i) => Math.min(imageCount - 1, i + 1));
  }, [imageCount]);

  const handleDownloadAll = () => {
    // 浏览器对多文件下载有限制，按顺序带小延迟触发，多数浏览器可接受
    selections.forEach((c, i) => {
      const idx = c ?? 0;
      setTimeout(() => {
        void onDownload(orderNo, i, idx);
      }, i * 400);
    });
  };

  // 预热当前 + 前后各一张，切图时不闪白
  useEffect(() => {
    const urls: string[] = [candidateSrc, originalSrc];
    if (safeIdx > 0) {
      const prevSel = selections[safeIdx - 1] ?? 0;
      urls.push(candidateUrl(token, safeIdx - 1, prevSel, updatedAt));
    }
    if (safeIdx < imageCount - 1) {
      const nextSel = selections[safeIdx + 1] ?? 0;
      urls.push(candidateUrl(token, safeIdx + 1, nextSel, updatedAt));
    }
    preloadImages(urls);
  }, [
    token,
    updatedAt,
    safeIdx,
    imageCount,
    candidateSrc,
    originalSrc,
    selections,
  ]);

  // 键盘快捷键：←/→ 切图，Home/End 跳首尾
  useEffect(() => {
    if (!hasNavigation) return;

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
        return true;
      return target.isContentEditable;
    };

    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (lightbox) return; // lightbox 自己处理
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "ArrowRight":
          e.preventDefault();
          goNext();
          break;
        case "Home":
          e.preventDefault();
          setCurrentIdx(0);
          break;
        case "End":
          e.preventDefault();
          setCurrentIdx(imageCount - 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasNavigation, lightbox, goPrev, goNext, imageCount]);

  // 移动端左右滑动切图（主卡整块都可触发）
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

  return (
    <>
      <section className="mx-auto flex w-full max-w-md flex-col items-stretch px-5 pt-8 pb-10 animate-[fadeIn_.3s_ease-out]">
        {/* ── Hero ── */}
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 ring-4 ring-emerald-50/60">
            <CheckCircle2
              className="h-8 w-8 text-emerald-500"
              strokeWidth={2}
            />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900">
            全部完成！
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            共{" "}
            <span className="font-semibold text-stone-700">{imageCount}</span>{" "}
            张效果图已提交
          </p>
        </div>

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

        {/* ── 下载全部（多图时主 CTA） ── */}
        {imageCount > 1 && (
          <button
            type="button"
            onClick={handleDownloadAll}
            className="mb-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-blue-500 text-sm font-medium text-white shadow-lg shadow-indigo-200/50 transition-all hover:shadow-indigo-300/60 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Download className="h-4 w-4" />
            下载全部 {imageCount} 张
          </button>
        )}

        {/* ── 计数器（多图时） ── */}
        {hasNavigation && (
          <div className="mb-2.5 flex justify-center">
            <span className="rounded-full bg-stone-900/5 px-3 py-1 text-xs font-medium tabular-nums text-stone-600">
              {safeIdx + 1} / {imageCount}
            </span>
          </div>
        )}

        {/* ── 主卡（包含触摸手势 + 左右 chevron） ── */}
        <div ref={swipeAreaRef} className="relative">
          <article className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
            {/* 上：成品大图区（chevron 也定位在这里） */}
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setLightbox({ imageIdx: safeIdx, candIdx: cand })
                }
                aria-label={`放大查看第 ${safeIdx + 1} 张成品`}
                className="group relative block aspect-[3/4] w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
                <img
                  src={candidateSrc}
                  alt={`第 ${safeIdx + 1} 张成品效果图`}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  loading="lazy"
                />
                {/* 已选用角标（左上） */}
                <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white shadow-sm backdrop-blur-sm">
                  <CheckCircle2 className="h-3 w-3" strokeWidth={3} />
                  选用 #{cand + 1}
                </span>
              </button>

              {/* 左右 chevron —— 仅桌面端显示（mobile 走 swipe / 缩略图） */}
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

            {/* 下：原图缩略图 + 第 N 张 + 下载（一行） */}
            <div className="flex items-center gap-2.5 border-t border-stone-100 px-3 py-2.5">
              <button
                type="button"
                onClick={() =>
                  setLightbox({ imageIdx: safeIdx, candIdx: cand })
                }
                aria-label={`放大查看第 ${safeIdx + 1} 张原图`}
                className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
                <img
                  src={originalSrc}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-stone-700">
                  第 {safeIdx + 1} 张
                </p>
                <p className="text-[10px] text-stone-400">
                  原图 · 已选 #{cand + 1}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onDownload(orderNo, safeIdx, cand)}
                aria-label={`下载第 ${safeIdx + 1} 张成品`}
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-stone-100 px-2.5 text-xs font-medium text-stone-700 transition-colors hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <Download className="h-3.5 w-3.5" />
                下载
              </button>
            </div>
          </article>
        </div>

        {/* ── 缩略图条（可点跳转，横向滚动） ── */}
        {hasNavigation && (
          <div className="mt-4">
            <ResultStrip
              token={token}
              updatedAt={updatedAt}
              count={imageCount}
              currentIdx={safeIdx}
              selections={selections}
              onChange={setCurrentIdx}
            />
          </div>
        )}

        {/* ── 底部完成提示 ── */}
        <div className="mt-7 flex items-center justify-center gap-2 rounded-xl bg-stone-50 px-4 py-3 text-xs text-stone-500">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span>已收到你的选择 · 会尽快安排打印</span>
        </div>
      </section>

      {lightbox && (
        <Lightbox
          open
          onClose={closeLightbox}
          token={token}
          updatedAt={updatedAt}
          target={lightbox}
          onTargetChange={setLightbox}
          imageCount={imageCount}
          candidateCount={candidateCount}
          selectedCand={selections[lightbox.imageIdx] ?? null}
          readOnly
          onSelect={() => {}}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────
// 缩略图条 —— 终态版本（不再区分 locked/chosen/未选三态）
// ──────────────────────────────────────────

interface ResultStripProps {
  token: string;
  updatedAt: string;
  count: number;
  currentIdx: number;
  selections: (number | null)[];
  onChange: (idx: number) => void;
}

function ResultStrip({
  token,
  updatedAt,
  count,
  currentIdx,
  selections,
  onChange,
}: ResultStripProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // 当前选中滚到视口中心（横向滚动）
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#result-tab-${currentIdx}`)
      ?.scrollIntoView({
        block: "nearest",
        inline: "center",
        behavior: "smooth",
      });
  }, [currentIdx]);

  if (count <= 1) return null;

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="切换结果图"
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
    >
      {Array.from({ length: count }).map((_, i) => {
        const sel = selections[i] ?? 0;
        const isCurrent = i === currentIdx;
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: 顺序固定，与 imageIdx 一一对应
            key={i}
            id={`result-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={isCurrent}
            tabIndex={isCurrent ? 0 : -1}
            onClick={() => onChange(i)}
            aria-label={`第 ${i + 1} 张效果图`}
            className={[
              "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition-all sm:h-16 sm:w-16",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
              isCurrent
                ? "border-emerald-500 ring-2 ring-emerald-500/30"
                : "border-stone-200 opacity-60 hover:opacity-100",
            ].join(" ")}
          >
            {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
            <img
              src={candidateUrl(token, i, sel, updatedAt)}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
            <span className="absolute top-1 left-1 rounded bg-black/55 px-1 text-[10px] font-semibold text-white backdrop-blur-sm tabular-nums">
              {i + 1}
            </span>
          </button>
        );
      })}
    </div>
  );
}
