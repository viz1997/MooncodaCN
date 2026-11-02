"use client";

/**
 * 生图入口的登录门槛(2026-11-02)
 *
 * 电商首页的「上传照片开始 / 定制」最终会打到 `/api/store/ai/transform` ——
 * 那是一次真实的上游 AI 调用(18–35s、真花钱)。匿名访客白嫖这条链路,所以:
 *
 *  - **服务端** `/api/store/ai/transform` 缺会话一律 401(权威闸门);
 *  - **客户端**在进工作台之前就把未登录访客送去 `/sign-in`,免得访客传完图、
 *    选完风格,等到点「生成预览」才被拦下(照片白传,体验最差)。
 *
 * ## callbackUrl 为什么自己拼 locale 前缀
 *
 * next-intl 的 `usePathname()` 返回的是**去掉 locale 前缀**的内部路径。
 * 直接把它当 callbackUrl 回跳,intl 中间件会二次重定向。这里手动拼
 * `/zh|/en`,跟 `marketing/header.tsx` 的 `useSignInUrl` 同一套写法。
 *
 * 2026-11-01 教训:**不要用 `typeof window === "undefined"` 分支** —— 服务端和
 * 客户端会算出两个不同的 href → hydration mismatch。locale 走 next-intl 的
 * `useLocale()`(SSR 可见),pathname 走 `usePathname()`(SSR 可见),两端一致。
 */

import { useLocale } from "next-intl";
import { useCallback, useMemo } from "react";

import { usePathname, useRouter } from "@/i18n/routing";
import { useSession } from "@/lib/auth/client";

/**
 * 当前页的登录链接(带 callbackUrl,登录后回到当前页)。
 *
 * 跟 `marketing/header.tsx` 的 `useSignInUrl` 同构,只是那边是给 `<Link>` 用的,
 * 这边给 `router.push` 用 —— 后者会自动补上 locale 前缀,所以 callbackUrl 里
 * 必须自带前缀(它是要被回跳的完整 URL)。
 */
export function useSignInUrl(): string {
  const locale = useLocale();
  const pathname = usePathname();
  return useMemo(() => {
    const target = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const prefix = locale ? `/${locale}` : "";
    return `/sign-in?callbackUrl=${encodeURIComponent(`${prefix}${target}`)}`;
  }, [locale, pathname]);
}

/**
 * 跑 action,前提是已登录;没登录就把人送去登录页(登录后回到当前页)。
 *
 * ## 会话还在加载时为什么不拦
 *
 * `useSession()` 首次挂载时 `isPending` 为 true,那会儿还不知道有没有登录 ——
 * 拦了会把已登录用户误弹去登录页。所以 pending 时**放行**,让服务端 401 兜底:
 * 真没登录的话,生图那一步照样被 401 拦下并跳登录页。
 */
export function useRequireSignIn(): (action: () => void) => void {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const signInUrl = useSignInUrl();

  return useCallback(
    (action: () => void) => {
      if (isPending || session?.user) {
        action();
        return;
      }
      router.push(signInUrl);
    },
    [isPending, session, router, signInUrl]
  );
}
