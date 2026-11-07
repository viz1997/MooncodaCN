"use client";

/**
 * 「加入打印单」那张卡上的**预估报价**(2026-11-07)
 *
 * 工作室的原话:「现在不登录也允许计价显示」。
 *
 * ## 价从哪儿来 —— 只有服务端
 *
 * 这个组件**不自己算价** —— 它把几何(体积 / 表面积 / 尺寸 / 支撑克重)
 * 发给 `POST /api/print-quote`,服务端按后台配的口径算,返回报价。
 *
 * 跟商城的购物袋一个道理:客户端算的价不能信(能被改)。工具页显示的这个
 * 数字只是**预估**,最终金额在打印单上按服务端重算的结果收。
 *
 * ## 访客能不能看到 —— 后台一个开关
 *
 * 未登录的人能不能看到价,由后台 `/admin/print-pricing` 的「访客可见计价」
 * 决定:
 *
 * | 情况 | 界面 |
 * |---|---|
 * | 报价成功 | 总额 + 一行明细 |
 * | 未登录 + 开关关着(接口回 403) | 「登录后可见报价」 |
 * | 算不出来 | 「算不出预估价」 |
 *
 * **已登录的人不受那个开关管** —— 能下单就能看价。
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
 * ## 交期不在这里
 *
 * 工具页一律按**标准档**算(交期在打印单上逐行选)。所以这个预估里
 * **没有交期加价** —— 打印单上选了加急 / 特急,金额会变。
 */

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type {
  PrintQuote,
  PrintQuoteInput,
} from "@/features/print-quote/lib/quote-types";
import { formatCents } from "@/lib/money";

/** 这块区域的五种状态 */
type PreviewState =
  /** 还没有模型 —— 什么都不摆 */
  | { kind: "empty" }
  /** 正在问服务端要价 */
  | { kind: "loading" }
  /** 拿到了报价 */
  | { kind: "ready"; quote: PrintQuote }
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
};

/** 报价请求防抖(毫秒)—— 拖尺寸滑块时别一路发 */
const QUOTE_DEBOUNCE_MS = 400;

export function PrintServiceQuotePreview({
  input,
}: PrintServiceQuotePreviewProps) {
  const t = useTranslations("PrintQuote");
  const [state, setState] = useState<PreviewState>({ kind: "empty" });

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
        const response = await fetch("/api/print-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
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

        const data = (await response.json()) as { quote?: PrintQuote };
        if (!data.quote) {
          setState({ kind: "error" });
          return;
        }
        setState({ kind: "ready", quote: data.quote });
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
  }, [input]);

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

  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{t("preview.label")}</p>
      <p className="text-lg font-semibold leading-tight tabular-nums">
        {formatCents(quote.totalPriceCents)}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {t("quote.weightFee")} {formatCents(quote.weightFeeCents)}
        {" · "}
        {t("quote.varnishFee")} {formatCents(quote.varnishFeeCents)}
        {" · "}
        {t("quote.supportFee")}{" "}
        {supportPending
          ? t("preview.supportPending")
          : formatCents(quote.supportFeeCents)}
      </p>
      {supportPending ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {t("preview.supportPendingHint")}
        </p>
      ) : null}
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {t("preview.estimateHint")}
      </p>
    </div>
  );
}
