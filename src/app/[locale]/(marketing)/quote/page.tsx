import { redirect, type routing } from "@/i18n/routing";

/**
 * `/quote` —— **已下线**,重定向到 `/tools/workbench`
 *
 * ## 2026-11-06:报价台整页删掉
 *
 * 工作室把打印服务的流程收成两步:
 *
 *   /tools/workbench(量重量的工具,公开)
 *     → 量好 → 点「填写下单信息」
 *     → 服务端重算报价 + 建一张打印工单 → /account/print-orders/{orderNo}
 *
 * 报价台(`/quote`)那套「上传 → 报价 → 交期 → 加进打印单」跟工具页用的是
 * **同一个**克重计算器,重复了一份下单控件 —— 而工作室要的是「工具页量完直接
 * 下单」。
 *
 * ## 2026-11-08:打印服务直接建工单
 *
 * 工作室的说法:**「不要放入购物车,放在这里 account/print-orders」**。
 *
 * 打印服务跟商城购物袋彻底分家 —— 商城购物袋只装目录商品,打印服务是独立
 * 工单(自己建、自己收款)。所以这里把人送到**量重量的工具页** —— 这一步是
 * 下单的入口,交期和金额在工单上确认。
 *
 * ## 为什么留一个重定向而不是 404
 *
 * 老的链接(导航、书签、分享出去的地址)不该断。重定向比 404 多做一件事:
 * 把人送到现在唯一正确的那个页面。
 */
export default async function QuotePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({
    href: "/tools/workbench",
    locale: locale as (typeof routing.locales)[number],
  });
}
