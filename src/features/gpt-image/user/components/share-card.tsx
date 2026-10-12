"use client";

/**
 * 分享弹窗 / 卡片 —— 展示二维码 + 复制链接 + 自保存按钮
 *
 * 2026-09-14 升级：从纯 section 区块升级为可作为 Modal 调用的组件。
 * 当传 `open` / `onClose` 时：作为弹窗（fixed inset-0 + 关闭按钮 + ESC 关闭）。
 * 不传 `open`：仍可作为 inline section 嵌入父级（保留向前兼容）。
 *
 * 调用方：
 *  - /image-gen（public-image-gen-view.tsx）—— demo 成功卡点「分享给客户」→ 弹窗
 *    模式，复用 submitted.token（promptOrder.token）。不再调 createPreviewShareAction
 *    写 preview_share 行（同一次下单多次点都用同一个 token）。
 *
 * 设计要点：
 *  - QR code 用 qrcode 包 toDataURL 生成 240px PNG（深色 #1c1917 兼容深色背景）
 *  - QR 内容 = `${origin}/p/{token}`，手机扫码直接打开分享页
 *  - 「复制链接」/「保存二维码」/「保存图片」三个按钮：
 *    - 复制链接：代理商最常用路径，复制到微信（navigator.clipboard + sonner toast）
 *    - 保存二维码：下载 qr-{orderNo}.png，让客户自己扫
 *    - 保存图片：调 onDownloadImage prop（/image-gen 走 handleDownload 直接下
 *      result.url 给代理商本地存档）
 *  - 移动端长按二维码 / 长按图默认触发系统"保存图片"，免费 fallback
 */

import { Copy, Download, QrCode, Share2, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ShareCardProps {
  /** 当前页面的完整 URL（含 origin），扫码后跳到这个分享页 */
  shareUrl: string;
  /** 订单号（用作下载文件名） */
  orderNo: string;
  /** 调 actions.download(orderNo, 0, 0) 触发候选图下载 */
  onDownloadImage: () => void | Promise<void>;
  /**
   * 2026-09-14：是否作为弹窗打开。传 `onClose` 时同步启用弹窗模式。
   * 不传 → 当作 inline section 渲染（保留向前兼容）。
   */
  open?: boolean;
  /** 弹窗关闭回调。点 ESC / 点遮罩 / 点关闭按钮都会调。 */
  onClose?: () => void;
}

export function ShareCard({
  shareUrl,
  orderNo,
  onDownloadImage,
  open,
  onClose,
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

  // 2026-09-14：弹窗模式 —— ESC 关闭 + body scroll lock，避免背景跟着滚。
  // onClose 是父组件 inline 函数（`() => setShowShareModal(false)`）每次 render 都新引用；
  // 不能直接放 deps —— 父组件任一 state 变化（generating / selectedCell / result）都会让
  // effect cleanup→setup 重跑，把 body overflow 反复设回 "hidden" 导致页面永久锁死。
  // 用 onCloseRef 解绑依赖，effect 只在 open 切换时跑。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const onKey = (_e: KeyboardEvent) => {
      onCloseRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      // 恢复 overflow —— 不论 prevOverflow 是什么（"hidden" / "" / "auto"），
      // 都设回原值。如果原值是 "hidden"（说明页面本来就被锁），保持 "hidden"。
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

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

  const body = (
    <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Share2 className="h-4 w-4 text-stone-700" />
          <h3 className="text-sm font-semibold tracking-tight text-stone-900">
            分享给朋友
          </h3>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭分享弹窗"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
          >
            <X className="h-4 w-4" />
          </button>
        )}
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
    </div>
  );

  // 弹窗模式：fixed 全屏 + 关闭按钮 + ESC 关闭 + body scroll lock（见上面 useEffect）
  if (open && onClose) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="分享给客户"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={(e) => {
          // 点遮罩关闭（点弹窗本身不冒泡到遮罩）
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="w-full max-w-md">{body}</div>
      </div>
    );
  }

  // 关闭状态不渲染任何东西 —— 之前 fallback 到 inline `<section>`，导致父组件
  // 永远挂载 ShareCard 时页面初次加载就有一个「分享给朋友」section 占位（用户
  // 报告「一直有分享给用户的弹窗」）。inline section 用法已废弃，需要的话父组件
  // 自己 render body JSX。
  return null;
}
