import { redirect, type routing } from "@/i18n/routing";

/**
 * `/quote` —— **已下线**,重定向到 `/print-order`
 *
 * ## 2026-11-06:报价台整页删掉
 *
 * 工作室把打印服务的流程收成两步:
 *
 *   /tools/weight(量重量的工具,公开)
 *     → 量好 → 点「加入打印单」
 *     → /print-order(打印列表 + 下单金额 + 收货地址 + 提交)
 *
 * 报价台(`/quote`)那套「上传 → 报价 → 交期 → 加进打印单」跟工具页用的是
 * **同一个**克重计算器,重复了一份下单控件 —— 而工作室要的是「工具页量完直接
 * 加进打印单,金额在打印单上确认」。
 *
 * ## 为什么留一个重定向而不是 404
 *
 * 老的链接(导航、书签、分享出去的地址)不该断。重定向比 404 多做一件事:
 * 把人送到现在唯一正确的那个页面。
 *
 * ## 为什么它在 `(marketing)` 组里
 *
 * 跟 `/print-order` 同一组 —— 打印服务是**官网**那条路,不是商城那条路。
 */
export default async function QuotePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({
    href: "/print-order",
    locale: locale as (typeof routing.locales)[number],
  });
}
