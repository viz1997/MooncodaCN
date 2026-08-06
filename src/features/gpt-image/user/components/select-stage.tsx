"use client";

import {
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

import { candidateUrl, originalUrl, preloadImages } from "./image-urls";
import { Lightbox, type LightboxTarget } from "./lightbox";
import { OriginalStrip } from "./original-strip";
import { QuadrantGrid } from "./quadrant-grid";

function isGridMode(candidateCount: number): candidateCount is 1 | 2 | 4 | 9 {
  return (
    candidateCount === 1 ||
    candidateCount === 2 ||
    candidateCount === 4 ||
    candidateCount === 9
  );
}

interface SelectStageProps {
  token: string;
  updatedAt: string;
  imageCount: number;
  candidateCount: number;
  selections: (number | null)[];
  selectedCount: number;
  allSelected: boolean;
  firstUnselectedIdx: number;
  submitting: boolean;
  regenerating: boolean;
  onToggle: (imageIdx: number, candIdx: number) => void;
  onSubmit: () => void;
  onRegenerate: (imageIdx: number) => Promise<boolean>;
}

export function SelectStage({
  token,
  updatedAt,
  imageCount,
  candidateCount,
  selections,
  selectedCount,
  allSelected,
  firstUnselectedIdx,
  submitting,
  regenerating,
  onToggle,
  onSubmit,
  onRegenerate,
}: SelectStageProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTriggerRef = useRef<string | null>(null);

  const safeIdx = Math.min(currentIdx, Math.max(0, imageCount - 1));
  const currentSelection = selections[safeIdx] ?? null;

  useEffect(
    () => () => {
      if (advanceRef.current) clearTimeout(advanceRef.current);
    },
    []
  );

  useEffect(() => {
    const urls: string[] = [originalUrl(token, safeIdx, updatedAt)];
    // 全部 candidateCount 都走宫格模式：candidates[imageIdx] 只存 1 张拼接图
    urls.push(candidateUrl(token, safeIdx, 0, updatedAt));
    if (safeIdx + 1 < imageCount) {
      urls.push(candidateUrl(token, safeIdx + 1, 0, updatedAt));
    }
    preloadImages(urls);
  }, [token, updatedAt, safeIdx, candidateCount, imageCount]);

  const handleToggle = useCallback(
    (imageIdx: number, candIdx: number) => {
      const wasUnset = (selections[imageIdx] ?? null) === null;
      const isCancelling = selections[imageIdx] === candIdx;
      onToggle(imageIdx, candIdx);

      if (!wasUnset || isCancelling) return;
      const nextUnset = selections.findIndex(
        (v, i) => i !== imageIdx && (v === null || v === undefined)
      );
      if (nextUnset === -1) return;
      if (advanceRef.current) clearTimeout(advanceRef.current);
      advanceRef.current = setTimeout(() => setCurrentIdx(nextUnset), 350);
    },
    [selections, onToggle]
  );

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

  const goToFirstUnselected = () => {
    if (firstUnselectedIdx >= 0) setCurrentIdx(firstUnselectedIdx);
  };

  return (
    <>
      <section className="rounded-2xl border border-zinc-200/80 bg-white">
        <div className="space-y-3 border-b border-zinc-100 px-4 py-3.5 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-zinc-900">
                {imageCount > 1
                  ? `为第 ${safeIdx + 1} 张照片挑一张`
                  : "挑一张你最喜欢的"}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                {candidateCount === 1
                  ? "下面是 1 张效果，点击确认即可。"
                  : `下方拼接图含 ${candidateCount} 个效果，点击其中一张选中，点右上角放大细看。`}
              </p>
            </div>
            {currentSelection !== null ? (
              <span className="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                <Check className="h-3.5 w-3.5" /> 已选 #{currentSelection + 1}
              </span>
            ) : (
              <span className="shrink-0 rounded-lg bg-zinc-100 px-2 py-1 text-xs text-zinc-500">
                未选择
              </span>
            )}
          </div>

          <OriginalStrip
            token={token}
            updatedAt={updatedAt}
            count={imageCount}
            currentIdx={safeIdx}
            selections={selections}
            onChange={setCurrentIdx}
          />
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-3 rounded-xl bg-zinc-50 p-2.5">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
              <img
                src={originalUrl(token, safeIdx, updatedAt)}
                alt={`第 ${safeIdx + 1} 张原图`}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1 text-xs text-zinc-500">
              <p className="font-medium text-zinc-700">你上传的原图</p>
              <p className="mt-0.5">
                {candidateCount === 1
                  ? "下面这张由原图生成"
                  : `下面这张由原图生成（含 ${candidateCount} 种效果）`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRegenConfirmOpen(true)}
              disabled={regenerating}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
            >
              {regenerating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 生成中
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" /> 重新生成
                </>
              )}
            </button>
          </div>

          {isGridMode(candidateCount) ? (
            // 所有 candidateCount 都走宫格模式（1/2/4/9 → 1x1 / 1x2 / 2x2 / 3x3）
            <QuadrantGrid
              token={token}
              updatedAt={updatedAt}
              imageIdx={safeIdx}
              compositeUrl={candidateUrl(token, safeIdx, 0, updatedAt)}
              quadrantCount={candidateCount}
              selectedQuadrant={currentSelection}
              onSelect={(q) => handleToggle(safeIdx, q)}
              onZoom={() => openLightbox(safeIdx, 0)}
            />
          ) : (
            // 暂不支持的 candidateCount（>9 或其他）。fallback：提示用户联系服务方
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
              当前模板效果数 {candidateCount} 暂不支持，请联系服务方。
            </div>
          )}

          <p aria-live="polite" className="sr-only">
            已选 {selectedCount} 张，共 {imageCount} 张
          </p>
        </div>
      </section>

      <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur-md pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="shrink-0 text-sm">
            <span className="font-semibold tabular-nums text-zinc-900">
              {selectedCount}/{imageCount}
            </span>
            <span className="ml-1 text-xs text-zinc-500">已选</span>
          </div>
          {allSelected ? (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={submitting}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> 提交中…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> 确认提交 {imageCount} 张
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={goToFirstUnselected}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2"
            >
              去选第 {firstUnselectedIdx + 1} 张{" "}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              确认提交这 {imageCount} 张选择？
            </AlertDialogTitle>
            <AlertDialogDescription>
              提交后结果会被锁定，无法再更换效果图。如果需要重新挑，只能取消订单后联系服务方重新创建。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再看看</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={onSubmit}
            >
              确认提交
            </AlertDialogAction>
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
                // 立即关闭弹窗，生成进度由 GENERATING 阶段展示
                setRegenConfirmOpen(false);
                void onRegenerate(safeIdx);
              }}
              className="bg-zinc-900 hover:bg-zinc-800"
            >
              确认重新生成
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
