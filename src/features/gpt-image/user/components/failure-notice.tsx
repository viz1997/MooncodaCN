"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { sanitizeErrorMessage } from "@/features/gpt-image/lib/sanitize-error-message";

interface FailureNoticeProps {
  message: string | null;
  /** 没有可重试次数时禁用按钮（上传额度已满） */
  canRetry: boolean;
  /** 重试中（按钮禁用 + spinner） */
  retrying?: boolean;
  /** 点击「重新生成全部」 */
  onRetryAll?: () => void;
}

/**
 * 失败通知条 —— 顶部内嵌，不替换整屏。
 *
 * 设计参考：参考 failure-notice.tsx —— `max-w-md mx-auto px-5 py-3` 红色 AlertTriangle
 * 配上 sanitize 后的原因与重试按钮，让用户在主流程里看到"上次失败"+继续操作。
 */
export function FailureNotice({
  message,
  canRetry,
  retrying = false,
  onRetryAll,
}: FailureNoticeProps) {
  // 永远不让原始 HTTP / HTML 漏到用户
  const displayMessage =
    sanitizeErrorMessage(message) ?? "上次生成失败，请重新上传图片或点击重试。";

  return (
    <section className="mx-auto w-full max-w-md px-5 pt-4 animate-[fadeIn_.3s_ease-out]">
      <div className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50/80 p-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-500">
          <AlertTriangle className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-red-800">生成失败</p>
          <p className="mt-0.5 text-xs leading-relaxed break-words text-red-700/80">
            {displayMessage}
          </p>
          {!canRetry && (
            <p className="mt-2 text-xs text-stone-500">
              本订单的图片额度已用满，请联系服务方处理。
            </p>
          )}
        </div>
        {onRetryAll && canRetry && (
          <button
            type="button"
            onClick={onRetryAll}
            disabled={retrying}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-red-200 px-2.5 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-60"
          >
            {retrying ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> 重试中
              </>
            ) : (
              <>
                <RefreshCw className="h-3 w-3" /> 重试
              </>
            )}
          </button>
        )}
      </div>
    </section>
  );
}
