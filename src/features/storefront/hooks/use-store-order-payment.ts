"use client";

/**
 * 商城订单的「去支付」—— 列表页和详情页**共用这一份**
 *
 * ## 为什么抽成 hook
 *
 * 付款入口有两种形态(跳转 / 扫码),每种都要自己管 loading、错误、二维码
 * 轮询。列表页和详情页各写一遍的话,改一次付款逻辑要改两个地方,漏一个
 * 就漂 —— 而漂的那一个用户会觉得「这个页面坏了」。
 *
 * **逻辑在 hook 里,版式在各自组件里** —— 列表页的二维码是整行展开的
 * (满宽),详情页的是居中的一块;版式不该被 hook 绑死。
 *
 * ## 微信是**扫码**,不是跳转
 *
 * 别的通道点了按钮整页跳走;微信点了之后**留在原地**画一个二维码 ——
 * 用户扫完码,页面轮询订单状态,收到款就显示「已支付」。
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

/**
 * 服务端的错误码 → i18n key
 *
 * 服务端同时给 `error`(机器码)和 `message`(中文人话)。这里**优先用码**翻
 * 成当前语言的话 —— 否则英文站上蹦出来一句中文。
 *
 * 认不出来的码 → 落回 `pay.failed`(通用那句),不用服务端那句中文。
 */
const ERROR_CODE_KEYS: Record<string, string> = {
  ALREADY_PAID: "pay.alreadyPaid",
  /**
   * 「支付宝那边说付了、我们核不上」(2026-11-14)
   *
   * 这一档**不能**落回 `pay.failed` —— 那句「生成支付入口失败,请稍后重试」
   * 会引导用户**再付一次**(钱可能已经到了)。
   */
  PAYMENT_UNVERIFIED: "pay.unverified",
  ORDER_REFUNDED: "pay.refunded",
  CARRIER_MISSING: "pay.carrierMissing",
  PAYMENT_NOT_CONFIGURED: "pay.notConfigured",
  PAYMENT_FAILED: "pay.failed",
  ORDER_NOT_FOUND: "pay.orderNotFound",
  AUTH_REQUIRED: "pay.authRequired",
};

export type StoreOrderPaymentState = {
  /** 跳转型通道的付款地址(支付宝) */
  paymentUrl: string | null;
  /** 扫码型通道的二维码内容(微信 Native) */
  qrCodeUrl: string | null;
  isLoading: boolean;
  /** 出错时的提示(已经是当前语言的话) */
  error: string | null;
  /** 点「去支付」 */
  startPayment: () => Promise<void>;
};

export function useStoreOrderPayment(orderNo: string): StoreOrderPaymentState {
  const t = useTranslations("StorefrontOrder");

  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startPayment = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/store/orders/${encodeURIComponent(orderNo)}/payment-link`,
        { method: "POST", credentials: "include" }
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        paymentUrl?: string | null;
        paymentQrCodeUrl?: string | null;
      };
      if (!res.ok) {
        const key = body?.error ? ERROR_CODE_KEYS[body.error] : undefined;
        setError(key ? t(key) : t("pay.failed"));
        setIsLoading(false);
        return;
      }
      // 微信 Native —— 扫码,页面留在原地
      if (body.paymentQrCodeUrl) {
        setQrCodeUrl(body.paymentQrCodeUrl);
        setIsLoading(false);
        return;
      }
      setPaymentUrl(body.paymentUrl ?? null);
      if (body.paymentUrl) {
        window.location.href = body.paymentUrl;
        return;
      }
      setError(t("pay.noLink"));
      setIsLoading(false);
    } catch {
      setError(t("pay.failed"));
      setIsLoading(false);
    }
  }, [orderNo, t]);

  /**
   * 扫完码之后轮询收款状态
   *
   * 微信的回调到本仓库有几秒延迟。不轮询的话用户得手动刷新 —— 扫完码盯着
   * 「待支付」不动,体验很差。
   *
   * **只扫二维码时才轮** —— 没有二维码就别打这个接口。
   */
  useEffect(() => {
    if (!qrCodeUrl) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/store/orders/${encodeURIComponent(orderNo)}`,
          { cache: "no-store", headers: { Accept: "application/json" } }
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          paymentStatus?: string;
          status?: string;
        };
        if (
          body?.paymentStatus === "paid" ||
          body?.status === "paid" ||
          body?.status === "fulfilled"
        ) {
          if (!cancelled) window.location.reload();
        }
      } catch {
        // 网络抖一下 —— 下一轮再试
      }
    };

    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [qrCodeUrl, orderNo]);

  return { paymentUrl, qrCodeUrl, isLoading, error, startPayment };
}
