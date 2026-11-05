"use client";

/**
 * 「去支付」按钮 —— 工单详情的收款入口
 *
 * ## 三种状态
 *
 * | 收款状态 | 界面 |
 * |---|---|
 * | `paid` | 一行绿字「已支付」,没有按钮 |
 * | 未付 + 有 `paymentUrl` | 「去支付」→ 直接跳支付平台 |
 * | 未付 + 没有 `paymentUrl` | 「获取支付入口」→ 先打 `POST /api/print-orders/:no/payment-link`,拿到再跳 |
 *
 * ## 为什么每次都问服务端要入口
 *
 * 支付链接会过期(旧路的 Stripe 链接 23 小时就过期)。本地存的 `paymentUrl`
 * 可能是烂的 —— 用户点一下跳到支付平台的报错页,体验极差。
 *
 * 但也不能每次都无脑建新链接:那会在支付平台那边留一堆重复的支付会话。
 * 折中是**让服务端决定**:客户端每次都问一次
 * `POST /api/print-orders/:no/payment-link`,服务端内部
 * (`ensurePrintOrderPaymentLink()`)按「有没有支付会话 / 有没有入口」
 * 决定复用还是重发。用户点一次按钮,付一次钱。
 *
 * ## 微信是**扫码**,不是跳转
 *
 * 微信 Native 不跳页 —— 服务端给回的是一段 `code_url`,本地画成二维码,
 * 用户扫完就行。所以「拿到入口」有两种形态:URL 或者二维码内容。
 *
 * ## 失败不吞
 *
 * 拿入口失败(通道没配 / 上游没连上)要把原因说出来,让用户知道
 * 可以找工作室线下付款 —— 不能只是转个圈然后什么都不发生。
 */

import { Loader2, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { PaymentQrCode } from "@/features/payments/components/payment-qr";

export function OrderPaymentButton({
  orderNo,
  paymentUrl,
  paymentQrCodeUrl,
  paymentStatus,
}: {
  orderNo: string;
  /** 本地存的支付链接 —— 可能是过期的 */
  paymentUrl: string | null;
  /** 微信扫码的二维码内容 —— null = 不是微信那一支 */
  paymentQrCodeUrl?: string | null;
  paymentStatus: string;
}) {
  const t = useTranslations("PrintQuote");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 这次拿回来的二维码 —— 有值就画码,不跳页 */
  const [qrCode, setQrCode] = useState<string | null>(paymentQrCodeUrl ?? null);

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

  /** 去支付 —— 先问服务端要入口,拿到就跳(微信是画码) */
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
        paymentQrCodeUrl?: string | null;
        message?: string;
      } | null;

      if (!res.ok) {
        setError(body?.message ?? t("payment.errors.LINK_FAILED"));
        setPending(false);
        return;
      }

      // 微信 Native —— 扫码,留在原地
      if (body?.paymentQrCodeUrl) {
        setQrCode(body.paymentQrCodeUrl);
        setPending(false);
        return;
      }

      if (!body?.paymentUrl) {
        setError(t("payment.errors.LINK_FAILED"));
        setPending(false);
        return;
      }

      // 整页跳走 —— 支付平台那边是外部页面,不是站内路由
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
      {qrCode ? (
        <div className="mt-2 flex flex-col items-center">
          <PaymentQrCode value={qrCode} size={180} hint={t("payment.qrHint")} />
        </div>
      ) : paymentUrl ? null : (
        <p className="max-w-[16rem] text-right text-[11px] text-muted-foreground">
          {t("payment.offlineHint")}
        </p>
      )}
    </div>
  );
}
