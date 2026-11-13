"use client";

/**
 * 商城订单详情页 —— `/account/orders/[orderNo]`
 *
 * ## 这一页要回答四个问题
 *
 *   1. 买了什么?   → 商品明细(标题 / 数量 / 折后单价)
 *   2. 寄到哪儿了? → 收货地址快照
 *   3. 怎么寄的?   → 物流(快递公司 + 运单号)
 *   4. 付了多少?   → 金额明细
 *
 * ## 为什么这一页是**新建**的
 *
 * 商城订单的买家侧以前**只有列表**(`/account/orders`),没有详情页 ——
 * 收货地址快照落了库、买家侧一次都没渲染过,物流更是无处可摆。
 * 工作室要在后台填运单号,买家总得有个地方看得到。
 *
 * ## 状态和物流是轮询来的
 *
 * 工作室在后台发货台填单号是**外部写入** —— 这一页不轮询的话,用户盯着
 * 「还没发货」看到手动刷新为止。`useStoreOrderPolling` 30s 一轮。
 *
 * ## 收货地址和物流**共用打印工单那一套**
 *
 * `ShipmentPanel` / `ShippingAddressPanel` 是 `features/shipment/components/`
 * 里的两个组件 —— 两处显示的东西一模一样,写两份迟早漂。
 */

import { ArrowLeft, Box, Receipt, Wallet } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PaymentQrCode } from "@/features/payments/components/payment-qr";
import {
  AtelierPageShell,
  AtelierPanel,
  AtelierSectionTitle,
} from "@/features/shared/components/atelier-page";
import {
  ShipmentPanel,
  ShippingAddressPanel,
} from "@/features/shipment/components/shipment-panel";
import type { ShipmentView } from "@/features/shipment/lib/types";
import { useStoreOrderPayment } from "@/features/storefront/hooks/use-store-order-payment";
import { useStoreOrderPolling } from "@/features/storefront/hooks/use-store-order-polling";
import type {
  StoreOrderDetailItem,
  StoreOrderDetailOrder,
} from "@/features/storefront/lib/order-detail-types";
import {
  STORE_ORDER_PAYMENT_CHIP,
  STORE_ORDER_STATUS_CHIP,
} from "@/features/storefront/lib/order-status-ui";
import { Link } from "@/i18n/routing";
import { formatCents } from "@/lib/money";

export function StoreOrderDetailView({
  order: initialOrder,
  items,
  shipments: initialShipments,
}: {
  order: StoreOrderDetailOrder;
  items: StoreOrderDetailItem[];
  /** 物流 —— 一个订单可能有多个包裹(补发 / 分开发) */
  shipments: ShipmentView[];
}) {
  const t = useTranslations("StorefrontOrder");
  const format = useFormatter();

  const { shipments, snapshot, refresh } = useStoreOrderPolling(
    initialOrder.orderNo,
    {
      shipments: initialShipments,
      snapshot: {
        status: initialOrder.status,
        paymentStatus: initialOrder.paymentStatus,
        paymentUrl: initialOrder.paymentUrl,
        paymentQrCodeUrl: initialOrder.paymentQrCodeUrl,
      },
    }
  );

  const payment = useStoreOrderPayment(initialOrder.orderNo);

  /**
   * 付款入口 —— 未付的单在这儿付
   *
   * 已付的单不摆(按钮点了会被服务端挡回来,还给用户一句「已经付过了」)。
   */
  const payable =
    snapshot.paymentStatus === "unpaid" && snapshot.status === "unpaid";

  return (
    <AtelierPageShell>
      <Link
        href="/account/orders"
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
            {initialOrder.orderNo}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${
                STORE_ORDER_STATUS_CHIP[snapshot.status]
              }`}
            >
              {t(`status.${snapshot.status}`)}
            </span>
            {/* 收款状态 —— 跟订单状态是两回事,用户最关心的是这个 */}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${
                STORE_ORDER_PAYMENT_CHIP[snapshot.paymentStatus]
              }`}
            >
              {t(`paymentStatus.${snapshot.paymentStatus}`)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t("detail.placedAt")}:{" "}
              {format.dateTime(new Date(initialOrder.createdAt), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            {initialOrder.paidAt ? (
              <span className="text-[11px] text-muted-foreground">
                {t("detail.paidAt")}:{" "}
                {format.dateTime(new Date(initialOrder.paidAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            ) : null}
          </div>
        </div>

        {payable ? (
          <div className="flex flex-col items-end gap-1.5">
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => void payment.startPayment()}
              disabled={payment.isLoading}
              type="button"
            >
              {t("pay.action")}
            </Button>
            {payment.error ? (
              <p className="max-w-[16rem] text-right text-[11px] text-destructive">
                {payment.error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-6">
        {/* 商品明细 */}
        <AtelierPanel>
          <AtelierSectionTitle icon={Box}>
            {t("detail.items")}
          </AtelierSectionTitle>
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-4 py-3 first:pt-0 last:pb-0"
              >
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt=""
                    className="size-16 object-cover rounded-sm bg-muted shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="size-16 rounded-sm bg-muted shrink-0" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{item.title}</p>
                  {item.sku ? (
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground break-all">
                      {item.sku}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatCents(item.discountedUnitPriceCents)} ×{" "}
                    {item.quantity}
                  </p>
                </div>

                <p className="font-serif text-base shrink-0">
                  {formatCents(item.lineTotalCents)}
                </p>
              </li>
            ))}
          </ul>
        </AtelierPanel>

        {/* 收货地址 —— 快照,落库了但以前买家侧一次都没渲染过 */}
        <ShippingAddressPanel address={initialOrder.shippingAddress} />

        {/* 物流 —— 工作室在后台填的快递公司 + 运单号 */}
        <ShipmentPanel shipments={shipments} />

        {/* 金额 */}
        <AtelierPanel>
          <AtelierSectionTitle icon={Wallet}>
            {t("detail.amount")}
          </AtelierSectionTitle>
          <dl className="space-y-2 text-sm">
            <AmountRow
              label={t("detail.subtotal")}
              value={formatCents(initialOrder.subtotalCents)}
            />
            {initialOrder.discountCents > 0 ? (
              <AmountRow
                label={t("detail.discount")}
                value={`− ${formatCents(initialOrder.discountCents)}`}
              />
            ) : null}
            {initialOrder.couponDiscountCents > 0 ? (
              <AmountRow
                label={
                  initialOrder.couponCode
                    ? `${t("detail.coupon")} (${initialOrder.couponCode})`
                    : t("detail.coupon")
                }
                value={`− ${formatCents(initialOrder.couponDiscountCents)}`}
              />
            ) : null}
            <AmountRow
              label={t("detail.shipping")}
              value={formatCents(initialOrder.shippingCents)}
            />
            <div className="border-t border-border pt-2 mt-3 flex items-center justify-between">
              <dt className="text-sm text-muted-foreground">
                {t("detail.total")}
              </dt>
              <dd className="font-serif text-xl">
                {formatCents(initialOrder.totalCents)}
              </dd>
            </div>
          </dl>
        </AtelierPanel>

        {/* 买家留言 */}
        {initialOrder.note ? (
          <AtelierPanel>
            <AtelierSectionTitle icon={Receipt}>
              {t("detail.note")}
            </AtelierSectionTitle>
            <p className="whitespace-pre-line text-xs text-foreground">
              {initialOrder.note}
            </p>
          </AtelierPanel>
        ) : null}
      </div>

      {/* 微信扫码 —— 留在原地画码 */}
      {payment.qrCodeUrl ? (
        <div className="mt-6 flex flex-col items-center rounded-sm border border-border p-6">
          <p className="font-serif text-base mb-3">{t("pay.qrTitle")}</p>
          <PaymentQrCode
            value={payment.qrCodeUrl}
            size={200}
            hint={t("pay.qrHint")}
          />
        </div>
      ) : null}

      {payment.paymentUrl ? (
        <a
          href={payment.paymentUrl}
          className="mt-4 inline-block text-xs underline text-muted-foreground"
        >
          {t("pay.openLink")}
        </a>
      ) : null}

      {/* 手动刷新 —— 轮询是 30s 一轮,用户想立刻看到可以点这个 */}
      <div className="mt-8 flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full"
          type="button"
          onClick={() => void refresh()}
        >
          {t("detail.refresh")}
        </Button>
      </div>
    </AtelierPageShell>
  );
}

function AmountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
