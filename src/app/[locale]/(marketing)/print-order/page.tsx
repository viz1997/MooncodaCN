/**
 * `/print-order` —— **打印单**页
 *
 * ## 打印服务不走商城购物袋
 *
 * 工作室的要求:「模型打印是不走商城正常的购物车的,而是走打印下单,即展示
 * 打印列表和下单金额」。所以打印服务有**另一张车**(另一个 cookie
 * `wjp_print_cart_id`、另一种性质 `kind = "print"`),也**另一个页面** ——
 * 商城购物袋(`/cart`)、购物袋抽屉、`/checkout` 里一行打印服务都不会出现。
 *
 * ## 页面摆三样东西
 *
 * 1. **打印列表** —— 每个模型一行(尺寸 / 克重 / 交期 / 单价 / 删一行)
 * 2. **下单金额** —— Σ 每行的报价(**没有运费**:打印服务的价就是报价本身)
 * 3. **提交打印单** —— 一次付款,钱到了才开工单
 *
 * ## 为什么在 `(marketing)` 而不是 `(marketing-atelier)`
 *
 * 打印服务是**官网**那条路(量重量的工具 → 打印单 → 付款),不是商城那条路。
 * 挂在商城那组会带着商城的购物袋抽屉,反而把「打印服务不跟商城混」这件事
 * 搅浑。
 *
 * ## 读打印单用 `getCart`,不用 `getOrCreatePrintCart`
 *
 * `getOrCreatePrintCart()` 会**写 cookie**,而写 cookie 在 Server Component
 * 里是非法的。这里只读:cookie 里有 id 就取那张车,没有就当空打印单。
 */

import type { Metadata } from "next";

import { listUserAddresses } from "@/features/address/queries";
import { PrintOrderView } from "@/features/storefront/components/print-order-view";
import { getCart, getPrintCartId } from "@/features/storefront/lib/cart-store";
import { getServerSession } from "@/lib/auth/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh ? "打印单 — Mooncoda 梦可达" : "Print order — Mooncoda";
  const description = isZh
    ? "你要打印的模型都在这儿 —— 每一件的几何、交期、单价都摆明白,确认金额再提交。"
    : "Every model you want printed — geometry, delivery tier and price for each, then confirm the total and submit.";

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

export default async function PrintOrderPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const session = await getServerSession();
  const userId = session?.user?.id ?? null;

  // 只读 cookie —— 见文件头
  const cartId = await getPrintCartId();
  const cart = cartId ? await getCart(cartId) : null;

  const addresses = userId ? await listUserAddresses(userId) : [];

  // 登录链接带 callbackUrl —— 登录完回到打印单,打印单还在
  const signInUrl = `/sign-in?callbackUrl=${encodeURIComponent(
    `/${locale}/print-order`
  )}`;

  return (
    <PrintOrderView
      initialCart={cart}
      addresses={addresses}
      isLoggedIn={Boolean(userId)}
      signInUrl={signInUrl}
    />
  );
}
