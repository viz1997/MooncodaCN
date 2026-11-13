/**
 * 站点设置的**纯逻辑** —— 零 import(能进 `unit` project 跑单测)
 *
 * ## 这一层管什么
 *
 * 「后台能改、不用重新部署」的站点级设置都走这套口径。第一项是**海外独立站
 * 的顾客访问地址**(2026-11-11 加的),第二项是**客服微信二维码的图片地址**
 * (2026-11-13 加的 —— 页脚「客服」那一栏,点开弹二维码)。
 *
 * ## 为什么不再只靠环境变量
 *
 * `NEXT_PUBLIC_*` 是**构建期内联**的 ⇒ 改完环境变量要**重新部署**才生效。
 * 工作室 2026-11-11 的要求是:**「不需要环境变量,在后台设置」** ⇒ 真理源
 * 搬到 DB(`site_setting` 表),环境变量退成**兜底**。
 *
 * ## 回退链(逐键)
 *
 * ```
 * 海外独立站:DB 那一行 → NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL → 空(不显示入口)
 * 客服二维码:DB 那一行 → NEXT_PUBLIC_SERVICE_WECHAT_QR_URL → /service/wechat-qr.png
 * ```
 *
 * ⚠️ **DB 里存了空串 = 明确关掉** —— 不是「没配」。所以后台能把入口关掉,
 * 哪怕环境变量还配着(那正是「在后台设置」的意义)。
 *
 * ## 为什么不合法就不显示(而不是照样渲染)
 *
 * 这个地址会被渲染成 `<a href=…>` ⇒ 渲染路径上**必须**校验过。
 * 万一有人直接改库(或者以后某个写入口漏了校验),一个
 * `javascript:…` 就会挂在页面上。⇒ **不合法的地址一律不显示**,并把
 * `invalid` 标出来 —— 后台要能看见「你存的那个地址不能用」。
 */

/* -------------------------------------------------------------------------- */
/*  键                                                                          */
/* -------------------------------------------------------------------------- */

/**
 * 设置的键 —— 一行一个键
 *
 * **键名写在代码里**,不写在 DB 里 —— 键是接口,DB 里多出来的行没人认领。
 */
export const SITE_SETTING_KEYS = {
  /** 海外独立站(Shopify)的顾客访问地址 */
  internationalStoreUrl: "international_store_url",
  /**
   * 客服微信二维码的图片地址(2026-11-13 加的)
   *
   * 页脚「客服」那一栏 —— 点一下弹出客服微信的二维码。
   */
  serviceWechatQrUrl: "service_wechat_qr_url",
} as const;

export type SiteSettingKey =
  (typeof SITE_SETTING_KEYS)[keyof typeof SITE_SETTING_KEYS];

/**
 * 客服微信二维码的**默认路径**(2026-11-13)
 *
 * 工作室把二维码图片放在 `public/service/wechat-qr.png` ⇒ 页面上的默认
 * 地址就是 `/service/wechat-qr.png`。
 *
 * ## 为什么要有这一档
 *
 * 后台那一栏存的是**一个 URL** —— 工作室能贴 R2 上的公网地址(换码不用
 * 重新部署),但**上传图片本身没有界面**(后台的文件管理页只列 / 删,不传)。
 * ⇒ 给一条「文件放进仓库就能生效」的兜底:后台那一行**不填**时,页面照样
 * 去找 `/service/wechat-qr.png`。
 *
 * ⚠️ **图片不存在也不会白屏** —— 那个 `<img>` 有 onError 兜底:加载失败就
 * 把图片收起来,改摆「二维码还没放上来 + 邮箱 + 工单入口」。
 *
 * ⚠️ 这个路径**不走 locale 前缀重定向** —— `src/proxy.ts` 的 matcher 已经
 * 把 `*.png` 排除在外(跟 wasm / py 一个道理,见那里踩过的坑)。
 */
export const DEFAULT_SERVICE_WECHAT_QR_PATH = "/service/wechat-qr.png";

/* -------------------------------------------------------------------------- */
/*  生效值                                                                      */
/* -------------------------------------------------------------------------- */

/** 这个生效值是从哪儿来的 */
export type SiteSettingSource =
  /** 后台配置(DB 里那一行) */
  | "db"
  /** 环境变量兜底 */
  | "env"
  /**
   * 代码里的静态默认值(2026-11-13 加的)
   *
   * 目前只有客服微信二维码用得上:后台那一行没填 ⇒ 走
   * `DEFAULT_SERVICE_WECHAT_QR_PATH`(`/service/wechat-qr.png`)。
   */
  | "default"
  /** 哪儿都没配 */
  | "none";

/** 解析出来的生效值 */
export interface ResolvedSiteSetting {
  /** 真正能拿去渲染的地址(空 = 不显示入口) */
  url: string;
  /** 它是从哪儿来的 */
  source: SiteSettingSource;
  /**
   * 存着的值**不合法** —— 渲染时已经忽略了
   *
   * 后台要提示:「你存的那个地址不能用」,而不是让人对着一个空地址发呆。
   */
  invalid: boolean;
}

/* -------------------------------------------------------------------------- */
/*  归一化 / 校验                                                               */
/* -------------------------------------------------------------------------- */

/** 地址不合法的原因 */
export type SiteUrlErrorCode =
  /** 空 —— 后台允许存空串(那表示「明确关掉」),但**保存**时空串是合法的 */
  | "EMPTY"
  /** 根本不是一个 URL */
  | "INVALID_URL"
  /** 是 URL,但不是 http(s) —— `javascript:` / `mailto:` 那种 */
  | "NOT_HTTP";

/**
 * 归一化 —— 去空格、去结尾的斜杠
 *
 * `"https://x.myshopify.com/"` 和 `"https://x.myshopify.com"` 是同一个地址,
 * 但存进 DB 的是前者、渲染出去的也是前者 ⇒ 后台的「当前生效值」跟页面上的
 * 对不上。归一化一次,两边一个样。
 */
export function normalizeStorefrontUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";

  let out = trimmed;
  // 去掉结尾的斜杠 —— 但 `"https://"` 这种光秃秃的协议头得留着(它非法,
  // 交给校验去说)
  while (out.endsWith("/") && !/^https?:\/\/$/i.test(out)) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * 校验一个地址能不能拿去渲染
 *
 * **只认 http / https** —— `javascript:` / `data:` / `mailto:` 那种一律
 * 拒掉(渲染成 `<a href>` 就是一条能点就执行的链接)。
 */
export function validateStorefrontUrl(
  raw: string
): { ok: true; value: string } | { ok: false; code: SiteUrlErrorCode } {
  const value = normalizeStorefrontUrl(raw);
  if (!value) return { ok: false, code: "EMPTY" };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, code: "INVALID_URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, code: "NOT_HTTP" };
  }
  if (!parsed.hostname) return { ok: false, code: "INVALID_URL" };

  return { ok: true, value };
}

/**
 * 校验**客服二维码图片地址**(2026-11-13)
 *
 * 跟 `validateStorefrontUrl` 的差别:**多认一档站内路径**。
 *
 * ## 为什么要多认站内路径
 *
 * 二维码图**不是链接**,是**一张图片** —— 它最自然的形态是仓库里的一张
 * 静态文件(`public/service/wechat-qr.png` ⇒ `/service/wechat-qr.png`),
 * 而不是 R2 上的公网地址。后台那一栏如果不认站内路径,工作室就得先把图
 * 传到 R2 才能填 —— 多一道手续。
 *
 * ⚠️ **`//evil.com/x.png` 不认** —— 那是「协议相对地址」,浏览器会当成
 * `https://evil.com/x.png` 去请求 ⇒ 等于让一个后台可配的字段变成一个
 * 「从别的站加载图片」的入口。**只认单个斜杠开头的站内路径**。
 */
export function validateServiceQrUrl(
  raw: string
): { ok: true; value: string } | { ok: false; code: SiteUrlErrorCode } {
  const value = normalizeStorefrontUrl(raw);
  if (!value) return { ok: false, code: "EMPTY" };

  // 站内路径 —— 单个斜杠开头
  if (value.startsWith("/")) {
    if (value.startsWith("//")) {
      // 协议相对地址 ⇒ 当成非法(见上面的说明)
      return { ok: false, code: "INVALID_URL" };
    }
    return { ok: true, value };
  }

  return validateStorefrontUrl(value);
}

/* -------------------------------------------------------------------------- */
/*  回退链                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 解析一个站点设置的生效地址 —— **回退链的通用实现**
 *
 * ## 口径(逐档)
 *
 * 1. **DB 里有这一行 ⇒ 它说了算** —— 哪怕存的是空串(那是「明确关掉」)
 * 2. DB 里没这一行 ⇒ 看**环境变量**
 * 3. 环境变量也没有 ⇒ 看**静态默认值**(`fallback`)—— 没有这一档就是
 *    「没配」
 *
 * ## 不合法怎么办
 *
 * **不显示**(fail closed) —— 一个坏链接比没有链接更糟。但 `invalid` 标出来,
 * 后台能看见「你存的那个地址不能用」。
 */
export function resolveSiteUrl(input: {
  /** DB 里那一行的值 —— `null` = 没存过 */
  dbValue: string | null | undefined;
  /** 环境变量的值 —— `null` / 空 = 没配 */
  envValue: string | null | undefined;
  /** 最后一档:代码里的静态默认值(空 = 没有这一档) */
  fallback?: string;
  /**
   * 用哪个校验器 —— 默认 `validateStorefrontUrl`(只认 http/https)
   *
   * 客服二维码那一项传 `validateServiceQrUrl`(多认一档站内路径)。
   */
  validate?: (
    raw: string
  ) => { ok: true; value: string } | { ok: false; code: SiteUrlErrorCode };
}): ResolvedSiteSetting {
  const validate = input.validate ?? validateStorefrontUrl;
  const dbValue = input.dbValue ?? null;

  if (dbValue !== null) {
    const normalized = normalizeStorefrontUrl(dbValue);
    if (!normalized) {
      // 空串 = 明确关掉入口
      return { url: "", source: "db", invalid: false };
    }
    const check = validate(normalized);
    if (!check.ok) {
      return { url: "", source: "db", invalid: true };
    }
    return { url: check.value, source: "db", invalid: false };
  }

  const envValue = normalizeStorefrontUrl(input.envValue);
  if (envValue) {
    const check = validate(envValue);
    if (!check.ok) {
      return { url: "", source: "env", invalid: true };
    }
    return { url: check.value, source: "env", invalid: false };
  }

  const fallback = normalizeStorefrontUrl(input.fallback);
  if (!fallback) {
    return { url: "", source: "none", invalid: false };
  }
  const check = validate(fallback);
  if (!check.ok) {
    return { url: "", source: "default", invalid: true };
  }
  return { url: check.value, source: "default", invalid: false };
}

/**
 * 解析海外独立站入口的生效地址
 *
 * 回退链:DB 那一行 → `NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL` → 空(不显示入口)。
 * **没有静态默认值那一档** —— 独立站地址只有「配了」和「没配」两种状态。
 */
export function resolveInternationalStoreUrl(input: {
  /** DB 里那一行的值 —— `null` = 没存过 */
  dbValue: string | null | undefined;
  /** 环境变量的值 —— `null` / 空 = 没配 */
  envValue: string | null | undefined;
}): ResolvedSiteSetting {
  return resolveSiteUrl({ ...input, fallback: "" });
}

/**
 * 解析**客服微信二维码**的生效图片地址(2026-11-13)
 *
 * 回退链:DB 那一行 → `NEXT_PUBLIC_SERVICE_WECHAT_QR_URL` →
 * `DEFAULT_SERVICE_WECHAT_QR_PATH`(`/service/wechat-qr.png`)。
 *
 * 与海外独立站那一项的差别只有**最后一档**:二维码有一个「文件放进仓库就
 * 生效」的静态默认值,独立站地址没有(没配就是没配)。
 */
export function resolveServiceWechatQrUrl(input: {
  /** DB 里那一行的值 —— `null` = 没存过 */
  dbValue: string | null | undefined;
  /** 环境变量的值 —— `null` / 空 = 没配 */
  envValue: string | null | undefined;
}): ResolvedSiteSetting {
  return resolveSiteUrl({
    ...input,
    fallback: DEFAULT_SERVICE_WECHAT_QR_PATH,
    validate: validateServiceQrUrl,
  });
}
