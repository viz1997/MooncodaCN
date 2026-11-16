"use client";

import { useEffect } from "react";

import {
  buildTawkEmbedUrl,
  type TawkApiConfig,
  type TawkWindow,
} from "@/features/tawk/lib/tawk-config";

/**
 * tawk.to 在线客服小窗 —— **匿名版**(2026-11-16)
 *
 * ## 小窗**永远是匿名**的
 *
 * 工作室 2026-11-16 拍板:**不要**把登录访客的姓名 / 邮箱发给 tawk.to
 * (第三方 / 境外服务 + 个人信息)。⇒ 这一版**不 import `useSession`** ——
 * 不只是「不读身份」,连 `/api/auth/get-session` 那一次请求都不发
 * (访客没登录时那个请求纯属白跑一趟网络)。
 *
 * ## 为什么自己注入,不用官方的 `<Script>`
 *
 * 官方那段 embed 代码做两件事:
 *
 * 1. `var Tawk_API = Tawk_API || {}` —— **建一个配置对象**(方法还没装上);
 * 2. 插一条 `<script src="https://embed.tawk.to/{propertyId}/{widgetId}">`。
 *
 * ⇒ 自己插脚本(要在插之前把 `onLoad` 挂上去,官方那段代码没有这一步)。
 *
 * ## 三条硬规矩
 *
 * 1. **不重复注入** —— 靠脚本标签上的 `id` 判定(React StrictMode 会双挂载,
 *    客户端路由也会重跑 effect)。
 * 2. **`window.Tawk_API` 的方法调用前要判存在** —— 方法是 widget 起来之后
 *    才装上的,提前调会抛 `TypeError: not a function`。
 * 3. **不卸载** —— 没有 `shutdown()`、没有 remove script。tawk 的小窗是
 *    「关掉页面就没了」的东西,主动拆反而会留下半截状态。
 *
 * ## 渲染
 *
 * **什么都不渲染** —— 服务端和客户端渲染出来的 HTML **一模一样**
 * (仓库规矩:不许用 `typeof window` 分支,不许 hydration mismatch)。
 */

const /** 注入的脚本标签上的 id —— 用来防重复注入 */ TAWK_SCRIPT_ID =
    "tawk-embed-script";

/**
 * 拿到 `window.Tawk_API`(没有就建一个空的)
 *
 * 官方那段代码做的是 `var Tawk_API = Tawk_API || {}` —— 我们做同一件事:
 * **先建好一个配置对象**,脚本加载时它会往这个对象上装方法。
 */
function getTawkApi(): TawkApiConfig {
  const win = window as TawkWindow;
  if (!win.Tawk_API) win.Tawk_API = {};
  return win.Tawk_API;
}

/**
 * 装 tawk 的 widget
 *
 * @param propertyId tawk 的 property id
 * @param widgetId tawk 的 widget id
 * @param locale 站点语言 —— 摆进 tawk 的自定义属性,工作室在后台能按语言筛
 */
export function mountTawkWidget(options: {
  propertyId: string;
  widgetId: string;
  locale: string;
}): void {
  const embedUrl = buildTawkEmbedUrl(options.propertyId, options.widgetId);
  if (!embedUrl) return;

  const api = getTawkApi();

  // `onLoad` 官方说的是「在 widget 加载完成时触发」—— 这时候方法才装上。
  api.onLoad = () => {
    // 自定义属性要在后台配过才认,没配会报错 —— 忽略就好,不影响小窗。
    try {
      if (typeof api.setAttributes === "function") {
        api.setAttributes({ locale: options.locale }, () => undefined);
      }
    } catch {
      // 忽略 —— tawk 的自定义属性没在后台配过时它会抛
    }
  };

  // 已经注入过 ⇒ 不重复插(StrictMode 双挂载 / 客户端路由)
  if (document.getElementById(TAWK_SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = TAWK_SCRIPT_ID;
  script.async = true;
  script.charset = "UTF-8";
  script.src = embedUrl;
  document.body.appendChild(script);
}

export interface TawkWidgetProps {
  /** tawk 的 property id —— 后台 `/admin/site-settings` 里配的 */
  propertyId: string;
  /** tawk 的 widget id */
  widgetId: string;
  /** 站点语言(`zh` / `en`)—— 摆进 tawk 的自定义属性 */
  locale: string;
}

/**
 * 在线客服小窗
 *
 * **永远是匿名的** —— 不查会话、不发访客身份(工作室 2026-11-16 拍板)。
 *
 * **服务端和客户端都渲染 `null`** —— 脚本是浏览器里的事,服务端没有。
 */
export function TawkWidget({ propertyId, widgetId, locale }: TawkWidgetProps) {
  useEffect(() => {
    // 还没配 ⇒ 什么都不做(后台会摆一句「还没配」)
    // ⚠️ **每条路都显式 return** —— 仓库开了 `noImplicitReturns`,
    // 有一条路 `return <值>`、另一条路 `return;` 就会报错。
    if (!propertyId || !widgetId) return undefined;

    mountTawkWidget({ propertyId, widgetId, locale });
    return undefined;
  }, [propertyId, widgetId, locale]);

  return null;
}
