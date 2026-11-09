/**
 * CheckoutView —— 商城结算页
 *
 * ## 金额**不在这里算**
 *
 * 页面显示的每一个数都是服务端算好传进来的(`cart.items[].discountedUnitPriceCents`
 * 那一列)。客户端不重算 —— 客户端算的数只配用来显示,收多少钱由
 * `POST /api/store/checkout` 在服务端重算一遍决定。
 *
 * ## 这一页**只有目录商品**(2026-11-08)
 *
 * 工作室的说法:「不要放入购物车,放在这里 account/print-orders」。打印服务
 * 是另一条线 —— 工单自己建、自己收款(见 `POST /api/print-orders`)。
 *
 * 所以这一页上每一行都是目录商品:缩略图 + 规格 + 数量。
 *
 * ## 收货地址和付款是**共用**的两块
 *
 * - 地址 → `<AddressSection>`
 * - 付款 → `<CheckoutPaymentPanel>`
 *
 * 抽出来是因为两处的「默认地址」逻辑和「扫码 → 轮询 → 钱到了」逻辑一旦
 * 各写一遍,漂移了没人发现。
 *
 * ## 三种付款方式,两种表现
 *
 * | 通道 | 付款方式 |
 * |---|---|
 * | 微信支付 | **扫码** —— 页面留在原地,画一个二维码给用户扫 |
 * | 支付宝 / Shopify | **跳转** —— 整页跳到支付平台 |
 */

"use client";

import { Zap } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { AddressSection } from "@/features/address/components/address-section";
import type { AddressView } from "@/features/address/types";
import { Link } from "@/i18n/routing";
import { formatCents } from "@/lib/money";

import { useCart } from "../hooks/use-cart";
import { computeCartTotals } from "../lib/cart-totals";
import { findAccessoryVariant } from "../lib/mock-catalog";
import { formatSizeWithInches } from "../lib/size-format";
import type { Cart, CartLineItem } from "../types";
import { CheckoutPaymentPanel } from "./checkout-payment-panel";
import { CouponField } from "./coupon-field";

export function CheckoutView({
  cart,
  addresses,
  isLoggedIn,
  signInUrl,
}: {
  cart: Cart | null;
  addresses: AddressView[];
  isLoggedIn: boolean;
  /** 登录链接(带 callbackUrl) */
  signInUrl: string;
}) {
  const {
    cart: cachedCart,
    items: cachedItems,
    coupon: cachedCoupon,
  } = useCart();

  /**
   * 行和优惠 —— **缓存优先,服务端那份兜底**
   *
   * 服务端渲染的那份(`cart` prop)是首屏;缓存回来之后换成缓存里的 ——
   * 用户在**这一页**输了优惠码,缓存里的券立刻生效,页面上的合计跟着变。
   *
   * 跟购物袋详情页是同一套口径(见 `cart-page-view.tsx`)。
   */
  const items = cachedCart ? cachedItems : (cart?.items ?? []);
  const coupon = cachedCart ? cachedCoupon : (cart?.coupon ?? null);

  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? null
  );
  const [note, setNote] = useState("");

  // 金额 —— 全部来自服务端算好的数;口径跟购物袋详情页共用一份
  // (见 `lib/cart-totals.ts` —— 两页显示的合计必须是同一个数)
  const totals = useMemo(
    () => computeCartTotals(items, coupon),
    [items, coupon]
  );

  /* ---------------------------------------------------------------------- */
  /*  空购物车                                                                */
  /* ---------------------------------------------------------------------- */

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h1 className="font-serif text-3xl mb-3">购物袋是空的</h1>
        <p className="text-sm text-muted-foreground mb-8">
          还没有要结算的作品 —— 去挑一个吧。
        </p>
        <Button asChild className="rounded-full px-7">
          <Link href="/products">浏览作品</Link>
        </Button>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  未登录                                                                  */
  /* ---------------------------------------------------------------------- */

  if (!isLoggedIn) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h1 className="font-serif text-3xl mb-3">结算需要先登录</h1>
        <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
          订单要挂在你的账号名下,登录后购物袋里的东西还在,可以直接继续。
        </p>
        <Button asChild className="rounded-full px-7">
          <Link href={signInUrl}>去登录</Link>
        </Button>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  结算                                                                    */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex items-center justify-between gap-4 mb-8">
        <h1 className="font-serif text-3xl">结算</h1>
        {/* 改数量 / 删一行回购物袋去改 —— 结算页上不给改,免得跟付款入口混在一起 */}
        <Button asChild variant="ghost" size="sm" className="rounded-full">
          <Link href="/cart">返回购物袋</Link>
        </Button>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-8 lg:gap-12 items-start">
        {/* 左栏:商品 + 地址 */}
        <div className="space-y-10">
          {/* 商品行 */}
          <section>
            <h2 className="eyebrow text-muted-foreground mb-4">商品</h2>
            <ul className="divide-y divide-border border-y border-border">
              {items.map((item) => (
                <CheckoutLineItem key={item.id} item={item} />
              ))}
            </ul>
          </section>

          {/* 收货地址 */}
          <section>
            <h2 className="eyebrow text-muted-foreground mb-4">收货地址</h2>
            <AddressSection
              addresses={addresses}
              value={selectedAddressId}
              onChange={setSelectedAddressId}
            />
          </section>

          {/* 留言 */}
          <section>
            <h2 className="eyebrow text-muted-foreground mb-4">留言(选填)</h2>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="给工作室的说明,比如收货时间偏好"
              className="w-full px-3 py-2 border border-border rounded-sm bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </section>
        </div>

        {/* 右栏:金额 + 去支付 */}
        <aside className="lg:sticky lg:top-6 border border-border rounded-sm p-6 bg-card">
          <h2 className="eyebrow text-muted-foreground mb-4">订单金额</h2>

          {/* 优惠码 —— 跟购物袋 / 抽屉共用一份 */}
          <div className="mb-5">
            <CouponField />
          </div>

          <dl className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">小计</dt>
              <dd className="font-medium">
                {formatCents(totals.subtotalCents)}
              </dd>
            </div>
            {totals.discountCents > 0 && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">数量折扣</dt>
                <dd className="font-medium text-accent">
                  -{formatCents(totals.discountCents)}
                </dd>
              </div>
            )}
            {totals.couponDiscountCents > 0 && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">优惠</dt>
                <dd className="font-medium text-accent">
                  -{formatCents(totals.couponDiscountCents)}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">运费</dt>
              <dd className="font-medium">
                {totals.shippingCents === 0
                  ? "免运费"
                  : formatCents(totals.shippingCents)}
              </dd>
            </div>
            <div className="border-t pt-3 mt-3 flex items-center justify-between">
              <dt className="uppercase tracking-[0.12em]">合计</dt>
              <dd className="font-serif text-2xl">
                {formatCents(totals.totalCents)}
              </dd>
            </div>
          </dl>

          {/* 付款 —— 商城结算页共用一份 */}
          <CheckoutPaymentPanel
            addressId={selectedAddressId}
            note={note}
            submitLabel="去支付"
          />
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  子组件                                                                     */
/* -------------------------------------------------------------------------- */

function CheckoutLineItem({ item }: { item: CartLineItem }) {
  // 配件名从字典反查 —— metadata 只存 id,改名/下架不用迁移存量 cart
  const accessoryNames = (item.metadata.accessoryVariantIds ?? [])
    .map((id) => findAccessoryVariant(id)?.name)
    .filter((n): n is string => Boolean(n));

  return (
    <li className="flex gap-4 py-5">
      <img
        src={item.productThumbnail}
        alt={item.productTitle}
        className="size-24 object-cover rounded-sm bg-muted shrink-0"
        loading="lazy"
      />
      <div className="flex-1 min-w-0">
        <p className="font-serif text-[15px] leading-tight">
          {item.productTitle}
        </p>
        <div className="mt-1 space-y-0.5">
          {item.metadata.sizeCm > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {formatSizeWithInches(item.metadata.sizeCm)}
            </p>
          )}
          {accessoryNames.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {accessoryNames.join(" · ")}
            </p>
          )}
          {item.metadata.engravingText && (
            <p className="text-[11px] text-muted-foreground italic">
              &ldquo;{item.metadata.engravingText}&rdquo;
            </p>
          )}
          {item.metadata.rushOrder && (
            <p className="text-[10px] uppercase tracking-[0.12em] text-accent mt-1 inline-flex items-center gap-1">
              <Zap className="size-3" />
              加急
            </p>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">× {item.quantity}</p>
      </div>
      <p className="text-sm font-medium shrink-0">
        {formatCents(item.discountedUnitPriceCents * item.quantity)}
      </p>
    </li>
  );
}
