import type { Metadata } from "next";

import { CartPageView } from "@/features/storefront/components/cart-page-view";
import { getCart, getCartId } from "@/features/storefront/lib/cart-store";

/**
 * `/cart` —— 购物袋详情页
 *
 * ## 服务端渲染购物车
 *
 * 首屏就要有内容 —— 行、金额都在服务端算好传下去。客户端组件只负责「改数量 /
 * 删行」这些交互(见 `components/cart-page-view.tsx`)。
 *
 * ## 读购物车用 `getCart`,不用 `getOrCreateCart`
 *
 * `getOrCreateCart()` 会**写 cookie**(`setCartId`),而写 cookie 在 Server
 * Component 里是非法的(Next.js 只允许在 Route Handler / Server Action 里改
 * cookie)。所以这里只读:cookie 里有 id 就取那张车,没有就当空购物车。
 *
 * 跟 `/checkout` 是同一个道理 —— 两页读的是同一张车,金额口径也共用
 * `lib/cart-totals.ts`,所以「购物袋里的合计」就是「结算页要收的合计」。
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh ? "购物袋 — Mooncoda 梦可达" : "Shopping bag — Mooncoda";
  const description = isZh
    ? "你挑好的作品都在这儿 —— 改数量、删一行、看金额,满意就去结算。"
    : "Everything you picked — change quantities, drop a line, check the total, then check out.";

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

export default async function CartPage() {
  // 只读 cookie —— 见文件头
  const cartId = await getCartId();
  const cart = cartId ? await getCart(cartId) : null;

  return <CartPageView initialCart={cart} />;
}
