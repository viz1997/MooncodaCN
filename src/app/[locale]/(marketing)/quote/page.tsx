import { redirect, type routing } from "@/i18n/routing";

/**
 * `/quote` —— **已下线**,重定向到 `/cart`
 *
 * ## 2026-11-06:报价台整页删掉
 *
 * 工作室把打印服务的流程收成两步:
 *
 *   /tools/workbench(量重量的工具,公开)
 *     → 量好 → 点「加入购物袋」
 *     → /cart(商城购物袋:打印服务那一行 + 目录商品 + 一次付款)
 *
 * 报价台(`/quote`)那套「上传 → 报价 → 交期 → 加进打印单」跟工具页用的是
 * **同一个**克重计算器,重复了一份下单控件 —— 而工作室要的是「工具页量完直接
 * 加进购物袋,金额在购物袋上确认」。
 *
 * ## 2026-11-08:目标页从 `/print-order` 换成 `/cart`
 *
 * 打印服务并进商城购物袋(工作室的说法:「不要 print-order,进入商城那个」),
 * 所以这里直接把人送到 `/cart`。
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
    href: "/cart",
    locale: locale as (typeof routing.locales)[number],
  });
}
