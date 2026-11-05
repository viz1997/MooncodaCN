"use client";

/**
 * 打印服务 —— 「加入购物车」面板
 *
 * 挂在克重工具(`/tools/weight`)的右栏(报价插槽),把「量出来的克重」变成
 * 购物车里的一行。
 *
 * ## 它做的事
 *
 * ```
 * 浏览器算出几何 → 服务端算出报价 → 用户点「加入购物车」
 *   → 模型打包上传 R2(按用户分区)
 *   → POST /api/store/carts/{id}/line-items(带 printSpec)
 *   → 服务端**重算**一遍价(客户端带来的价不信)→ 落购物车
 *   → 打开购物袋
 * ```
 *
 * ## 为什么要走购物车而不是直接下单
 *
 * 用户可能想「一个自印摆件 + 一个定制打印」一起付。走购物车的话,一次结算
 * 同时出 `SO-…` 商城订单和 `PO-…` 打印工单,钱一次付清。
 *
 * ## 登录
 *
 * 模型要上传到 R2,上传要登录 —— 所以未登录时按钮变成「登录后加入购物车」。
 * 不能匿名加购:购物车是 cookie 里的游客车,换个设备就找不回来,而打印
 * 工单是**要开工的活**,必须挂在账号名下。
 */

import { AlertCircle, Loader2, Package, ShoppingBag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { PricingModelPayload } from "@/features/pricing/components/pricing-calculator-types";
import { DeliveryTierPicker } from "@/features/print-quote/components/delivery-tier-picker";
import { QuoteBreakdown } from "@/features/print-quote/components/quote-breakdown";
import {
  DEFAULT_DELIVERY_RATES,
  type DeliveryTierId,
} from "@/features/print-quote/lib/delivery-tier";
import type {
  PrintQuote,
  PrintQuoteInput,
} from "@/features/print-quote/lib/quote-types";
import { uploadModelFile } from "@/features/print-quote/lib/upload-model";
import { useCart, useCartUi } from "@/features/storefront/hooks/use-cart";
import {
  buildPrintServiceMetadata,
  PRINT_SERVICE_PRODUCT_ID,
} from "@/features/storefront/lib/print-service";
import type { PrintServiceSpec } from "@/features/storefront/types";

/** 加购的三个阶段 */
type Phase = "idle" | "uploading" | "adding";

export type PrintServiceCartPanelProps = {
  /** 服务端报价;null = 还没算出来 */
  quote: PrintQuote | null;
  /** 挂着的报价跟当前几何还对得上吗 */
  quoteFresh: boolean;
  /** 报价请求进行中 */
  loading: boolean;
  /** 报价失败原因 */
  error: string | null;
  /** 当前交期档位 */
  deliveryTier: DeliveryTierId;
  /** 切交期档位 */
  onDeliveryTierChange: (tier: DeliveryTierId) => void;
  /** 当前几何 */
  quoteInput: PrintQuoteInput | null;
  /** 模型文件 + 缩放 —— 加购时要打包上传 */
  modelPayload: PricingModelPayload | null;
  /** 登录了吗 */
  isLoggedIn: boolean;
  /** 登录链接(带 callbackUrl) */
  signInUrl: string;
};

export function PrintServiceCartPanel({
  quote,
  quoteFresh,
  loading,
  error,
  deliveryTier,
  onDeliveryTierChange,
  quoteInput,
  modelPayload,
  isLoggedIn,
  signInUrl,
}: PrintServiceCartPanelProps) {
  const t = useTranslations("PrintQuote");
  const { addLineItem } = useCart();
  const openCart = useCartUi((s) => s.openCart);

  const [phase, setPhase] = useState<Phase>("idle");
  const [addError, setAddError] = useState<string | null>(null);

  /**
   * 报价小计(克重 + 后处理 + 支撑)—— 三档加价的基数
   *
   * 从合计里减掉加价得到:服务端算的时候基数就是这个,前端反推能拿到同一个数
   * (加减法在整数分上不会有误差)。
   */
  const subtotalCents = quote
    ? quote.totalPriceCents - quote.deliveryFeeCents
    : null;

  /**
   * 能不能加购
   *
   * 三个条件都要满足:
   * - 有模型(手动模式的包络盒估算没有文件可传)
   * - 报价跟当前几何对得上(对不上就是拿旧价下单)
   * - 报价算出来了
   */
  const canAdd =
    Boolean(modelPayload) && Boolean(quoteInput) && quoteFresh && !loading;

  const handleAddToCart = async () => {
    if (!canAdd || !quoteInput || !modelPayload) return;
    setAddError(null);
    setPhase("uploading");
    try {
      // ① 模型打包上传 —— 只在用户点了按钮之后才离开浏览器
      const uploaded = await uploadModelFile(modelPayload);

      // ② 组装规格 —— 交期档位进规格(加急和不加急是两行,不是同一行)
      const spec: PrintServiceSpec = {
        volumeCM3: quoteInput.volumeCM3,
        surfaceAreaCM2: quoteInput.surfaceAreaCM2,
        dims: quoteInput.dims,
        supportWeightG: quoteInput.supportWeightG ?? null,
        selfSupportRatio: quoteInput.selfSupportRatio ?? null,
        deliveryTier,
        modelFileName: uploaded.fileName,
        modelObjectKey: uploaded.objectKey,
        modelUrl: uploaded.url,
        modelSizeBytes: uploaded.size,
        // 只是展示用的克重 —— 服务端重算之后会用自己的值覆盖掉
        materialWeightG: quote?.materialWeightG ?? null,
      };

      // ③ 加购 —— 服务端会重算一遍价,不信客户端带来的
      setPhase("adding");
      await addLineItem.mutateAsync({
        productId: PRINT_SERVICE_PRODUCT_ID,
        spec: buildPrintServiceMetadata({ spec }),
        quantity: 1,
      });

      setPhase("idle");
      openCart();
    } catch (err) {
      console.error("[PrintService] 加入购物车失败", err);
      setPhase("idle");
      setAddError(
        err instanceof Error ? err.message : t("cart.errors.addFailed")
      );
    }
  };

  /* ---------------------------------------------------------------------- */
  /*  还没有模型                                                              */
  /* ---------------------------------------------------------------------- */

  if (!modelPayload) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
          <span className="text-xs font-medium text-foreground">
            {t("cart.title")}
          </span>
        </div>
        <div className="p-3">
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Package className="mt-px size-3.5 shrink-0" />
            {t("cart.needModel")}
          </p>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  有模型 —— 报价 + 交期 + 加购                                             */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
        <span className="text-xs font-medium text-foreground">
          {t("cart.title")}
        </span>
        {loading && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {t("quote.quoting")}
          </span>
        )}
      </div>

      <div className="space-y-2 p-3">
        {!quote && !error && (
          <p className="text-xs text-muted-foreground">{t("quote.empty")}</p>
        )}

        {error && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            {error}
          </p>
        )}

        {quote && (
          <>
            <DeliveryTierPicker
              value={deliveryTier}
              rates={quote.deliveryRates ?? DEFAULT_DELIVERY_RATES}
              subtotalCents={subtotalCents}
              onChange={onDeliveryTierChange}
              disabled={loading}
            />

            <QuoteBreakdown values={quote} />

            {!quoteFresh && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {t("quote.stale")}
              </p>
            )}

            {isLoggedIn ? (
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={!canAdd || phase !== "idle"}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {phase === "idle" ? (
                  <ShoppingBag className="size-3.5" />
                ) : (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {phase === "uploading"
                  ? t("cart.uploading")
                  : phase === "adding"
                    ? t("cart.adding")
                    : t("cart.add")}
              </button>
            ) : (
              <a
                href={signInUrl}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <ShoppingBag className="size-3.5" />
                {t("cart.signInFirst")}
              </a>
            )}

            {addError && (
              <p className="flex items-start gap-1.5 text-[11px] text-destructive">
                <AlertCircle className="mt-px size-3.5 shrink-0" />
                {addError}
              </p>
            )}

            <p className="text-[10px] text-muted-foreground">
              {t("cart.hint")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
