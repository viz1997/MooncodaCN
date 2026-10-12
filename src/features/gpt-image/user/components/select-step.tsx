"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  History,
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
import type { OrderHistorySnapshotView } from "@/features/gpt-image/lib/types";
import { CandidateStrip } from "./candidate-strip";
import { ImageProgress } from "./image-progress";
import {
  candidateUrl,
  historyCandidateUrl,
  originalUrl,
  preloadImages,
} from "./image-urls";
import { Lightbox, type LightboxTarget } from "./lightbox";
import { OriginalLightbox } from "./original-lightbox";
import { OriginalStrip } from "./original-strip";
import { QuadrantGrid } from "./quadrant-grid";

interface SelectStepProps {
  token: string;
  updatedAt: string;
  /**
   * 2026-09-02：批次数（= ceil(uploadedImageCount / imagesPerUpload)）。
   * 索引语义从 imageIdx（张数）改成 batchIdx（批次槽位）。
   */
  batchCount: number;
  /**
   * 2026-09-02：每批参考图张数。OriginalStrip / OriginalLightbox 用它
   * 计算批次代表图与批次内循环张数。
   */
  imagesPerUpload: number;
  /** 2026-09-02：订单实际已上传参考图张数（拍平 uploadedImages.length）。 */
  uploadedImageCount: number;
  candidateCount: number;
  /**
   * 2026-09-01：模板级候选输出模式。
   * - "grid"（默认）：Lingting 返 1 张拼接图，用 QuadrantGrid 切格子
   * - "separate"：Lingting 返 N 张独立候选，用 CandidateStrip 列出
   */
  outputMode?: "grid" | "separate";
  /** 长度 = batchCount，按 batchIdx 索引 */
  selections: (number | null)[];
  /** 非空位总数（含本地草稿 + 服务端锁定） */
  selectedCount: number;
  /** 服务端已锁定位数量（CANDIDATES_READY 下 selections 非空） */
  lockedCount: number;
  /** 判定某 batchIdx 是否已服务端锁定 */
  isLocked: (batchIdx: number) => boolean;
  submitting: boolean;
  regenerating: boolean;
  /** 切换某批的本地候选选择；已锁定批忽略 */
  onToggle: (batchIdx: number, candIdx: number) => void;
  onSubmit: () => void;
  /** 重新生成当前批次（第 safeBatchIdx + 1 批） */
  onRegenerate: (batchIdx: number) => Promise<boolean>;
  /** 单批重新生成次数上限（来自订单 regenerateLimit） */
  regenerateLimit: number;
  /**
   * 每批已用重新生成次数（trigger=regenerate_single 且 imageIdx=batchIdx
   * 的快照行数）。长度对齐 batchCount；用 safeBatchIdx 索引当前批的剩余次数。
   */
  regenerateUsedByBatch: number[];
  /**
   * 当前订单的全部历史快照（round DESC）。前端再按 batchIdx 过滤：
   * - 查看最新快照（index 0）：QuadrantGrid 用当前 candidates（可点选）
   * - 查看旧快照：QuadrantGrid 用 snapshot.candidates[safeBatchIdx][0] 作 compositeUrl（只读）
   */
  snapshots: OrderHistorySnapshotView[];
}

const SWIPE_THRESHOLD = 50; // px

/**
 * 选图步骤 —— mobile-first 单列布局（partial select + 批次索引版）。
 *
 * 2026-09-02：索引语义从 imageIdx（张数）改成 batchIdx（批次槽位）。
 * 多张参考图合一次生图后，candidates 最小锁定单元是「批次」而不是「单张
 * 原图」。按钮文案同步：
 * - 「已锁定 X/Y 张」→「」→ 已锁定 X/Y 批」
 * - 「重新生成第 N 张」→「」→ 重新生成第 N 批」
 * - 「提交后该张效果」→「」→ 提交后该批效果」
 * - 「剩余 N 张可继续上传」→「」→ 剩余 N 批可继续上传」
 *
 * partial select 行为差异（2026-08 起）：
 * - 按钮"确认提交"现在锁定**当前 safeBatchIdx 批**（不再是"全选后统一提交"）。
 *   服务端按 batchIdx 增量合并，其他未提交批保持原状。
 * - 已锁定批视觉态：
 *   - QuadrantGrid disabled（不可点候选）
 *   - 当前批小卡角标改 "已锁定 #N" + Lock 图标
 *   - "重新生成第 N 批"按钮 disabled
 *   - "确认提交第 N 批"按钮 disabled，文案改 "已提交 #N"
 * - Enter 键 / 触发 confirm dialog：当前批未锁定 + 选了候选 → 触发 confirm；
 *   当前批已锁定 → Enter 无操作（用户应继续选下一批）。
 *
 * 锁定 = 不可重做（批次模型保留 partial select 不可逆语义）：
 * 提交后该批即被服务端锁定，UI 只读（视觉提示保留：emerald 边框 +
 * Lock 角标）。要重新生成 / 重选只能服务端把 selections[i] 置 null 后
 * 用户才能在 UI 上重新触发——这是有意识的，避免"锁了又解锁"状态混乱。
 *
 * 布局：
 * 1. 顶部「第 3 步 · 选择效果图」徽章 + 标题
 * 2. 进度小条（多批时显示）
 * 3. 批次缩略图横排（切换用）—— 已锁定批永久 emerald 边框
 * 4. 当前批候选组（小） + QuadrantGrid（已锁定批 disabled）
 * 5. 浮底 CTA：双按钮（重新生成 + 确认提交），按 isCurrentLocked 切态
 *
 * 交互保留：
 * - 1-9 选、←→ 切批、Z 撤销、Enter 提交、R 重新生成、? 帮助
 * - Lightbox：点击放大 + 在大图模式下选
 * - AlertDialog：提交 / 重新生成 二次确认
 * - 切批方式：点 OriginalStrip 缩略图、←/→ 箭头键、Lightbox 横向滑动。
 *   2026-08-15 起移除"点击候选自动跳下一批"逻辑（用户反馈：不想被自动推进）。
 */
export function SelectStep({
  token,
  updatedAt,
  batchCount,
  imagesPerUpload,
  uploadedImageCount,
  candidateCount,
  outputMode,
  selections,
  selectedCount,
  lockedCount,
  isLocked,
  submitting,
  regenerating,
  onToggle,
  onSubmit,
  onRegenerate,
  regenerateLimit,
  regenerateUsedByBatch,
  snapshots,
}: SelectStepProps) {
  const [currentIdx, setCurrentIdx] = useState(() => {
    // 默认从第 0 批开始：让 OriginalStrip 默认高亮的那批和 QuadrantGrid
    // 默认展示的候选组**对齐**。避免 "strip 视觉默认第一批（emerald
    // 边框=已锁）但下方 QuadrantGrid 跳到第二批未锁位" 的错位感。
    return 0;
  });
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [originalPreviewOpen, setOriginalPreviewOpen] = useState(false);
  /**
   * 当前正在查看的快照索引（在 `imageSnapshots` 数组里的位置）。
   * 默认 null = 看最新候选（compositeUrl = candidateUrl(...)，QuadrantGrid 可点选）。
   * 非 null = 看历史快照（QuadrantGrid 只读，compositeUrl 走 historyId 通道）。
   * batchIdx 切换或 regen 完成后重置为 null（看最新）。
   */
  const [viewingSnapshotIdx, setViewingSnapshotIdx] = useState<number | null>(
    null
  );

  const safeBatchIdx = Math.min(currentIdx, Math.max(0, batchCount - 1));
  const currentSelection = selections[safeBatchIdx] ?? null;
  const isCurrentLocked = isLocked(safeBatchIdx);
  // 单批"重新生成"按钮剩余可点次数（用户主动重生成第 N 批）。
  // 按批次独立计数：每批都有自己的额度，互不挤占。已锁定批不可改。
  //
  // 业务语义（2026-09-03 用户确认）：regenerateLimit = 每批尝试总次数，
  // 含首次（"重试次数，包括本次"）。首次不走 /regenerate，所以这里"剩
  // 余可点击次数"= limit-1-usedCount。limit=1 → 0 次可点（只有首次）；
  // limit=0 → 按钮被外层 {regenerateLimit > 0} 隐藏。
  const regenerateUsedForCurrentBatch =
    regenerateUsedByBatch[safeBatchIdx] ?? 0;
  const maxRegenTriggers = Math.max(0, regenerateLimit - 1);
  const regenerateRemaining = Math.max(
    0,
    maxRegenTriggers - regenerateUsedForCurrentBatch
  );
  const canRegenerate = !isCurrentLocked && regenerateRemaining > 0;

  // 当前批下的所有历史快照（按 round DESC，与传入顺序一致）
  //
  // 历史快照按 batchIdx 维度存（candidates[batchIdx][candIdx]）。这里
  // batchCount 是新语义，老快照按 imageIdx 维度存时 length 不一致——过滤
  // 时按 snapshot.batchCount >= safeBatchIdx 兜底。
  const imageSnapshots = useMemo(
    () =>
      snapshots.filter((s) => (s.batchCount ?? s.imageCount) > safeBatchIdx),
    [snapshots, safeBatchIdx]
  );

  // 切批或重新生成完成后，自动跳回最新候选（避免停在某个旧快照上状态错乱）。
  // 按批次独立计数：只关心当前批的重试次数变化，其他批的重生成本批视图无关。
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps 是触发器，不是读取
  useEffect(() => {
    setViewingSnapshotIdx(null);
  }, [safeBatchIdx, regenerateUsedForCurrentBatch]);

  const viewingSnapshot =
    viewingSnapshotIdx !== null
      ? (imageSnapshots[viewingSnapshotIdx] ?? null)
      : null;
  const isViewingOldSnapshot = viewingSnapshot !== null;
  const safeSnapshotIdx =
    viewingSnapshotIdx !== null && viewingSnapshotIdx < imageSnapshots.length
      ? viewingSnapshotIdx
      : null;
  // canGoPrevSnapshot: 查看最新（null）或当前未到最旧时均可往"更旧"跳。
  // canGoNextSnapshot: 已在历史模式下且未到最新快照（idx>0）时可往"更新"跳。
  const canGoPrevSnapshot =
    imageSnapshots.length > 0 &&
    (viewingSnapshotIdx === null ||
      (safeSnapshotIdx !== null &&
        safeSnapshotIdx < imageSnapshots.length - 1));
  const canGoNextSnapshot =
    isViewingOldSnapshot && safeSnapshotIdx !== null && safeSnapshotIdx > 0;

  // 旧快照的 compositeUrl：通过 /candidates/[batchIdx]/0?historyId=... 走历史通道
  const viewingCompositeUrl =
    viewingSnapshot !== null
      ? `/api/orders/${token}/candidates/${safeBatchIdx}/0?historyId=${viewingSnapshot.id}&t=${encodeURIComponent(viewingSnapshot.createdAt)}`
      : null;

  // 最近一次"被赋值"的批次索引
  const lastSelectedIdx = useMemo(() => {
    let last: number | null = null;
    for (let i = 0; i < selections.length; i++) {
      const v = selections[i];
      if (v !== null && v !== undefined) last = i;
    }
    return last;
  }, [selections]);

  useEffect(() => {
    // 2026-09-02：批次代表图下标 = safeBatchIdx * imagesPerUpload
    const repImageIdx = safeBatchIdx * Math.max(1, imagesPerUpload);
    const urls: string[] = [originalUrl(token, repImageIdx, updatedAt)];
    // grid 模式仅 candIdx=0（拼接图）；separate 模式全部 candIdx 预热
    if (outputMode === "separate") {
      for (let c = 0; c < candidateCount; c++) {
        urls.push(candidateUrl(token, safeBatchIdx, c, updatedAt));
      }
    } else {
      urls.push(candidateUrl(token, safeBatchIdx, 0, updatedAt));
    }
    if (safeBatchIdx + 1 < batchCount) {
      // 下一批代表图预热
      urls.push(
        originalUrl(
          token,
          (safeBatchIdx + 1) * Math.max(1, imagesPerUpload),
          updatedAt
        )
      );
      urls.push(candidateUrl(token, safeBatchIdx + 1, 0, updatedAt));
    }
    // 历史快照 URL：用户切"上一版/下一版"时立刻命中浏览器缓存，
    // 不再空白等待服务端 round-trip。
    for (const snap of imageSnapshots) {
      urls.push(
        historyCandidateUrl(token, snap.id, safeBatchIdx, snap.createdAt)
      );
    }
    preloadImages(urls);
  }, [
    token,
    updatedAt,
    safeBatchIdx,
    batchCount,
    imagesPerUpload,
    imageSnapshots,
    outputMode,
    candidateCount,
  ]);

  const handleToggle = useCallback(
    (batchIdx: number, candIdx: number) => {
      // 已锁定批：本地点不动（防御性，正常情况下 use-selections 的
      // toggle 已短路；这里再防一次 Lightbox / 外部直接触发）
      if (isLocked(batchIdx)) return;
      onToggle(batchIdx, candIdx);
    },
    [onToggle, isLocked]
  );

  const handleUndo = useCallback(() => {
    if (lastSelectedIdx === null || lastSelectedIdx === undefined) return;
    const cur = selections[lastSelectedIdx];
    if (cur === null || cur === undefined) return;
    if (isLocked(lastSelectedIdx)) return; // 已锁定批不可撤销
    onToggle(lastSelectedIdx, cur); // toggle 取消
    setCurrentIdx(lastSelectedIdx);
  }, [selections, onToggle, lastSelectedIdx, isLocked]);

  const closeLightbox = () => {
    setLightbox(null);
  };

  /**
   * 提交按钮启用条件（partial select 语义，锁定 = 不可重做）：
   * - 当前批本地草稿非空（已有候选可锁定）
   * - 当前批未服务端锁定（已锁定不可再提交；要重做只能服务端解锁）
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
          handleToggle(safeBatchIdx, n);
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
          setCurrentIdx((i) => Math.min(batchCount - 1, i + 1));
          break;
        case "z":
        case "Z":
          if (!(e.ctrlKey || e.metaKey) && e.shiftKey) break;
          e.preventDefault();
          handleUndo();
          break;
        case "Enter":
          // 当前批未锁定 + 本地有候选 → 打开确认；已锁定 → 跳过
          if (currentSelection !== null && !isCurrentLocked) {
            e.preventDefault();
            setConfirmOpen(true);
          }
          break;
        case "r":
        case "R":
          if (!(e.ctrlKey || e.metaKey)) {
            // 已锁定批不可重新生成（要重做只能服务端解锁后用户重新触发）
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
    safeBatchIdx,
    batchCount,
    currentSelection,
    isCurrentLocked,
    handleToggle,
    handleUndo,
  ]);

  // ─── 移动端左右滑动切批 ───
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
      if (dx < 0) setCurrentIdx((i) => Math.min(batchCount - 1, i + 1));
      else setCurrentIdx((i) => Math.max(0, i - 1));
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [batchCount]);

  return (
    <>
      <section className="mx-auto flex w-full max-w-md flex-col items-stretch px-5 pt-4 pb-32 animate-[fadeIn_.3s_ease-out]">
        {/* 标题 */}
        <div className="mb-4 text-center">
          <h2 className="text-xl font-bold text-stone-900">
            {batchCount > 1 ? "选择效果图" : "挑一张你最喜欢的"}
          </h2>
          {batchCount > 1 && lockedCount > 0 && (
            <p className="mt-1 text-xs text-stone-400">
              已锁定 {lockedCount}/{batchCount} 批，剩余可继续上传或挑选
            </p>
          )}
        </div>

        {/* 进度小条（多批时） */}
        {batchCount > 1 && (
          <ImageProgress
            total={batchCount}
            current={safeBatchIdx}
            done={selectedCount}
          />
        )}

        {/* 批次缩略图横排（多批时）—— 2026-09-02 改名/按批次 */}
        {batchCount > 1 && (
          <div className="mb-4">
            <OriginalStrip
              token={token}
              updatedAt={updatedAt}
              count={batchCount}
              currentIdx={safeBatchIdx}
              selections={selections}
              onChange={setCurrentIdx}
              isLocked={isLocked}
              imagesPerUpload={imagesPerUpload}
            />
          </div>
        )}

        {/* 候选区 —— 2026-09-01 按 template.outputMode 分支：
            - grid（默认）：QuadrantGrid 1 张拼接图 + CSS 网格切格子
            - separate：CandidateStrip N 张独立候选
            历史快照只在 grid 模式下展示（snapshot.candidates[batchIdx][0] 是 1 张拼接图）；
            separate 模式每个 imageSnapshots 的 N 张候选分别存储，UI 暂不接入历史切换 */}
        <div ref={swipeAreaRef} className="relative">
          {outputMode === "separate" ? (
            <CandidateStrip
              token={token}
              updatedAt={updatedAt}
              imageIdx={safeBatchIdx}
              candidateCount={candidateCount}
              selectedCand={isViewingOldSnapshot ? null : currentSelection}
              disabled={isCurrentLocked || isViewingOldSnapshot}
              onSelect={(c) => handleToggle(safeBatchIdx, c)}
            />
          ) : (
            <QuadrantGrid
              token={token}
              updatedAt={updatedAt}
              imageIdx={safeBatchIdx}
              compositeUrl={
                viewingCompositeUrl ??
                candidateUrl(token, safeBatchIdx, 0, updatedAt)
              }
              quadrantCount={
                (candidateCount === 1 ||
                candidateCount === 2 ||
                candidateCount === 4 ||
                candidateCount === 9
                  ? candidateCount
                  : 4) as 1 | 2 | 4 | 9
              }
              selectedQuadrant={isViewingOldSnapshot ? null : currentSelection}
              onSelect={(q) => handleToggle(safeBatchIdx, q)}
              disabled={isCurrentLocked}
            />
          )}
        </div>

        {/* 历史快照切换 —— 放在大图下方，避开可点选区。
            仅当该批存在快照时渲染；查看最新时不显示 "回到最新"。 */}
        {imageSnapshots.length > 0 && (
          <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-stone-500">
            <div />
            <div className="flex items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (!canGoPrevSnapshot) return;
                  setViewingSnapshotIdx((i) => (i === null ? 0 : i + 1));
                }}
                disabled={!canGoPrevSnapshot}
                aria-label="查看更早的历史效果图"
                title="上一版"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:cursor-default disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={2.25} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!canGoNextSnapshot) return;
                  setViewingSnapshotIdx((i) => (i === null ? null : i - 1));
                }}
                disabled={!canGoNextSnapshot}
                aria-label="查看更新的效果图"
                title="下一版"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:cursor-default disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={2.25} />
              </button>
            </div>
            <div className="flex justify-end">
              {isViewingOldSnapshot && viewingSnapshot && (
                <button
                  type="button"
                  onClick={() => setViewingSnapshotIdx(null)}
                  title={`查看于 ${new Date(viewingSnapshot.createdAt).toLocaleString("zh-CN")}，点击回到最新候选`}
                  className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
                >
                  <History className="h-3 w-3" />
                  回到最新
                </button>
              )}
            </div>
          </div>
        )}

        {/* 操作按钮：重新生成（次级）+ 确认提交（主）并列，居中显示 */}
        <div className="mt-4 flex w-full items-stretch justify-center gap-2">
          {/* 重新生成（次级）—— 已锁定批 / 次数用尽时禁用 */}
          <button
            type="button"
            onClick={() => {
              if (!canRegenerate) return;
              setRegenConfirmOpen(true);
            }}
            disabled={regenerating || !canRegenerate}
            title={
              !isCurrentLocked && regenerateRemaining === 0
                ? "本订单的重新生成次数已用完"
                : undefined
            }
            className="inline-flex h-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-stone-200 bg-white px-3 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-60"
          >
            {regenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isCurrentLocked ? (
              <Lock className="h-4 w-4" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {batchCount > 1
              ? isCurrentLocked
                ? "已锁定"
                : `重新生成第 ${safeBatchIdx + 1} 批`
              : isCurrentLocked
                ? "已锁定"
                : "重新生成"}
            {!isCurrentLocked && regenerateLimit > 0 && (
              <span className="ml-0.5 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-stone-500">
                剩 {regenerateRemaining}
              </span>
            )}
          </button>

          {/* 确认提交（主）—— 已锁定批可再次点击以更新保存值（toPayload 会跳过无变化的位） */}
          <button
            type="button"
            onClick={() => {
              if (!canConfirm) return;
              setConfirmOpen(true);
            }}
            disabled={submitting || !canConfirm}
            className={[
              "h-11 shrink-0 rounded-xl px-4 text-sm font-medium transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:cursor-not-allowed",
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
                {currentSelection !== null ? "已提交" : "该批已提交"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                {batchCount > 1
                  ? `确认提交第 ${safeBatchIdx + 1} 批`
                  : "确认提交"}
              </span>
            )}
          </button>
        </div>

        {/* sr-only 状态说明，给屏幕阅读器 */}
        <span className="sr-only">
          {safeBatchIdx >= batchCount - 1 ? "这是最后一批" : "继续选择下一批"}
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
          imageCount={batchCount}
          candidateCount={candidateCount}
          outputMode={outputMode}
          selectedCand={selections[lightbox.imageIdx] ?? null}
          onSelect={(i, c) => {
            handleToggle(i, c);
            closeLightbox();
          }}
        />
      )}

      {/* ─── 原图预览灯箱（批次维度）─── */}
      <OriginalLightbox
        open={originalPreviewOpen}
        onClose={() => setOriginalPreviewOpen(false)}
        token={token}
        updatedAt={updatedAt}
        batchIdx={safeBatchIdx}
        batchCount={batchCount}
        imagesPerUpload={imagesPerUpload}
        uploadedImageCount={uploadedImageCount}
        onChangeBatch={(idx) => setCurrentIdx(idx)}
      />

      {/* ─── 二次确认 dialogs ─── */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>
            {batchCount > 1
              ? `锁定第 ${safeBatchIdx + 1} 批的选择？`
              : "确认提交？"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {batchCount > 1 && lockedCount + 1 < batchCount
              ? `提交后该批效果将被锁定，无法再更换。剩余 ${batchCount - lockedCount - 1} 批可继续上传或挑选。如需全部重新选择，请取消订单后联系服务方重新创建。`
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
            重新生成第 {safeBatchIdx + 1} 批的效果？
          </AlertDialogTitle>
          <AlertDialogDescription>
            这一批当前的选择会被清空，{candidateCount}{" "}
            张效果图将重新生成，通常需要 30-90 秒。其他批次不受影响。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={regenerating}>
              再想想
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                setRegenConfirmOpen(false);
                void onRegenerate(safeBatchIdx);
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
