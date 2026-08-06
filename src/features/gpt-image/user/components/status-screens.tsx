"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Link as LinkIcon,
  Loader2,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";

/** 首次加载整屏态 */
export function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-50 px-6">
      <div className="text-center">
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-emerald-600" />
        <p className="mt-3 text-sm text-zinc-500">正在加载订单…</p>
      </div>
    </div>
  );
}

/** token 无效整屏态 */
export function InvalidLinkScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-50 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200/80 bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50">
          <LinkIcon className="h-5 w-5 text-amber-600" />
        </div>
        <h2 className="text-base font-semibold text-zinc-900">链接无效</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          订单不存在或链接已失效。请确认链接是否完整，或联系为你创建订单的服务方。
        </p>
        <Button variant="outline" className="mt-5" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" /> 返回首页
          </Link>
        </Button>
      </div>
    </div>
  );
}

/** 已取消 */
export function CancelledPanel({
  cancelledAt,
}: {
  cancelledAt: string | null;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-10 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100">
        <XCircle className="h-5 w-5 text-zinc-400" />
      </div>
      <h3 className="text-base font-semibold text-zinc-900">订单已取消</h3>
      <p className="mt-2 text-sm text-zinc-500">
        {cancelledAt
          ? `取消时间 ${new Date(cancelledAt).toLocaleString("zh-CN")}`
          : "此订单已被取消。"}
      </p>
      <p className="mt-3 text-xs leading-relaxed text-zinc-400">
        如需重新生成，请联系服务方创建新订单。
      </p>
      <Button variant="outline" className="mt-5" asChild>
        <Link href="/">
          <ArrowLeft className="h-4 w-4" /> 返回首页
        </Link>
      </Button>
    </div>
  );
}

/** 生成失败提示条 —— 全页只此一处展示 errorMessage */
export function FailureNotice({
  message,
  canRetry,
  onRetryAll,
  retrying,
}: {
  message: string | null;
  canRetry: boolean;
  onRetryAll?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/70 p-4">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-red-800">上次生成失败</p>
        <p className="mt-1 text-xs leading-relaxed break-words text-red-700/90">
          {message || "生成图片时发生未知错误。"}
        </p>
        <p className="mt-2 text-xs text-red-600/80">
          {canRetry
            ? "可以在下方重新上传图片再试一次，或直接重新生成全部效果图。"
            : "本订单的图片额度已用满，请联系服务方处理。"}
        </p>
      </div>
      {onRetryAll && canRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetryAll}
          disabled={retrying}
          className="shrink-0 border-red-300 bg-white text-red-700 hover:bg-red-50 hover:text-red-800"
        >
          {retrying ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 重试中
            </>
          ) : (
            "重新生成全部"
          )}
        </Button>
      )}
    </div>
  );
}
