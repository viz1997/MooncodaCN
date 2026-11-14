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

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { PaymentQrCode } from "@/features/payments/components/payment-qr";
import { Link } from "@/i18n/routing";
import { formatCents } from "@/lib/money";

import { invalidateCartCache } from "../hooks/use-cart";

/** 轮询间隔 */
const POLL_INTERVAL_MS = 3000;
/** 最多轮询次数(20 × 3s = 60s) */
const MAX_ATTEMPTS = 20;
/** 页面隐藏时的间隔 */
const HIDDEN_INTERVAL_MS = 15_000;

type OrderStatus = "unpaid" | "paid" | "fulfilled" | "cancelled";
type OrderPaymentStatus = "unpaid" | "paid" | "refunded" | "failed";

/**
 * 主动查单的结论(2026-11-14)
 *
 * `reportedPaid` = 「支付宝那边**说**这笔已经付款成功,但我们核对不上」
 * (公钥不对 / 金额对不上)⇒ **买家不许再付一次**。
 */
interface ReconcileConclusion {
  paid: boolean;
  reportedPaid: boolean;
  settled: boolean;
  code: string;
  message: string;
}

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
  /**
   * 「支付宝那边说付了、我们核不上」(2026-11-14)
   *
   * 为真 ⇒ 这一页**不许**给「重新支付」按钮 —— 那条链接的 `out_trade_no`
   * 已经付过了,点它只会拿到支付宝的「该订单已付款(TRADE_HAS_SUCCESS)」,
   * **死循环**(线上真踩过:`SO-20261114-137332`)。
   *
   * 同时**继续轮询** —— 工作室把公钥修好之后,下一轮就会变成「支付成功」。
   */
  const [reportedPaid, setReportedPaid] = useState(false);
  /** 查单给的人话 —— 摆在 ⚠ 面板里 */
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);

  const aliveRef = useRef(true);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queryClient = useQueryClient();

  /**
   * 付款成功 → 购物车缓存作废
   *
   * 服务端在收款回调那一刻把买掉的行从购物车里摘掉了(见
   * `payments/lib/settle.ts`)—— 客户端这份缓存得跟着作废,不然用户看到的
   * 还是买之前的购物袋。
   */
  useEffect(() => {
    if (paymentStatus === "paid") {
      void invalidateCartCache(queryClient);
    }
  }, [paymentStatus, queryClient]);

  /**
   * 回跳后**立刻主动查一次支付宝**(2026-11-14)
   *
   * 收钱以「支付宝推过来的异步通知」为准,但通知会丢(地址配错 / 验签不过 /
   * app_id 对不上)⇒ 钱到了、订单永远是 `unpaid`,用户盯着「正在确认支付…」
   * 转圈到超时(线上真踩过:`SO-20261114-657E4A`)。
   *
   * ⇒ 用户从支付宝回跳到这一页时,**主动问一次支付宝**「这单到底付了没」。
   * 查完直接更新状态,不用等第一轮轮询(那要 3 秒)。
   *
   * 只在**进来那一刻**查一次 —— 后面由轮询接管(那个接口自带节流,同一个
   * 订单 20 秒内最多打一次支付宝)。
   *
   * 查失败**不报错** —— 这只是兜底,主路还是轮询读库。
   */
  useEffect(() => {
    if (initialStatus !== "unpaid" || initialPaymentStatus !== "unpaid") {
      return;
    }

    let cancelled = false;

    const confirm = async () => {
      try {
        const res = await fetch(
          `/api/store/orders/${encodeURIComponent(orderNo)}/confirm-payment`,
          {
            method: "POST",
            headers: { Accept: "application/json" },
            cache: "no-store",
          }
        );
        if (!res.ok) return;

        const body = (await res.json()) as {
          status?: OrderStatus;
          paymentStatus?: OrderPaymentStatus;
          reconcile?: ReconcileConclusion | null;
        };
        if (cancelled) return;
        if (typeof body.status === "string") {
          setStatus(body.status);
        }
        if (typeof body.paymentStatus === "string") {
          setPaymentStatus(body.paymentStatus);
        }
        // 「支付宝说付了、我们核不上」⇒ 撤掉「重新支付」按钮
        if (body.reconcile?.reportedPaid) {
          setReportedPaid(true);
          setReconcileMessage(body.reconcile.message ?? null);
        }
      } catch {
        // 查单挂了 —— 下面的轮询还在,不影响
      }
    };

    void confirm();

    return () => {
      cancelled = true;
    };
  }, [orderNo, initialStatus, initialPaymentStatus]);

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
            reconcile?: ReconcileConclusion | null;
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
          // 「支付宝说付了、我们核不上」⇒ 撤掉「重新支付」按钮(2026-11-14)
          if (body.reconcile?.reportedPaid) {
            setReportedPaid(true);
            setReconcileMessage(body.reconcile.message ?? null);
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
      <div className="atelier-container py-16 text-center">
        <div className="atelier-narrow">
          <XCircle className="size-14 mx-auto text-muted-foreground" />
          <h1 className="font-serif text-3xl mt-5 mb-2">已退款</h1>
          <p className="text-sm text-muted-foreground mb-8">
            订单号 {orderNo} —— 这笔订单已经退过款。
          </p>
          <Button asChild className="rounded-full px-7">
            <Link href="/account/orders">我的订单</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (paymentStatus === "failed") {
    return (
      <div className="atelier-container py-16 text-center">
        <div className="atelier-narrow">
          <XCircle className="size-14 mx-auto text-destructive" />
          <h1 className="font-serif text-3xl mt-5 mb-2">支付失败</h1>
          <p className="text-sm text-muted-foreground mb-8">
            订单号 {orderNo} —— 这次没有扣款成功,可以在「我的订单」里重新支付。
          </p>
          <Button asChild className="rounded-full px-7">
            <Link href="/account/orders">我的订单</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (paymentStatus === "paid" || status === "paid" || status === "fulfilled") {
    return (
      <div className="atelier-container py-16 text-center">
        <div className="atelier-narrow">
          <CheckCircle2 className="size-14 mx-auto text-primary" />
          <h1 className="font-serif text-3xl mt-5 mb-2">支付成功</h1>
          <p className="text-sm text-muted-foreground mb-1">订单号 {orderNo}</p>
          <p className="text-sm text-muted-foreground mb-8">
            金额 {formatCents(totalCents)} —— 我们已经收到款,马上开始制作。
          </p>
          <div className="flex gap-3 justify-center">
            <Button asChild className="rounded-full px-7">
              <Link href="/products">继续逛</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full px-7">
              <Link href="/account/orders">我的订单</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  已取消                                                                   */
  /* ---------------------------------------------------------------------- */

  if (status === "cancelled") {
    return (
      <div className="atelier-container py-16 text-center">
        <div className="atelier-narrow">
          <XCircle className="size-14 mx-auto text-destructive" />
          <h1 className="font-serif text-3xl mt-5 mb-2">订单已取消</h1>
          <p className="text-sm text-muted-foreground mb-8">
            订单号 {orderNo} —— 这次没有收到付款。
          </p>
          <Button asChild className="rounded-full px-7">
            <Link href="/products">回到商店</Link>
          </Button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  还没确认 / 没确认到                                                       */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="atelier-container py-16 text-center">
      <div className="atelier-narrow">
        {reportedPaid ? (
          /* ------------------------------------------------------------------ */
          /*  支付宝说付了,我们核不上(2026-11-14)                             */
          /* ------------------------------------------------------------------ */
          <>
            <TriangleAlert className="size-14 mx-auto text-amber-600" />
            <h1 className="font-serif text-3xl mt-5 mb-2">
              支付宝那边显示已经付款成功
            </h1>
            <p className="text-sm text-muted-foreground mb-2">
              订单号 {orderNo}
              <br />
              金额 {formatCents(totalCents)}
            </p>
            <p className="text-sm text-muted-foreground mb-8">
              我们这边还在核对这笔付款(不影响你 —— 请不要重复付款,
              工作室会人工确认)。
            </p>

            {/* 查单给的人话 —— 工作室那边看日志时能对上 */}
            {reconcileMessage && (
              <p className="mb-8 rounded-lg bg-amber-50 px-4 py-3 text-left text-xs text-amber-900">
                {reconcileMessage}
              </p>
            )}

            {/* ⚠️ **不给「重新支付」** —— 那条链接的 out_trade_no 已经付过了,
                点它只会拿到支付宝的「该订单已付款(TRADE_HAS_SUCCESS)」,
                死循环(线上真踩过:SO-20261114-137332)。 */}
            <div className="flex gap-3 justify-center">
              <Button asChild variant="outline" className="rounded-full px-7">
                <Link href="/account/orders">我的订单</Link>
              </Button>
            </div>
          </>
        ) : gaveUp ? (
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
                <Link href="/account/orders">我的订单</Link>
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
              金额 {formatCents(totalCents)}
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
    </div>
  );
}
