"use client";

/**
 * 生图工作台 → 外部生图 入口（紧凑 Popover）
 *
 * 把免登录的 /image-gen 页面作为独立子页提供给工作台用户：
 * - 点击 globe icon → 弹出 Popover，内含「打开」+「复制链接」
 *
 * 放在工作台右侧「生成结果」标题栏右侧（与「新建会话」按钮并列），
 * 不再单独横在页面顶部。比起独立卡片，icon 按钮更克制，hover 才有信息。
 */

import { Copy, ExternalLink, Globe } from "lucide-react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          title="外部生图 · 免登录入口"
        >
          <Globe className="h-3.5 w-3.5 mr-1" />
          外部生图
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-64 space-y-2">
        <div className="space-y-0.5">
          <p className="text-sm font-medium leading-tight">外部生图入口</p>
          <p className="text-[10px] text-muted-foreground leading-tight">
            免登录 · 分享给合作伙伴
          </p>
        </div>
        <div className="rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[10px] break-all text-muted-foreground">
          {href}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="h-7 flex-1 text-xs"
          >
            <Copy className="h-3 w-3 mr-1" />
            复制链接
          </Button>
          <Button asChild size="sm" className="h-7 flex-1 text-xs">
            <a href={href} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3 mr-1" />
              打开
            </a>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}