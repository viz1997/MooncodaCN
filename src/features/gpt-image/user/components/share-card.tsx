"use client";

/**
 * 代理商侧分享卡片 —— 展示二维码 + 复制链接 + 自保存按钮
 *
 * 仅用于 /image-gen 成功卡（public-image-gen-view.tsx），让代理商一键生成
 * QR / 复制链接发给客户扫码进 /p/[token]。**不**在客人侧 /p/[token] 出现——
 * 客人扫码进 /p/[token] 时手里已经有这条链接（/p/[token] 本身就是分享凭证），
 * 再展示「分享给朋友」是冗余动作。
 *
 * 2026-09-13：原 /image-gen 结果卡只有"下载图片"按钮，发给客户不方便。
 * 新增这张卡片：
 *  - QR code 用 qrcode 包 toDataURL 生成 240px PNG（深色 #1c1917 兼容深色背景）
 *  - QR 内容 = `${origin}/p/{token}`（demo 流 token / preview token 都适用），
 *    手机扫码直接打开分享页
 *  - 「复制链接」/「保存二维码」/「保存图片」三个按钮：
 *    - 复制链接：代理商最常用路径，复制到微信（navigator.clipboard + sonner toast）
 *    - 保存二维码：下载 qr-{orderNo}.png，让客户自己扫
 *    - 保存图片：调 onDownloadImage prop（/image-gen 走 handleDownload 直接下
 *      result.url 给代理商本地存档）
 *  - 移动端长按二维码 / 长按图默认触发系统"保存图片"，免费 fallback
 *  - URL 文本展示在按钮上方（truncate + select-all 友好），方便代理商肉眼校验
 *
 * 两路 /image-gen 场景：
 *  - demo 流「选择此效果下单」成功后：token 指向 /p/{demoToken]（demo 流不进
 *   /p/[token] 是因为 candidates 是单 composite，candIdx>0 找不到图——但
 *    ShareCard 用 result.url 本地存档）
 *  - preview 流「分享给客户预览」成功后：token 指向 /p/{previewToken]（客人
 *    真的会扫码进去确认）
 */

import { Copy, Download, QrCode, Share2 } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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

  // 2026-09-13：复制分享链接 —— 代理商最常用路径（粘到微信）。fallback 用
  // 隐藏 textarea + execCommand("copy") 兼容极老浏览器；现代浏览器走
  // navigator.clipboard.writeText（异步、需 https 或 localhost）。
  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast.success("链接已复制");
    } catch {
      toast.error("复制失败，请手动选中链接");
    }
  };

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
            用手机相机扫描二维码，或复制链接发给朋友。
          </p>
          {/* 2026-09-14：去 URL 文本显示 —— 只保留一个独立「复制链接」按钮。
              URL 不再以文本形式外露，避免代理商截图分享时无意暴露 token，
              也避免长链接撑爆布局。点击按钮复制到剪贴板（toast 提示）。 */}
          <button
            type="button"
            onClick={() => {
              void handleCopy();
            }}
            disabled={!shareUrl}
            className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
            复制链接
          </button>
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
