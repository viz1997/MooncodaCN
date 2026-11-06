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
 *
 * ## 版式归这一层
 *
 * 空的时候(一张单都没有)整页就是空状态,跟购物袋空的时候一样 —— 所以
 * 「空不空」这件事得由**拿到轮询结果的人**判断,也就是这里。列表组件
 * (`print-order-list.tsx`)只管把有单的时候画成行。
 */

import { PackageSearch } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { PrintOrderList } from "@/features/print-quote/components/print-order-list";
import { usePrintOrderPolling } from "@/features/print-quote/hooks/use-print-order-polling";
import type { UserPrintOrder } from "@/features/print-quote/lib/quote-types";
import {
  AtelierEmptyState,
  AtelierPageHeader,
  AtelierPageShell,
} from "@/features/shared/components/atelier-page";
import { Link } from "@/i18n/routing";

export function PrintOrdersView({
  initialOrders,
}: {
  initialOrders: UserPrintOrder[];
}) {
  const t = useTranslations("PrintQuote");
  const { orders, loading } = usePrintOrderPolling(initialOrders);

  /* ---------------------------------------------------------------------- */
  /*  一张单都没有 —— 整页空状态                                              */
  /* ---------------------------------------------------------------------- */

  if (orders.length === 0) {
    if (loading) {
      return (
        <AtelierPageShell>
          <p className="py-20 text-center text-sm text-muted-foreground">
            {t("list.loading")}
          </p>
        </AtelierPageShell>
      );
    }

    return (
      <AtelierEmptyState
        icon={PackageSearch}
        title={t("list.empty")}
        description={t("list.emptyHint")}
        action={
          <Button asChild className="rounded-full px-7">
            <Link href="/tools/weight">{t("list.emptyCta")}</Link>
          </Button>
        }
      />
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  有单                                                                    */
  /* ---------------------------------------------------------------------- */

  return (
    <AtelierPageShell>
      <AtelierPageHeader
        title={t("list.title")}
        description={t("list.count", { count: orders.length })}
        action={
          <Button asChild variant="ghost" size="sm" className="rounded-full">
            <Link href="/print-order">{t("list.newOrder")}</Link>
          </Button>
        }
      />

      <PrintOrderList orders={orders} />
    </AtelierPageShell>
  );
}
