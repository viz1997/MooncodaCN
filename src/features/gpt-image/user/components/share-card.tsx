"use client";

/**
 * /p/[token] 分享卡片 —— 终态展示二维码 + 自保存按钮
 *
 * 2026-09-13：原 ResultStep 只有"下载全部 N 批"按钮，转发给朋友不方便。
 * 新增这张卡片：
 *  - QR code 用 qrcode 包 toDataURL 生成 240px PNG（深色 #1c1917 兼容深色背景）
 *  - QR 内容 = 当前页面 URL（`/p/{token}`），手机扫码直接打开分享页
 *  - 「保存二维码」/「保存图片」两个按钮，分别下载 qr-{orderNo}.png 和
 *    候选图 PNG（走 actions.download 复用的服务端 stream，与 ResultStep 同源）
 *  - 移动端长按二维码 / 长按图默认触发系统"保存图片"，免费 fallback
 */

import { Download, QrCode, Share2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface ShareCardProps {
  /** 当前页面的完整 URL（含 origin），扫码后跳到这个分享页 */
  shareUrl: string;
  /** 订单号（用作下载文件名） */
  orderNo: string;
  /** 调 actions.download(orderNo, 0, 0) 触发候选图下载 */
  onDownloadImage: () => void | Promise<void>;
}

export function ShareCard({
  shareUrl,
  orderNo,
  onDownloadImage,
}: ShareCardProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [qrErr, setQrErr] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(shareUrl, {
      width: 240,
      margin: 2,
      color: { dark: "#1c1917", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setQrErr(err instanceof Error ? err.message : "二维码生成失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  return (
    <section className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Share2 className="h-4 w-4 text-stone-700" />
        <h3 className="text-sm font-semibold tracking-tight text-stone-900">
          分享给朋友
        </h3>
      </div>

      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="shrink-0 rounded-xl border border-stone-100 bg-stone-50 p-2">
          {qrDataUrl ? (
            // biome-ignore lint/performance/noImgElement: data URL from qrcode
            <img
              src={qrDataUrl}
              alt={`订单 ${orderNo} 分享二维码`}
              className="h-32 w-32"
            />
          ) : (
            <div className="flex h-32 w-32 items-center justify-center text-xs text-stone-400">
              {qrErr || "生成中..."}
            </div>
          )}
        </div>

        <div className="w-full flex-1 space-y-2">
          <p className="text-xs leading-relaxed text-stone-600">
            用手机相机扫描二维码，把这张效果图的分享链接发给朋友。
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href={qrDataUrl || "#"}
              download={`qr-${orderNo}.png`}
              aria-disabled={!qrDataUrl}
              className={cn(
                "inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-stone-200 px-3 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50",
                !qrDataUrl && "pointer-events-none opacity-50"
              )}
            >
              <QrCode className="h-4 w-4" />
              保存二维码
            </a>
            <button
              type="button"
              onClick={() => {
                void onDownloadImage();
              }}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-500 px-3 text-xs font-medium text-white shadow-sm transition-all hover:shadow-md active:scale-[0.99]"
            >
              <Download className="h-4 w-4" />
              保存图片
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}