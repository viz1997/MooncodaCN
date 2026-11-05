/**
 * `/checkout` —— 商城结算页
 *
 * ## 服务端渲染购物车和地址
 *
 * 页面首屏就要有内容 —— 购物车行、地址列表、金额都在服务端算好传下去。
 * 客户端组件只负责「选地址 / 填新地址 / 点去支付」这些交互。
 *
 * ## 读购物车用 `getCart`,不用 `getOrCreateCart`
 *
 * `getOrCreateCart()` 会**写 cookie**(`setCartId`),而写 cookie 在 Server
 * Component 里是非法的(Next.js 只允许在 Route Handler / Server Action 里改
 * cookie)。所以这里只读:cookie 里有 id 就取那张车,没有就当空购物车。
 *
 * ## 未登录不跳走,给个提示
 *
 * 未登录时页面显示「结算需要先登录」+ 登录链接 —— 而不是 307 跳走。
 * 购物车还在 cookie 里,登录后回来接着结,不丢东西。
 */

import { listUserAddresses } from "@/features/address/queries";
import { CheckoutView } from "@/features/storefront/components/checkout-view";
import { getCart, getCartId } from "@/features/storefront/lib/cart-store";
import { getServerSession } from "@/lib/auth/server";

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const session = await getServerSession();
  const userId = session?.user?.id ?? null;

  // 只读 cookie —— 见文件头
  const cartId = await getCartId();
  const cart = cartId ? await getCart(cartId) : null;

  const addresses = userId ? await listUserAddresses(userId) : [];

  // 登录链接带 callbackUrl —— 登录完回到结算页,购物车还在
  const signInUrl = `/sign-in?callbackUrl=${encodeURIComponent(
    `/${locale}/checkout`
  )}`;

  return (
    <CheckoutView
      cart={cart}
      addresses={addresses}
      isLoggedIn={Boolean(userId)}
      signInUrl={signInUrl}
    />
  );
}
