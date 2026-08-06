"use client";

import { X } from "lucide-react";

interface OrderHeaderProps {
  templateName: string;
  orderNo: string;
  recipientName: string;
  /** 是否展示右上角取消按钮 */
  canCancel: boolean;
  cancelling: boolean;
  onCancelClick: () => void;
}

export function OrderHeader({
  templateName,
  orderNo,
  recipientName,
  canCancel,
  cancelling,
  onCancelClick,
}: OrderHeaderProps) {
  const hasNickname = !!recipientName && recipientName.trim() !== "";
  return (
    <header className="border-b border-zinc-100">
      <div className="mx-auto flex max-w-2xl items-start justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-medium text-zinc-900">
            {templateName}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
            <span>
              订单 <span className="font-mono text-zinc-700">{orderNo}</span>
            </span>
            {hasNickname && (
              <>
                <span className="text-zinc-300">·</span>
                <span className="truncate">
                  用户昵称{" "}
                  <span className="text-zinc-700">{recipientName}</span>
                </span>
              </>
            )}
          </div>
        </div>
        {canCancel && (
          <button
            type="button"
            onClick={onCancelClick}
            disabled={cancelling}
            aria-label="取消订单"
            className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <X className="h-3.5 w-3.5" />
            取消
          </button>
        )}
      </div>
    </header>
  );
}
