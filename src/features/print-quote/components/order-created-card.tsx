"use client";

/**
 * 下单成功卡片 —— 「订单建好了,接下来付钱」
 *
 * ## 四种情形
 *
 * | 情形 | 卡片说什么 | 做什么 |
 * |---|---|---|
 * | 有支付链接 | 「正在跳转支付…」 | 自动跳支付平台(3 秒后) |
 * | 有支付链接但自动跳被拦 | 同上 | 手动点「去支付」 |
 * | 有二维码(微信) | 「微信扫码支付」 | 画一个码,用户扫 |
 * | 没有付款入口 | 「订单已创建,支付入口生成失败」 | 给详情页链接(那儿能重试 / 走线下) |
 *
 * ## 为什么自动跳要延后 3 秒
 *
 * 立即跳会让用户来不及看到「订单号」—— 而订单号是他在工作室那边对账的
 * 凭据。3 秒足够读完一行订单号,又不至于让人以为页面卡住了。
 *
 * 延后跳转期间页面仍然可点 —— 手动链接一直在。
 *
 * ## 微信不跳页
 *
 * 微信 Native 是**扫码**:页面留在原地画码,用户扫完钱才到。所以这一支
 * 没有「3 秒后自动跳」,也没有「去支付」按钮 —— 码本身就是入口。
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { PaymentQrCode } from "@/features/payments/components/payment-qr";
import { formatCents } from "@/features/print-quote/lib/format";
import type { PrintOrderCreated } from "@/features/print-quote/lib/quote-types";
import { Link } from "@/i18n/routing";

/** 延迟多久自动跳支付平台 */
const AUTO_REDIRECT_DELAY_MS = 3000;

export function OrderCreatedCard({ order }: { order: PrintOrderCreated }) {
  const t = useTranslations("PrintQuote");
  const [secondsLeft, setSecondsLeft] = useState(
    Math.round(AUTO_REDIRECT_DELAY_MS / 1000)
  );

  const paymentUrl = order.paymentUrl;
  const qrCodeUrl = order.paymentQrCodeUrl;

  useEffect(() => {
    if (!paymentUrl) return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [paymentUrl]);

  useEffect(() => {
    if (!paymentUrl) return;
    const timer = setTimeout(() => {
      window.location.href = paymentUrl;
    }, AUTO_REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [paymentUrl]);

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5">
      <h3 className="text-base font-semibold text-emerald-900">
        {t("order.successTitle")}
      </h3>
      <p className="mt-1 text-sm text-emerald-800/80">
        {t("order.successBody")}
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-emerald-800/70">{t("order.orderNo")}</dt>
          <dd className="mt-0.5 font-mono text-sm font-medium text-emerald-900">
            {order.orderNo}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-emerald-800/70">{t("quote.total")}</dt>
          <dd className="mt-0.5 font-mono text-sm font-medium text-emerald-900">
            {formatCents(order.quote.totalPriceCents)}
          </dd>
        </div>
      </dl>

      {/* 微信扫码 —— 页面留在原地,不跳 */}
      {qrCodeUrl ? (
        <div className="mt-4 rounded-lg border border-emerald-600/20 bg-white/60 p-3">
          <p className="text-xs font-medium text-emerald-900">
            {t("payment.qrTitle")}
          </p>
          <div className="mt-3 flex justify-center">
            <PaymentQrCode
              value={qrCodeUrl}
              size={200}
              hint={t("payment.qrHint")}
            />
          </div>
        </div>
      ) : paymentUrl ? (
        <div className="mt-4 rounded-lg border border-emerald-600/20 bg-white/60 p-3">
          <p className="text-xs font-medium text-emerald-900">
            {t("order.redirecting", { seconds: secondsLeft })}
          </p>
          <a
            href={paymentUrl}
            className="mt-2 inline-block rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            {t("order.payNow")}
          </a>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-amber-600/20 bg-amber-50/70 p-3">
          <p className="text-xs font-medium text-amber-900">
            {t("order.paymentLinkFailed")}
          </p>
          <p className="mt-1 text-[11px] text-amber-800/80">
            {t("order.paymentLinkFailedHint")}
          </p>
        </div>
      )}

      <p className="mt-4 text-xs text-emerald-800/70">
        {t("order.successHint")}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard/print-orders"
          className="text-xs font-medium text-emerald-800 underline underline-offset-4 hover:text-emerald-900"
        >
          {t("order.successLink")}
        </Link>
        <Link
          href={`/dashboard/print-orders/${order.orderNo}`}
          className="text-xs font-medium text-emerald-800 underline underline-offset-4 hover:text-emerald-900"
        >
          {t("order.viewDetail")}
        </Link>
      </div>
    </div>
  );
}
