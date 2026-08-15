"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Eye,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { candidateUrl, originalUrl, preloadImages } from "./image-urls";

export interface LightboxTarget {
  imageIdx: number;
  candIdx: number;
}

interface LightboxProps {
  open: boolean;
  onClose: () => void;
  token: string;
  updatedAt: string;
  target: LightboxTarget;
  onTargetChange: (t: LightboxTarget) => void;
  imageCount: number;
  candidateCount: number;
  selectedCand: number | null;
  readOnly?: boolean;
  onSelect: (imageIdx: number, candIdx: number) => void;
}

const SWIPE_X = 60;
const SWIPE_DOWN = 110;

export function Lightbox({
  open,
  onClose,
  token,
  updatedAt,
  target,
  onTargetChange,
  imageCount,
  candidateCount,
  selectedCand,
  readOnly = false,
  onSelect,
}: LightboxProps) {
  const { imageIdx, candIdx } = target;
  const reduce = useReducedMotion();
  const [compareMode, setCompareMode] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [seenImageIdx, setSeenImageIdx] = useState(imageIdx);
  if (seenImageIdx !== imageIdx) {
    setSeenImageIdx(imageIdx);
    setCompareMode(false);
    setPeeking(false);
  }

  const isSelected = selectedCand === candIdx;

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setPeeking(false);
  }, []);

  const go = useCallback(
    (dCand: number, dImage = 0) => {
      let nextImage = imageIdx;
      let nextCand = candIdx;
      if (dImage !== 0) {
        nextImage = (imageIdx + dImage + imageCount) % imageCount;
        // 切图时尽量保留同位次（不超过新图的候选数），
        // 避免每次换图都跳回首张让用户在大图模式下翻页错乱。
        nextCand = Math.min(candIdx, candidateCount - 1);
      } else {
        nextCand = (candIdx + dCand + candidateCount) % candidateCount;
      }
      onTargetChange({ imageIdx: nextImage, candIdx: nextCand });
    },
    [imageIdx, candIdx, imageCount, candidateCount, onTargetChange]
  );

  const confirm = useCallback(() => {
    if (readOnly) return;
    onSelect(imageIdx, candIdx);
  }, [readOnly, onSelect, imageIdx, candIdx]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          go(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          go(1);
          break;
        case "ArrowUp":
          if (imageCount > 1) {
            e.preventDefault();
            go(0, -1);
          }
          break;
        case "ArrowDown":
          if (imageCount > 1) {
            e.preventDefault();
            go(0, 1);
          }
          break;
        case " ":
          e.preventDefault();
          setCompareMode((v) => !v);
          break;
        case "Enter":
          e.preventDefault();
          confirm();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go, confirm, imageCount]);

  useEffect(() => {
    if (!open) return;
    const prev = (candIdx - 1 + candidateCount) % candidateCount;
    const next = (candIdx + 1) % candidateCount;
    preloadImages([
      originalUrl(token, imageIdx, updatedAt),
      candidateUrl(token, imageIdx, prev, updatedAt),
      candidateUrl(token, imageIdx, next, updatedAt),
    ]);
  }, [open, token, updatedAt, imageIdx, candIdx, candidateCount]);

  useEffect(
    () => () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    },
    []
  );

  const currentSrc = candidateUrl(token, imageIdx, candIdx, updatedAt);
  const originalSrc = originalUrl(token, imageIdx, updatedAt);

  /**
   * 把 candidateCount 映射成宫格布局，与 QuadrantGrid 一致。
   * candidateCount=1 时返回 (1,1) —— 等价于直接显示，不需要裁剪（调用方判断）。
   */
  const layoutOf = (n: number): { cols: number; rows: number } => {
    if (n === 1) return { cols: 1, rows: 1 };
    if (n === 2) return { cols: 2, rows: 1 };
    if (n === 4) return { cols: 2, rows: 2 };
    return { cols: 3, rows: 3 };
  };
  const { cols, rows } = layoutOf(candidateCount);
  const col = candIdx % cols;
  const row = Math.floor(candIdx / cols);
  /**
   * 宫格模式下用 background-image 裁出对应格子，避免把整张拼接图等比缩小
   * （拼接图是 1 张图，候选是其中一块，缩小后整图小到看不清细节）。
   */
  const candidateCropStyle: React.CSSProperties =
    candidateCount > 1
      ? {
          backgroundImage: `url(${currentSrc})`,
          backgroundSize: `${cols * 100}% ${rows * 100}%`,
          backgroundRepeat: "no-repeat",
          backgroundPosition:
            cols > 1
              ? `${(col / (cols - 1)) * 100}% ${row > 0 ? (row / (rows - 1)) * 100 : 0}%`
              : "0 0",
        }
      : {};

  const fade = reduce
    ? {}
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-zinc-950" />
        <DialogPrimitive.Content
          aria-describedby="lightbox-hint"
          className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-zinc-100 outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            第 {imageIdx + 1} 张照片的效果图 {candIdx + 1}，共 {candidateCount}{" "}
            张
          </DialogPrimitive.Title>
          <p id="lightbox-hint" className="sr-only">
            左右方向键切换效果，上下方向键切换照片，空格键对比原图，回车选择，Esc
            关闭。
          </p>

          <div className="flex items-center justify-between gap-2 px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 sm:px-5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                照片 {imageIdx + 1} / {imageCount}
              </p>
              <p
                aria-live="polite"
                className="text-xs text-zinc-400 tabular-nums"
              >
                共 {candidateCount} 张可选
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCompareMode((v) => !v)}
                aria-pressed={compareMode}
                className="flex h-11 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                {compareMode ? (
                  <Columns2 className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                {compareMode ? "退出对比" : "对比原图"}
              </button>
              <DialogPrimitive.Close
                aria-label="关闭"
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <X className="h-5 w-5" />
              </DialogPrimitive.Close>
            </div>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-3 sm:px-14"
            onPointerDown={(e) => {
              dragRef.current = { x: e.clientX, y: e.clientY };
              holdTimerRef.current = setTimeout(() => setPeeking(true), 350);
            }}
            onPointerMove={(e) => {
              const start = dragRef.current;
              if (!start || !holdTimerRef.current) return;
              if (
                Math.abs(e.clientX - start.x) > 10 ||
                Math.abs(e.clientY - start.y) > 10
              ) {
                cancelHold();
              }
            }}
            onPointerCancel={cancelHold}
            onPointerLeave={cancelHold}
            onPointerUp={(e) => {
              const wasPeeking = peeking;
              cancelHold();
              const start = dragRef.current;
              dragRef.current = null;
              if (!start || wasPeeking) return;
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_X) {
                go(dx < 0 ? 1 : -1);
              } else if (dy > SWIPE_DOWN) {
                onClose();
              }
            }}
          >
            {candidateCount > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label="上一张效果"
                  className="absolute top-1/2 left-2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:flex"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label="下一张效果"
                  className="absolute top-1/2 right-2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:flex"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}

            {compareMode ? (
              <div className="grid h-full w-full grid-rows-2 gap-2 py-1 md:grid-cols-2 md:grid-rows-1">
                <figure className="flex min-h-0 flex-col items-center justify-center gap-1.5">
                  <img
                    src={originalSrc}
                    alt={`第 ${imageIdx + 1} 张原图`}
                    className="max-h-full min-h-0 w-auto max-w-full rounded-lg object-contain"
                  />
                  <figcaption className="text-xs text-zinc-400">
                    原图
                  </figcaption>
                </figure>
                <figure className="flex min-h-0 flex-col items-center justify-center gap-1.5">
                  {candidateCount > 1 ? (
                    <div
                      aria-label={`第 ${imageIdx + 1} 张照片的效果图 ${candIdx + 1}`}
                      className="max-h-full min-h-0 w-auto max-w-full rounded-lg"
                      style={{
                        aspectRatio: "1 / 1",
                        ...candidateCropStyle,
                      }}
                    />
                  ) : (
                    <img
                      src={currentSrc}
                      alt={`第 ${imageIdx + 1} 张照片的效果图 ${candIdx + 1}`}
                      className="max-h-full min-h-0 w-auto max-w-full rounded-lg object-contain"
                    />
                  )}
                  <figcaption className="text-xs text-emerald-400">
                    已选
                  </figcaption>
                </figure>
              </div>
            ) : (
              <>
                <AnimatePresence mode="wait" initial={false}>
                  {peeking || candidateCount === 1 ? (
                    <motion.img
                      key={`${imageIdx}-${candIdx}-${peeking ? "o" : "c"}`}
                      {...fade}
                      transition={{ duration: reduce ? 0 : 0.16 }}
                      src={peeking ? originalSrc : currentSrc}
                      alt={
                        peeking
                          ? `第 ${imageIdx + 1} 张原图`
                          : `第 ${imageIdx + 1} 张照片的效果图 ${candIdx + 1}`
                      }
                      className="max-h-full max-w-full select-none rounded-lg object-contain"
                      draggable={false}
                    />
                  ) : (
                    <motion.div
                      key={`${imageIdx}-${candIdx}-c-crop`}
                      {...fade}
                      transition={{ duration: reduce ? 0 : 0.16 }}
                      aria-label={`第 ${imageIdx + 1} 张照片的效果图 ${candIdx + 1}`}
                      className="max-h-full max-w-full select-none rounded-lg"
                      draggable={false}
                      style={{
                        aspectRatio: "1 / 1",
                        backgroundImage: candidateCropStyle.backgroundImage,
                        backgroundSize: candidateCropStyle.backgroundSize,
                        backgroundRepeat: candidateCropStyle.backgroundRepeat,
                        backgroundPosition:
                          candidateCropStyle.backgroundPosition,
                      }}
                    />
                  )}
                </AnimatePresence>
                {peeking && (
                  <span className="pointer-events-none absolute bottom-3 rounded-lg bg-white/15 px-3 py-1 text-xs text-white backdrop-blur">
                    原图
                  </span>
                )}
              </>
            )}
          </div>

          <div className="space-y-3 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 sm:px-5">
            {candidateCount > 1 && (
              <div className="flex justify-center gap-2 overflow-x-auto">
                {Array.from({ length: candidateCount }).map((_, c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onTargetChange({ imageIdx, candIdx: c })}
                    aria-label={`查看效果 ${c + 1}`}
                    aria-current={c === candIdx}
                    className={[
                      "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                      c === candIdx
                        ? "border-white"
                        : "border-transparent opacity-60 hover:opacity-100",
                    ].join(" ")}
                  >
                    <img
                      src={candidateUrl(token, imageIdx, c, updatedAt)}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    {selectedCand === c && (
                      <span className="absolute inset-x-0 bottom-0 flex h-4 items-center justify-center bg-emerald-500">
                        <Check className="h-3 w-3 text-white" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {!readOnly && (
              <button
                type="button"
                onClick={confirm}
                className={[
                  "flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                  isSelected
                    ? "bg-emerald-500 text-white hover:bg-emerald-600"
                    : "bg-white text-zinc-900 hover:bg-zinc-100",
                ].join(" ")}
              >
                {isSelected ? (
                  <>
                    <Check className="h-4 w-4" /> 已选择这张（再点取消）
                  </>
                ) : (
                  "选择这张"
                )}
              </button>
            )}
            <p className="text-center text-xs text-zinc-500 sm:hidden">
              左右滑切换 · 长按看原图 · 双击选择
            </p>
            <p className="hidden text-center text-xs text-zinc-500 sm:block">
              ← → 切换效果 · 空格并排对比 · 长按图片看原图 · Enter 选择 · Esc
              关闭
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
