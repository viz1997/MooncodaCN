import { redirect, type routing } from "@/i18n/routing";

/**
 * `/dashboard/print-orders` —— **旧地址**,已搬到 `/account/print-orders`
 *
 * 2026-11-06:工作室要求把「打印订单 / 购物订单 / 地址管理」从控制台搬到
 * 电商首页头像下拉里(理由见 `/account/orders/page.tsx` 的文件头)。
 *
 * ## 为什么留一个重定向而不是 404
 *
 * 老的链接不该断 —— **工单确认邮件里就带着这个地址**
 * (`features/print-quote/lib/notifications.tsx` 拼的),还有用户收藏的
 * 书签、分享出去的地址。重定向比 404 多做一件事:把人送到现在唯一正确的
 * 那个页面。
 */
export default async function LegacyPrintOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({
    href: "/account/print-orders",
    locale: locale as (typeof routing.locales)[number],
  });
}
