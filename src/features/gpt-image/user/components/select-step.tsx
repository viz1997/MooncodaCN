"use client";

import {
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ImageProgress } from "./image-progress";
import { candidateUrl, originalUrl, preloadImages } from "./image-urls";
import { Lightbox, type LightboxTarget } from "./lightbox";
import { OriginalLightbox } from "./original-lightbox";
import { OriginalStrip } from "./original-strip";
import { QuadrantGrid } from "./quadrant-grid";

interface SelectStepProps {
  token: string;
  updatedAt: string;
  imageCount: number;
  candidateCount: number;
  /** 每张原图的当前选择（长度 = uploadedImageCount）
   *  - 本地草稿值（未提交）：用户在 SelectStep 内点击但还没确认的候选
   *  - 服务端锁定值（已提交）：partial submit 写入、不可再改
   *  - null：待选
   */
  selections: (number | null)[];
  /** 非空位总数（含本地草稿 + 服务端锁定） */
  selectedCount: number;
  /** 服务端已锁定位数量（CANDIDATES_READY 下 selections 非空） */
  lockedCount: number;
  /** 判定某 index 是否已服务端锁定 */
  isLocked: (imageIdx: number) => boolean;
  submitting: boolean;
  regenerating: boolean;
  onToggle: (imageIdx: number, candIdx: number) => void;
  onSubmit: () => void;
  /** 重新生成当前原图（第 safeIdx 张） */
  onRegenerate: (imageIdx: number) => Promise<boolean>;
}

const SWIPE_THRESHOLD = 50; // px

/**
 * 选图步骤 —— mobile-first 单列布局（partial select 感知版）。
 *
 * partial select 引入后的行为差异：
 * - 按钮"确认提交"现在锁定**当前 safeIdx 张**（不再是"全选后统一提交"）。
 *   服务端按 imageIdx 增量合并，其他未提交位保持原状。
 * - 已锁定位视觉态：
 *   - QuadrantGrid disabled（不可点候选）
 *   - 当前原图小卡角标改 "已锁定 #N" + Lock 图标
 *   - "重新生成第 N 张"按钮 disabled
 *   - "确认提交第 N 张"按钮 disabled，文案改 "已提交 #N"
 * - Enter 键 / 自动跳到下一张未选：当前张未锁定 + 选了候选 → 触发 confirm；
 *   当前张已锁定 → Enter 跳过（用户应继续选下一张）。
 *
 * 锁定 = 不可重做（2026-08 批次模型保留 partial select 不可逆语义）：
 * 提交后该张即被服务端锁定，UI 只读（视觉提示保留：emerald 边框 +
 * Lock 角标）。要重新生成 / 重选只能服务端把 selections[i] 置 null 后
 * 用户才能在 UI 上重新触发——这是有意识的，避免"锁了又解锁"状态混乱。
 *
 * 布局（参考 select-step.tsx）：
 * 1. 顶部「第 3 步 · 选择效果图」徽章 + 标题
 * 2. 进度小条（多图时显示）
 * 3. 原图缩略图横排（切换用）—— 已锁定位永久 emerald 边框
 * 4. 当前原图卡片（小） + QuadrantGrid（已锁定位 disabled）
 * 5. 浮底 CTA：双按钮（重新生成 + 确认提交），按 isCurrentLocked 切态
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
  lockedCount,
  isLocked,
  submitting,
  regenerating,
  onToggle,
  onSubmit,
  onRegenerate,
}: SelectStepProps) {
  const [currentIdx, setCurrentIdx] = useState(() => {
    // 默认从第一张原图（imageIdx=0）开始：让 OriginalStrip 默认高亮的那张和
    // QuadrantGrid 默认展示的候选组**对齐**，避免"strip 视觉默认第一张
    // （emerald 边框=已锁）但下方 QuadrantGrid 跳到第二张未锁位"的错位感。
    //
    // 之前"first unlocked"逻辑会把 currentIdx 推到下一张未选位，但锁定位的
    // emerald 边框视觉权重远高于当前但未选的 zinc-300 边框，用户看上去仍像
    // "第一张是默认当前 tab"——与 QuadrantGrid 实际显示的位不一致。统一
    // 默认从 0 起，用户需要看别的位时手动点 strip 切（或选完后 handleToggle
    // 自动跳到下一未选位）。
    return 0;
  });
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [originalPreviewOpen, setOriginalPreviewOpen] = useState(false);
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const safeIdx = Math.min(currentIdx, Math.max(0, imageCount - 1));
  const currentSelection = selections[safeIdx] ?? null;
  const isCurrentLocked = isLocked(safeIdx);

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
      // 已锁定位：本地点不动（防御性，正常情况下 use-selections 的
      // toggle 已短路；这里再防一次 Lightbox / 外部直接触发）
      if (isLocked(imageIdx)) return;
      const wasUnset = (selections[imageIdx] ?? null) === null;
      const isCancelling = selections[imageIdx] === candIdx;
      onToggle(imageIdx, candIdx);

      if (!wasUnset || isCancelling) return;
      // 选完后自动跳到下一张未选原图（跳过已锁定位——它们的 selections[i]
      // 已非 null，findIndex 的 null 条件天然不命中）。
      const nextUnset = selections.findIndex(
        (v, i) => i !== imageIdx && (v === null || v === undefined)
      );
      if (nextUnset === -1) return;
      if (advanceRef.current) clearTimeout(advanceRef.current);
      advanceRef.current = setTimeout(() => setCurrentIdx(nextUnset), 350);
    },
    [selections, onToggle, isLocked]
  );

  const handleUndo = useCallback(() => {
    if (lastSelectedIdx === null || lastSelectedIdx === undefined) return;
    const cur = selections[lastSelectedIdx];
    if (cur === null || cur === undefined) return;
    if (isLocked(lastSelectedIdx)) return; // 已锁定位不可撤销
    onToggle(lastSelectedIdx, cur); // toggle 取消
    setCurrentIdx(lastSelectedIdx);
  }, [selections, onToggle, lastSelectedIdx, isLocked]);

  const closeLightbox = () => {
    setLightbox(null);
  };

  /**
   * 提交按钮启用条件（partial select 语义，锁定 = 不可重做）：
   * - 当前张本地草稿非空（已有候选可锁定）
   * - 当前张未服务端锁定（已锁定不可再提交；要重做只能服务端解锁）
   *
   * 与原版"allSelected 才可点"差异：现在每张图独立锁定，不需要全选完。
   * confirmOpen 点击时调 onSubmit；onSubmit 内部用 use-selections 的
   * toPayload() 提交增量项。
   */
  const canConfirm = currentSelection !== null && !isCurrentLocked;

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
          // 当前张未锁定 + 本地有候选 → 打开确认；已锁定 → 跳过
          if (currentSelection !== null && !isCurrentLocked) {
            e.preventDefault();
            setConfirmOpen(true);
          }
          break;
        case "r":
        case "R":
          if (!(e.ctrlKey || e.metaKey)) {
            // 已锁定位不可重新生成（要重做只能服务端解锁后用户重新触发）
            if (isCurrentLocked) return;
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
    currentSelection,
    isCurrentLocked,
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
          {imageCount > 1 && lockedCount > 0 && (
            <p className="mt-1 text-xs text-stone-400">
              已锁定 {lockedCount}/{imageCount} 张，剩余可继续上传或挑选
            </p>
          )}
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
              isLocked={isLocked}
            />
          </div>
        )}


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
            disabled={isCurrentLocked}
          />
        </div>

     

        {/* 操作按钮：重新生成（次级）+ 确认提交（主）并列 */}
        <div className="mt-4 flex w-full items-stretch gap-2">
          {/* 重新生成（次级）—— 已锁定位禁用 */}
          <button
            type="button"
            onClick={() => {
              if (isCurrentLocked) return;
              setRegenConfirmOpen(true);
            }}
            disabled={regenerating || isCurrentLocked}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-stone-200 bg-white px-3 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-60"
          >
            {regenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isCurrentLocked ? (
              <Lock className="h-4 w-4" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {imageCount > 1
              ? isCurrentLocked
                ? "已锁定"
                : `重新生成第 ${safeIdx + 1} 张`
              : isCurrentLocked
                ? "已锁定"
                : "重新生成"}
          </button>

          {/* 确认提交（主）—— 已锁定位可再次点击以更新保存值（toPayload 会跳过无变化的位） */}
          <button
            type="button"
            onClick={() => {
              if (!canConfirm) return;
              setConfirmOpen(true);
            }}
            disabled={submitting || !canConfirm}
            className={[
              "h-11 flex-1 rounded-xl text-sm font-medium transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:cursor-not-allowed",
              canConfirm
                ? "bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-lg shadow-indigo-200/50 hover:shadow-indigo-300/50"
                : "bg-stone-200 text-stone-400 disabled:opacity-100",
            ].join(" ")}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-4 w-4 animate-spin" /> 提交中…
              </span>
            ) : isCurrentLocked ? (
              <span className="inline-flex items-center gap-1.5">
                <Lock className="h-4 w-4" />
                {currentSelection !== null
                  ? `已提交 #${currentSelection + 1}`
                  : "该张已提交"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                {imageCount > 1 ? `确认提交第 ${safeIdx + 1} 张` : "确认提交"}
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

      {/* ─── 原图预览灯箱 ─── */}
      <OriginalLightbox
        open={originalPreviewOpen}
        onClose={() => setOriginalPreviewOpen(false)}
        token={token}
        updatedAt={updatedAt}
        imageIdx={safeIdx}
        imageCount={imageCount}
        onChangeImage={(idx) => setCurrentIdx(idx)}
      />

      {/* ─── 二次确认 dialogs ─── */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {imageCount > 1
              ? `锁定第 ${safeIdx + 1} 张原图的选择？`
              : "确认提交？"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {imageCount > 1 && lockedCount + 1 < imageCount
              ? `提交后该张效果将被锁定，无法再更换。剩余 ${imageCount - lockedCount - 1} 张可继续上传或挑选。如需全部重新选择，请取消订单后联系服务方重新创建。`
              : "提交后结果会被锁定，无法再更换效果图。如需重新挑选，请取消订单后联系服务方重新创建。"}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>再看看</AlertDialogCancel>
            <AlertDialogAction onClick={onSubmit}>确认提交</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={regenConfirmOpen} onOpenChange={setRegenConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>
            重新生成第 {safeIdx + 1} 张的效果？
          </AlertDialogTitle>
          <AlertDialogDescription>
            这一张当前的选择会被清空，{candidateCount}{" "}
            张效果图将重新生成，通常需要 30-90 秒。其他照片不受影响。
          </AlertDialogDescription>
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
