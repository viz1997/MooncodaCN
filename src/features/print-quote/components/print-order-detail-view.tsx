"use client";

/**
 * 工单详情页 —— `/account/print-orders/[orderNo]`
 *
 * ## 这一页要回答四个问题
 *
 *   1. 现在到哪一步了?   → 状态 chip + 时间线
 *   2. 当时按什么价收的? → 报价明细(服务端重算后落库的那个数)
 *   3. 模型是哪个?       → 模型文件信息
 *   4. 我留过什么话?     → 联系方式 + 下单留言
 *
 * ## 状态是轮询来的,不是刷新来的
 *
 * 工作室在后台改状态是**外部**写入的。这里接 `usePrintOrderDetailPolling`,
 * 30s 一次;用户切走再切回来会立刻刷一次。
 *
 * ## 取消按钮只对「待确认」出现
 *
 * 能不能取消由 `isUserCancellable()` 说了算 —— 规则在数据层也守着,
 * 这里只是**不给用户看一个点了会失败的按钮**。
 *
 * ## 版式跟商城一致
 *
 * 分区面板走 `features/shared/components/atelier-page.tsx` 那一份共享
 * 骨架(细边框 + 无阴影),标题走 `.eyebrow`。之前这里是控制台那套
 * `rounded-xl` + `shadow-sm` 的卡片,跟从电商首页点进来的路径不搭。
 */

import { ArrowLeft, Box, FileText, Mail, Phone, User } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect } from "react";

import { OrderCancelButton } from "@/features/print-quote/components/order-cancel-button";
import { OrderPaymentButton } from "@/features/print-quote/components/order-payment-button";
import { OrderTimeline } from "@/features/print-quote/components/order-timeline";
import { QuoteBreakdown } from "@/features/print-quote/components/quote-breakdown";
import { usePrintOrderDetailPolling } from "@/features/print-quote/hooks/use-print-order-polling";
import { formatCents, formatDims } from "@/features/print-quote/lib/format";
import type {
  PrintOrderEventView,
  UserPrintOrderDetail,
} from "@/features/print-quote/lib/quote-types";
import { isUserCancellable } from "@/features/print-quote/lib/status-machine";
import {
  PRINT_ORDER_PAYMENT_CHIP,
  PRINT_ORDER_STATUS_CHIP,
} from "@/features/print-quote/lib/status-ui";
import {
  AtelierPageShell,
  AtelierPanel,
  AtelierSectionTitle,
} from "@/features/shared/components/atelier-page";
import { Link } from "@/i18n/routing";

export function PrintOrderDetailView({
  order: initialOrder,
  events: initialEvents,
}: {
  order: UserPrintOrderDetail;
  events: PrintOrderEventView[];
}) {
  const t = useTranslations("PrintQuote");
  const format = useFormatter();

  const { order, events, refresh } = usePrintOrderDetailPolling(
    initialOrder.orderNo,
    { order: initialOrder, events: initialEvents }
  );

  const cancellable = isUserCancellable(order.status);

  /**
   * 从支付回跳(`?paid=1`)→ 立刻拉一次
   *
   * 页面首屏是 RSC 渲染时的那份数据 —— 用户付完钱跳回来,那份数据里
   * 还是「未付款」。webhook 落库还有几秒延迟,轮询要等 30 秒。
   *
   * 所以这里立刻刷一次:多一个请求,换来「用户一回来就看到已付款」。
   */
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("paid")) return;
    void refresh();
  }, [refresh]);

  return (
    <AtelierPageShell>
      <Link
        href="/account/print-orders"
        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        {t("detail.back")}
      </Link>

      {/* 头部:订单号 / 状态 / 时间 */}
      <div className="mt-6 mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow text-muted-foreground">{t("detail.title")}</p>
          <h1 className="font-serif text-3xl mt-2 break-all">
            {order.orderNo}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${
                PRINT_ORDER_STATUS_CHIP[order.status]
              }`}
            >
              {t(`status.${order.status}`)}
            </span>
            {/* 收款状态 —— 跟工单状态是两回事,用户最关心的是这个 */}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${
                PRINT_ORDER_PAYMENT_CHIP[order.paymentStatus]
              }`}
            >
              {t(`payment.status.${order.paymentStatus}`)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t("detail.placedAt")}:{" "}
              {format.dateTime(new Date(order.createdAt), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t("detail.updatedAt")}:{" "}
              {format.dateTime(new Date(order.updatedAt), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          {/* 收款入口 —— 未付的单在这儿付 */}
          <OrderPaymentButton
            orderNo={order.orderNo}
            paymentUrl={order.paymentUrl}
            paymentQrCodeUrl={order.paymentQrCodeUrl}
            paymentStatus={order.paymentStatus}
          />
          {cancellable ? (
            <OrderCancelButton
              orderNo={order.orderNo}
              onCancelled={async () => {
                await refresh();
              }}
            />
          ) : null}
        </div>
      </div>

      <div className="space-y-6">
        {/* 时间线 */}
        <AtelierPanel>
          <AtelierSectionTitle icon={FileText}>
            {t("timeline.title")}
          </AtelierSectionTitle>
          <OrderTimeline events={events} viewer="user" />
        </AtelierPanel>

        {/* 报价明细 */}
        <AtelierPanel>
          <AtelierSectionTitle icon={Box}>
            {t("quote.title")}
          </AtelierSectionTitle>
          <QuoteBreakdown values={order} totalSize="sm" />
        </AtelierPanel>

        {/* 模型文件 */}
        <AtelierPanel>
          <AtelierSectionTitle icon={Box}>
            {t("detail.model.title")}
          </AtelierSectionTitle>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact
              label={t("detail.model.fileName")}
              value={order.modelFileName}
              mono
            />
            <Fact
              label={t("detail.model.size")}
              value={
                order.modelSizeBytes === null
                  ? "—"
                  : `${(order.modelSizeBytes / 1024 / 1024).toFixed(2)} MB`
              }
            />
            <Fact
              label={t("detail.model.volume")}
              value={`${order.volumeCM3.toFixed(2)} cm³`}
            />
            <Fact
              label={t("detail.model.surfaceArea")}
              value={`${order.surfaceAreaCM2.toFixed(2)} cm²`}
            />
            <Fact
              label={t("detail.model.dims")}
              value={formatDims(order.dims)}
            />
            <Fact
              label={t("detail.model.weight")}
              value={`${order.materialWeightG.toFixed(1)} g`}
            />
            <Fact
              label={t("detail.model.supportWeight")}
              value={
                order.supportWeightG === null
                  ? "—"
                  : `${order.supportWeightG.toFixed(1)} g`
              }
            />
            <Fact
              label={t("quote.total")}
              value={formatCents(order.totalPriceCents)}
            />
          </dl>
        </AtelierPanel>

        {/* 联系方式 */}
        <AtelierPanel>
          <AtelierSectionTitle icon={User}>
            {t("detail.contact.title")}
          </AtelierSectionTitle>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Fact label={t("detail.contact.name")} value={order.contactName} />
            <Fact
              label={t("detail.contact.email")}
              value={order.contactEmail}
              icon={<Mail className="size-3" />}
            />
            <Fact
              label={t("detail.contact.phone")}
              value={order.contactPhone ?? "—"}
              icon={<Phone className="size-3" />}
            />
          </dl>
          {order.note ? (
            <div className="mt-4 rounded-sm border border-border bg-muted/40 px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("detail.contact.note")}
              </p>
              <p className="mt-0.5 whitespace-pre-line text-xs text-foreground">
                {order.note}
              </p>
            </div>
          ) : null}
        </AtelierPanel>
      </div>
    </AtelierPageShell>
  );
}

function Fact({
  label,
  value,
  mono,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm text-foreground ${mono ? "font-mono break-all" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
