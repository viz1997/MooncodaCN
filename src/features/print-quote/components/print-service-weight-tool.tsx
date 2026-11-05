"use client";

/**
 * 克重工具 —— 「量完就能下单」那一版(`/tools/weight`)
 *
 * ## 它跟 `/quote` 的关系
 *
 * 两个页面用的是**同一个**克重计算器(`PricingCalculator`),区别只在报价之后
 * 走哪条路:
 *
 * | 页面 | 报价之后 |
 * |---|---|
 * | `/quote` | 展开下单表单 → 直接建工单(`PO-…`) |
 * | `/tools/weight` | 加入购物车 → 跟别的商品一起结算(`SO-…` + `PO-…`) |
 *
 * 两条路的报价是**同一个**服务端接口、同一套口径(`usePrintQuote()`),
 * 所以用户在哪个页面看到的价都一样。
 *
 * ## 为什么在商城路由组里
 *
 * `/tools/weight` 在 `(marketing-atelier)` 下 —— 那一组挂着 `<CartDrawer />`。
 * 加完购物车直接弹购物袋,用户能立刻看见自己加了什么、价格多少。
 */

import { useCallback, useState } from "react";

import { PricingCalculator } from "@/features/pricing/components/pricing-calculator";
import type { PricingModelPayload } from "@/features/pricing/components/pricing-calculator-types";
import { PrintServiceCartPanel } from "@/features/storefront/components/print-service-cart-panel";

import { usePrintQuote } from "../hooks/use-print-quote";

export function PrintServiceWeightTool({
  isLoggedIn,
  signInUrl,
}: {
  /** 登录了吗 —— 没登录不能加购(模型要上传到 R2) */
  isLoggedIn: boolean;
  /** 登录链接(带 callbackUrl) */
  signInUrl: string;
}) {
  const {
    quoteInput,
    setQuoteInput,
    deliveryTier,
    setDeliveryTier,
    quote,
    quoteFresh,
    loading,
    error,
  } = usePrintQuote();

  const [modelPayload, setModelPayload] = useState<PricingModelPayload | null>(
    null
  );

  const handleModelChange = useCallback(
    (payload: PricingModelPayload | null) => {
      setModelPayload(payload);
    },
    []
  );

  return (
    <PricingCalculator
      showChrome={false}
      quoteMode
      onQuoteInput={setQuoteInput}
      onModelChange={handleModelChange}
      quoteSlot={
        <PrintServiceCartPanel
          quote={quote}
          quoteFresh={quoteFresh}
          loading={loading}
          error={error}
          deliveryTier={deliveryTier}
          onDeliveryTierChange={setDeliveryTier}
          quoteInput={quoteInput}
          modelPayload={modelPayload}
          isLoggedIn={isLoggedIn}
          signInUrl={signInUrl}
        />
      }
    />
  );
}
