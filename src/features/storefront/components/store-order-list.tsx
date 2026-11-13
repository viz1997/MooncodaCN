/**
 * StoreOrderList —— 「我的商城订单」
 *
 * ## 为什么它不在商城主体里
 *
 * 商城主体是匿名的(逛 → 加购 → 结算要登录),订单却**必须**挂在账号名下 ——
 * 支付平台按 email upsert customer,订单归属账号才查得回来。所以订单列表
 * 是**登录后**才有的页面,挂在 `/account/orders`
 * (2026-11-06 从 `/dashboard/store-orders` 搬过来 —— 工作室要求把买家的
 * 东西放电商首页右上角头像下拉,不放控制台)。
 *
 * ## 版式跟商城一致
 *
 * 这一页是从电商首页头像点进来的,长相要跟 `/cart` 一家:页面留白、衬线
 * 大标题、分隔线列表、空状态。版式走 `features/shared/components/atelier-page.tsx`
 * 那一份共享骨架,别再各写一遍。
 *
 * ## 「去支付」要能重取入口
 *
 * 未支付的订单给一个「去支付」按钮 —— 入口过期了(支付平台那边会换新的)
 * 或者结算时压根没生成入口(建单失败),都能在这里重新拿到。
 *
 * 付款逻辑在 `useStoreOrderPayment` 里 —— **详情页共用同一份**(2026-11-13)。
 * 逻辑在 hook、版式在各自组件:这一页的二维码是**整行下方展开**(满宽),
 * 详情页的是**居中一块**。
 *
 * ## 「查看详情」的入口
 *
 * 整行不做 `Link` —— 行里本来就有「去支付」按钮,整行变链接会让按钮的点击
 * 语义变糊(而且嵌套交互元素在 a11y 上是错的)。给一个明确的「查看详情」链接。
 */

"use client";

import { Loader2, ShoppingBag } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PaymentQrCode } from "@/features/payments/components/payment-qr";
import {
  AtelierEmptyState,
  AtelierPageHeader,
  AtelierPageShell,
} from "@/features/shared/components/atelier-page";
import { useStoreOrderPayment } from "@/features/storefront/hooks/use-store-order-payment";
import {
  STORE_ORDER_PAYMENT_CHIP,
  STORE_ORDER_STATUS_CHIP,
} from "@/features/storefront/lib/order-status-ui";
import { Link } from "@/i18n/routing";
import { formatCents } from "@/lib/money";

/** 列表里的一行(可序列化的形状) */
export interface StoreOrderListItem {
  orderNo: string;
  /** 订单状态 —— 单子走到哪一步了 */
  status: "unpaid" | "paid" | "fulfilled" | "cancelled";
  /** 支付状态 —— 钱怎么样了 */
  paymentStatus: "unpaid" | "paid" | "refunded" | "failed";
  totalCents: number;
  createdAt: string;
  itemCount: number;
  /** 商品名(最多展示两个) */
  titles: string[];
  thumbnail: string | null;
  /** 走的哪条收款通道 —— null = 还没开始收款 */
  paymentChannel?: string | null;
}

/**
 * 显示哪个标签 —— **支付状态优先**
 *
 * 一单退了款,订单状态还是「已支付」(单子还在),但用户要看到的是「已退款」。
 * 反过来一单支付失败了,订单状态是「未支付」,但文案该说「支付失败」。
 *
 * 返回的是**完整的 i18n 键**(`status.paid` / `paymentStatus.refunded`)——
 * 两套状态是两套文案,只回一个裸值的话,调用方分不清该去哪个命名空间里找。
 *
 * 徽章的配色跟详情页共用一份(`order-status-ui.ts`) —— 两处各写一套颜色,
 * 改一次颜色只改一处,两个页面就长得不一样了。
 */
function resolveOrderChip(order: StoreOrderListItem): {
  key: string;
  className: string;
} {
  if (order.paymentStatus !== "paid") {
    return {
      key: `paymentStatus.${order.paymentStatus}`,
      className: STORE_ORDER_PAYMENT_CHIP[order.paymentStatus],
    };
  }
  return {
    key: `status.${order.status}`,
    className: STORE_ORDER_STATUS_CHIP[order.status],
  };
}

export function StoreOrderList({ orders }: { orders: StoreOrderListItem[] }) {
  const t = useTranslations("StorefrontOrder");

  if (orders.length === 0) {
    return (
      <AtelierEmptyState
        icon={ShoppingBag}
        title={t("list.emptyTitle")}
        description={t("list.emptyDescription")}
        action={
          <Button asChild className="rounded-full px-7">
            <Link href="/">{t("list.emptyAction")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <AtelierPageShell>
      <AtelierPageHeader
        title={t("list.title")}
        description={t("list.description")}
        action={
          <Button asChild variant="ghost" size="sm" className="rounded-full">
            <Link href="/">{t("list.browse")}</Link>
          </Button>
        }
      />

      <ul className="divide-y divide-border border-y border-border">
        {orders.map((order) => (
          <OrderRow key={order.orderNo} order={order} />
        ))}
      </ul>
    </AtelierPageShell>
  );
}

function OrderRow({ order }: { order: StoreOrderListItem }) {
  const t = useTranslations("StorefrontOrder");
  const chip = resolveOrderChip(order);
  const payment = useStoreOrderPayment(order.orderNo);

  const payable = order.paymentStatus === "unpaid" && order.status === "unpaid";

  return (
    <li className="flex flex-wrap gap-4 py-6">
      {order.thumbnail ? (
        <img
          src={order.thumbnail}
          alt=""
          className="size-28 object-cover rounded-sm bg-muted shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="size-28 rounded-sm bg-muted shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-serif text-base leading-tight">
              {order.titles.join(" · ") || order.orderNo}
              {order.itemCount > order.titles.length ? t("list.more") : ""}
            </p>
            <div className="mt-1 space-y-0.5">
              <p className="text-[11px] text-muted-foreground">
                {order.orderNo} ·{" "}
                {t("list.itemsCount", { count: order.itemCount })}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(order.createdAt).toLocaleString("zh-CN")}
              </p>
            </div>
          </div>

          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${chip.className}`}
          >
            {t(chip.key)}
          </span>
        </div>

        {payment.error ? (
          <p className="mt-2 text-xs text-destructive">{payment.error}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <p className="font-serif text-xl">{formatCents(order.totalCents)}</p>

          <div className="flex items-center gap-2">
            {/* 详情入口 —— 物流 / 收货地址 / 金额明细都在那一页 */}
            <Button asChild size="sm" variant="ghost" className="rounded-full">
              <Link href={`/account/orders/${order.orderNo}`}>
                {t("list.viewDetail")}
              </Link>
            </Button>

            {payable ? (
              <Button
                size="sm"
                className="rounded-full"
                onClick={() => void payment.startPayment()}
                disabled={payment.isLoading}
                type="button"
              >
                {payment.isLoading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                {t("pay.action")}
              </Button>
            ) : null}
          </div>
        </div>

        {payment.paymentUrl ? (
          <a
            href={payment.paymentUrl}
            className="mt-2 block text-xs underline text-muted-foreground"
          >
            {t("pay.openLink")}
          </a>
        ) : null}
      </div>

      {/* 微信扫码 —— 整行下方展开,画完码用户扫就行 */}
      {payment.qrCodeUrl ? (
        <div className="w-full shrink-0 border-t border-border pt-4 flex flex-col items-center">
          <p className="font-serif text-base mb-3">{t("pay.qrTitle")}</p>
          <PaymentQrCode
            value={payment.qrCodeUrl}
            size={200}
            hint={t("pay.qrHint")}
          />
        </div>
      ) : null}
    </li>
  );
}
