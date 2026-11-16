"use client";

import { useCallback, useEffect } from "react";

import type { TawkVisitor } from "@/features/tawk/lib/tawk-config";
import { useSession } from "@/lib/auth/client";

import { mountTawkWidget, type TawkWidgetProps } from "./tawk-widget";

/**
 * tawk.to 在线客服小窗 —— **带身份版**(2026-11-16)
 *
 * ## 什么时候才用这一版
 *
 * **后台那颗开关打开的时候**(「把登录访客的姓名和邮箱告诉客服」)。
 * 工作室 2026-11-16 拍板:**默认关** —— tawk.to 是第三方服务,访客的姓名 /
 * 邮箱是个人信息 ⇒ 发不发由工作室自己决定。
 *
 * 开关关 ⇒ 走 `tawk-widget.tsx` 那个**匿名版**(连会话都不查)。
 *
 * ## 会话为什么要「等一下」
 *
 * 身份来自客户端的 `useSession()`(better-auth)。但:
 *
 * - **不能用服务端 `headers()` 读 cookie** —— 那会让整个公开商城站
 *   (`/legal/**` / `/cart` / `/checkout` / `/product/[handle]` / `/tools/**`)
 *   全部变成动态渲染。仓库里 `/legal/shipping` 那种静态页要保住构建期预渲染。
 * - **也不能无限等** —— 会话查不到 / 失败时不能把客服小窗卡住不出现。
 *
 * ⇒ **最多等 1.5 秒**:会话在这之前落定 ⇒ 带上身份;超了 ⇒ 不带身份照样装
 * (匿名客服一样能用,少个名字而已)。
 *
 * ## 身份必须在脚本下载**之前**设上
 *
 * tawk 只在加载那一刻读一次 `window.Tawk_API.visitor` ⇒ 晚设就不认。
 * `mountTawkWidget()` 干这件事(它先设 `visitor`,再插脚本)。
 */

/**
 * 等会话落定的上限(毫秒)
 *
 * 1.5 秒 —— 够本地 / 正常网络下 better-auth 把会话查回来;
 * 又不至于让「会话查不到」的用户等太久才看到客服小窗。
 */
const TAWK_SESSION_WAIT_MS = 1500;

/**
 * 在线客服小窗 —— **带访客身份**
 *
 * 登录访客的姓名 / 邮箱会发给 tawk.to(第三方服务)—— 只在**工作室在后台
 * 打开了那颗开关**的时候才走这一版。
 *
 * **服务端和客户端都渲染 `null`** —— 脚本是浏览器里的事,服务端没有。
 */
export function TawkWidgetWithIdentity({
  propertyId,
  widgetId,
  locale,
}: TawkWidgetProps) {
  const { data: session, isPending } = useSession();

  const mount = useCallback(
    (visitor?: TawkVisitor) => {
      mountTawkWidget({ propertyId, widgetId, locale, visitor });
    },
    [propertyId, widgetId, locale]
  );

  useEffect(() => {
    // 还没配 ⇒ 什么都不做(后台会摆一句「还没配」)
    // ⚠️ **每条路都显式 return** —— 仓库开了 `noImplicitReturns`,
    // 有一条路 `return <值>`、另一条路 `return;` 就会报错。
    if (!propertyId || !widgetId) return undefined;

    // 会话还在查 ⇒ 等一下(有上限)
    if (isPending) {
      const timer = setTimeout(() => mount(undefined), TAWK_SESSION_WAIT_MS);
      return () => clearTimeout(timer);
    }

    const user = session?.user;
    mount(
      user
        ? {
            name: user.name ?? undefined,
            email: user.email ?? undefined,
          }
        : undefined
    );
    return undefined;
    // `propertyId` / `widgetId` 显式列出来 —— 它们被这个 effect 直接读了
    // (`mount` 那一层也依赖它们,但写出来才看得见「换 ID ⇒ 重跑」)
  }, [mount, isPending, session?.user, propertyId, widgetId]);

  return null;
}
