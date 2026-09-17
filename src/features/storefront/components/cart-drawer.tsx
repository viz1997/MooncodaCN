/**
 * CartDrawer —— 1:1 移植自 atelier cart-drawer.tsx
 *
 * 视觉保留:
 *  - 右侧滑入 + backdrop blur overlay
 *  - 顶部 sticky:购物袋图标 + 标题 + 件数
 *  - 免运费进度条(¥99 门槛)
 *  - Line item 列表(图片 + 标题 + 规格 + 刻字 + 自定义预览标签)
 *  - +/- 数量 + 删除按钮
 *  - 底部:小计 / 运费 / 总价 / Proceed to Checkout
 *
 * 适配差异:
 *  - 用 useCart (TanStack Query) 替代 atelier useCartStore
 *  - 用 useCartUi (Zustand) 控制 drawer 开关
 *  - 用 formatPriceCNY 替代 useFormatPrice(单币种 CNY)
 *  - 文案中文化(¥99 / 免运费 / 敬请期待)
 *  - "Proceed to Checkout" 弹 toast(真 Medusa 接入时改为跳转)
 */

"use client";

import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatPriceCNY } from "@/features/marketing/components/storefront/wjp-store-data";
import { useToast } from "@/hooks/use-toast";

import { useCart, useCartUi } from "../hooks/use-cart";

const FREE_SHIPPING_THRESHOLD_CNY = 99;

export function CartDrawer() {
  const { toast } = useToast();
  const isOpen = useCartUi((s) => s.isOpen);
  const closeCart = useCartUi((s) => s.closeCart);
  const {
    items,
    isLoading,
    subtotalCents,
    shippingCents,
    itemCount,
    updateLineItemQuantity,
    removeLineItem,
  } = useCart();

  const subtotalCNY = subtotalCents / 100;
  const shippingCNY = shippingCents / 100;
  const totalCNY = subtotalCNY + shippingCNY;
  const remainingCNY = Math.max(0, FREE_SHIPPING_THRESHOLD_CNY - subtotalCNY);
  const progressPercent = Math.min(
    100,
    (subtotalCNY / FREE_SHIPPING_THRESHOLD_CNY) * 100
  );

  const handleCheckout = () => {
    toast({
      title: "敬请期待",
      description: "checkout 流程对接中。Mock storefront 阶段暂不支持下单。",
    });
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closeCart()}>
      <SheetContent
        side="right"
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

        {/* 免运费进度条 */}
        {items.length > 0 && (
          <div className="px-5 py-4 bg-secondary/50 border-b">
            <p className="text-sm text-foreground/80 mb-2 text-pretty">
              {remainingCNY > 0 ? (
                <>
                  还差
                  <span className="font-semibold text-foreground mx-1">
                    {formatPriceCNY(remainingCNY)}
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
              {items.map((item) => {
                const itemTotalCents = item.unitPriceCents * item.quantity;
                return (
                  <li key={item.id} className="flex gap-4 px-5 py-4">
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
                              {item.metadata.sizeCm}cm
                            </p>
                          )}
                          {item.metadata.engravingText && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 italic truncate">
                              &ldquo;{item.metadata.engravingText}&rdquo;
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
                          onClick={() =>
                            removeLineItem.mutate({
                              lineItemId: item.id,
                            })
                          }
                          disabled={removeLineItem.isPending}
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
                            onClick={() =>
                              updateLineItemQuantity.mutate({
                                lineItemId: item.id,
                                quantity: item.quantity - 1,
                              })
                            }
                            disabled={
                              updateLineItemQuantity.isPending ||
                              item.quantity <= 1
                            }
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
                            onClick={() =>
                              updateLineItemQuantity.mutate({
                                lineItemId: item.id,
                                quantity: item.quantity + 1,
                              })
                            }
                            disabled={updateLineItemQuantity.isPending}
                            aria-label="增加数量"
                            className="size-8 flex items-center justify-center hover:bg-secondary rounded-r-full transition-colors disabled:opacity-50"
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>
                        <p className="text-sm font-medium">
                          {formatPriceCNY(itemTotalCents / 100)}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
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
                  {formatPriceCNY(subtotalCNY)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">运费</span>
                <span className="font-medium">
                  {remainingCNY > 0 ? "结算时计算" : "免运费"}
                </span>
              </div>
              <div className="border-t pt-2.5" />
              <div className="flex items-center justify-between">
                <span className="text-sm uppercase tracking-[0.12em]">
                  合计
                </span>
                <span className="font-serif text-xl">
                  {formatPriceCNY(totalCNY)}
                </span>
              </div>
            </div>
            <div className="px-5 pb-5 pt-1">
              <Button
                size="lg"
                onClick={handleCheckout}
                className="w-full rounded-full h-12 uppercase tracking-[0.14em] text-[12px] font-medium"
                type="button"
              >
                去结算(敬请期待)
              </Button>
              <p className="text-[11px] text-muted-foreground text-center mt-3">
                Mock storefront 阶段暂不支持真实下单。
              </p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
