import { redirect, type routing } from "@/i18n/routing";

/**
 * `/dashboard/print-orders/[orderNo]` —— **旧地址**,已搬到
 * `/account/print-orders/[orderNo]`
 *
 * 2026-11-06:工作室要求把「打印订单 / 购物订单 / 地址管理」从控制台搬到
 * 电商首页头像下拉里(理由见 `/account/orders/page.tsx` 的文件头)。
 *
 * ## 为什么留一个重定向而不是 404
 *
 * 老的链接不该断 —— **工单邮件里带着带订单号的地址**
 * (`features/print-quote/lib/notifications.tsx` 拼的),还有用户收藏的
 * 书签、分享出去的地址。重定向比 404 多做一件事:把人送到现在唯一正确的
 * 那个页面。
 *
 * 订单号要转义 —— 它是 URL 路径里的一段,原样拼过去会被当成路径分隔符。
 */
export default async function LegacyPrintOrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; orderNo: string }>;
}) {
  const { locale, orderNo } = await params;
  redirect({
    href: `/account/print-orders/${encodeURIComponent(orderNo)}`,
    locale: locale as (typeof routing.locales)[number],
  });
}
