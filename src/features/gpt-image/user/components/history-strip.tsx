"use client";

/**
 * 用户端 - 效果图历史快照水平横滑条。
 *
 * 设计约束（参见 [[user-page-no-complex-features]] 的"水平列表例外"条款）：
 * - 嵌在 SelectStep 的 QuadrantGrid 与按钮组之间
 * - 每张原图对应一条横滑条；当前 imageIdx 由 SelectStep 内部 state 决定，
 *   只在 SelectStep 内部过滤显示，不把 currentIdx 提升到父组件
 * - 不做"原图 vs 效果"对比，不做键位提示，不做 complex 探索功能
 * - 缩略图 = 当前 imageIdx 的快照候选（候选序号 0 作代表，"那张图那一轮的样子"）
 * - 点击 → HistoryLightbox 看该 imageIdx 该轮的候选主图；可"用这一版"恢复
 *   （已锁定位不显示恢复按钮）
 * - 数据由 useOrderHistory 从 /api/orders/[token]/history 拿，前端按 imageIdx
 *   过滤
 */

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { History, Loader2, X } from "lucide-react";
import { useState } from "react";

import type {
  OrderHistorySnapshotView,
  RestoreHistoryResponseData,
} from "@/features/gpt-image/lib/types";
import { cn } from "@/lib/utils";
import { relativeTime } from "./order-lib";

/** 拼历史快照某一 imageIdx 某一 candIdx 的图片 URL。 */
function snapshotCandidateUrl(
  token: string,
  snap: OrderHistorySnapshotView,
  imageIdx: number,
  candIdx = 0
): string {
  return `/api/orders/${token}/candidates/${imageIdx}/${candIdx}?historyId=${snap.id}&t=${encodeURIComponent(snap.createdAt)}`;
}

interface HistoryStripProps {
  token: string;
  imageIdx: number;
  snapshots: OrderHistorySnapshotView[];
  loading: boolean;
  /** 当前原图是否已服务端锁定（partial select 锁定位不可被覆盖恢复） */
  isCurrentLocked: boolean;
  /** 当前正在恢复的快照 id（用于按钮 loading 态） */
  restoringId: string | null;
  /** 触发恢复：父组件负责调 /restore + refresh。 */
  onRestore: (id: string) => Promise<RestoreHistoryResponseData | null>;
}

/**
 * 单张原图的历史效果横滑条。
 *
 * 当前 imageIdx 下所有可见快照按 round DESC 排序：最新 round 标"当前"。
 * 0 个快照不渲染整条（避免空容器浪费主视觉）。
 */
export function HistoryStrip({
  token,
  imageIdx,
  snapshots,
  loading,
  isCurrentLocked,
  restoringId,
  onRestore,
}: HistoryStripProps) {
  const [openSnap, setOpenSnap] = useState<OrderHistorySnapshotView | null>(
    null
  );

  // 过滤：在快照涵盖范围内（imageCount > imageIdx），按 round DESC
  const items = snapshots
    .filter((s) => s.imageCount > imageIdx)
    .slice()
    .sort((a, b) => b.round - a.round);

  // 空快照且非加载中 → 不渲染（用户可能根本没动过 regen / 没历史）
  if (!loading && items.length === 0) return null;

  const latestRound = items[0]?.round ?? null;

  return (
    <>
      <section className="mt-3">
        <header className="mb-2 flex items-center gap-1.5 px-0.5">
          <History className="h-3.5 w-3.5 text-stone-400" strokeWidth={2.25} />
          <h3 className="text-xs font-medium text-stone-500">历史效果图</h3>
          <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-stone-500">
            {items.length}
          </span>
        </header>

        <section
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 snap-x snap-mandatory"
          aria-label="历史效果图横滑条"
        >
          {loading && items.length === 0 ? (
            <div className="flex h-16 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone-200 text-xs text-stone-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              加载中…
            </div>
          ) : (
            items.map((snap) => {
              const isLatest = snap.round === latestRound;
              const isRestoring = restoringId === snap.id;
              return (
                <HistoryThumb
                  key={snap.id}
                  snap={snap}
                  token={token}
                  imageIdx={imageIdx}
                  isLatest={isLatest}
                  isRestoring={isRestoring}
                  disabled={!snap.restorable}
                  disabledReason={snap.incompatibilityReason}
                  onOpen={() => setOpenSnap(snap)}
                />
              );
            })
          )}
        </section>
      </section>

      <HistoryLightbox
        open={openSnap !== null}
        snap={openSnap}
        token={token}
        imageIdx={imageIdx}
        isCurrentLocked={isCurrentLocked}
        restoring={openSnap ? restoringId === openSnap.id : false}
        onClose={() => setOpenSnap(null)}
        onRestore={async (id) => {
          const ok = await onRestore(id);
          if (ok) setOpenSnap(null);
          return ok;
        }}
      />
    </>
  );
}

/* ====================================================================== */
/* 单张缩略图卡                                                          */
/* ====================================================================== */

interface HistoryThumbProps {
  snap: OrderHistorySnapshotView;
  token: string;
  imageIdx: number;
  isLatest: boolean;
  isRestoring: boolean;
  disabled: boolean;
  disabledReason: string | null;
  onOpen: () => void;
}

function HistoryThumb({
  snap,
  token,
  imageIdx,
  isLatest,
  isRestoring,
  disabled,
  disabledReason,
  onOpen,
}: HistoryThumbProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={isRestoring}
      title={
        disabled
          ? (disabledReason ?? "不可查看")
          : `第 ${snap.round} 轮历史效果图`
      }
      className={cn(
        "relative h-16 w-16 shrink-0 snap-start overflow-hidden rounded-lg border bg-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed",
        isLatest
          ? "border-emerald-400 ring-2 ring-emerald-400/40"
          : "border-stone-200 hover:border-stone-300",
        disabled && "opacity-60"
      )}
    >
      {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
      <img
        src={snapshotCandidateUrl(token, snap, imageIdx)}
        alt={`第 ${snap.round} 轮历史效果图`}
        className={cn(
          "h-full w-full object-cover transition-opacity",
          isRestoring ? "opacity-40" : "opacity-100"
        )}
        loading="lazy"
      />
      {/* round 角标 */}
      <span
        className={cn(
          "absolute top-0.5 left-0.5 rounded px-1 py-0.5 text-[9px] font-semibold tabular-nums",
          isLatest ? "bg-emerald-500 text-white" : "bg-black/60 text-white"
        )}
      >
        {isLatest ? "当前" : `第${snap.round}轮`}
      </span>
      {isRestoring && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <Loader2 className="h-4 w-4 animate-spin text-white" />
        </div>
      )}
    </button>
  );
}

/* ====================================================================== */
/* 缩略图点击后弹出的 Lightbox —— 最小化：单图 + "用这一版"按钮           */
/* ====================================================================== */

interface HistoryLightboxProps {
  open: boolean;
  snap: OrderHistorySnapshotView | null;
  token: string;
  imageIdx: number;
  isCurrentLocked: boolean;
  restoring: boolean;
  onClose: () => void;
  onRestore: (id: string) => Promise<RestoreHistoryResponseData | null>;
}

function HistoryLightbox({
  open,
  snap,
  token,
  imageIdx,
  isCurrentLocked,
  restoring,
  onClose,
  onRestore,
}: HistoryLightboxProps) {
  if (!snap) {
    // Dialog 仍需挂载以控 open 状态；snap=null 时用空内容
    return (
      <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogPrimitive.Portal />
      </DialogPrimitive.Root>
    );
  }

  const triggerLabel = (() => {
    switch (snap.trigger) {
      case "regenerate_single":
        return typeof snap.imageIdx === "number"
          ? `重新生成第 ${snap.imageIdx + 1} 张前`
          : "重新生成前";
      case "regenerate_all":
        return "全部重新生成前";
      case "failed_reupload":
        return "失败后换图前";
      case "restore":
        return "恢复历史版本前";
      default:
        return "历史快照";
    }
  })();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-stone-900/40 backdrop-blur-sm animate-[fadeIn_.2s_ease-out]" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md flex-col rounded-t-2xl border border-stone-100 bg-white shadow-2xl animate-[fadeIn_.2s_ease-out]"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">
            第 {snap.round} 轮历史效果图
          </DialogPrimitive.Title>

          {/* header */}
          <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-5 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight text-stone-800">
                第 {snap.round} 轮 · 历史效果图
              </p>
              <p className="mt-0.5 truncate text-xs text-stone-400">
                {triggerLabel} · {relativeTime(snap.createdAt)}
              </p>
            </div>
            <DialogPrimitive.Close
              aria-label="关闭"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* 主图（snap 的 imageIdx×candIdx=0 作代表） */}
          <div className="bg-stone-50 px-5 py-4">
            <div className="overflow-hidden rounded-xl border border-stone-100 bg-white">
              {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
              <img
                src={snapshotCandidateUrl(token, snap, imageIdx)}
                alt={`第 ${snap.round} 轮第 ${imageIdx + 1} 张候选`}
                className="aspect-[4/3] w-full object-cover"
                loading="eager"
              />
            </div>
          </div>

          {/* 操作：恢复 / 已锁提示 */}
          <div className="border-t border-stone-100 px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
            {isCurrentLocked ? (
              <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                当前原图已锁定，无法恢复其他版本
              </p>
            ) : !snap.restorable ? (
              <p className="flex items-center gap-1.5 rounded-lg bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-500">
                {snap.incompatibilityReason ?? "此版本不可恢复"}
              </p>
            ) : (
              <button
                type="button"
                disabled={restoring}
                onClick={() => {
                  void onRestore(snap.id);
                }}
                className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-500 text-sm font-medium text-white shadow-lg shadow-indigo-200/50 transition-all hover:shadow-indigo-300/50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                {restoring ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    恢复中…
                  </>
                ) : (
                  <>用这一版替换当前候选</>
                )}
              </button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
