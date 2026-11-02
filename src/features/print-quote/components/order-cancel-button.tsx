"use client";

/**
 * 用户自助取消工单
 *
 * ## 只有「待确认」能取消
 *
 * 工作室一确认(`CONFIRMED`),就意味着产能已经投进去了 —— 这时候用户
 * 一句话撤单,工作室是白干的。所以取消只对 `PENDING` 开放。
 *
 * 这条规则在**三处**同时守着:
 *   1. 这个组件要不要渲染(前端)
 *   2. `cancelPrintOrderAction` 的前置检查(action 层)
 *   3. `transitionPrintOrderStatus()` 锁行后的强校验(真正的授权边界)
 *
 * 第 3 条才是关键 —— 前两条都能被绕过(直接调 action、手工构造请求)。
 *
 * ## 为什么是「展开」而不是弹窗
 *
 * 取消是破坏性操作,得有个确认步骤,但不值得为它开一个模态框 ——
 * 弹窗会把用户从「看进度」这个上下文里拽走。点一下按钮,原地展开一块
 * 「确认区」,写不写原因都能取消。
 *
 * ## 失败要说出原因
 *
 * 服务端返回 `{ok:false, code}`,这里按 code 找 i18n 文案 —— 不能只弹一句
 * 「操作失败」,用户不知道自己哪里做错了。
 */

import { Loader2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";

import { cancelPrintOrderAction } from "@/features/print-quote/user/actions";

export function OrderCancelButton({
  orderNo,
  onCancelled,
}: {
  orderNo: string;
  /** 取消成功后回调 —— 详情页用它刷新时间线 */
  onCancelled?: () => void | Promise<void>;
}) {
  const t = useTranslations("PrintQuote");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const { execute: cancel, isPending } = useAction(cancelPrintOrderAction, {
    onSuccess: ({ data }) => {
      if (data?.ok) {
        setError(null);
        setDone(true);
        setOpen(false);
        void onCancelled?.();
        return;
      }
      const code = data?.code ?? "FAILED";
      setError(t(`detail.cancel.errors.${code}`));
    },
    onError: ({ error }) => {
      setError(error.serverError ?? t("detail.cancel.errors.FAILED"));
    },
  });

  if (done) {
    return (
      <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        {t("detail.cancel.success")}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <XCircle className="size-3.5" />
        {t("detail.cancel.button")}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <p className="text-sm font-medium text-foreground">
        {t("detail.cancel.confirmTitle")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("detail.cancel.confirmBody")}
      </p>

      <span className="mt-3 block text-xs font-medium text-foreground">
        {t("detail.cancel.noteLabel")}
      </span>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        rows={3}
        aria-label={t("detail.cancel.noteLabel")}
        placeholder={t("detail.cancel.notePlaceholder")}
        className="mt-1 w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
      />

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            void cancel({ orderNo, note: note.trim() || null });
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {isPending
            ? t("detail.cancel.submitting")
            : t("detail.cancel.button")}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {t("order.cancel")}
        </button>
      </div>
    </div>
  );
}
