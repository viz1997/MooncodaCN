"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { originalUrl, preloadImages } from "./image-urls";

interface OriginalLightboxProps {
  open: boolean;
  onClose: () => void;
  token: string;
  updatedAt: string;
  /**
   * 2026-09-02：当前预览的 batchIdx（不是单图 imageIdx）。批次内可继续
   * 翻看 imagesPerUpload 张原图。
   */
  batchIdx: number;
  /** 订单总批次数（= ceil(uploadedImageCount / imagesPerUpload)） */
  batchCount: number;
  /**
   * 2026-09-02：每批参考图张数。批次内循环张数 = min(imagesPerUpload,
   * uploadedImageCount - batchIdx * imagesPerUpload)。
   */
  imagesPerUpload: number;
  /**
   * 2026-09-02：订单实际已上传张数。最后一批可能不足 imagesPerUpload 张。
   */
  uploadedImageCount: number;
  /** 翻页回调：父组件切到新 batchIdx（与 SelectStep currentIdx 同步） */
  onChangeBatch?: (batchIdx: number) => void;
}

const SWIPE_X = 60;
const SWIPE_DOWN = 110;

/**
 * 批次原图预览灯箱 —— 2026-09-02 从「原图条」改成「批次条」。
 *
 * 之前是单图切换（imageIdx = 0..uploadedImageCount-1）；现在按批次切：
 * - 批次内：横滑 / ←→ 切换 imagesPerUpload 张原图
 * - 批次间：上 /下方向键切换 batchIdx（同步 SelectStep currentIdx）
 *
 * 设计要点：
 * - 单批订单（batchCount === 1）：只展示本批内 N 张原图，下/上滑动关闭
 * - 多批订单：批次内 ←/→ 翻原图，批次间 ↑/↓ 切批次
 * - Esc / 点 X / 下滑关闭
 * - 与 Lightbox 的"对比原图"模式不同：本组件**只展示原图**，给"我想看清
 *   楚自己上传的图片长什么样"的场景用的入口
 */
export function OriginalLightbox({
  open,
  onClose,
  token,
  updatedAt,
  batchIdx,
  batchCount,
  imagesPerUpload,
  uploadedImageCount,
  onChangeBatch,
}: OriginalLightboxProps) {
  const reduce = useReducedMotion();
  // 内部维护当前 batchIdx 与批次内 localIdx；父组件切换时同步
  const [localBatchIdx, setLocalBatchIdx] = useState(batchIdx);
  const [localInBatchIdx, setLocalInBatchIdx] = useState(0);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setLocalBatchIdx(batchIdx);
    setLocalInBatchIdx(0);
  }, [batchIdx]);

  // 当前批内的实际张数：可能是最后一批不满 imagesPerUpload
  const perBatch = Math.max(1, imagesPerUpload);
  const inBatchSize = (() => {
    const remaining = uploadedImageCount - localBatchIdx * perBatch;
    return Math.max(1, Math.min(perBatch, remaining));
  })();
  // 全局原图下标（用于 originalUrl）
  const globalImageIdx = localBatchIdx * perBatch + localInBatchIdx;

  const goInBatch = useCallback(
    (delta: number) => {
      if (inBatchSize <= 1) return;
      const next = (localInBatchIdx + delta + inBatchSize) % inBatchSize;
      setLocalInBatchIdx(next);
    },
    [localInBatchIdx, inBatchSize]
  );

  const goBatch = useCallback(
    (delta: number) => {
      if (batchCount <= 1) return;
      const next = (localBatchIdx + delta + batchCount) % batchCount;
      setLocalBatchIdx(next);
      setLocalInBatchIdx(0);
      onChangeBatch?.(next);
    },
    [localBatchIdx, batchCount, onChangeBatch]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 批次间切：↑ / ↓；批次内切：← / →
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goInBatch(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goInBatch(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        goBatch(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        goBatch(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goInBatch, goBatch]);

  // 预热本批全部原图 + 相邻批首张
  useEffect(() => {
    if (!open) return;
    const urls: string[] = [];
    for (let i = 0; i < inBatchSize; i++) {
      urls.push(originalUrl(token, localBatchIdx * perBatch + i, updatedAt));
    }
    if (batchCount > 1) {
      const prevIdx = (localBatchIdx - 1 + batchCount) % batchCount;
      const nextIdx = (localBatchIdx + 1) % batchCount;
      urls.push(originalUrl(token, prevIdx * perBatch, updatedAt));
      urls.push(originalUrl(token, nextIdx * perBatch, updatedAt));
    }
    preloadImages(urls);
  }, [
    open,
    token,
    updatedAt,
    localBatchIdx,
    inBatchSize,
    batchCount,
    perBatch,
  ]);

  const src = originalUrl(token, globalImageIdx, updatedAt);
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
          aria-describedby="original-lightbox-hint"
          className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-zinc-100 outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            {batchCount > 1
              ? `第 ${localBatchIdx + 1} 批，共 ${batchCount} 批`
              : `上传的原图`}
          </DialogPrimitive.Title>
          <p id="original-lightbox-hint" className="sr-only">
            左右方向键切换批次内原图，上下方向键切换批次，Esc 关闭。
          </p>

          <div className="flex items-center justify-between gap-2 px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 sm:px-5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {batchCount > 1
                  ? `第 ${localBatchIdx + 1} / ${batchCount} 批`
                  : "你上传的原图"}
              </p>
              <p className="text-xs text-zinc-400">
                {inBatchSize > 1
                  ? `批内 ${localInBatchIdx + 1} / ${inBatchSize} 张`
                  : "点击外部或按 Esc 关闭"}
              </p>
            </div>
            <DialogPrimitive.Close
              aria-label="关闭"
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-3 sm:px-14"
            onPointerDown={(e) => {
              dragRef.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={(e) => {
              const start = dragRef.current;
              dragRef.current = null;
              if (!start) return;
              const dx = e.clientX - start.x;
              const dy = e.clientY - start.y;
              if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_X) {
                goInBatch(dx < 0 ? 1 : -1);
              } else if (dy > SWIPE_DOWN) {
                onClose();
              }
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
          >
            {inBatchSize > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => goInBatch(-1)}
                  aria-label="批内上一张原图"
                  className="absolute top-1/2 left-2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:flex"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => goInBatch(1)}
                  aria-label="批内下一张原图"
                  className="absolute top-1/2 right-2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:flex"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}

            <AnimatePresence mode="wait" initial={false}>
              <motion.img
                key={`${globalImageIdx}-${updatedAt}`}
                {...fade}
                transition={{ duration: reduce ? 0 : 0.16 }}
                src={src}
                alt={
                  inBatchSize > 1
                    ? `第 ${localBatchIdx + 1} 批 / 第 ${localInBatchIdx + 1} 张原图`
                    : "你上传的原图"
                }
                className="max-h-full max-w-full select-none rounded-lg object-contain"
                draggable={false}
              />
            </AnimatePresence>
          </div>

          <p className="px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 text-center text-xs text-zinc-500 sm:hidden">
            左右滑切换批内原图 · 向下滑关闭
          </p>
          <p className="hidden px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 text-center text-xs text-zinc-500 sm:block">
            ← → 批内切图 · ↑ ↓ 切批 · Esc 关闭
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
