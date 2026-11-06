"use client";

/**
 * 报价条 —— 渲染在克重面板下方
 *
 * 位置在右栏(克重 → 尺寸调整 → 报价),因为它是这条链路的**结论**:
 * 用户在上面调尺寸,下面实时看到「这么重、这么贵」。
 *
 * 价格全部来自服务端(`/api/print-quote`),这里只负责摆出来 —— 客户端
 * 算的价不显示,避免出现「页面显示一个价、下单是另一个价」。
 *
 * ## 面板底部那个按钮是「加入打印单」
 *
 * 工作室的要求:「模型打印是不走商城正常的购物车的,而是走打印下单,即展示
 * 打印列表和下单金额」。所以报价台的出口**不是**「直接提交订单」,而是把模型
 * 加进**打印单**(`/print-order`,另一张车)—— 加完之后由打印单页摆出打印
 * 列表和下单金额。
 *
 * 加进去了按钮就地变成「已加入 + 查看打印单」:用户的眼睛就在这个面板上,
 * 结果摆在原地,不用去别处找。
 */

import { AlertCircle, Loader2, Printer } from "lucide-react";
import { useTranslations } from "next-intl";

import { DeliveryTierPicker } from "@/features/print-quote/components/delivery-tier-picker";
import { QuoteBreakdown } from "@/features/print-quote/components/quote-breakdown";
import {
  DEFAULT_DELIVERY_RATES,
  type DeliveryTierId,
} from "@/features/print-quote/lib/delivery-tier";
import type { PrintQuote } from "@/features/print-quote/lib/quote-types";
import { Link } from "@/i18n/routing";

export type QuoteSummaryProps = {
  /** 服务端返回的报价;null = 还没算出来 */
  quote: PrintQuote | null;
  /** 报价请求进行中 */
  loading: boolean;
  /**
   * 挂着的报价已经过期(几何变了,新报价还在路上)
   *
   * 过期的时候不能加购 —— 界面上这个价是上一组尺寸的,用户按它确认,
   * 服务端却会按新尺寸算钱,两边对不上。
   */
  stale: boolean;
  /** 报价请求失败 */
  error: string | null;
  /** 「加入打印单」按钮 —— 没有报价 / 报价过期时禁用 */
  onAddToPrintOrder: () => void;
  /** 正在加(上传模型 + 落打印单) */
  adding: boolean;
  /**
   * 已经加进打印单了 —— 按钮换成「已加入 + 查看打印单」
   *
   * 这一段的状态放在报价面板里,而不是页面上另外摆一张卡:用户的眼睛就在
   * 这个面板上,按钮就地变成结果,不用去别处找。
   */
  added: boolean;
  /** 「再加一个模型」—— 回到可以再次加入的状态 */
  onReset: () => void;
  /** 当前选的交期档位 */
  deliveryTier: DeliveryTierId;
  /** 切交期档位 —— 父组件要拿新档位重新去服务端报价 */
  onDeliveryTierChange: (tier: DeliveryTierId) => void;
};

export function QuoteSummary({
  quote,
  loading,
  stale,
  error,
  onAddToPrintOrder,
  adding,
  added,
  onReset,
  deliveryTier,
  onDeliveryTierChange,
}: QuoteSummaryProps) {
  const t = useTranslations("PrintQuote");

  /**
   * 报价小计(克重 + 后处理 + 支撑)—— 三档加价的基数
   *
   * 从合计里减掉加价得到:服务端算的时候基数就是这个,前端反推能拿到同一个数
   * (加减法在整数分上不会有误差)。
   */
  const subtotalCents = quote
    ? quote.totalPriceCents - quote.deliveryFeeCents
    : null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
        <span className="text-xs font-medium text-foreground">
          {t("quote.title")}
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

            {stale && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {t("quote.stale")}
              </p>
            )}

            {/*
             * 已经加进去了 —— 按钮就地变成结果
             *
             * 「再加一个模型」把状态退回可加入:同一个模型再点一次会**再传一
             * 遍文件**(对象键是新的),所以它会变成打印单里的**另一行**,而不
             * 是把原来那行的数量改成 2。
             */}
            {added ? (
              <div className="mt-1 rounded-md border border-border bg-secondary/40 px-3 py-2.5">
                <p className="text-xs font-medium text-foreground">
                  {t("printOrder.added")}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <Link
                    href="/print-order"
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {t("printOrder.view")}
                  </Link>
                  <button
                    type="button"
                    onClick={onReset}
                    className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {t("printOrder.addMore")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onAddToPrintOrder}
                disabled={adding || stale || loading}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {adding ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Printer className="size-3.5" />
                )}
                {adding ? t("printOrder.adding") : t("printOrder.add")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
