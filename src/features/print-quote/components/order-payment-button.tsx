"use client";

/**
 * 「去支付」按钮 —— 工单详情的收款入口
 *
 * ## 三种状态
 *
 * | 收款状态 | 界面 |
 * |---|---|
 * | `paid` | 一行绿字「已支付」,没有按钮 |
 * | 未付 + 有 `paymentUrl` | 「去支付」→ 直接跳 Stripe |
 * | 未付 + 没有 `paymentUrl` | 「获取支付链接」→ 先打 `POST /api/print-orders/:no/payment-link`,拿到再跳 |
 *
 * ## 为什么每次都问服务端要链接
 *
 * Stripe 的支付链接 23 小时就过期。本地存的 `paymentUrl` 可能是烂的 ——
 * 用户点一下跳到 Stripe 的报错页,体验极差。
 *
 * 但也不能每次都无脑建新链接:那会在 Sellbase 那边留一堆重复的支付会话。
 * 折中是**让服务端决定**:客户端每次都问一次
 * `POST /api/print-orders/:no/payment-link`,服务端内部
 * (`ensurePrintOrderPaymentLink()`)按「有没有 Sellbase 订单 / 有没有链接」
 * 决定复用还是重发。用户点一次按钮,付一次钱。
 *
 * ## 失败不吞
 *
 * 拿链接失败(Sellbase 没配 / Stripe 没连上)要把原因说出来,让用户知道
 * 可以找工作室线下付款 —— 不能只是转个圈然后什么都不发生。
 */

import { Loader2, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function OrderPaymentButton({
  orderNo,
  paymentUrl,
  paymentStatus,
}: {
  orderNo: string;
  /** 本地存的支付链接 —— 可能是过期的 */
  paymentUrl: string | null;
  paymentStatus: string;
}) {
  const t = useTranslations("PrintQuote");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (paymentStatus === "paid") {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600/20 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
        <Wallet className="size-3.5" />
        {t("payment.paid")}
      </p>
    );
  }

  if (paymentStatus === "refunded") {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <Wallet className="size-3.5" />
        {t("payment.refunded")}
      </p>
    );
  }

  /** 去支付 —— 先问服务端要链接,拿到就跳 */
  const goPay = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/print-orders/${encodeURIComponent(orderNo)}/payment-link`,
        { method: "POST", headers: { Accept: "application/json" } }
      );
      const body = (await res.json().catch(() => null)) as {
        paymentUrl?: string | null;
        message?: string;
      } | null;

      if (!res.ok || !body?.paymentUrl) {
        setError(body?.message ?? t("payment.errors.LINK_FAILED"));
        setPending(false);
        return;
      }

      // 整页跳走 —— Stripe 那边是外部页面,不是站内路由
      window.location.href = body.paymentUrl;
    } catch {
      setError(t("payment.errors.LINK_FAILED"));
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          void goPay();
        }}
        className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Wallet className="size-3.5" />
        )}
        {pending ? t("payment.loading") : t("payment.payNow")}
      </button>
      {error ? (
        <p className="max-w-[16rem] text-right text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
      {paymentUrl ? null : (
        <p className="max-w-[16rem] text-right text-[11px] text-muted-foreground">
          {t("payment.offlineHint")}
        </p>
      )}
    </div>
  );
}
