/**
 * 付款二维码 —— 微信 Native 的付款入口
 *
 * ## 为什么要在**浏览器里**画码
 *
 * 微信 Native 下单拿到的是一段字符串:
 * `weixin://wxpay/bizpayurl?pr=…`。它**不是**图片 URL,得自己画成码。
 *
 * 画码这一步**绝不能交给外部二维码服务** —— 把 `code_url` 传给
 * `api.qrserver.com` 之类的第三方,等于把这一笔付款的入口交给别人看。
 * 所以用 `qrcode` 这个包在本地生成(data URL),不发出任何请求。
 *
 * `qrcode` 已经在本仓库里用过了(见 `features/gpt-image/user/components/
 * share-card.tsx`),不新增依赖。
 *
 * ## 有效期
 *
 * 微信的 `code_url` 是**一次会话的入口**。同一张单的 `out_trade_no` 在微信侧
 * 唯一,再建第二个 Native 会话会被拒(OUT_TRADE_NO_USED)—— 所以码只能**复用**
 * 存下来的那一个,没有「刷新二维码」这条路。真扫不动了(会话被关掉)只能由
 * 工作室处理。
 */

"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function PaymentQrCode({
  value,
  size = 220,
  hint,
}: {
  /** 二维码内容 —— 微信是 `weixin://wxpay/bizpayurl?pr=…` */
  value: string;
  /** 边长(px) */
  size?: number;
  /** 码下面的一行提示 */
  hint?: string | undefined;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);

    QRCode.toDataURL(value, {
      width: size,
      margin: 2,
      // M 级纠错 —— 微信的码带 logo 之类的遮挡时还能扫出来
      errorCorrectionLevel: "M",
      color: { dark: "#1c1917", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "二维码生成失败");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <p className="text-xs text-destructive">
        二维码生成失败:{error} —— 请刷新页面重试,或者联系工作室。
      </p>
    );
  }

  if (!dataUrl) {
    return (
      <div
        className="animate-pulse rounded-sm bg-muted"
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }

  return (
    <figure className="flex flex-col items-center gap-2">
      {/* data URL —— 不是外链,不出网 */}
      {/* biome-ignore lint/performance/noImgElement: data URL 不是外链资源 */}
      <img
        src={dataUrl}
        width={size}
        height={size}
        alt="付款二维码"
        className="rounded-sm border border-border bg-white"
      />
      {hint ? (
        <figcaption className="text-xs text-muted-foreground">
          {hint}
        </figcaption>
      ) : null}
    </figure>
  );
}
