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
  /** 当前预览的原图下标（0-based） */
  imageIdx: number;
  /** 订单总原图张数；=1 时隐藏翻页控件 */
  imageCount: number;
  /** 翻页回调：父组件切到新 idx（可选；不传则 lightbox 内部维护） */
  onChangeImage?: (idx: number) => void;
}

const SWIPE_X = 60;
const SWIPE_DOWN = 110;

/**
 * 原图预览灯箱 —— 复用 Lightbox 的对话框 + 手势骨架，但只展示用户上传的
 * 原图，没有候选切换 / 锁定 / 选择等业务元素。
 *
 * 设计要点：
 * - 单图订单（imageCount === 1）：只显示一张原图，下/上滑动关闭
 * - 多图订单：←/→ 切换原图，预热前后两张
 * - 与 Lightbox 的"对比原图"模式不同：本组件**只展示原图**，是给
 *   "我想看清楚自己上传的图片长什么样"的场景用的入口
 * - Esc / 点 X / 下滑关闭
 */
export function OriginalLightbox({
  open,
  onClose,
  token,
  updatedAt,
  imageIdx,
  imageCount,
  onChangeImage,
}: OriginalLightboxProps) {
  const reduce = useReducedMotion();
  // 内部维护当前 idx：父组件的 imageIdx 是初始值，←/→ 时本地先更新，
  // 通过 onChangeImage 通知父组件（如 SelectStep 同步切到 safeIdx）
  const [localIdx, setLocalIdx] = useState(imageIdx);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // 外部 imageIdx 变化时同步（例如打开时父组件切换了）
  useEffect(() => {
    setLocalIdx(imageIdx);
  }, [imageIdx]);

  const go = useCallback(
    (delta: number) => {
      if (imageCount <= 1) return;
      const next = (localIdx + delta + imageCount) % imageCount;
      setLocalIdx(next);
      onChangeImage?.(next);
    },
    [localIdx, imageCount, onChangeImage]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  // 预热当前 + 相邻两张原图
  useEffect(() => {
    if (!open) return;
    const urls = [originalUrl(token, localIdx, updatedAt)];
    if (imageCount > 1) {
      urls.push(
        originalUrl(token, (localIdx - 1 + imageCount) % imageCount, updatedAt),
        originalUrl(token, (localIdx + 1) % imageCount, updatedAt)
      );
    }
    preloadImages(urls);
  }, [open, token, updatedAt, localIdx, imageCount]);

  const src = originalUrl(token, localIdx, updatedAt);
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
            {imageCount > 1
              ? `第 ${localIdx + 1} 张原图，共 ${imageCount} 张`
              : "上传的原图"}
          </DialogPrimitive.Title>
          <p id="original-lightbox-hint" className="sr-only">
            左右方向键切换原图，Esc 关闭，向下滑动关闭。
          </p>

          <div className="flex items-center justify-between gap-2 px-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 sm:px-5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {imageCount > 1
                  ? `原图 ${localIdx + 1} / ${imageCount}`
                  : "你上传的原图"}
              </p>
              <p className="text-xs text-zinc-400">点击外部或按 Esc 关闭</p>
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
                go(dx < 0 ? 1 : -1);
              } else if (dy > SWIPE_DOWN) {
                onClose();
              }
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
          >
            {imageCount > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label="上一张原图"
                  className="absolute top-1/2 left-2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:flex"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label="下一张原图"
                  className="absolute top-1/2 right-2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:flex"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}

            <AnimatePresence mode="wait" initial={false}>
              <motion.img
                key={`${localIdx}-${updatedAt}`}
                {...fade}
                transition={{ duration: reduce ? 0 : 0.16 }}
                src={src}
                alt={
                  imageCount > 1 ? `第 ${localIdx + 1} 张原图` : "你上传的原图"
                }
                className="max-h-full max-w-full select-none rounded-lg object-contain"
                draggable={false}
              />
            </AnimatePresence>
          </div>

          <p className="px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 text-center text-xs text-zinc-500 sm:hidden">
            左右滑切换原图 · 向下滑关闭
          </p>
          <p className="hidden px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 text-center text-xs text-zinc-500 sm:block">
            ← → 切换原图 · Esc 关闭
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
