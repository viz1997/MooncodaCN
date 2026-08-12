"use client";

import { Download, Eye, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { candidateUrl, originalUrl, preloadImages } from "./image-urls";

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
const LONG_PRESS_MS = 300; // 长按阈值

/**
 * 完成步骤 —— 简洁浏览视图（非放大预览）。
 *
 * 设计要点（2026-08-12 重设计）：
 * - 紧凑布局：照片位置 + 效果位置 + 中等大小候选图（不放大）
 * - 键盘导航：
 *   · ←/→ 切换当前照片下的效果
 *   · ↑/↓ 切换照片
 *   · 空格 并排对比原图
 *   · Enter 选择（终态已锁，no-op）
 *   · Esc  关闭（退出对比模式）
 * - 移动端：横向滑动切照片、长按图片看原图、点"对比原图"按钮
 * - 单图订单：所有切图控件隐藏，仅展示主视图 + 下载
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
  const [photoIdx, setPhotoIdx] = useState(0);
  const [candIdx, setCandIdx] = useState(() => selections[0] ?? 0);
  const [compareMode, setCompareMode] = useState(false);
  const [peeking, setPeeking] = useState(false);

  const safePhoto = Math.min(photoIdx, Math.max(0, imageCount - 1));
  const safeCand = Math.min(candIdx, Math.max(0, candidateCount - 1));
  const selectedCand = selections[safePhoto] ?? 0;

  const candidateSrc = candidateUrl(token, safePhoto, safeCand, updatedAt);
  const originalSrc = originalUrl(token, safePhoto, updatedAt);

  const hasMultiplePhotos = imageCount > 1;
  const hasMultipleEffects = candidateCount > 1;

  // 切照片时把 candIdx 同步到该照片的已选效果
  useEffect(() => {
    setCandIdx(selections[safePhoto] ?? 0);
  }, [safePhoto, selections]);

  // 预热：当前 candidate + 原图 + 选中 candidate
  useEffect(() => {
    const urls: string[] = [
      candidateUrl(token, safePhoto, safeCand, updatedAt),
      originalSrc,
    ];
    if (safeCand !== selectedCand) {
      urls.push(candidateUrl(token, safePhoto, selectedCand, updatedAt));
    }
    preloadImages(urls);
  }, [token, updatedAt, safePhoto, safeCand, selectedCand, originalSrc]);

  // 键盘快捷键
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
        return true;
      return target.isContentEditable;
    };

    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      switch (e.key) {
        case "ArrowLeft":
          if (hasMultipleEffects) {
            e.preventDefault();
            setCandIdx((i) => (i - 1 + candidateCount) % candidateCount);
          }
          break;
        case "ArrowRight":
          if (hasMultipleEffects) {
            e.preventDefault();
            setCandIdx((i) => (i + 1) % candidateCount);
          }
          break;
        case "ArrowUp":
          if (hasMultiplePhotos) {
            e.preventDefault();
            setPhotoIdx((i) => Math.max(0, i - 1));
          }
          break;
        case "ArrowDown":
          if (hasMultiplePhotos) {
            e.preventDefault();
            setPhotoIdx((i) => Math.min(imageCount - 1, i + 1));
          }
          break;
        case " ":
          // 空格 = toggle compareMode（也允许按钮区输入空格时触发对比，避免误吞）
          if (!e.repeat) {
            e.preventDefault();
            setCompareMode((m) => !m);
          }
          break;
        case "Enter":
          // 终态已锁，Enter 选择为 no-op
          break;
        case "Escape":
          if (compareMode) {
            e.preventDefault();
            setCompareMode(false);
          }
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    hasMultipleEffects,
    hasMultiplePhotos,
    candidateCount,
    imageCount,
    compareMode,
  ]);

  // 移动端横向滑动切照片
  const swipeAreaRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!hasMultiplePhotos) return;
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
      if (dx < 0) setPhotoIdx((i) => Math.min(imageCount - 1, i + 1));
      else setPhotoIdx((i) => Math.max(0, i - 1));
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [hasMultiplePhotos, imageCount]);

  // 长按图片看原图（peek）
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPeek = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => setPeeking(true), LONG_PRESS_MS);
  }, []);

  const endPeek = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setPeeking(false);
  }, []);

  useEffect(
    () => () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    },
    []
  );

  const handleDownloadAll = () => {
    // 浏览器对多文件下载有限制，按顺序带小延迟触发
    selections.forEach((c, i) => {
      const idx = c ?? 0;
      setTimeout(() => {
        void onDownload(orderNo, i, idx);
      }, i * 400);
    });
  };

  const isSelectedView = safeCand === selectedCand;

  return (
    <section className="mx-auto flex w-full max-w-md flex-col items-stretch px-5 pt-6 pb-8 animate-[fadeIn_.3s_ease-out]">
      {/* ── 顶部位置描述 + 键位提示 ── */}
      <div className="mb-4 text-center">
        <p className="text-sm text-stone-600">
          第 {safePhoto + 1} 张照片的效果图 {safeCand + 1}，共 {candidateCount}{" "}
          张
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-stone-400">
          左右方向键切换效果，上下方向键切换照片，空格键对比原图，回车选择，Esc
          关闭
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

      {/* ── 位置显示 ── */}
      <div className="mb-3 text-center">
        <p className="text-2xl font-bold tracking-tight text-stone-900 tabular-nums">
          照片 {safePhoto + 1} / {imageCount}
        </p>
        <p className="mt-0.5 text-sm text-stone-500 tabular-nums">
          效果 #{safeCand + 1} / 共 {candidateCount} 张
          {!isSelectedView && (
            <span className="ml-2 text-xs text-amber-600">
              （已选 #{selectedCand + 1}）
            </span>
          )}
        </p>
      </div>

      {/* ── 对比原图按钮（空格切换） ── */}
      <button
        type="button"
        onClick={() => setCompareMode((m) => !m)}
        aria-pressed={compareMode}
        className={[
          "mb-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
          compareMode
            ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300"
            : "bg-stone-100 text-stone-700 hover:bg-stone-200",
        ].join(" ")}
      >
        <Eye className="h-4 w-4" />
        {compareMode ? "退出对比" : "对比原图"}
      </button>

      {/* ── 图像区 ── */}
      <div ref={swipeAreaRef} className="relative">
        {compareMode ? (
          <div className="grid grid-cols-2 gap-1.5">
            <ComparePane label="原图" src={originalSrc} />
            <ComparePane
              label={
                isSelectedView
                  ? `已选 #${safeCand + 1}`
                  : `候选 #${safeCand + 1}`
              }
              src={candidateSrc}
              highlighted={isSelectedView}
            />
          </div>
        ) : (
          <button
            type="button"
            onMouseDown={startPeek}
            onMouseUp={endPeek}
            onMouseLeave={endPeek}
            onTouchStart={startPeek}
            onTouchEnd={endPeek}
            onTouchCancel={endPeek}
            aria-label={`第 ${safePhoto + 1} 张照片，效果 ${safeCand + 1}${isSelectedView ? "（已选）" : ""}`}
            className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl border border-stone-100 bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
            <img
              src={peeking ? originalSrc : candidateSrc}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              draggable={false}
            />
            {peeking ? (
              <span className="absolute top-2 left-2 rounded bg-black/70 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
                原图
              </span>
            ) : (
              <span
                className={[
                  "absolute top-2 left-2 rounded-full px-2 py-1 text-[10px] font-semibold text-white shadow-sm backdrop-blur-sm",
                  isSelectedView ? "bg-emerald-500" : "bg-amber-500",
                ].join(" ")}
              >
                {isSelectedView
                  ? `已选 #${safeCand + 1}`
                  : `候选 #${safeCand + 1}`}
              </span>
            )}
          </button>
        )}
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

      {/* ── 底部键盘提示 ── */}
      <div className="mt-4 rounded-xl bg-stone-50 px-4 py-3 text-center text-xs leading-relaxed text-stone-500">
        ← → 切换效果 · 空格并排对比 · 长按图片看原图 · Enter 选择 · Esc 关闭
      </div>
    </section>
  );
}

// ──────────────────────────────────────────
// ComparePane —— 对比模式的两宫格
// ──────────────────────────────────────────

interface ComparePaneProps {
  label: string;
  src: string;
  highlighted?: boolean;
}

function ComparePane({ label, src, highlighted }: ComparePaneProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-stone-100 bg-stone-50">
      {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
      <img
        src={src}
        alt=""
        className="aspect-square w-full object-cover"
        loading="lazy"
      />
      <span
        className={[
          "absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm backdrop-blur-sm",
          highlighted ? "bg-emerald-500" : "bg-black/70",
        ].join(" ")}
      >
        {label}
      </span>
    </div>
  );
}
