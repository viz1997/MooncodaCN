"use client";

/**
 * 「我的打印订单」—— 列表展示组件
 *
 * 用在 `/account/print-orders` 整页(经 `PrintOrdersView`)。
 *
 * 2026-11-06 报价台(`/quote`)整页删掉之前,这里还挂在报价台底部 ——
 * 报价台没了,这个组件就只剩订单列表页那一个用方了(所以「查看全部」那个
 * 链接也一并删掉:那个页自己就是全部)。
 *
 * ## 只画列表,页面骨架归 `PrintOrdersView`
 *
 * 页面留白、标题、空状态都在 `print-orders-view.tsx` —— 那边知道轮询回来的
 * 订单到底有没有,空状态要占满整页。这里只负责把订单画成行。
 *
 * ## 只读,没有「移除」
 *
 * 2026-11-01 之前这里是浏览器 localStorage 里的一个索引,用户能随手删掉 ——
 * 那时候它只是「本机的一个快捷方式」,删了不影响订单本身(订单在库里)。
 * 现在订单挂在账号名下,是正式的记录,没有「从列表里删掉」这回事。
 *
 * ## 配色走语义 token
 *
 * 商城那套主题里 —— `--card` / `--border` / `--muted-foreground` 都是同一套
 * 变量,用语义 token 一份代码两处都对(控制台 / 商城各有一套色板,靠变量
 * 切换,组件本身不用改)。状态 chip 是例外:它有自己的语义色,统一放在
 * `lib/status-ui.ts`,用户侧和后台共用一份。
 */

import { useFormatter, useTranslations } from "next-intl";

import {
  formatCents,
  formatDims,
  formatGrams,
} from "@/features/print-quote/lib/format";
import type { UserPrintOrder } from "@/features/print-quote/lib/quote-types";
import {
  PRINT_ORDER_PAYMENT_CHIP,
  PRINT_ORDER_STATUS_CHIP,
} from "@/features/print-quote/lib/status-ui";
import { Link } from "@/i18n/routing";

export function PrintOrderList({ orders }: { orders: UserPrintOrder[] }) {
  const t = useTranslations("PrintQuote");
  const format = useFormatter();

  return (
    <ul className="divide-y divide-border border-y border-border">
      {orders.map((order) => (
        <li key={order.orderNo} className="flex flex-wrap gap-4 py-5">
          <div className="flex-1 min-w-0">
            <Link
              href={`/account/print-orders/${order.orderNo}`}
              className="font-serif text-base leading-tight underline-offset-4 hover:underline"
            >
              {order.orderNo}
            </Link>

            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${
                  PRINT_ORDER_STATUS_CHIP[order.status]
                }`}
              >
                {t(`status.${order.status}`)}
              </span>

              {/* 收款状态 —— 用户在列表里最想看到的是这个 */}
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ${
                  PRINT_ORDER_PAYMENT_CHIP[order.paymentStatus]
                }`}
              >
                {t(`payment.status.${order.paymentStatus}`)}
              </span>

              <span className="font-mono text-[11px] text-muted-foreground">
                {formatGrams(order.materialWeightG)}
                {order.supportWeightG !== null
                  ? ` + ${formatGrams(order.supportWeightG)}`
                  : null}
              </span>

              <span className="font-mono text-[11px] text-muted-foreground">
                {formatDims(order.dims)}
              </span>

              <span className="text-[11px] text-muted-foreground">
                {format.dateTime(new Date(order.createdAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
          </div>

          <div className="text-right shrink-0">
            <p className="font-serif text-base">
              {formatCents(order.totalPriceCents)}
            </p>
            <Link
              href={`/account/print-orders/${order.orderNo}`}
              className="mt-1 block text-[11px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              {t("list.viewDetail")}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
