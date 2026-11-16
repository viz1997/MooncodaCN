"use client";

/**
 * 报价明细 —— 工单详情页(以及任何要显示「按什么价收的」的地方)共用
 *
 * ## 为什么要抽出来
 *
 * 早先只有报价台(`QuoteSummary`)渲染这几行,后来工单详情页也要显示
 * 「当时按什么价收的」。抄一份的话,以后改一行文案/加一行费用就得改两处,
 * 漏一处就会出现「详情页少一项费用」这种用户会来问的问题。
 *
 * 报价台 2026-11-06 整页删掉,这个组件还在 —— 工单详情页那一份明细就是
 * 它渲染的。
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
 *
 * ## 收据上多摆的两行(2026-11-17)
 *
 * 工作室的两条口径:
 *
 * > 同一模型打印多件;后处理按件计,不重复收起步价。
 * > 配送方式 运费按单收取 顺丰到付…顺丰标快 ¥18…顺丰空运 ¥22
 *
 * ⇒ **件数**要摆出来(买家得知道那些钱是按几件算的)、
 * **配送方式 + 运费**要摆出来(「到付」那一档是**收件人付钱**,不是免运费 ——
 * 摆「¥0」会被误读)。
 *
 * ## 脚注那两句(2026-11-17)
 *
 * - 「含税价已包含 1% 普票 · 不另收」—— 工作室的原话。买家最常问的是
 *   「发票怎么开」,摆在收据底下等于当面回答了。
 * - 「后处理含:去支撑、清洗、基础打磨、上 UV 光油、独立包装与结构质保」——
 *   工作室给的后处理口径。**这是服务内容,不是成本结构** —— 跟「不摆明细」
 *   那条不冲突(明细不摆,但服务内容要说清楚)。
 */

import type { ShippingOptionId } from "@mooncoda/print-tool-core/quote/shipping-option";
import { useTranslations } from "next-intl";
import { formatCents, formatGrams } from "@/features/print-quote/lib/format";

/**
 * 渲染报价明细需要的那几个数
 *
 * `PrintQuote`(报价结果)和 `UserPrintOrderDetail`(详情页)都满足这个形状。
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
  /** 交期加价(分)—— 按小计的比例收,标准档是 0 */
  deliveryFeeCents: number;
  /** 这档承诺的交期(小时) */
  deliveryHours: number;
  /** 合计(分) */
  totalPriceCents: number;
  /**
   * 优惠码减掉的钱(分)—— 2026-11-08
   *
   * **可选** —— `PrintQuote` 没有它(报价不认优惠,优惠是订单级的),
   * `UserPrintOrderDetail` 有它。
   *
   * 有它的时候必须摆出「优惠」这一行 —— 否则明细加起来 ≠ 合计:
   * 四个费用列存的是**折前**的,`totalPriceCents` 存的是**净额**。
   */
  couponDiscountCents?: number | undefined;
  /**
   * 打印件数(2026-11-17)
   *
   * 克重费 / 后处理费 / 支撑加价都 **× N**;运费不乘(按单收)。
   *
   * **可选** —— 老单没有这一项(落回 1)。
   */
  quantity?: number | undefined;
  /**
   * 配送方式(2026-11-17)
   *
   * **可选** —— 老单落到**顺丰到付**(`normalizeShippingOption` 的口径)。
   */
  shippingOption?: ShippingOptionId | undefined;
  /**
   * 运费(分)(2026-11-17)
   *
   * **按单收** —— 不乘件数。`0` 表示「到付」(收件人签收时付钱),
   * **不是免运费** ⇒ 那一档显示「收件人付款」而不是「¥0」。
   */
  shippingFeeCents?: number | undefined;
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

  /**
   * 件数(2026-11-17)
   *
   * **只在 > 1 的时候摆** —— 一件是默认,摆「件数 1」是噪音。多件才摆,
   * 因为那正是买家需要知道「这些钱是按几件算的」的时候。
   */
  const quantity = values.quantity ?? 1;

  /**
   * 配送方式 + 运费(2026-11-17)
   *
   * **合成一行** —— 「配送方式 · 顺丰标快 ¥18.00」。摆成标签 + 档位名 + 金额
   * 三样是废话,合成一行一眼看全。
   *
   * ⚠️ **「到付」那一档显示「收件人付款」而不是「¥0」** —— 它的运费确实是
   * 0(收件人签收时付钱),但显示「¥0」会被读成**免运费**。
   */
  const shippingOption = values.shippingOption;
  const shippingFeeCents = values.shippingFeeCents ?? 0;

  return (
    <div>
      <dl className="space-y-2.5 text-sm">
        {quantity > 1 ? (
          <Row
            label={t("quote.quantity")}
            value={t("quantity.value", { count: quantity })}
          />
        ) : null}
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
        {/* 交期 —— 标准档也要摆出来:用户得看到「多久能拿到」 */}
        <Row
          label={t("delivery.row", { hours: values.deliveryHours })}
          value={
            values.deliveryFeeCents > 0
              ? `+${formatCents(values.deliveryFeeCents)}`
              : t("delivery.free")
          }
        />
        {/* 配送方式 + 运费 —— 按单收,不乘件数 */}
        {shippingOption ? (
          <Row
            label={t("shipping.row", {
              method: t(`shipping.option.${shippingOption}`),
            })}
            value={
              shippingOption === "cod"
                ? t("shipping.receiverPays")
                : formatCents(shippingFeeCents)
            }
          />
        ) : null}
        {/*
          优惠(2026-11-08)
          ——
          四个费用列存的是**折前**的,合计存的是**净额**(优惠后)。这一行不摆
          出来的话,「明细加起来 ≠ 合计」—— 用户会以为算错了。
        */}
        {values.couponDiscountCents && values.couponDiscountCents > 0 ? (
          <Row
            label={t("coupon.row")}
            value={`-${formatCents(values.couponDiscountCents)}`}
          />
        ) : null}
        <div className="flex items-baseline justify-between border-t border-border pt-3 mt-3">
          <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {t("quote.total")}
          </dt>
          <dd
            className={`font-serif text-foreground ${
              totalSize === "lg" ? "text-2xl" : "text-xl"
            }`}
          >
            {formatCents(values.totalPriceCents)}
          </dd>
        </div>
      </dl>

      {/*
        脚注(2026-11-17)

        - 「后处理含:去支撑、清洗、基础打磨、上 UV 光油、独立包装与结构质保」
          —— 工作室给的后处理口径。这是**服务内容**,不是成本结构(明细不摆,
          但服务要说清楚)。
        - 「含税价已包含 1% 普票 · 不另收」—— 工作室的原话。买家最常问的是
          「发票怎么开」,摆在收据底下等于当面回答了。

        ⚠️ 放在 `<dl>` **外面** —— `<p>` 不能直接进 `<dl>`(里面只该有
        `dt` / `dd`)。
      */}
      <div className="mt-2 space-y-1">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {t("postProcess.items")}
        </p>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {t("invoice.note")}
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
