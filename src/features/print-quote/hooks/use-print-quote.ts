"use client";

/**
 * 服务端报价 —— 防抖请求 + 过期判定
 *
 * ## 为什么抽出来
 *
 * 报价的请求逻辑原来在两个地方要用:
 *
 * - `/quote` 报价台(直接下单那条路)
 * - `/tools/weight` 克重工具(加入购物车那条路,2026-11-06 已撤下)
 *
 * 两边**必须**是同一套:同样的防抖窗口、同样的「旧响应不能盖掉新响应」判定、
 * 同样的「报价过没过期」口径。两处各写一遍的话,改了一处忘了另一处,就会出现
 * 「报价台说 61.18、工具页说 61.20」这种用户一眼看出来的对不上。
 *
 * 2026-11-06 起**只有报价台**在用这个 hook —— 工具页不显示价格、也不调报价
 * 接口(计算器跑工具模式,几何数据不抛给服务端)。hook 留着是因为「报价只有
 * 一处算」这条规矩本身有价值:再加第二个报价入口的时候,照着这个 hook 接,
 * 不要另写一套。
 *
 * ## 报价必须带输入一起存
 *
 * 只存报价不够:用户改了尺寸之后,新报价要等 400ms 防抖 + 一次往返才回来,
 * 这期间界面上挂的还是**旧几何的价**。只看「有没有报价」来决定能不能下单,
 * 就会让用户按旧价确认、服务端按新价建单 —— 两边对不上。
 *
 * 所以报价必须带着它的输入一起存,靠 `quoteFresh` 判断它跟当前几何还对不对得上。
 */

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_DELIVERY_TIER,
  type DeliveryTierId,
} from "../lib/delivery-tier";
import type { PrintQuote, PrintQuoteInput } from "../lib/quote-types";

/**
 * 防抖窗口(毫秒)
 *
 * 拖尺寸滑块会连着触发几十次几何变化 —— 不防抖就是几十次请求。
 * 400ms 是个体感合适的值:停手之后价格立刻跟上。
 */
const QUOTE_DEBOUNCE_MS = 400;

/**
 * 两组几何是不是同一组
 *
 * 按值比 —— 几何每次变化都是新对象,比引用永远不相等。
 * 报价是否过期、下单前的一致性检查都靠它。
 */
export function sameQuoteInput(
  a: PrintQuoteInput | null,
  b: PrintQuoteInput | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.volumeCM3 === b.volumeCM3 &&
    a.surfaceAreaCM2 === b.surfaceAreaCM2 &&
    a.dims[0] === b.dims[0] &&
    a.dims[1] === b.dims[1] &&
    a.dims[2] === b.dims[2] &&
    (a.supportWeightG ?? null) === (b.supportWeightG ?? null) &&
    (a.selfSupportRatio ?? null) === (b.selfSupportRatio ?? null)
  );
}

/** `usePrintQuote()` 的返回值 */
export type UsePrintQuoteResult = {
  /** 当前几何(克重工具抛过来的) */
  quoteInput: PrintQuoteInput | null;
  /** 设置几何 —— 传给 `PricingCalculator` 的 `onQuoteInput` */
  setQuoteInput: (input: PrintQuoteInput | null) => void;
  /** 当前交期档位 */
  deliveryTier: DeliveryTierId;
  /** 切档位 —— 会触发重新报价 */
  setDeliveryTier: (tier: DeliveryTierId) => void;
  /** 服务端报价;null = 还没算出来 */
  quote: PrintQuote | null;
  /**
   * 挂着的报价跟当前几何还对得上吗?
   *
   * 对不上 = 界面上的价是上一组尺寸的,不能拿去下单 / 加购。
   */
  quoteFresh: boolean;
  /** 报价请求进行中 */
  loading: boolean;
  /** 报价失败原因 */
  error: string | null;
};

export function usePrintQuote(): UsePrintQuoteResult {
  const t = useTranslations("PrintQuote");

  const [quoteInput, setQuoteInput] = useState<PrintQuoteInput | null>(null);
  const [deliveryTier, setDeliveryTier] = useState<DeliveryTierId>(
    DEFAULT_DELIVERY_TIER
  );
  const [quoteResult, setQuoteResult] = useState<{
    input: PrintQuoteInput;
    quote: PrintQuote;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `latestInputRef` 存当前几何:响应回来时先比一下,晚到的旧响应直接丢,
  // 免得旧几何的价把新几何的价盖掉。
  const latestInputRef = useRef(quoteInput);
  useEffect(() => {
    latestInputRef.current = quoteInput;
  }, [quoteInput]);

  // 交期档位也要防「旧响应盖掉新响应」—— 连点三档,回来的顺序不保证
  const latestTierRef = useRef(deliveryTier);
  useEffect(() => {
    latestTierRef.current = deliveryTier;
  }, [deliveryTier]);

  useEffect(() => {
    if (!quoteInput) {
      setQuoteResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    const requestedInput = quoteInput;
    const requestedTier = deliveryTier;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      void (async () => {
        try {
          const res = await fetch("/api/print-quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...requestedInput,
              deliveryTier: requestedTier,
            }),
            signal: controller.signal,
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
              message?: string;
            } | null;
            setError(body?.message ?? t("quote.error"));
            setQuoteResult(null);
            return;
          }
          const body = (await res.json()) as { quote: PrintQuote };
          // 几何或交期档位在这期间又变了 → 这个价已经过期,丢掉(新请求在路上)
          if (!sameQuoteInput(requestedInput, latestInputRef.current)) return;
          if (requestedTier !== latestTierRef.current) return;
          setQuoteResult({ input: requestedInput, quote: body.quote });
          setError(null);
        } catch (err) {
          // 几何又变了 → 这次请求作废,新的请求已经在路上
          if ((err as Error)?.name === "AbortError") return;
          setError(t("quote.error"));
          setQuoteResult(null);
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [quoteInput, deliveryTier, t]);

  const quote = quoteResult?.quote ?? null;

  /**
   * 交期档位也算在内:换档位要重新报价,回来的路上界面挂的还是旧档位的价 ——
   * 那时候不能下单(用户以为付的是加急的钱,服务端按标准档建单)。
   */
  const quoteFresh = useMemo(
    () =>
      quoteResult !== null &&
      quoteInput !== null &&
      sameQuoteInput(quoteResult.input, quoteInput) &&
      quoteResult.quote.deliveryTier === deliveryTier,
    [quoteResult, quoteInput, deliveryTier]
  );

  return {
    quoteInput,
    setQuoteInput,
    deliveryTier,
    setDeliveryTier,
    quote,
    quoteFresh,
    loading,
    error,
  };
}
