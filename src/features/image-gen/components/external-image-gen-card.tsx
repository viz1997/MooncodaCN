"use client";

/**
 * 生图工作台 → 外部生图 入口（紧凑条）
 *
 * 把免登录的 /image-gen 页面作为独立子页提供给工作台用户：
 * - 「打开」按钮：新标签页打开 /image-gen
 * - 「复制链接」按钮：复制完整 URL
 *
 * 紧凑单行布局，避免占用工作台过多纵向空间
 */

import { Copy, ExternalLink, Globe } from "lucide-react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function ExternalImageGenCard() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "zh";
  const href = `/${locale}/image-gen`;

  const handleCopy = async () => {
    if (typeof window === "undefined") return;
    const absoluteUrl = `${window.location.origin}${href}`;
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      toast.success("已复制外部生图链接");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-md border border-violet-500/20 bg-violet-500/5 px-3 py-2">
      <Globe className="h-4 w-4 text-violet-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-tight">外部生图</p>
        <p className="text-[10px] text-muted-foreground leading-tight">
          免登录 · 分享给合作伙伴
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        className="h-7 px-2 text-xs"
      >
        <Copy className="h-3 w-3 mr-1" />
        复制链接
      </Button>
      <Button
        asChild
        size="sm"
        className="h-7 bg-gradient-to-r from-violet-500 to-purple-600 text-xs"
      >
        <a href={href} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-3 w-3 mr-1" />
          打开
        </a>
      </Button>
    </div>
  );
}
