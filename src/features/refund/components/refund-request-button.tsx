"use client";

/**
 * 买家侧的「申请退款」入口 —— **两个详情页共用这一份**
 *
 * 商城订单(`/account/orders/[orderNo]`)和打印工单(`/account/print-orders/[orderNo]`)
 * 的入口长得一模一样、行为也一模一样 ⇒ 只写一个组件,两处 import。
 *
 * ## 为什么是「展开」而不是弹窗
 *
 * 跟「取消工单」一个路子 —— 工作室的口味是**配置 / 表单就地展开,不开弹窗**。
 * 弹窗会把买家从「看订单详情」这个上下文里拽走,还挡住手机上的地址栏。
 *
 * ## 「能不能退」由**纯函数**判定
 *
 * `evaluateRefundEligibility()` 界面和服务端跑的是**同一个函数** ⇒ 界面不会
 * 摆出一个「点了必失败」的按钮。
 *
 * ⚠️ **服务端那一层才是真正的授权边界** —— 用户照样能直接调 action。
 * 界面上藏按钮只是 UI 便利。
 *
 * ## 不可退的时候**要说清楚为什么**
 *
 * 「已付款但不能退」是最容易让人以为系统坏了的场景(工作室的口径:
 * 「开始打印或者生产开始后无法退款」)。所以这一档摆一句话说清楚原因,
 * 而不是把按钮藏了让人猜。
 *
 * 但**没付款的订单不摆任何东西** —— 没什么可退的,提一句是噪音。
 */

import { Loader2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";

import { evaluateRefundEligibility } from "@/features/refund/lib/eligibility";
import { refundErrorTextKey } from "@/features/refund/lib/error-text";
import type { RefundOrderKind, RefundView } from "@/features/refund/lib/types";
import { requestRefundAction } from "@/features/refund/user/actions";

export function RefundRequestButton({
  orderKind,
  orderNo,
  paymentStatus,
  status,
  hasShipment = false,
  refund = null,
  onSubmitted,
}: {
  /** 挂在哪种订单上 */
  orderKind: RefundOrderKind;
  /** 订单号 */
  orderNo: string;
  /** 收款状态(小写那套) */
  paymentStatus: string;
  /** 订单状态(商城小写 / 打印大写) */
  status: string;
  /** 商城订单:已发货没有 */
  hasShipment?: boolean;
  /** 当前这一单**最新**的退款申请(轮询带回来的) */
  refund?: RefundView | null;
  /** 提交成功后回调 —— 详情页用它刷新,状态面板才会出现 */
  onSubmitted?: () => void | Promise<void>;
}) {
  const t = useTranslations("Refund");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const { execute: submit, isPending } = useAction(requestRefundAction, {
    onSuccess: ({ data }) => {
      if (data?.ok) {
        setError(null);
        setDone(true);
        setOpen(false);
        void onSubmitted?.();
        return;
      }
      setError(t(refundErrorTextKey(data?.code)));
    },
    onError: ({ error }) => {
      setError(error.serverError ?? t("errors.FAILED"));
    },
  });

  // 「进行中」= pending 或 approved —— approved 是钱还在路上,那时候再申请
  // 一条就会**退两次钱**。
  const hasActiveRequest =
    refund !== null &&
    (refund.status === "pending" || refund.status === "approved");

  const eligibility = evaluateRefundEligibility({
    orderKind,
    paymentStatus,
    status,
    hasShipment,
    hasActiveRequest,
  });

  // 提交成功之后(或者页面已经带了一条进行中的申请)—— 状态面板在管这件事,
  // 这里不再重复摆一条。
  if (done || hasActiveRequest) {
    return null;
  }

  // 不能退 —— 「付过钱但不能退」要说清楚为什么;没付过钱的什么都不摆。
  if (!eligibility.eligible) {
    if (paymentStatus !== "paid") {
      return null;
    }
    return (
      <p className="rounded-sm border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        {t(refundErrorTextKey(eligibility.code))}
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
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Undo2 className="size-3.5" />
        {t("button")}
      </button>
    );
  }

  return (
    // 展开后的表单要有**确定的宽度** —— 父容器是内容宽的 flex 列,
    // 不写宽度的话 textarea 会塌成默认的 20 列宽,手机上根本没法写字。
    <div className="w-full rounded-sm border border-border bg-muted/40 p-4 sm:max-w-xl">
      <p className="text-sm font-medium text-foreground">{t("confirmTitle")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("confirmBody")}</p>

      <span className="mt-3 block text-[11px] text-muted-foreground">
        {t("reasonLabel")}
      </span>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        rows={3}
        aria-label={t("reasonLabel")}
        placeholder={t("reasonPlaceholder")}
        className="mt-1.5 w-full resize-y rounded-sm border border-border bg-card px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
      />

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={isPending || reason.trim().length === 0}
          onClick={() => {
            void submit({ orderKind, orderNo, reason: reason.trim() });
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {isPending ? t("submitting") : t("submit")}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-full px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
