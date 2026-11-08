import { redirect, type routing } from "@/i18n/routing";

/**
 * `/print-order` —— **已下线**,重定向到 `/cart`
 *
 * ## 2026-11-08:打印单并进商城购物袋
 *
 * 工作室的说法:**「不要 print-order,进入商城那个」**。
 *
 * 2026-11-06 到 2026-11-08 之间,打印服务走的是**自己的**打印单:另一张车
 * (另一个 cookie `wjp_print_cart_id`、另一种性质 `kind = "print"`)、另一个
 * 页面(`/print-order`)、另一个加购接口(`/api/store/print-carts/**`)。
 *
 * 现在**只有一张车**了 —— 打印服务跟目录商品装同一个购物袋,同一个 `/cart`
 * 页面、同一个抽屉、同一个 `/checkout`,一次付款。服务端在结算的同一个
 * 事务里落一张商城订单 + N 张打印工单(见 `storefront/lib/checkout.ts`)。
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
    href: "/cart",
    locale: locale as (typeof routing.locales)[number],
  });
}
