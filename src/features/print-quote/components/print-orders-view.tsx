"use client";

/**
 * 「我的打印订单」整页 —— `/account/print-orders`
 *
 * 2026-11-06 从 `/dashboard/print-orders` 搬过来(工作室要求把买家的东西
 * 放电商首页头像下拉,不放控制台),组件也跟着从 `PrintOrdersDashboardView`
 * 改名为 `PrintOrdersView` —— 它现在挂在商城那套头底下,名字里带
 * "Dashboard" 会让人以为它还归控制台。
 *
 * ## 为什么列表页要有轮询
 *
 * 工作室在后台改状态是**外部**写入的,用户这边不刷新页面就看不到 ——
 * 上一版这是个静态列表,用户得自己手动刷,或者干脆不知道工单动了。
 * 这里接上 `usePrintOrderPolling`,状态一变(≤30s)chip 就跳变。
 *
 * ## 首屏数据由 RSC 给
 *
 * 页面 RSC 已经查过一遍订单(`listUserPrintOrders`)传进来 —— 首屏不用等
 * 轮询那一趟往返,SEO/首屏体验都更好。轮询只是**保持新鲜**。
 */

import { PrintOrderList } from "@/features/print-quote/components/print-order-list";
import { usePrintOrderPolling } from "@/features/print-quote/hooks/use-print-order-polling";
import type { UserPrintOrder } from "@/features/print-quote/lib/quote-types";

export function PrintOrdersView({
  initialOrders,
}: {
  initialOrders: UserPrintOrder[];
}) {
  const { orders, loading } = usePrintOrderPolling(initialOrders);

  return (
    <div className="space-y-6">
      <PrintOrderList
        orders={orders}
        loading={loading && orders.length === 0}
      />
    </div>
  );
}
