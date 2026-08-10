"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDown, History, ImageIcon, Loader2, X } from "lucide-react";
import { useState } from "react";
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

import type {
  OrderHistorySnapshotView,
  OrderHistoryTrigger,
  OrderStatus,
} from "@/features/gpt-image/lib/types";
import { cn } from "@/lib/utils";
import { relativeTime } from "./order-lib";

/** 各 trigger 在 UI 上的简短标签（trigger 内部还带 imageIdx 信息） */
const TRIGGER_LABELS: Record<
  OrderHistoryTrigger,
  (snap: OrderHistorySnapshotView) => string
> = {
  regenerate_single: (s) =>
    typeof s.imageIdx === "number"
      ? `重新生成第 ${s.imageIdx + 1} 张前`
      : "重新生成前",
  regenerate_all: () => "全部重新生成前",
  failed_reupload: () => "失败后换图前",
  restore: () => "恢复历史版本前",
};

/** 状态 → 是否允许点击 restore */
function statusAllowsRestore(status: OrderStatus): boolean {
  return status === "CANDIDATES_READY" || status === "FAILED";
}

/** 不可 restore 时的状态文案（与 incompatibilityReason 区分） */
const STATUS_BLOCK_REASON: Record<OrderStatus, string | null> = {
  GENERATING: "正在生成，完成后可恢复",
  SELECTED: "已提交，结果已锁定",
  CANCELLED: "订单已取消",
  PENDING: "尚未生成效果图",
  CANDIDATES_READY: null,
  FAILED: null,
};

interface HistoryCardProps {
  snap: OrderHistorySnapshotView;
  disabled: boolean;
  disabledReason: string | null;
  restoring: boolean;
  onRestore: (id: string) => void;
}

function HistoryCard({
  snap,
  disabled,
  disabledReason,
  restoring,
  onRestore,
}: HistoryCardProps) {
  const triggerLabel = TRIGGER_LABELS[snap.trigger](snap);
  return (
    <div
      className={cn(
        "relative w-52 shrink-0 snap-start overflow-hidden rounded-xl border border-stone-100 bg-white",
        disabled && "opacity-60"
      )}
    >
      {/* 缩略图 */}
      <div className="relative aspect-square w-full bg-stone-100">
        {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
        <img
          src={snap.thumbnailUrl}
          alt={`第 ${snap.round} 轮历史效果图缩略图`}
          className={cn(
            "h-full w-full object-cover transition-opacity",
            disabled ? "opacity-50" : "opacity-100"
          )}
          loading="lazy"
        />
        {restoring && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
        <div className="absolute top-1.5 left-1.5">
          <span className="rounded bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">
            第 {snap.round} 轮
          </span>
        </div>
        {snap.candidateIdx >= 0 && (
          <div className="absolute right-1.5 bottom-1.5">
            <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">
              #{snap.candidateIdx + 1}
            </span>
          </div>
        )}
      </div>

      {/* 文案区 */}
      <div className="space-y-1.5 p-2.5">
        <p className="truncate text-xs font-medium text-stone-700">
          {triggerLabel}
        </p>
        <p className="text-xs tabular-nums text-stone-400">
          {relativeTime(snap.createdAt)}
        </p>
        <button
          type="button"
          onClick={() => {
            if (disabled || restoring) return;
            onRestore(snap.id);
          }}
          disabled={disabled || restoring}
          title={
            disabled ? (disabledReason ?? "不可恢复") : "恢复这一轮的候选集"
          }
          className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border border-stone-200 bg-white text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
        >
          {restoring ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 恢复中
            </>
          ) : (
            "恢复此版本"
          )}
        </button>
        {disabled && disabledReason && (
          <p className="text-xs leading-relaxed text-stone-400">
            {disabledReason}
          </p>
        )}
      </div>
    </div>
  );
}

interface HistoryDrawerProps {
  history: OrderHistorySnapshotView[];
  loading: boolean;
  status: OrderStatus;
  restoringId: string | null;
  /** 父组件接到 id 后负责：AlertDialog 确认 → 调用 hook.restore(id) */
  onRestore: (id: string) => void;
}

/**
 * 历史快照底部 sheet —— mobile-first 单列布局下的历史抽屉入口。
 *
 * 设计要点：
 * - TopBar 右上角"历史"按钮（带数字 badge），只在 history.length > 0 时显示
 * - 点开底部 sheet（fixed inset-x-0 bottom-0），max-h 80vh，顶部圆角
 * - Sheet 内：标题 + 状态解释条 + 横向滑动卡片（carousel）+ AlertDialog 二次确认
 */
export function HistoryDrawer({
  history,
  loading,
  status,
  restoringId,
  onRestore,
}: HistoryDrawerProps) {
  const statusBlocked = !statusAllowsRestore(status);
  const statusReason = STATUS_BLOCK_REASON[status];
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // 空快照不渲染按钮（生产环境绝大多数情况下都没有历史）
  if (!loading && history.length === 0) return null;

  const confirmSnap = confirmId
    ? (history.find((s) => s.id === confirmId) ?? null)
    : null;

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label="效果图历史"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
          >
            <History className="h-3.5 w-3.5" strokeWidth={2.25} />
            历史
            {history.length > 0 && (
              <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-stone-600">
                {history.length}
              </span>
            )}
          </button>
        </DialogPrimitive.Trigger>

        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-stone-900/30 backdrop-blur-sm animate-[fadeIn_.2s_ease-out]" />
          <DialogPrimitive.Content
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80vh] w-full max-w-md flex-col rounded-t-2xl border border-stone-100 bg-white shadow-2xl animate-[fadeIn_.2s_ease-out]"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <DialogPrimitive.Title className="sr-only">
              效果图历史
            </DialogPrimitive.Title>

            {/* sheet header */}
            <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-5 py-3">
              <span className="flex items-center gap-2 text-sm font-semibold tracking-tight text-stone-800">
                <History
                  className="h-4 w-4 text-stone-500"
                  strokeWidth={2.25}
                />
                效果图历史
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium tabular-nums text-stone-600">
                  {history.length}
                </span>
              </span>
              <DialogPrimitive.Close
                aria-label="关闭"
                className="flex h-8 w-8 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>

            {/* 状态提示条 */}
            {statusBlocked && statusReason && (
              <p className="border-b border-stone-100 bg-stone-50/60 px-5 py-2 text-xs leading-relaxed text-stone-500">
                {statusReason}
              </p>
            )}

            {/* 卡片列表 */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {loading && history.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-stone-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  加载中…
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-stone-400">
                    <span className="inline-flex items-center gap-1.5">
                      <History className="h-3.5 w-3.5" />
                      {history.length} 个历史版本
                    </span>
                  </div>
                  <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1 snap-x snap-mandatory">
                    {history.map((snap) => {
                      const disabled = !snap.restorable || statusBlocked;
                      const disabledReason = !snap.restorable
                        ? (snap.incompatibilityReason ?? "不可恢复")
                        : (statusReason ?? null);
                      return (
                        <HistoryCard
                          key={snap.id}
                          snap={snap}
                          disabled={disabled}
                          disabledReason={disabledReason}
                          restoring={restoringId === snap.id}
                          onRestore={setConfirmId}
                        />
                      );
                    })}
                  </div>
                  {history.length > 0 &&
                    history.every((s) => !s.restorable) && (
                      <p className="flex items-center gap-1.5 text-xs text-stone-400">
                        <ImageIcon className="h-3.5 w-3.5" />
                        所有历史版本都已不兼容（如换了原图或模板），只能重新生成。
                      </p>
                    )}
                </div>
              )}
            </div>

            {/* 提示用户向下滑动关闭（mobile 友好） */}
            <div className="flex justify-center pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1">
              <span className="inline-flex items-center gap-1 text-[10px] text-stone-400">
                <ChevronDown className="h-3 w-3" />
                点击上方关闭按钮收起
              </span>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* 二次确认 */}
      <AlertDialog
        open={confirmSnap !== null}
        onOpenChange={(v) => !v && setConfirmId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              恢复第 {confirmSnap?.round} 轮效果图？
            </AlertDialogTitle>
            <AlertDialogDescription>
              当前的候选集会被自动归档为新一轮历史，然后切换到第{" "}
              {confirmSnap?.round} 轮的历史版本（原图 + 候选 + 已选候选）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoringId === confirmId}>
              再想想
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={restoringId === confirmId}
              onClick={(e) => {
                e.preventDefault();
                const id = confirmId;
                setConfirmId(null);
                if (!id) return;
                onRestore(id);
              }}
            >
              确认恢复
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
