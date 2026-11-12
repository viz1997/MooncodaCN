import { redirect, type routing } from "@/i18n/routing";

/**
 * `/print-order` —— **已下线**,重定向到 `/account/print-orders`
 *
 * ## 2026-11-08:打印服务直接建工单
 *
 * 工作室的说法:**「不要放入购物车,放在这里 account/print-orders」**。
 *
 * 打印服务是**另一条线**,跟商城购物袋彻底分家:
 *
 * ```
 * /tools/workbench(量重量的工具,公开)
 *   → 点「填写下单信息」→ 服务端重算报价 + 建一张打印工单
 *   → /account/print-orders/{orderNo} —— 钱在那儿付(工单自己收款)
 * ```
 *
 * 商城购物袋**只装目录商品**(钥匙扣 / 冰箱贴 / 相框 …)。工单落在
 * `/account/print-orders` 那一个列表里,工单详情页给付款入口。
 *
 * ## 为什么重定向到这儿,而不是 `/tools/workbench`
 *
 * `/print-order` 这个地址的意思是「我的打印单」。用户点它是要看自己的单子,
 * 不是要重新量一个模型 —— 所以送到列表页。列表页的空状态和页头都摆着
 * 「新建打印订单」,点一下才去工作台。
 *
 * ## 为什么留一个重定向而不是 404
 *
 * 老的链接(导航、书签、分享出去的地址、工单邮件里的链接)不该断。重定向比
 * 404 多做一件事:把人送到现在唯一正确的那个页面。
 */
export default async function PrintOrderPage({
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
