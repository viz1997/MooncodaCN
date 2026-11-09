/**
 * 优惠码输入 —— **购物袋 / 结算页共用一份**(2026-11-08)
 *
 * ## 三处用同一个组件
 *
 * 购物袋抽屉(`cart-drawer.tsx`)、购物袋详情页(`cart-page-view.tsx`)、
 * 结算页(`checkout-view.tsx`)—— 三处各写一遍的话,改一句文案要改三个地方,
 * 漏一处就出现「购物袋能输、结算页不能输」。
 *
 * ## 码**住在车上**,不在这个组件里
 *
 * 应用优惠码 = `POST /api/store/carts/{id}/coupon`,服务端把码写进
 * `cart.coupon_code` 并**重算一遍**折扣。组件自己什么都不存(除了用户正在
 * 输的那串字符)。
 *
 * ## 折扣金额是**服务端算的**
 *
 * 组件只显示 `coupon.discountCents`(服务端给的快照),**客户端一个加法都不做**
 * —— 仓库的规矩:钱只在服务端算一遍。
 *
 * ## 「去掉优惠码」
 *
 * 传**空串**就是去掉。存在的意义:车上的码可能**已经用不了了**(改小数量
 * 跌破门槛 / 券过期 / 额度用完)—— 车里的码还留着,但结算会拒。这种时候要给
 * 用户一条路把码摘掉,不然只能手动改数量把门槛凑回去。
 */

"use client";

import { Tag, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/money";

import { CouponRequestError, useCart } from "../hooks/use-cart";
import { couponErrorText } from "../lib/coupon-error-text";

export function CouponField() {
  const { cart, coupon, couponError, couponDiscountCents, applyCoupon } =
    useCart();

  const [code, setCode] = useState("");

  /** 车上存着的码(可能已经用不了了) */
  const storedCode = cart?.couponCode ?? null;

  /** 这次请求本身的错误 —— 精确原因码 → 人话 */
  const requestError = applyCoupon.error;
  const requestErrorText =
    requestError instanceof CouponRequestError
      ? couponErrorText(requestError.code)
      : (requestError?.message ?? null);

  const handleApply = () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    applyCoupon.mutate({ code: trimmed });
  };

  const handleRemove = () => {
    setCode("");
    // 空串 = 摘掉优惠码(服务端把 coupon_code 清成 null)
    applyCoupon.mutate({ code: "" });
  };

  /* ---------------------------------------------------------------------- */
  /*  已经用上(或车上有码)                                                  */
  /* ---------------------------------------------------------------------- */

  if (storedCode) {
    const unusable = Boolean(couponError) || !coupon;

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-1.5 min-w-0">
            <Tag className="size-3.5 shrink-0" />
            <span className="font-medium truncate">{storedCode}</span>
            {coupon ? (
              <span className="text-accent">
                −{formatCents(couponDiscountCents)}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={handleRemove}
            disabled={applyCoupon.isPending}
            className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 disabled:opacity-50"
          >
            <X className="size-3.5" />
            去掉
          </button>
        </div>

        {/* 券在车上但用不了了 —— 说清楚为什么,并给一条摘掉的路 */}
        {unusable ? (
          <p className="text-xs text-destructive text-pretty">
            {couponErrorText(couponError)}
          </p>
        ) : null}

        {requestErrorText ? (
          <p className="text-xs text-destructive text-pretty">
            {requestErrorText}
          </p>
        ) : null}
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  还没用券                                                                */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleApply();
            }
          }}
          placeholder="优惠码"
          maxLength={64}
          aria-label="优惠码"
          className="h-9 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleApply}
          disabled={applyCoupon.isPending || code.trim().length === 0}
          className="rounded-full shrink-0"
        >
          {applyCoupon.isPending ? "应用中…" : "应用"}
        </Button>
      </div>

      {requestErrorText ? (
        <p className="text-xs text-destructive text-pretty">
          {requestErrorText}
        </p>
      ) : null}
    </div>
  );
}
