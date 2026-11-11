/**
 * 站点设置的**纯逻辑** —— 零 import(能进 `unit` project 跑单测)
 *
 * ## 这一层管什么
 *
 * 「后台能改、不用重新部署」的站点级设置都走这套口径。第一项是**海外独立站
 * 的顾客访问地址**(2026-11-11 加的)。
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
 * DB 那一行 → NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL → 空(不显示入口)
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
} as const;

export type SiteSettingKey =
  (typeof SITE_SETTING_KEYS)[keyof typeof SITE_SETTING_KEYS];

/* -------------------------------------------------------------------------- */
/*  生效值                                                                      */
/* -------------------------------------------------------------------------- */

/** 这个生效值是从哪儿来的 */
export type SiteSettingSource =
  /** 后台配置(DB 里那一行) */
  | "db"
  /** 环境变量兜底 */
  | "env"
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

/* -------------------------------------------------------------------------- */
/*  回退链                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 解析海外独立站入口的生效地址
 *
 * ## 口径
 *
 * 1. **DB 里有这一行 ⇒ 它说了算** —— 哪怕存的是空串(那是「明确关掉」)
 * 2. DB 里没这一行 ⇒ 看**环境变量**
 * 3. 都没有 ⇒ 没有地址(入口不出现)
 *
 * ## 不合法怎么办
 *
 * **不显示**(fail closed) —— 一个坏链接比没有链接更糟。但 `invalid` 标出来,
 * 后台能看见「你存的那个地址不能用」。
 */
export function resolveInternationalStoreUrl(input: {
  /** DB 里那一行的值 —— `null` = 没存过 */
  dbValue: string | null | undefined;
  /** 环境变量的值 —— `null` / 空 = 没配 */
  envValue: string | null | undefined;
}): ResolvedSiteSetting {
  const dbValue = input.dbValue ?? null;

  if (dbValue !== null) {
    const normalized = normalizeStorefrontUrl(dbValue);
    if (!normalized) {
      // 空串 = 明确关掉入口
      return { url: "", source: "db", invalid: false };
    }
    const check = validateStorefrontUrl(normalized);
    if (!check.ok) {
      return { url: "", source: "db", invalid: true };
    }
    return { url: check.value, source: "db", invalid: false };
  }

  const envValue = normalizeStorefrontUrl(input.envValue);
  if (!envValue) {
    return { url: "", source: "none", invalid: false };
  }
  const check = validateStorefrontUrl(envValue);
  if (!check.ok) {
    return { url: "", source: "env", invalid: true };
  }
  return { url: check.value, source: "env", invalid: false };
}
