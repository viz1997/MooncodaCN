/**
 * CheckoutSuccessView —— 支付成功页(轮询)
 *
 * ## 为什么要有轮询
 *
 * 用户从 Stripe 跳回来的那一刻,钱**可能还没到**:
 *
 * ```
 * Stripe 支付完成 → Stripe 通知 Sellbase → Sellbase 发 webhook
 *                 → 本仓库收到 webhook → 标 paid
 * ```
 *
 * 这条链有几秒延迟。用户落地时本地状态可能还是 `unpaid` —— 这时候显示
 * 「失败」是错的(钱明明付了),显示「成功」也是错的(可能压根没付)。
 *
 * 所以轮询到状态明确为止。
 *
 * ## 轮询多久
 *
 * 最多 60 秒(20 次 × 3 秒)。webhook 正常几秒就到;60 秒还没动静,基本
 * 可以判定 webhook 丢了 —— 这时候给「重新支付 / 查订单」的入口,而不是
 * 让用户对着一个转圈发呆。
 *
 * 页面隐藏时(切到别的标签页)降频 —— 见 `document.hidden`。
 */

"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatPriceCNY } from "@/features/marketing/components/storefront/wjp-store-data";
import { PaymentQrCode } from "@/features/payments/components/payment-qr";
import { Link } from "@/i18n/routing";

/** 轮询间隔 */
const POLL_INTERVAL_MS = 3000;
/** 最多轮询次数(20 × 3s = 60s) */
const MAX_ATTEMPTS = 20;
/** 页面隐藏时的间隔 */
const HIDDEN_INTERVAL_MS = 15_000;

type OrderStatus = "unpaid" | "paid" | "fulfilled" | "cancelled";
type OrderPaymentStatus = "unpaid" | "paid" | "refunded" | "failed";

export function CheckoutSuccessView({
  orderNo,
  initialStatus,
  initialPaymentStatus,
  initialTotalCents,
  initialPaymentUrl,
  initialPaymentQrCodeUrl,
}: {
  orderNo: string;
  initialStatus: OrderStatus;
  initialPaymentStatus: OrderPaymentStatus;
  initialTotalCents: number;
  initialPaymentUrl: string | null;
  /** 微信扫码的二维码内容 —— null = 不是微信那一支 */
  initialPaymentQrCodeUrl?: string | null;
}) {
  const [status, setStatus] = useState<OrderStatus>(initialStatus);
  const [paymentStatus, setPaymentStatus] =
    useState<OrderPaymentStatus>(initialPaymentStatus);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(
    initialPaymentUrl
  );
  const [paymentQrCodeUrl, setPaymentQrCodeUrl] = useState<string | null>(
    initialPaymentQrCodeUrl ?? null
  );
  const [totalCents, setTotalCents] = useState(initialTotalCents);
  const [gaveUp, setGaveUp] = useState(false);

  const aliveRef = useRef(true);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    attemptRef.current = 0;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const schedule = () => {
      if (!aliveRef.current) return;
      clearTimer();
      const delay =
        typeof document !== "undefined" && document.hidden
          ? HIDDEN_INTERVAL_MS
          : POLL_INTERVAL_MS;
      timerRef.current = setTimeout(tick, delay);
    };

    const tick = async () => {
      timerRef.current = null;
      if (!aliveRef.current) return;

      attemptRef.current++;
      try {
        const res = await fetch(
          `/api/store/orders/${encodeURIComponent(orderNo)}`,
          {
            headers: { Accept: "application/json" },
            cache: "no-store",
          }
        );

        if (res.status === 404 || res.status === 401) {
          // 订单查不到 / 会话没了 —— 停,别再打
          setGaveUp(true);
          return;
        }

        if (res.ok) {
          const body = (await res.json()) as {
            status?: OrderStatus;
            paymentStatus?: OrderPaymentStatus;
            totalCents?: number;
            paymentUrl?: string | null;
            paymentQrCodeUrl?: string | null;
          };
          if (typeof body.status === "string") {
            setStatus(body.status);
          }
          if (typeof body.paymentStatus === "string") {
            setPaymentStatus(body.paymentStatus);
          }
          if (typeof body.totalCents === "number") {
            setTotalCents(body.totalCents);
          }
          if (body.paymentUrl !== undefined) {
            setPaymentUrl(body.paymentUrl);
          }
          if (body.paymentQrCodeUrl !== undefined) {
            setPaymentQrCodeUrl(body.paymentQrCodeUrl);
          }
          if (
            (body.status && body.status !== "unpaid") ||
            (body.paymentStatus && body.paymentStatus !== "unpaid")
          ) {
            // 到终态了 —— 停轮询
            return;
          }
        }
      } catch {
        // 网络抖一下 —— 下一轮再试
      }

      if (attemptRef.current >= MAX_ATTEMPTS) {
        setGaveUp(true);
        return;
      }
      schedule();
    };

    // 已经是终态就别轮询了
    if (initialStatus !== "unpaid" || initialPaymentStatus !== "unpaid") {
      return () => {
        aliveRef.current = false;
        clearTimer();
      };
    }

    schedule();

    return () => {
      aliveRef.current = false;
      clearTimer();
    };
  }, [orderNo, initialStatus, initialPaymentStatus]);

  /* ---------------------------------------------------------------------- */
  /*  已支付                                                                   */
  /* ---------------------------------------------------------------------- */

  if (paymentStatus === "refunded") {
    return (
      <div className="mx-auto max-w-[560px] px-4 sm:px-6 py-16 text-center">
        <XCircle className="size-14 mx-auto text-muted-foreground" />
        <h1 className="font-serif text-3xl mt-5 mb-2">已退款</h1>
        <p className="text-sm text-muted-foreground mb-8">
          订单号 {orderNo} —— 这笔订单已经退过款。
        </p>
        <Button asChild className="rounded-full px-7">
          <Link href="/dashboard/store-orders">我的订单</Link>
        </Button>
      </div>
    );
  }

  if (paymentStatus === "failed") {
    return (
      <div className="mx-auto max-w-[560px] px-4 sm:px-6 py-16 text-center">
        <XCircle className="size-14 mx-auto text-destructive" />
        <h1 className="font-serif text-3xl mt-5 mb-2">支付失败</h1>
        <p className="text-sm text-muted-foreground mb-8">
          订单号 {orderNo} —— 这次没有扣款成功,可以在「我的订单」里重新支付。
        </p>
        <Button asChild className="rounded-full px-7">
          <Link href="/dashboard/store-orders">我的订单</Link>
        </Button>
      </div>
    );
  }

  if (paymentStatus === "paid" || status === "paid" || status === "fulfilled") {
    return (
      <div className="mx-auto max-w-[560px] px-4 sm:px-6 py-16 text-center">
        <CheckCircle2 className="size-14 mx-auto text-primary" />
        <h1 className="font-serif text-3xl mt-5 mb-2">支付成功</h1>
        <p className="text-sm text-muted-foreground mb-1">订单号 {orderNo}</p>
        <p className="text-sm text-muted-foreground mb-8">
          金额 {formatPriceCNY(totalCents / 100)} ——
          我们已经收到款,马上开始制作。
        </p>
        <div className="flex gap-3 justify-center">
          <Button asChild className="rounded-full px-7">
            <Link href="/products">继续逛</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full px-7">
            <Link href="/dashboard/store-orders">我的订单</Link>
          </Button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  已取消                                                                   */
  /* ---------------------------------------------------------------------- */

  if (status === "cancelled") {
    return (
      <div className="mx-auto max-w-[560px] px-4 sm:px-6 py-16 text-center">
        <XCircle className="size-14 mx-auto text-destructive" />
        <h1 className="font-serif text-3xl mt-5 mb-2">订单已取消</h1>
        <p className="text-sm text-muted-foreground mb-8">
          订单号 {orderNo} —— 这次没有收到付款。
        </p>
        <Button asChild className="rounded-full px-7">
          <Link href="/products">回到商店</Link>
        </Button>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  还没确认 / 没确认到                                                       */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="mx-auto max-w-[560px] px-4 sm:px-6 py-16 text-center">
      {gaveUp ? (
        <>
          <XCircle className="size-14 mx-auto text-muted-foreground" />
          <h1 className="font-serif text-3xl mt-5 mb-2">还没收到付款</h1>
          <p className="text-sm text-muted-foreground mb-8">
            订单号 {orderNo} —— 支付可能没有完成,或者确认消息还没到。
            {paymentUrl || paymentQrCodeUrl
              ? "你可以重新支付这笔订单。"
              : "请到「我的订单」里重新获取支付入口。"}
          </p>

          {/* 微信那一支 —— 码还在,用户扫一下就行 */}
          {paymentQrCodeUrl && (
            <div className="mb-8 flex justify-center">
              <PaymentQrCode
                value={paymentQrCodeUrl}
                size={200}
                hint="用微信扫一扫,付款完成后这一页会自动更新"
              />
            </div>
          )}

          <div className="flex gap-3 justify-center">
            {paymentUrl && (
              <Button asChild className="rounded-full px-7">
                <a href={paymentUrl}>重新支付</a>
              </Button>
            )}
            <Button asChild variant="outline" className="rounded-full px-7">
              <Link href="/dashboard/store-orders">我的订单</Link>
            </Button>
          </div>
        </>
      ) : (
        <>
          <Loader2 className="size-14 mx-auto animate-spin text-muted-foreground" />
          <h1 className="font-serif text-3xl mt-5 mb-2">正在确认支付…</h1>
          <p className="text-sm text-muted-foreground mb-8">
            订单号 {orderNo}
            <br />
            金额 {formatPriceCNY(totalCents / 100)}
            <br />
            支付确认后会立刻显示,通常只要几秒。
          </p>

          {/* 微信那一支 —— 用户还没扫码,码得一直显示着 */}
          {paymentQrCodeUrl && (
            <div className="mb-8 flex justify-center">
              <PaymentQrCode
                value={paymentQrCodeUrl}
                size={200}
                hint="用微信扫一扫,付款完成后这一页会自动更新"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
