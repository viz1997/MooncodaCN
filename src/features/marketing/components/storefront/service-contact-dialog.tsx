"use client";

/**
 * 页脚「客服」那一栏 —— 点开弹客服微信二维码(2026-11-13)
 *
 * 工作室的要求:**「底部增加客服联系方式,比如点击后展示客服的微信二维码」**。
 *
 * ## 三条口径
 *
 * 1. **模型/图片地址来自后台** —— `service_setting` 的 `service_wechat_qr_url`
 *    那一行(真理源是 DB,环境变量退成兜底,见
 *    `src/features/site-settings/lib/site-setting.ts`)。工作室换码不用改代码、
 *    不用重新部署。
 * 2. **图片加载不出来也有话说** —— 那个 `<img>` 带 onError 兜底:加载失败就
 *    把图收起来,改摆「二维码还没放上来」+ 邮箱 + 工单入口。**不能给用户一个
 *    破图** —— 客服入口是页脚里最要紧的一条联系渠道。
 * 3. **portal 指回 `.atelier-root`** —— 否则弹窗落在 atelier 的配色 token
 *    之外,变成全站默认主题(见 `useAtelierContainer` 的文件头)。
 *
 * ## 为什么用普通 `<img>` 而不是 next/image
 *
 * 图片地址是**后台可配的任意地址**(R2 公网地址 / 站内路径)⇒ 走 next/image
 * 的话得把 R2 域名加进 `images.remotePatterns`,后台换一个域名就白屏。
 * 二维码图不需要优化 ⇒ 直接 `<img>`。
 */

import { Mail, MessageCircle, Ticket } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAtelierContainer } from "@/features/storefront/hooks/use-atelier-container";

/** 客服邮箱 —— 跟 `src/config/site.ts` 的兜底地址一致 */
const SERVICE_EMAIL = "support@mooncoda.com";

export function ServiceContactDialog({ qrUrl }: { qrUrl: string }) {
  const container = useAtelierContainer();
  const [qrBroken, setQrBroken] = useState(false);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors text-left"
        >
          客服微信
        </button>
      </DialogTrigger>

      <DialogContent
        portalContainer={container}
        className="max-w-[22rem] text-center"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center justify-center gap-2">
            <MessageCircle className="h-5 w-5" />
            客服微信
          </DialogTitle>
          <DialogDescription>
            扫码加上客服微信,问报价、问交期、问能不能印 —— 都行。
          </DialogDescription>
        </DialogHeader>

        {qrUrl && !qrBroken ? (
          <div className="mx-auto w-fit rounded-xl border bg-white p-3">
            <img
              src={qrUrl}
              alt="客服微信二维码"
              width={200}
              height={200}
              className="h-[200px] w-[200px] object-contain"
              /* 加载不出来 ⇒ 收起来,改摆邮箱 + 工单入口(不能给用户一个破图) */
              onError={() => setQrBroken(true)}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground leading-relaxed">
            二维码还没放上来 —— 先用下面的方式联系客服,一样的。
          </div>
        )}

        <div className="flex flex-col gap-2 text-sm">
          <a
            href={`mailto:${SERVICE_EMAIL}`}
            className="flex items-center justify-center gap-2 rounded-md border px-3 py-2 transition-colors hover:bg-accent"
          >
            <Mail className="h-4 w-4" />
            {SERVICE_EMAIL}
          </a>
          <a
            href="/dashboard/support"
            className="flex items-center justify-center gap-2 rounded-md border px-3 py-2 transition-colors hover:bg-accent"
          >
            <Ticket className="h-4 w-4" />
            提交在线工单
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
