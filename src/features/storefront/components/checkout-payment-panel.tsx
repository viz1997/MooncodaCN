"use client";

/**
 * 结算的「付款」那一块 —— 商城结算页和打印单页共用
 *
 * ## 它管什么
 *
 * 选收款通道 → 提交结算 → 拿到付款入口 → 微信扫码 → 轮询到钱到了。
 * 这些状态**全部在组件自己里** —— 父组件(结算页 / 打印单页)只负责把
 * 「选了哪个地址」「留言是什么」传进来,以及在钱到了之后刷新自己的缓存。
 *
 * ## 两种车走同一个接口
 *
 * `POST /api/store/checkout` 带一个 `cartKind`:
 *
 * - `storefront` 商城购物袋 —— 目录商品,运费按 ¥99 门槛算
 * - `print` 打印单 —— 打印服务,没有运费
 *
 * 钱到了之后要作废哪份缓存,也跟着 `cartKind` 走(见 `use-cart.ts` /
 * `use-print-cart.ts` 的 invalidate)。
 */

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { PaymentChannelPicker } from "@/features/payments/components/payment-channel-picker";
import { PaymentQrCode } from "@/features/payments/components/payment-qr";
import { Link } from "@/i18n/routing";

import { invalidateCartCache } from "../hooks/use-cart";
import { invalidatePrintCartCache } from "../hooks/use-print-cart";

/** 结算哪张车 */
export type CheckoutCartKind = "storefront" | "print";

export function CheckoutPaymentPanel({
  cartKind,
  addressId,
  note,
  submitLabel = "去支付",
  onPaid,
}: {
  cartKind: CheckoutCartKind;
  /** 选中的收货地址 id —— 没有就不给提交 */
  addressId: string | null;
  /** 用户留言 */
  note?: string | null;
  /** 提交按钮上的字(「去支付」/「提交打印单」) */
  submitLabel?: string;
  /** 钱到了 —— 父组件可以在这里刷新自己的东西 */
  onPaid?: (orderNo: string) => void;
}) {
  const queryClient = useQueryClient();
  const locale = useLocale();
  const tPayment = useTranslations("Payment");

  const [isPaying, setIsPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [createdOrderNo, setCreatedOrderNo] = useState<string | null>(null);
  /** 这一单里生成的打印工单号(`PO-…`)—— 支付入口没生成时给用户一个凭据 */
  const [createdPrintOrderNos, setCreatedPrintOrderNos] = useState<string[]>(
    []
  );
  /** 选中的收款通道 —— null = 还没选(服务端挑第一个可用的) */
  const [channel, setChannel] = useState<string | null>(null);
  /**
   * 微信扫码的二维码内容
   *
   * 非 null 时页面**留在原地**画码 —— 微信 Native 不跳页。
   */
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  /** 扫码之后钱到了没 —— 轮询出来的 */
  const [scanPaid, setScanPaid] = useState(false);

  const handlePay = async () => {
    if (!addressId) {
      setPayError("请先选择收货地址");
      return;
    }
    setIsPaying(true);
    setPayError(null);
    setQrCodeUrl(null);
    setScanPaid(false);

    try {
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addressId,
          note: note?.trim() ? note.trim() : null,
          // 结算哪张车 —— 商城购物袋 / 打印单
          cartKind,
          // 打印工单的邮件通知语言 —— 跟着订单落库
          locale,
          // 收款通道 —— 用户选的那个
          channel: channel ?? undefined,
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setPayError(body?.message ?? `结算失败(HTTP ${res.status})`);
        setIsPaying(false);
        return;
      }

      setCreatedOrderNo(body?.orderNo ?? null);
      setCreatedPrintOrderNos(
        Array.isArray(body?.printOrderNos) ? body.printOrderNos : []
      );

      // 微信 Native —— 扫码,页面留在原地画码
      if (body?.paymentQrCodeUrl) {
        setQrCodeUrl(body.paymentQrCodeUrl);
        setIsPaying(false);
        return;
      }

      if (body?.paymentUrl) {
        // 跳支付宝 / Shopify / 旧路的 Stripe —— 全页跳转,不能用 router.push
        window.location.href = body.paymentUrl;
        return;
      }

      // 订单建好了但没有付款入口 —— 给出订单号,让用户去订单页重取
      // 两种失败,两种说法(见 checkout.ts 的 classifyPaymentIssue):
      // 「收款通道没配好」重试没用,让他去找工作室;「这次调用挂了」重试就能好
      setPayError(
        body?.paymentIssue === "PAYMENT_NOT_CONFIGURED"
          ? "订单已创建,但支付通道暂时不可用。订单已经保留,工作室会跟你联系收款。"
          : "订单已创建,但支付入口生成失败。请到「我的订单」里重新获取支付入口。"
      );
      setIsPaying(false);
    } catch {
      setPayError("结算失败,请稍后重试");
      setIsPaying(false);
    }
  };

  /**
   * 扫码之后的轮询 —— 钱到了就停
   *
   * 微信的回调到本仓库有几秒延迟。用户扫完码盯着页面看,这时候显示
   * 「失败」是错的(钱明明付了),显示「成功」也是错的(可能压根没付)。
   * 所以轮询到状态明确为止。
   */
  useEffect(() => {
    if (!qrCodeUrl || !createdOrderNo) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/store/orders/${encodeURIComponent(createdOrderNo)}`,
          { cache: "no-store", headers: { Accept: "application/json" } }
        );
        if (!res.ok) return;
        const body = await res.json();
        if (
          body?.paymentStatus === "paid" ||
          body?.status === "paid" ||
          body?.status === "fulfilled"
        ) {
          if (!cancelled) setScanPaid(true);
        }
      } catch {
        // 网络抖一下 —— 下一轮再试
      }
    };

    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [qrCodeUrl, createdOrderNo]);

  /**
   * 钱到了 → 车里的缓存作废
   *
   * 服务端在收款回调那一刻把买掉的行从车里摘掉了(见
   * `payments/lib/settle.ts`)—— 客户端这份缓存得跟着作废。
   */
  useEffect(() => {
    if (!scanPaid) return;
    void (async () => {
      if (cartKind === "print") {
        await invalidatePrintCartCache(queryClient);
      } else {
        await invalidateCartCache(queryClient);
      }
      onPaid?.(createdOrderNo ?? "");
    })();
  }, [scanPaid, queryClient, cartKind, createdOrderNo, onPaid]);

  /* ---------------------------------------------------------------------- */
  /*  微信扫码 —— 页面留在原地画码,不跳页                                      */
  /* ---------------------------------------------------------------------- */

  if (qrCodeUrl) {
    return (
      <div className="mt-5 border border-border rounded-sm p-4">
        <h3 className="text-sm font-medium mb-3 text-center">
          {scanPaid ? tPayment("qrPaidTitle") : tPayment("qrTitle")}
        </h3>
        <div className="flex justify-center">
          <PaymentQrCode
            value={qrCodeUrl}
            size={200}
            hint={scanPaid ? undefined : tPayment("qrHint")}
          />
        </div>
        {scanPaid ? (
          <p className="mt-3 text-xs text-primary text-center">
            {tPayment("qrPaid")}
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground text-center">
            正在确认支付…
          </p>
        )}
        {createdOrderNo && (
          <p className="mt-2 text-[11px] text-muted-foreground text-center">
            订单号:{createdOrderNo}
          </p>
        )}
        {createdPrintOrderNos.length > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground text-center">
            打印工单号:{createdPrintOrderNos.join("、")}
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2">
          <Button
            asChild
            size="sm"
            className="w-full rounded-full"
            variant={scanPaid ? "default" : "outline"}
          >
            <Link
              href={
                cartKind === "print"
                  ? "/account/print-orders"
                  : "/account/orders"
              }
            >
              我的订单
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  选通道 + 提交                                                            */
  /* ---------------------------------------------------------------------- */

  return (
    <>
      {/* 支付方式 —— 没配好的通道不显示 */}
      <PaymentChannelPicker
        value={channel}
        onChange={setChannel}
        disabled={isPaying}
      />

      {payError && (
        <div className="mt-4 p-3 border border-destructive/40 bg-destructive/5 rounded-sm text-xs text-destructive">
          {payError}
          {createdOrderNo && (
            <p className="mt-1 text-muted-foreground">
              订单号:{createdOrderNo}
            </p>
          )}
          {createdPrintOrderNos.length > 0 && (
            <p className="mt-1 text-muted-foreground">
              打印工单号:{createdPrintOrderNos.join("、")}
            </p>
          )}
        </div>
      )}

      <Button
        size="lg"
        onClick={handlePay}
        disabled={isPaying || !addressId}
        className="w-full mt-5 rounded-full h-12 uppercase tracking-[0.14em] text-[12px] font-medium"
        type="button"
      >
        {isPaying && <Loader2 className="size-4 animate-spin" />}
        {submitLabel}
      </Button>

      <p className="text-[11px] text-muted-foreground text-center mt-3">
        提交后跳转在线支付,付款完成才开始制作。
      </p>
    </>
  );
}
