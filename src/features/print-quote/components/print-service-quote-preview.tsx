"use client";

/**
 * **报价弹窗**里的**预估报价**(2026-11-07 起;2026-11-09 搬进弹窗)
 *
 * 工作室的原话:「现在不登录也允许计价显示」。
 *
 * 以前这块在右栏那张「提交打印订单」卡片里 —— 2026-11-09 整块搬进
 * **报价弹窗**(`print-service-quote-dialog.tsx`),那颗卡片删了。
 *
 * ## 价从哪儿来 —— 只有服务端
 *
 * 这个组件**不自己算价** —— 它把几何(体积 / 表面积 / 尺寸 / 支撑克重)
 * 发给 `POST /api/print-quote`,服务端按后台配的口径算,返回报价。
 *
 * 客户端算的价不能信(能被改)。工具页显示的这个数字只是**预估**,最终金额
 * 在打印单上按服务端重算的结果收。
 *
 * ## 界面上不摆单价(2026-11-16)
 *
 * 工作室的要求:「不要展示 4.5 元/g 这种单价,避免暴露我们的成本」。
 *
 * 服务端返回的是**对外形状**(`PublicPrintQuote`)—— 单价那一栏**根本不在
 * 响应里**,不是「拿到了再藏起来」。收据上摆的是「克重费 ¥12.34」,**不摆**
 * 「12.34 ÷ 8.3 g = ¥1.49/g」。
 *
 * ## 访客能不能看到 —— 后台一个开关
 *
 * 未登录的人能不能看到价,由后台 `/admin/print-pricing` 的「访客可见计价」
 * 决定:
 *
 * | 情况 | 界面 |
 * |---|---|
 * | 报价成功 | **只有总额**(不摆费用明细 —— 2026-11-16 工作室要求) |
 * | 未登录 + 开关关着(接口回 403) | 「登录后可见报价」 |
 * | 算不出来 | 「算不出预估价」 |
 *
 * **已登录的人不受那个开关管** —— 能下单就能看价。
 *
 * ## 费用明细**不摆**(2026-11-16)
 *
 * 工作室的原话:「克重费 ¥16.65 · 后处理 ¥5 · 支撑加价 ¥0
 * **不要显示明细**」。
 *
 * ⇒ 弹窗里**只有总额**。明细那一行删了(工单详情页的收据不动 —— 那是
 * 已经付掉的账,不是报价)。
 *
 * ⚠️ **「支撑还没算」的披露留着** —— 那个总额是**偏低的**(服务端按 0 算
 * 支撑),不说清楚就是「摆一个看着精确、其实少算了一笔的数」。
 *
 * ## 支撑还没算的时候,金额是**不完整的**
 *
 * 支撑**不跟随角度实时重算**(工作室 2026-11-07 的口径):用户点「包裹支撑」
 * 或「置于平面」才算一次。在那之前,`supportWeightG` 是 null,支撑费算成 0 ——
 * 那个价是**偏低的**。
 *
 * 所以这里明说「未含支撑费」,而不是摆一个看着精确、其实少算了一笔的数。
 * 用户点了「包裹支撑」,`input` 变了,这个组件自动重新报价。
 *
 * ## 交期跟着弹窗里选的那一档
 *
 * `deliveryTier` 传进来的是**下单表单里选中的那一档**(默认标准档)——
 * 报价里带上它,弹窗里摆的三档加价跟总额才对得上。换档位 → 重新问价。
 */

import type { DeliveryTierId } from "@mooncoda/print-tool-core/quote/delivery-tier";
import type { ShippingOptionId } from "@mooncoda/print-tool-core/quote/shipping-option";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type {
  CouponErrorCode,
  CouponView,
} from "@/features/coupon/lib/coupon-calc";
import type {
  PrintQuoteInput,
  PublicPrintQuote,
} from "@/features/print-quote/lib/quote-types";
import { formatCents } from "@/lib/money";

/** 这块区域的五种状态 */
type PreviewState =
  /** 还没有模型 —— 什么都不摆 */
  | { kind: "empty" }
  /** 正在问服务端要价 */
  | { kind: "loading" }
  /** 拿到了报价 */
  | { kind: "ready"; quote: PublicPrintQuote }
  /** 未登录 + 后台把访客可见计价关了 */
  | { kind: "hidden" }
  /** 算不出来 / 请求挂了 */
  | { kind: "error" };

export type PrintServiceQuotePreviewProps = {
  /**
   * 当前量着的几何 —— 服务端按这组数报价
   *
   * null = 还没有模型(什么都不摆)。
   */
  input: PrintQuoteInput | null;
  /**
   * 交期档位(2026-11-08)
   *
   * 打印服务**不再进商城购物袋**了,交期档位是在**下单表单**里选的。
   * 选中的那一档要带进报价 —— 否则卡片上摆的预估价跟用户选的那一档对不上。
   */
  deliveryTier?: DeliveryTierId | undefined;
  /**
   * 打印件数(2026-11-17)
   *
   * 工作室的原话「同一模型打印多件」—— 克重费 / 后处理费 / 支撑加价都
   * **按件**放大。**运费不乘**(按单收)。
   *
   * 不传 = 1 件(老客户端)。
   */
  quantity?: number | undefined;
  /**
   * 配送方式(2026-11-17)
   *
   * 只影响**运费**,跟交期档位是两个正交的轴。不传 = 顺丰到付(¥0)。
   */
  shippingOption?: ShippingOptionId | undefined;
  /**
   * 优惠码(2026-11-08)
   *
   * 带了它去问价,服务端会顺带算这张码能减多少 —— **折扣是服务端算的**,
   * 客户端一个加法都不做。
   *
   * 码不可用**不会**让这个接口失败:报价照给,响应里多一个 `couponError`。
   */
  couponCode?: string | null | undefined;
  /**
   * 把报价抬给父组件(2026-11-08)
   *
   * 父组件要拿 `quote.deliveryRates`(三档的比例)摆交期选择器,拿
   * 小计算选择器上那三档的加价 —— 比例只能由服务端给,前端不自己认一份。
   */
  onQuote?: ((quote: PublicPrintQuote | null) => void) | undefined;
  /**
   * 把优惠结果抬给父组件(2026-11-08)
   *
   * `coupon` = 服务端算好的优惠快照;`error` = 券不可用的精确原因码。
   * 父组件把它传给下单表单 —— 表单要显示「这张码减了多少钱」/「为什么用不了」。
   */
  onCoupon?:
    | ((coupon: CouponView | null, error: CouponErrorCode | null) => void)
    | undefined;
};

/** 报价请求防抖(毫秒)—— 拖尺寸滑块时别一路发 */
const QUOTE_DEBOUNCE_MS = 400;

export function PrintServiceQuotePreview({
  input,
  deliveryTier,
  quantity,
  shippingOption,
  couponCode,
  onQuote,
  onCoupon,
}: PrintServiceQuotePreviewProps) {
  const t = useTranslations("PrintQuote");
  const [state, setState] = useState<PreviewState>({ kind: "empty" });

  /**
   * 优惠结果 —— **服务端算好的快照**
   *
   * `coupon` = 这张码减了多少;`couponError` = 用不了的精确原因码。
   *
   * 客户端一个加法都不做 —— 折扣金额是服务端算的(能被改)。
   */
  const [coupon, setCoupon] = useState<CouponView | null>(null);
  const [couponError, setCouponError] = useState<CouponErrorCode | null>(null);

  useEffect(() => {
    if (!input) {
      setState({ kind: "empty" });
      return;
    }

    // 几何变了就把上一次的结果撤掉 —— 别让旧价挂在那儿
    setState({ kind: "loading" });

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        // 交期档位 + 件数 + 配送方式 + 优惠码带进报价 ——
        // 用户选的每一项,金额都要按它算
        const payload: PrintQuoteInput & {
          couponCode?: string | null;
        } = {
          ...input,
          deliveryTier: deliveryTier ?? null,
          quantity: quantity ?? null,
          shippingOption: shippingOption ?? null,
        };
        if (couponCode) payload.couponCode = couponCode;

        const response = await fetch("/api/print-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        // 403 = 未登录 + 后台关了访客可见计价 —— 不是错误,是「登录才看得到」
        if (response.status === 403) {
          setState({ kind: "hidden" });
          return;
        }
        if (!response.ok) {
          setState({ kind: "error" });
          return;
        }

        const data = (await response.json()) as {
          quote?: PublicPrintQuote;
          coupon?: CouponView | null;
          couponError?: CouponErrorCode | null;
        };
        if (!data.quote) {
          setState({ kind: "error" });
          return;
        }
        setState({ kind: "ready", quote: data.quote });
        setCoupon(data.coupon ?? null);
        setCouponError(data.couponError ?? null);
      } catch (error) {
        // 几何又变了 → 上一次请求被取消 —— 不是错误
        if (error instanceof Error && error.name === "AbortError") return;
        setState({ kind: "error" });
      }
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, deliveryTier, quantity, shippingOption, couponCode]);

  // 把报价抬给父组件 —— 父组件要拿它摆交期选择器
  const liftedQuote = state.kind === "ready" ? state.quote : null;
  useEffect(() => {
    onQuote?.(liftedQuote);
  }, [liftedQuote, onQuote]);

  // 把优惠结果抬给父组件
  const liftedCoupon = coupon;
  const liftedCouponError = couponError;
  useEffect(() => {
    onCoupon?.(liftedCoupon, liftedCouponError);
  }, [liftedCoupon, liftedCouponError, onCoupon]);

  if (state.kind === "empty") return null;

  if (state.kind === "loading") {
    return (
      <p className="text-[11px] text-muted-foreground">
        {t("preview.quoting")}
      </p>
    );
  }

  if (state.kind === "hidden") {
    return (
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
        <p className="text-xs font-medium">{t("preview.signInRequired")}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t("preview.signInHint")}
        </p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <p className="text-[11px] text-muted-foreground">{t("preview.error")}</p>
    );
  }

  const { quote } = state;
  // 支撑还没算 —— 服务端按 0 算,那个价是偏低的,得说清楚
  const supportPending = quote.supportWeightG === null;

  /**
   * 优惠 —— **服务端算好的**
   *
   * `discountCents` 是服务端算的(能被改),客户端只负责把它显示出来。
   * 优惠基数是「合计 − 交期加价」,所以减完之后交期加价那部分不变。
   */
  const couponDiscountCents = coupon?.discountCents ?? 0;
  const payableCents = Math.max(0, quote.totalPriceCents - couponDiscountCents);

  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{t("preview.label")}</p>
      <p className="text-lg font-semibold leading-tight tabular-nums">
        {formatCents(payableCents)}
      </p>
      {couponDiscountCents > 0 ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t("coupon.row")} -{formatCents(couponDiscountCents)}
          {" · "}
          {coupon?.code}
        </p>
      ) : null}
      {/*
       * **不摆费用明细**(2026-11-16)
       *
       * 工作室的原话:「克重费 ¥16.65 · 后处理 ¥5 · 支撑加价 ¥0
       * **不要显示明细**」。
       *
       * 摆明细等于把**成本结构**摆给访客 —— 每一档费用各是多少,一眼就看出
       * 哪一档贵、哪一档便宜(再跟体积一比,单价能反推出来)。总额摆出来
       * 就够了,明细留在工单上(那是收据)。
       *
       * ⚠️ **支撑没算的那句披露必须留着** —— 服务端按 `supportWeightG ?? 0`
       * 算,支撑还没算出来时那个总额**是偏低的**。删掉披露就等于「摆一个看着
       * 精确、其实少算了一笔的数」。这一句是**减法**(少算),跟明细那种
       * **加法**(多露)不是一回事。
       */}
      {supportPending ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("preview.supportPendingNote")}
        </p>
      ) : null}
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {t("preview.estimateHint")}
      </p>
      {/*
        「已含 1% 普票 · 不另收」(2026-11-17)
        ——
        工作室的原话。**不是成本结构** —— 是**卖点的另一半**:买家最常问的
        就是「发票怎么开 / 要不要另外收钱」,摆在预估价底下等于当场回答了。

        ⚠️ 这跟「费用明细不摆」不冲突 —— 明细是**加法**(把成本结构露出去),
        这一句是**减法**(少收的那一笔说清楚)。
      */}
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {t("invoice.note")}
      </p>
    </div>
  );
}
