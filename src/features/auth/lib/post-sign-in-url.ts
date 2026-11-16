/**
 * 登录之后回哪儿 —— 一份纯逻辑(2026-11-16)
 *
 * ## 为什么抽出来
 *
 * 登录页有两条路(邮箱密码 / 手机号 + 验证码),而其中一条**写死了
 * `/dashboard`**(`phone-sign-in-form.tsx` 里两处 `window.location.href =
 * "/dashboard"`)。用户从打印工作台点进来(带 `?callbackUrl=…`),用手机号
 * 登录之后却被甩到控制台 —— **量好的模型全丢了**。
 *
 * ⇒ 一份纯函数,两边共用,别各写一份。
 *
 * ## 这份文件是纯的
 *
 * 零 import、不碰 `window` / `document`(浏览器那一层在最后一个小函数里,
 * 而且只在**点击那一刻**被调用,不在渲染期跑)⇒ 能进 vitest 的 `unit`
 * project 跑单测。
 */

/** 兜底 —— 没 callbackUrl、referrer 也不认 ⇒ 回控制台 */
export const DEFAULT_POST_SIGN_IN_PATH = "/dashboard";

/**
 * 本仓库支持的语言 —— 跟 `src/i18n/routing.ts` 的 `locales` 一致
 *
 * 这里写死一份而不是 import —— 这个文件要能进 `unit` project(不 import
 * 任何仓库模块)。**加语言的时候两处一起改。**
 */
const LOCALES = ["en", "zh"] as const;

/**
 * 安全 callbackUrl 校验(防 open redirect)
 *
 * - 必须以 `/` 开头(相对路径)
 * - 不允许 `//` 开头(协议相对 ⇒ 外站)
 * - 不允许 `/\` 开头(部分浏览器会 normalize 成 `//`)
 */
export function isSafeCallbackPath(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\");
}

/** 路径上有没有语言前缀 —— `/zh/...` 有,`/english` 没有 */
function hasLocalePrefix(raw: string): boolean {
  return LOCALES.some((l) => raw === `/${l}` || raw.startsWith(`/${l}/`));
}

/** 从当前路径上认语言 —— `/zh/tools/workbench` ⇒ `zh` */
function localeFromPathname(pathname: string): string {
  const m = pathname.match(/^\/(en|zh)(?:\/|$)/);
  return m?.[1] ?? "";
}

/**
 * 给路径补上语言前缀
 *
 * 已带 `/en` / `/zh` 前缀的直接用 —— 否则补出来会变成 `/zh/zh/...`。
 * 当前路径认不出语言时**原样返回**(不瞎猜一个语言前缀)。
 */
export function withLocalePrefix(raw: string, currentPathname: string): string {
  if (hasLocalePrefix(raw)) return raw;
  const locale = localeFromPathname(currentPathname);
  if (!locale) return raw;
  return `/${locale}${raw.startsWith("/") ? "" : "/"}${raw}`;
}

/** 从查询串里读 `callbackUrl` */
export function readCallbackUrl(search: string): string | null {
  if (!search) return null;
  try {
    return new URLSearchParams(search).get("callbackUrl");
  } catch {
    return null;
  }
}

/**
 * 从 referrer 里取**同源**的相对路径
 *
 * 外站的 referrer 一律不认 —— 那是把用户送到外站去。
 */
export function readSameOriginReferrerPath(
  referrer: string,
  origin: string
): string | null {
  if (!referrer || !origin) return null;
  try {
    const url = new URL(referrer);
    if (url.origin !== origin) return null;
    if (!isSafeCallbackPath(url.pathname)) return null;
    // 带 query / hash 一起带回去(比如 `/image-gen?xxx`)
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // referrer 解析失败 → 跳过
    return null;
  }
}

/** 解析登录后跳转目标所需要的几个输入 */
export type PostSignInContext = {
  /** `location.search` */
  search: string;
  /** `document.referrer` */
  referrer: string;
  /** `location.origin` */
  origin: string;
  /** `location.pathname` */
  pathname: string;
};

/**
 * 登录后回哪儿 —— 优先级:
 *
 * 1. `?callbackUrl=…`(中间件踢过来 / 业务侧动态拼)
 * 2. `document.referrer` 里的**同源**路径(用户在公开页点登录 ⇒ 来自哪里
 *    回哪里)
 * 3. `/dashboard`(兜底)
 */
export function resolvePostSignInUrl(ctx: PostSignInContext): string {
  const callback = readCallbackUrl(ctx.search);
  if (callback && isSafeCallbackPath(callback)) {
    return withLocalePrefix(callback, ctx.pathname);
  }

  const referrerPath = readSameOriginReferrerPath(ctx.referrer, ctx.origin);
  if (referrerPath) {
    return withLocalePrefix(referrerPath, ctx.pathname);
  }

  return DEFAULT_POST_SIGN_IN_PATH;
}

/**
 * 浏览器那一层 —— 登录成功那一刻调
 *
 * `typeof window` 那句是**运行期**的守卫(SSR 时这个函数压根不会被调),
 * 不是渲染期的分支 ⇒ 不会有 hydration 不一致。
 */
export function resolvePostSignInUrlFromBrowser(): string {
  if (typeof window === "undefined") return DEFAULT_POST_SIGN_IN_PATH;

  return resolvePostSignInUrl({
    search: window.location.search,
    referrer: typeof document === "undefined" ? "" : document.referrer,
    origin: window.location.origin,
    pathname: window.location.pathname,
  });
}
