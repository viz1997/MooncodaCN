"use client";

import { Check, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ImageProgress } from "./image-progress";
import { candidateUrl, originalUrl, preloadImages } from "./image-urls";
import { Lightbox, type LightboxTarget } from "./lightbox";
import { OriginalStrip } from "./original-strip";
import { QuadrantGrid } from "./quadrant-grid";

interface SelectStepProps {
  token: string;
  updatedAt: string;
  imageCount: number;
  candidateCount: number;
  /** 每张原图的候选选择（长度 = uploadedImageCount） */
  selections: (number | null)[];
  selectedCount: number;
  allSelected: boolean;
  submitting: boolean;
  regenerating: boolean;
  onToggle: (imageIdx: number, candIdx: number) => void;
  onSubmit: () => void;
  /** 重新生成当前原图（第 safeIdx 张） */
  onRegenerate: (imageIdx: number) => Promise<boolean>;
}

const SWIPE_THRESHOLD = 50; // px

/**
 * 选图步骤 —— mobile-first 单列布局。
 *
 * 布局（参考 select-step.tsx）：
 * 1. 顶部「第 3 步 · 选择效果图」徽章 + 标题
 * 2. 进度小条（多图时显示）
 * 3. 原图缩略图横排（切换用）
 * 4. 当前原图卡片（小） + QuadrantGrid
 * 5. 浮底 CTA：「已选 #N」+「确认，下一张」/「确认并提交全部」
 *
 * 交互保留：
 * - 1-9 选、←→ 切图、Z 撤销、Enter 提交、R 重新生成、? 帮助
 * - Lightbox：点击放大 + 在大图模式下选
 * - AlertDialog：提交 / 重新生成 二次确认
 * - 选中后自动跳到下一张未选原图
 */
export function SelectStep({
  token,
  updatedAt,
  imageCount,
  candidateCount,
  selections,
  selectedCount,
  allSelected,
  submitting,
  regenerating,
  onToggle,
  onSubmit,
  onRegenerate,
}: SelectStepProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTriggerRef = useRef<string | null>(null);

  const safeIdx = Math.min(currentIdx, Math.max(0, imageCount - 1));
  const currentSelection = selections[safeIdx] ?? null;

  // 最近一次"被赋值"的图片索引
  const lastSelectedIdx = useMemo(() => {
    let last: number | null = null;
    for (let i = 0; i < selections.length; i++) {
      const v = selections[i];
      if (v !== null && v !== undefined) last = i;
    }
    return last;
  }, [selections]);

  useEffect(
    () => () => {
      if (advanceRef.current) clearTimeout(advanceRef.current);
    },
    []
  );

  useEffect(() => {
    const urls: string[] = [
      originalUrl(token, safeIdx, updatedAt),
      candidateUrl(token, safeIdx, 0, updatedAt),
    ];
    if (safeIdx + 1 < imageCount) {
      urls.push(candidateUrl(token, safeIdx + 1, 0, updatedAt));
    }
    preloadImages(urls);
  }, [token, updatedAt, safeIdx, imageCount]);

  const handleToggle = useCallback(
    (imageIdx: number, candIdx: number) => {
      const wasUnset = (selections[imageIdx] ?? null) === null;
      const isCancelling = selections[imageIdx] === candIdx;
      onToggle(imageIdx, candIdx);

      if (!wasUnset || isCancelling) return;
      // 选完后自动跳到下一张未选原图
      const nextUnset = selections.findIndex(
        (v, i) => i !== imageIdx && (v === null || v === undefined)
      );
      if (nextUnset === -1) return;
      if (advanceRef.current) clearTimeout(advanceRef.current);
      advanceRef.current = setTimeout(() => setCurrentIdx(nextUnset), 350);
    },
    [selections, onToggle]
  );

  const handleUndo = useCallback(() => {
    if (lastSelectedIdx === null || lastSelectedIdx === undefined) return;
    const cur = selections[lastSelectedIdx];
    if (cur === null || cur === undefined) return;
    onToggle(lastSelectedIdx, cur); // toggle 取消
    setCurrentIdx(lastSelectedIdx);
  }, [selections, onToggle, lastSelectedIdx]);

  const openLightbox = (imageIdx: number, candIdx: number) => {
    lastTriggerRef.current = `cand-${imageIdx}-${candIdx}`;
    setLightbox({ imageIdx, candIdx });
  };

  const closeLightbox = () => {
    setLightbox(null);
    const id = lastTriggerRef.current;
    lastTriggerRef.current = null;
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus());
  };

  // ─── 键盘快捷键 ───
  useEffect(() => {
    /** 事件目标是否在可输入元素上（避免键盘快捷键干扰） */
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
      if (confirmOpen || regenConfirmOpen || helpOpen) return;

      // 数字键 1-9：选第 N 个候选
      if (e.key >= "1" && e.key <= "9") {
        const n = Number.parseInt(e.key, 10) - 1;
        if (n < candidateCount) {
          e.preventDefault();
          handleToggle(safeIdx, n);
        }
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          setCurrentIdx((i) => Math.max(0, i - 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          setCurrentIdx((i) => Math.min(imageCount - 1, i + 1));
          break;
        case "z":
        case "Z":
          if (!(e.ctrlKey || e.metaKey) && e.shiftKey) break;
          e.preventDefault();
          handleUndo();
          break;
        case "Enter":
          if (allSelected) {
            e.preventDefault();
            setConfirmOpen(true);
          }
          break;
        case "r":
        case "R":
          if (!(e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            setRegenConfirmOpen(true);
          }
          break;
        case "?":
          e.preventDefault();
          setHelpOpen(true);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    lightbox,
    confirmOpen,
    regenConfirmOpen,
    helpOpen,
    candidateCount,
    safeIdx,
    imageCount,
    allSelected,
    handleToggle,
    handleUndo,
  ]);

  // ─── 移动端左右滑动切图 ───
  const swipeAreaRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
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
      if (dx < 0) setCurrentIdx((i) => Math.min(imageCount - 1, i + 1));
      else setCurrentIdx((i) => Math.max(0, i - 1));
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [imageCount]);

  return (
    <>
      <section className="mx-auto flex w-full max-w-md flex-col items-stretch px-5 pt-4 pb-32 animate-[fadeIn_.3s_ease-out]">
        {/* 标题 */}
        <div className="mb-4 text-center">
          <h2 className="text-xl font-bold text-stone-900">
            {imageCount > 1 ? "选择效果图" : "挑一张你最喜欢的"}
          </h2>
        </div>

        {/* 进度小条（多图时） */}
        {imageCount > 1 && (
          <ImageProgress
            total={imageCount}
            current={safeIdx}
            done={selectedCount}
          />
        )}

        {/* 原图缩略图横排（多图时） */}
        {imageCount > 1 && (
          <div className="mb-4">
            <OriginalStrip
              token={token}
              updatedAt={updatedAt}
              count={imageCount}
              currentIdx={safeIdx}
              selections={selections}
              onChange={setCurrentIdx}
            />
          </div>
        )}

        {/* 当前原图小卡 */}
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-stone-50 p-2.5">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-white">
            {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
            <img
              src={originalUrl(token, safeIdx, updatedAt)}
              alt={`第 ${safeIdx + 1} 张原图`}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1 text-xs text-stone-500">
            <p className="font-medium text-stone-700">
              {imageCount > 1
                ? `正在为第 ${safeIdx + 1} 张原图挑选`
                : "你上传的原图"}
            </p>
            <p className="mt-0.5">
              {candidateCount === 1
                ? "下面这张由原图生成"
                : `下面这张由原图生成（含 ${candidateCount} 种效果）`}
            </p>
          </div>
          {currentSelection !== null && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />#
              {currentSelection + 1}
            </span>
          )}
        </div>

        {/* 宫格 / Lightbox 触发 */}
        <div ref={swipeAreaRef} className="relative">
          <QuadrantGrid
            token={token}
            updatedAt={updatedAt}
            imageIdx={safeIdx}
            compositeUrl={candidateUrl(token, safeIdx, 0, updatedAt)}
            quadrantCount={
              (candidateCount === 1 ||
              candidateCount === 2 ||
              candidateCount === 4 ||
              candidateCount === 9
                ? candidateCount
                : 4) as 1 | 2 | 4 | 9
            }
            selectedQuadrant={currentSelection}
            onSelect={(q) => handleToggle(safeIdx, q)}
            onZoom={() => openLightbox(safeIdx, 0)}
          />
        </div>

        {/* 提示文字（在按钮上方） */}
        <p className="mt-3 text-center text-xs text-stone-400">
          {imageCount > 1
            ? "移动端左右滑动切图 · 桌面端 ← → 切图"
            : "点击候选图后再点下方按钮"}
        </p>

        {/* 操作按钮：重新生成（次级）+ 确认提交（主）并列 */}
        <div className="mt-4 flex w-full items-stretch gap-2">
          {/* 进度小字 */}
          <div className="flex shrink-0 items-center pr-1 text-sm">
            <span className="font-semibold tabular-nums text-stone-900">
              {selectedCount}/{imageCount}
            </span>
            <span className="ml-1 text-xs font-medium text-stone-500">
              已选
            </span>
          </div>

          {/* 重新生成（次级） */}
          <button
            type="button"
            onClick={() => setRegenConfirmOpen(true)}
            disabled={regenerating}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-stone-200 bg-white px-3 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-60"
          >
            {regenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {imageCount > 1 ? `重新生成第 ${safeIdx + 1} 张` : "重新生成"}
          </button>

          {/* 确认提交（主）—— 文案统一，全选前 disabled 置灰不可点击 */}
          <button
            type="button"
            onClick={() => {
              if (allSelected) setConfirmOpen(true);
            }}
            disabled={submitting || !allSelected}
            className={[
              "h-11 flex-1 rounded-xl text-sm font-medium transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:cursor-not-allowed",
              allSelected
                ? "bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-lg shadow-indigo-200/50 hover:shadow-indigo-300/50"
                : "bg-stone-200 text-stone-400 disabled:opacity-100",
            ].join(" ")}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-4 w-4 animate-spin" /> 提交中…
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> 确认提交 {imageCount} 张
              </span>
            )}
          </button>
        </div>

        {/* sr-only 状态说明，给屏幕阅读器 */}
        <span className="sr-only">
          {safeIdx >= imageCount - 1 ? "这是最后一张图" : "继续选择下一张图"}
        </span>
      </section>

      {/* ─── Lightbox ─── */}
      {lightbox && (
        <Lightbox
          open
          onClose={closeLightbox}
          token={token}
          updatedAt={updatedAt}
          target={lightbox}
          onTargetChange={(t) => {
            setLightbox(t);
            setCurrentIdx(t.imageIdx);
          }}
          imageCount={imageCount}
          candidateCount={candidateCount}
          selectedCand={selections[lightbox.imageIdx] ?? null}
          onSelect={(i, c) => {
            handleToggle(i, c);
            closeLightbox();
          }}
        />
      )}

      {/* ─── 二次确认 dialogs ─── */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              确认提交这 {imageCount} 张选择？
            </AlertDialogTitle>
            <AlertDialogDescription>
              提交后结果会被锁定，无法再更换效果图。如需重新挑选，请取消订单后联系服务方重新创建。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再看看</AlertDialogCancel>
            <AlertDialogAction onClick={onSubmit}>确认提交</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={regenConfirmOpen} onOpenChange={setRegenConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              重新生成第 {safeIdx + 1} 张的效果？
            </AlertDialogTitle>
            <AlertDialogDescription>
              这一张当前的选择会被清空，{candidateCount}{" "}
              张效果图将重新生成，通常需要 30-90 秒。其他照片不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={regenerating}>
              再想想
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setRegenConfirmOpen(false);
                void onRegenerate(safeIdx);
              }}
            >
              确认重新生成
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
