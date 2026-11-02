"use client";

/**
 * 报价明细 —— 报价台和工单详情页共用
 *
 * ## 为什么要抽出来
 *
 * 之前只有报价台(`QuoteSummary`)渲染这几行,现在工单详情页也要显示
 * 「当时按什么价收的」。抄一份的话,以后改一行文案/加一行费用就得改两处,
 * 漏一处就会出现「详情页少一项费用」这种用户会来问的问题。
 *
 * ## 组件只管「摆出来」
 *
 * 数字全部来自服务端重算的结果(下单时算好的),这里不重算 —— 详情页显示的
 * 是**当时那笔账**,不是现在重新算一遍的数(模型、克重规则可能已经变了)。
 *
 * ## 配色走语义 token
 *
 * `border-border` / `text-muted-foreground` / `text-foreground` 在 marketing
 * 和 dashboard 两套布局里是同一组暖灰,一份样式两处都对。
 */

import { useTranslations } from "next-intl";

import { formatCents, formatGrams } from "@/features/print-quote/lib/format";

/**
 * 渲染报价明细需要的那几个数
 *
 * `PrintQuote`(报价台)和 `UserPrintOrderDetail`(详情页)都满足这个形状。
 */
export type QuoteBreakdownValues = {
  /** 耗材克重 g */
  materialWeightG: number;
  /** 支撑克重 g */
  supportWeightG: number | null;
  /** 克重费(分) */
  weightFeeCents: number;
  /** 后处理(分) */
  varnishFeeCents: number;
  /** 支撑加价(分) */
  supportFeeCents: number;
  /** 合计(分) */
  totalPriceCents: number;
};

export function QuoteBreakdown({
  values,
  totalSize = "lg",
}: {
  values: QuoteBreakdownValues;
  /** 合计的字号 —— 详情页里用小一号,别喧宾夺主 */
  totalSize?: "sm" | "lg";
}) {
  const t = useTranslations("PrintQuote");

  return (
    <>
      <Row
        label={t("quote.materialWeight")}
        value={formatGrams(values.materialWeightG)}
      />
      {values.supportFeeCents > 0 ? (
        <Row
          label={t("quote.supportFee")}
          value={formatCents(values.supportFeeCents)}
        />
      ) : null}
      <Row
        label={t("quote.weightFee")}
        value={formatCents(values.weightFeeCents)}
      />
      {values.varnishFeeCents > 0 ? (
        <Row
          label={t("quote.varnishFee")}
          value={formatCents(values.varnishFeeCents)}
        />
      ) : null}
      <div className="flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-xs font-medium text-foreground">
          {t("quote.total")}
        </span>
        <span
          className={`font-mono font-semibold tracking-tight text-amber-700 dark:text-amber-400 ${
            totalSize === "lg" ? "text-xl" : "text-base"
          }`}
        >
          {formatCents(values.totalPriceCents)}
        </span>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}
