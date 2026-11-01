"use client";

/**
 * 「我的打印订单」—— 列表展示组件
 *
 * 两处共用:
 *  - 报价台 `/quote` 底部(下单成功后新单会插到最上面)
 *  - dashboard `/dashboard/print-orders` 整页
 *
 * ## 只读,没有「移除」
 *
 * 2026-11-01 之前这里是浏览器 localStorage 里的一个索引,用户能随手删掉 ——
 * 那时候它只是「本机的一个快捷方式」,删了不影响订单本身(订单在库里)。
 * 现在订单挂在账号名下,是正式的记录,没有「从列表里删掉」这回事。
 *
 * 数据每次都是现查的:报价台那部分由页面 RSC 查好传进来,dashboard 页
 * 由页面自己查。这里不缓存报价明细,免得改了尺寸之后本地还显示着旧价。
 */

import { PackageSearch } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  formatCents,
  formatDims,
  formatGrams,
} from "@/features/print-quote/lib/format";
import type {
  PrintOrderStatus,
  UserPrintOrder,
} from "@/features/print-quote/lib/quote-types";
import { Link } from "@/i18n/routing";

/** 状态标签样式 —— 文案走 i18n(`PrintQuote.status.*`) */
const STATUS_CHIP: Record<PrintOrderStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-amber-600/20",
  CONFIRMED: "bg-sky-50 text-sky-700 ring-sky-600/20",
  IN_PRODUCTION: "bg-violet-50 text-violet-700 ring-violet-600/20",
  SHIPPED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CANCELLED: "bg-stone-100 text-stone-500 ring-stone-500/20",
};

export function PrintOrderList({
  orders,
  showAllLink = true,
}: {
  orders: UserPrintOrder[];
  /** 报价台里显示「查看全部」;dashboard 页自己就是全部,不显示 */
  showAllLink?: boolean;
}) {
  const t = useTranslations("PrintQuote");

  if (orders.length === 0) {
    return (
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
          <PackageSearch className="size-4 text-stone-400" />
          {t("list.title")}
        </h3>
        <p className="mt-3 text-xs text-stone-400">{t("list.empty")}</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
          <PackageSearch className="size-4 text-stone-400" />
          {t("list.title")}
        </h3>
        {showAllLink && (
          <Link
            href="/dashboard/print-orders"
            className="text-xs text-stone-500 underline-offset-4 transition-colors hover:text-stone-900 hover:underline"
          >
            {t("list.viewAll")}
          </Link>
        )}
      </div>

      <ul className="divide-y divide-stone-100">
        {orders.map((order) => (
          <li
            key={order.orderNo}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
          >
            <span className="font-mono text-xs font-medium text-stone-800">
              {order.orderNo}
            </span>

            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${
                STATUS_CHIP[order.status]
              }`}
            >
              {t(`status.${order.status}`)}
            </span>

            <span className="font-mono text-xs text-stone-600">
              {formatGrams(order.materialWeightG)}
              {order.supportWeightG !== null
                ? ` + ${formatGrams(order.supportWeightG)}`
                : null}
            </span>

            <span className="font-mono text-xs text-stone-500">
              {formatDims(order.dims)}
            </span>

            <span className="font-mono text-xs font-medium text-stone-800">
              {formatCents(order.totalPriceCents)}
            </span>

            <span className="text-[11px] text-stone-400">
              {new Date(order.createdAt).toLocaleDateString("zh-CN")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
