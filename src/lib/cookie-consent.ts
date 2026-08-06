/**
 * Cookie 同意（Consent）常量与类型定义
 *
 * 同意状态存于 localStorage（key: COOKIE_CONSENT_KEY），取值：
 *  - "all"       用户接受全部 Cookie（含分析/营销）
 *  - "essential" 仅接受必要 Cookie
 *  - ""           未做任何选择（视为未同意）
 *
 * 详细偏好存于 COOKIE_PREFERENCES_KEY（JSON：analytics/marketing 开关）。
 *
 * 当用户变更同意时，派发 COOKIE_CONSENT_CHANGE_EVENT 自定义事件，
 * 供 Analytics 等组件监听以即时响应。
 */

/** localStorage 键：同意总开关 */
export const COOKIE_CONSENT_KEY = "cookie-consent";

/** localStorage 键：详细偏好（JSON） */
export const COOKIE_PREFERENCES_KEY = "cookie-preferences";

/** 自定义事件名：同意状态变更通知 */
export const COOKIE_CONSENT_CHANGE_EVENT = "cookie-consent-change";

/** 同意类型 */
export type CookieConsentType = "all" | "essential" | "";

/** Cookie 偏好（细分开关） */
export interface CookiePreferences {
  /** 分析 Cookie（如 Google Analytics） */
  analytics: boolean;
  /** 营销 Cookie（如广告投放 / 重定向） */
  marketing: boolean;
}

/** 默认偏好：全部开启 */
export const DEFAULT_COOKIE_PREFERENCES: CookiePreferences = {
  analytics: true,
  marketing: true,
};

/**
 * 读取当前同意状态
 *
 * 服务端 / 非浏览器环境返回 ""（未同意）。
 */
export function getConsent(): CookieConsentType {
  if (typeof window === "undefined") return "";
  return (localStorage.getItem(COOKIE_CONSENT_KEY) as CookieConsentType) ?? "";
}

/**
 * 是否已同意分析 Cookie
 */
export function hasAnalyticsConsent(): boolean {
  return getConsent() === "all";
}

/**
 * 读取详细偏好，解析失败回退默认值
 */
export function getPreferences(): CookiePreferences {
  if (typeof window === "undefined") return DEFAULT_COOKIE_PREFERENCES;
  const raw = localStorage.getItem(COOKIE_PREFERENCES_KEY);
  if (!raw) return DEFAULT_COOKIE_PREFERENCES;
  try {
    return { ...DEFAULT_COOKIE_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_COOKIE_PREFERENCES;
  }
}

/**
 * 保存同意状态并派发变更事件
 *
 * @param consent 同意类型
 * @param prefs 详细偏好（可选）
 */
export function setConsent(
  consent: CookieConsentType,
  prefs?: CookiePreferences
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(COOKIE_CONSENT_KEY, consent || "");
  if (prefs) {
    localStorage.setItem(COOKIE_PREFERENCES_KEY, JSON.stringify(prefs));
  }
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGE_EVENT));
}
