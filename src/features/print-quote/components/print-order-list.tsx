"use client";

/**
 * 「我的打印订单」—— 列表展示组件
 *
 * 两处共用:
 *  - 报价台 `/quote` 底部(下单成功后新单会插到最上面)
 *  - dashboard `/dashboard/print-orders` 整页(经 `PrintOrdersDashboardView`)
 *
 * ## 只读,没有「移除」
 *
 * 2026-11-01 之前这里是浏览器 localStorage 里的一个索引,用户能随手删掉 ——
 * 那时候它只是「本机的一个快捷方式」,删了不影响订单本身(订单在库里)。
 * 现在订单挂在账号名下,是正式的记录,没有「从列表里删掉」这回事。
 *
 * ## 配色走语义 token
 *
 * 报价台在 marketing 布局(暖色 stone 底),dashboard 在 shadcn 主题里 ——
 * 两边的 `--card` / `--border` / `--muted-foreground` 都是同一套暖灰,
 * 用语义 token 一份代码两处都对。状态 chip 是例外:它有自己的语义色,
 * 统一放在 `lib/status-ui.ts`,用户侧和后台共用一份。
 */

import { PackageSearch } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import {
  formatCents,
  formatDims,
  formatGrams,
} from "@/features/print-quote/lib/format";
import type { UserPrintOrder } from "@/features/print-quote/lib/quote-types";
import { PRINT_ORDER_STATUS_CHIP } from "@/features/print-quote/lib/status-ui";
import { Link } from "@/i18n/routing";

export function PrintOrderList({
  orders,
  showAllLink = true,
  loading = false,
}: {
  orders: UserPrintOrder[];
  /** 报价台里显示「查看全部」;dashboard 页自己就是全部,不显示 */
  showAllLink?: boolean;
  /** 首屏还在拉 —— 别急着显示「还没有下单记录」 */
  loading?: boolean;
}) {
  const t = useTranslations("PrintQuote");
  const format = useFormatter();

  if (orders.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <PackageSearch className="size-4 text-muted-foreground" />
          {t("list.title")}
        </h3>
        <p className="mt-3 text-xs text-muted-foreground">
          {loading ? t("list.loading") : t("list.empty")}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <PackageSearch className="size-4 text-muted-foreground" />
          {t("list.title")}
        </h3>
        {showAllLink && (
          <Link
            href="/dashboard/print-orders"
            className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {t("list.viewAll")}
          </Link>
        )}
      </div>

      <ul className="divide-y divide-border">
        {orders.map((order) => (
          <li
            key={order.orderNo}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
          >
            <Link
              href={`/dashboard/print-orders/${order.orderNo}`}
              className="font-mono text-xs font-medium text-foreground underline-offset-4 hover:underline"
            >
              {order.orderNo}
            </Link>

            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${
                PRINT_ORDER_STATUS_CHIP[order.status]
              }`}
            >
              {t(`status.${order.status}`)}
            </span>

            <span className="font-mono text-xs text-muted-foreground">
              {formatGrams(order.materialWeightG)}
              {order.supportWeightG !== null
                ? ` + ${formatGrams(order.supportWeightG)}`
                : null}
            </span>

            <span className="font-mono text-xs text-muted-foreground">
              {formatDims(order.dims)}
            </span>

            <span className="font-mono text-xs font-medium text-foreground">
              {formatCents(order.totalPriceCents)}
            </span>

            <span className="text-[11px] text-muted-foreground">
              {format.dateTime(new Date(order.createdAt), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>

            <Link
              href={`/dashboard/print-orders/${order.orderNo}`}
              className="ml-auto text-[11px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {t("list.viewDetail")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
