"use client";

/**
 * 报价条 —— 渲染在克重面板下方
 *
 * 位置在右栏(克重 → 尺寸调整 → 报价),因为它是这条链路的**结论**:
 * 用户在上面调尺寸,下面实时看到「这么重、这么贵」。
 *
 * 价格全部来自服务端(`/api/print-quote`),这里只负责摆出来 —— 客户端
 * 算的价不显示,避免出现「页面显示一个价、下单是另一个价」。
 */

import { AlertCircle, Loader2, Scale } from "lucide-react";
import { useTranslations } from "next-intl";

import { formatCents, formatGrams } from "@/features/print-quote/lib/format";
import type { PrintQuote } from "@/features/print-quote/lib/quote-types";

export type QuoteSummaryProps = {
  /** 服务端返回的报价;null = 还没算出来 */
  quote: PrintQuote | null;
  /** 报价请求进行中 */
  loading: boolean;
  /**
   * 挂着的报价已经过期(几何变了,新报价还在路上)
   *
   * 过期的时候不能下单 —— 界面上这个价是上一组尺寸的,用户按它确认,
   * 服务端却会按新尺寸算钱,两边对不上。
   */
  stale: boolean;
  /** 报价请求失败 */
  error: string | null;
  /** 「填写下单信息」按钮 —— 没有报价时禁用 */
  onStartOrder: () => void;
  /** 已经进到填单阶段 */
  ordering: boolean;
};

export function QuoteSummary({
  quote,
  loading,
  stale,
  error,
  onStartOrder,
  ordering,
}: QuoteSummaryProps) {
  const t = useTranslations("PrintQuote");

  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-3 py-2">
        <span className="text-xs font-medium text-stone-600">
          {t("quote.title")}
        </span>
        {loading && (
          <span className="flex items-center gap-1 text-[11px] text-stone-400">
            <Loader2 className="size-3 animate-spin" />
            {t("quote.quoting")}
          </span>
        )}
      </div>

      <div className="space-y-2 p-3">
        {!quote && !error && (
          <p className="text-xs text-stone-400">{t("quote.empty")}</p>
        )}

        {error && (
          <p className="flex items-start gap-1.5 text-xs text-red-600">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            {error}
          </p>
        )}

        {quote && (
          <>
            <Row
              label={t("quote.materialWeight")}
              value={formatGrams(quote.materialWeightG)}
            />
            {quote.supportFeeCents > 0 && (
              <Row
                label={t("quote.supportFee")}
                value={formatCents(quote.supportFeeCents)}
              />
            )}
            <Row
              label={t("quote.weightFee")}
              value={formatCents(quote.weightFeeCents)}
            />
            {quote.varnishFeeCents > 0 && (
              <Row
                label={t("quote.varnishFee")}
                value={formatCents(quote.varnishFeeCents)}
              />
            )}
            <div className="flex items-baseline justify-between border-t border-stone-200 pt-2">
              <span className="text-xs font-medium text-stone-700">
                {t("quote.total")}
              </span>
              <span className="font-mono text-xl font-semibold tracking-tight text-amber-700">
                {formatCents(quote.totalPriceCents)}
              </span>
            </div>

            {stale && (
              <p className="text-[11px] text-amber-600">{t("quote.stale")}</p>
            )}

            <button
              type="button"
              onClick={onStartOrder}
              disabled={ordering || stale || loading}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md bg-stone-900 px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Scale className="size-3.5" />
              {ordering ? t("order.continueEditing") : t("order.start")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-stone-500">{label}</span>
      <span className="font-mono text-stone-700">{value}</span>
    </div>
  );
}
