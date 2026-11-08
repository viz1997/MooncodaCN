/**
 * CartDrawer —— 1:1 移植自 atelier cart-drawer.tsx
 *
 * 视觉保留:
 *  - 右侧滑入 + backdrop blur overlay
 *  - 顶部 sticky:购物袋图标 + 标题 + 件数
 *  - 免运费进度条(¥99 门槛)
 *  - Line item 列表(图片 + 标题 + 规格 + 刻字 + 自定义预览标签)
 *  - +/- 数量 + 删除按钮
 *  - 底部:小计 / 运费 / 总价 / 去结算
 *
 * 适配差异:
 *  - 用 useCart (TanStack Query) 替代 atelier useCartStore
 *  - 用 useCartUi (Zustand) 控制 drawer 开关
 *  - 用 formatCents 替代 useFormatPrice(单币种 CNY)
 *  - 文案中文化(¥99 / 免运费)
 *  - 「去结算」跳 `/checkout`(2026-11-04:结算链接上了 Sellbase 收银台)
 *
 * ## 行合计用**折后**单价
 *
 * 阶梯折扣是按行数量算的(买 10 个打九折),折扣落在单价上。显示的行合计
 * 用 `discountedUnitPriceCents × quantity` —— 跟结算页显示的价、跟实际收
 * 的钱是同一个数。
 *
 * ## 抽屉里**两种行都有**(2026-11-08)
 *
 * 打印服务并进商城购物袋了 —— 工作室的说法:「不要 print-order,进入商城
 * 那个」。所以这一行在抽屉里也出现:
 *
 * - **目录商品行** —— 缩略图 + +/− 数量
 * - **打印服务行** —— 包裹图标、**没有 +/−**(一件活一个模型)、没有交期
 *   选择器(抽屉太窄,去详情页改)
 *
 * 判据是「`metadata` 里有没有 `printSpec`」—— 见 `lib/print-service.ts`。
 */

"use client";

import { Minus, Plus, ShoppingBag, Trash2, X, Zap } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Link, useRouter } from "@/i18n/routing";
import { formatCents } from "@/lib/money";

import { useAtelierContainer } from "../hooks/use-atelier-container";
import { useCart, useCartUi } from "../hooks/use-cart";
import { findAccessoryVariant } from "../lib/mock-catalog";
import { PRICING_CONSTANTS } from "../lib/pricing-constants";
import { getPrintServiceSpec } from "../lib/print-service";
import { formatSizeWithInches } from "../lib/size-format";
import type { CartLineItem } from "../types";
import { PrintLineRow } from "./print-line-row";

const FREE_SHIPPING_THRESHOLD_CENTS =
  PRICING_CONSTANTS.FREE_SHIPPING_THRESHOLD_CENTS;

export function CartDrawer() {
  const router = useRouter();
  const isOpen = useCartUi((s) => s.isOpen);
  const closeCart = useCartUi((s) => s.closeCart);
  const container = useAtelierContainer();
  const {
    items,
    isLoading,
    subtotalCents,
    catalogSubtotalCents,
    shippingCents,
    itemCount,
    updateLineItemQuantity,
    removeLineItem,
  } = useCart();

  const totalCents = subtotalCents + shippingCents;
  // 免运费门槛按**目录商品**那部分算 —— 打印服务不产生快递费
  const remainingCents = Math.max(
    0,
    FREE_SHIPPING_THRESHOLD_CENTS - catalogSubtotalCents
  );
  const progressPercent = Math.min(
    100,
    (catalogSubtotalCents / FREE_SHIPPING_THRESHOLD_CENTS) * 100
  );

  /** 分成两种行 —— 目录商品 / 打印服务 */
  const printItems = useMemo(
    () => items.filter((item) => getPrintServiceSpec(item.metadata) !== null),
    [items]
  );
  const catalogItems = useMemo(
    () => items.filter((item) => getPrintServiceSpec(item.metadata) === null),
    [items]
  );

  const handleCheckout = () => {
    closeCart();
    router.push("/checkout");
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeCart()}>
      <SheetContent
        side="right"
        // portal 指回 .atelier-root —— 否则抽屉落在 atelier 的 token 子树外,
        // 配色和圆角退回全站默认主题(见 use-atelier-container.ts)
        portalContainer={container}
        className="w-full sm:max-w-md p-0 flex flex-col"
      >
        <SheetHeader className="px-5 py-5 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ShoppingBag className="size-5" />
              <SheetTitle className="font-serif text-xl tracking-tight">
                购物袋
              </SheetTitle>
              <span className="text-xs text-muted-foreground">
                {itemCount} 件
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={closeCart}
              aria-label="关闭购物袋"
              className="size-9 rounded-full"
              type="button"
            >
              <X className="size-5" />
            </Button>
          </div>
        </SheetHeader>

        {/* 免运费进度条 —— 车里没有目录商品时不摆(打印服务不产生快递费) */}
        {catalogSubtotalCents > 0 && (
          <div className="px-5 py-4 bg-secondary/50 border-b">
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

        {/* Line items */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && items.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              加载中...
            </div>
          ) : items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center px-6 text-center">
              <div className="size-16 rounded-full bg-secondary flex items-center justify-center mb-4">
                <ShoppingBag className="size-7 text-muted-foreground" />
              </div>
              <h3 className="font-serif text-xl mb-2">购物袋是空的</h3>
              <p className="text-sm text-muted-foreground max-w-xs text-pretty">
                浏览钥匙扣 / 手办 / 冰箱贴系列,选中的作品会出现在这里。¥99
                免运费。
              </p>
              <Button
                onClick={closeCart}
                className="mt-6 rounded-full px-7"
                type="button"
              >
                浏览作品
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {catalogItems.map((item) => (
                <DrawerCatalogRow
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
                  onRemove={() =>
                    removeLineItem.mutate({ lineItemId: item.id })
                  }
                />
              ))}
              {printItems.map((item) => (
                <PrintLineRow
                  key={item.id}
                  item={item}
                  size="sm"
                  className="px-5 py-4"
                  busy={removeLineItem.isPending}
                  onRemove={() =>
                    removeLineItem.mutate({ lineItemId: item.id })
                  }
                />
              ))}
            </ul>
          )}
        </div>

        {/* Footer / checkout */}
        {items.length > 0 && (
          <div className="border-t bg-background">
            <div className="px-5 py-4 space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">小计</span>
                <span className="font-medium">
                  {formatCents(subtotalCents)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">运费</span>
                <span className="font-medium">
                  {/* 车里没有目录商品 → 没有要寄的东西 → 没有运费 */}
                  {catalogSubtotalCents <= 0
                    ? "无"
                    : remainingCents > 0
                      ? "结算时计算"
                      : "免运费"}
                </span>
              </div>
              <div className="border-t pt-2.5" />
              <div className="flex items-center justify-between">
                <span className="text-sm uppercase tracking-[0.12em]">
                  合计
                </span>
                <span className="font-serif text-xl">
                  {formatCents(totalCents)}
                </span>
              </div>
            </div>
            <div className="px-5 pb-5 pt-1">
              {/* 抽屉看不全的,去详情页看 —— 那一页是一屏摊开 + 金额明细 */}
              <Link
                href="/cart"
                onClick={closeCart}
                className="block text-center text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors mb-3"
              >
                查看购物袋详情
              </Link>
              <Button
                size="lg"
                onClick={handleCheckout}
                className="w-full rounded-full h-12 uppercase tracking-[0.14em] text-[12px] font-medium"
                type="button"
              >
                去结算
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-3">
                提交后跳转在线支付,付款完成才开始制作。
              </p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/*  目录商品行                                                                 */
/* -------------------------------------------------------------------------- */

function DrawerCatalogRow({
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
  const itemTotalCents = item.discountedUnitPriceCents * item.quantity;

  // 配件名从字典反查 —— metadata 只存 id,改名/下架不用迁移存量 cart
  const accessoryNames = (item.metadata.accessoryVariantIds ?? [])
    .map((id) => findAccessoryVariant(id)?.name)
    .filter((n): n is string => Boolean(n));

  return (
    <li className="flex gap-4 px-5 py-4">
      <img
        src={item.productThumbnail}
        alt={item.productTitle}
        className="size-24 object-cover rounded-sm bg-muted shrink-0"
        loading="lazy"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-serif text-[15px] leading-tight truncate">
              {item.productTitle}
            </p>
            {item.metadata.sizeCm > 0 && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {formatSizeWithInches(item.metadata.sizeCm)}
              </p>
            )}
            {accessoryNames.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {accessoryNames.join(" · ")}
              </p>
            )}
            {item.metadata.engravingText && (
              <p className="text-[11px] text-muted-foreground mt-0.5 italic truncate">
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
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={`移除 ${item.productTitle}`}
            className="text-muted-foreground hover:text-destructive transition-colors p-1 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
          </button>
        </div>

        <div className="flex items-center justify-between mt-3">
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
          <p className="text-sm font-medium">{formatCents(itemTotalCents)}</p>
        </div>
      </div>
    </li>
  );
}
