"use client";

/**
 * 购物袋详情页 —— `/cart`
 *
 * ## 为什么要有这一页
 *
 * 购物袋之前只有一个**抽屉**(`cart-drawer.tsx`):滑进来、看看、改数量、关掉。
 * 想看清「我到底买了什么、每件多少钱、折扣省了多少、运费怎么算」,得在
 * 抽屉里一行一行地翻 —— 抽屉一次只显示几行,滑到一半关掉就没了。
 *
 * 这一页是抽屉的「摊开版」:同样的数据、同样的口径,一屏看完,改数量 / 删
 * 行都在页面上直接做,底下是金额明细,右上角去结算。
 *
 * ## 金额**不在这里算**
 *
 * 页面显示的每一个数都是服务端算好传进来的(`discountedUnitPriceCents` 那一
 * 列)。客户端只做加总 —— 口径跟结算页共用 `lib/cart-totals.ts`,所以「购物袋
 * 里看到的合计」跟「结算页要收的合计」是同一个数。
 *
 * ## 数据来源:缓存优先,服务端那份兜底
 *
 * - **缓存**(`useCart()`)是活的真相 —— 改数量 / 删行走的是它,抽屉里改了
 *   这页也跟着变(同一个 query key)。
 * - **服务端那份**(`initialCart`)是首屏 —— 缓存还没回来的那一瞬间先用它,
 *   用户不会看到「空的购物袋」闪一下。
 *
 * ## 文案
 *
 * 跟抽屉 / 结算页一样是**中文硬编码** —— 商城这一整套交易界面目前只有中文
 * 一版(`cart-drawer.tsx` / `checkout-view.tsx` 都是)。这一页跟着走,别单独
 * 开一套 i18n(那会让「中文抽屉 → 英文购物袋页 → 中文结算页」更割裂)。
 *
 * ## 这一页**只有目录商品**(2026-11-08)
 *
 * 工作室的说法:「不要放入购物车,放在这里 account/print-orders」。打印服务
 * 是另一条线 —— 工单自己建、自己收款(见 `POST /api/print-orders`)。
 *
 * 所以这一页上每一行都是目录商品:有缩略图、有 +/− 数量(阶梯折扣按数量算)。
 */

import { Minus, Plus, ShoppingBag, Trash2, Zap } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";
import { formatCents } from "@/lib/money";

import { useCart } from "../hooks/use-cart";
import { computeCartTotals } from "../lib/cart-totals";
import { findAccessoryVariant } from "../lib/mock-catalog";
import { PRICING_CONSTANTS } from "../lib/pricing-constants";
import { formatSizeWithInches } from "../lib/size-format";
import type { Cart, CartLineItem } from "../types";
import { CouponField } from "./coupon-field";

export function CartPageView({ initialCart }: { initialCart: Cart | null }) {
  const {
    cart: cachedCart,
    items: cachedItems,
    coupon: cachedCoupon,
    updateLineItemQuantity,
    removeLineItem,
  } = useCart();

  /**
   * 缓存里的行优先,缓存还没回来就用服务端渲染好的那份
   *
   * 缓存到位之后两者是同一份数据 —— 服务端每次读购物车都会按 metadata 重算
   * 单价(见 `cart-store.ts`),所以不会出现「页面显示的价跟结算收的价对不上」。
   */
  const items = cachedCart ? cachedItems : (initialCart?.items ?? []);

  /**
   * 优惠效果 —— 跟行同一个来源
   *
   * **折扣金额是服务端算的**(`cart.coupon` 这个快照),客户端一个加法都不做。
   * 优惠码住在车上(`cart.coupon_code`),每次读车都**现算**一遍 —— 车里的行数
   * 变了,门槛可能就不满足了。
   */
  const coupon = cachedCart ? cachedCoupon : (initialCart?.coupon ?? null);

  const totals = useMemo(
    () => computeCartTotals(items, coupon),
    [items, coupon]
  );

  const remainingCents = totals.remainingForFreeShippingCents;
  const progressPercent = Math.min(
    100,
    (totals.subtotalCents / PRICING_CONSTANTS.FREE_SHIPPING_THRESHOLD_CENTS) *
      100
  );

  /* ---------------------------------------------------------------------- */
  /*  空购物袋                                                                */
  /* ---------------------------------------------------------------------- */

  if (items.length === 0) {
    return (
      <div className="atelier-container py-20 text-center">
        <div className="size-16 rounded-full bg-secondary flex items-center justify-center mx-auto mb-5">
          <ShoppingBag className="size-7 text-muted-foreground" />
        </div>
        <h1 className="font-serif text-3xl mb-3">购物袋是空的</h1>
        <p className="text-sm text-muted-foreground mb-8 max-w-xs mx-auto text-pretty">
          还没有要结算的作品 —— 去挑一个吧。¥99 免运费。
        </p>
        <Button asChild className="rounded-full px-7">
          <Link href="/">浏览作品</Link>
        </Button>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  购物袋                                                                  */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="atelier-container py-10">
      <div className="flex items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="font-serif text-3xl">购物袋</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totals.itemCount} 件
          </p>
        </div>
        <Button asChild variant="ghost" size="sm" className="rounded-full">
          <Link href="/">继续浏览</Link>
        </Button>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-8 lg:gap-12 items-start">
        {/* 左栏:行列表 */}
        <div className="space-y-6">
          {/* 免运费进度条 —— 跟抽屉同一套口径 */}
          {totals.subtotalCents > 0 && (
            <div className="px-5 py-4 bg-secondary/50 border border-border rounded-sm">
              <p className="text-sm text-foreground/80 mb-2 text-pretty">
                {remainingCents > 0 ? (
                  <>
                    还差
                    <span className="font-semibold text-foreground mx-1">
                      {formatCents(remainingCents)}
                    </span>
                    即可免运费
                  </>
                ) : (
                  <span className="font-medium text-foreground">
                    🎉 已解锁免运费
                  </span>
                )}
              </p>
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* 行列表 */}
          <ul className="divide-y divide-border border-y border-border">
            {items.map((item) => (
              <CartLineItemRow
                key={item.id}
                item={item}
                busy={
                  updateLineItemQuantity.isPending || removeLineItem.isPending
                }
                onQuantityChange={(quantity) =>
                  updateLineItemQuantity.mutate({
                    lineItemId: item.id,
                    quantity,
                  })
                }
                onRemove={() => removeLineItem.mutate({ lineItemId: item.id })}
              />
            ))}
          </ul>

          {/* 改数量 / 删行失败时的提示 */}
          {(updateLineItemQuantity.error || removeLineItem.error) && (
            <p className="text-xs text-destructive">
              {(updateLineItemQuantity.error ?? removeLineItem.error)?.message}
            </p>
          )}
        </div>

        {/* 右栏:金额 + 去结算 */}
        <aside className="lg:sticky lg:top-6 border border-border rounded-sm p-6 bg-card">
          <h2 className="eyebrow text-muted-foreground mb-4">金额</h2>

          {/* 优惠码 —— 跟抽屉 / 结算页共用一份 */}
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

          <Button
            asChild
            size="lg"
            className="w-full mt-6 rounded-full h-12 uppercase tracking-[0.14em] text-[12px] font-medium"
          >
            <Link href="/checkout">去结算</Link>
          </Button>
          <p className="text-[11px] text-muted-foreground text-center mt-3">
            提交后跳转在线支付,付款完成才开始制作。
          </p>
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  行                                                                         */
/* -------------------------------------------------------------------------- */

function CartLineItemRow({
  item,
  busy,
  onQuantityChange,
  onRemove,
}: {
  item: CartLineItem;
  /** 有请求在飞 —— 按钮先禁用,免得连点 */
  busy: boolean;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  /** 目录商品行 */

  // 配件名从字典反查 —— metadata 只存 id,改名/下架不用迁移存量 cart
  const accessoryNames = (item.metadata.accessoryVariantIds ?? [])
    .map((id) => findAccessoryVariant(id)?.name)
    .filter((n): n is string => Boolean(n));

  const lineTotalCents = item.discountedUnitPriceCents * item.quantity;
  const hasDiscount =
    item.discountedUnitPriceCents < item.unitPriceCents && item.quantity > 0;

  return (
    <li className="flex gap-4 py-6">
      <img
        src={item.productThumbnail}
        alt={item.productTitle}
        className="size-28 object-cover rounded-sm bg-muted shrink-0"
        loading="lazy"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-serif text-base leading-tight">
              {item.productTitle}
            </p>
            <div className="mt-1 space-y-0.5">
              {item.metadata.sizeCm > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {formatSizeWithInches(item.metadata.sizeCm)}
                </p>
              )}
              {accessoryNames.length > 0 && (
                <p className="text-[11px] text-muted-foreground truncate">
                  {accessoryNames.join(" · ")}
                </p>
              )}
              {item.metadata.engravingText && (
                <p className="text-[11px] text-muted-foreground italic truncate">
                  &ldquo;{item.metadata.engravingText}&rdquo;
                </p>
              )}
              {item.metadata.rushOrder && (
                <p className="text-[10px] uppercase tracking-[0.12em] text-accent mt-1 inline-flex items-center gap-1">
                  <Zap className="size-3" />
                  加急
                </p>
              )}
              {item.metadata.previewImage && (
                <p className="text-[10px] text-accent mt-0.5 uppercase tracking-[0.12em]">
                  Custom preview
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={`移除 ${item.productTitle}`}
            className="text-muted-foreground hover:text-destructive transition-colors p-1 disabled:opacity-50 shrink-0"
          >
            <Trash2 className="size-4" />
          </button>
        </div>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="flex items-center border rounded-full">
            <button
              type="button"
              onClick={() => onQuantityChange(item.quantity - 1)}
              disabled={busy || item.quantity <= 1}
              aria-label="减少数量"
              className="size-8 flex items-center justify-center hover:bg-secondary rounded-l-full transition-colors disabled:opacity-30"
            >
              <Minus className="size-3" />
            </button>
            <span className="w-8 text-center text-sm font-medium">
              {item.quantity}
            </span>
            <button
              type="button"
              onClick={() => onQuantityChange(item.quantity + 1)}
              disabled={busy}
              aria-label="增加数量"
              className="size-8 flex items-center justify-center hover:bg-secondary rounded-r-full transition-colors disabled:opacity-50"
            >
              <Plus className="size-3" />
            </button>
          </div>

          <div className="text-right">
            <p className="font-medium">{formatCents(lineTotalCents)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {hasDiscount ? (
                <>
                  {formatCents(item.discountedUnitPriceCents)} × {item.quantity}
                  <span className="line-through ml-1.5">
                    {formatCents(item.unitPriceCents)}
                  </span>
                </>
              ) : (
                <>
                  {formatCents(item.discountedUnitPriceCents)} × {item.quantity}
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </li>
  );
}
