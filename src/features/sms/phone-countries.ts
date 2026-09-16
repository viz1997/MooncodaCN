/**
 * 区号字典（2026-09-16）
 *
 * UI 选区号 + 默认 +86（用户决策 2026-09-15）。
 * 服务端存 E.164：toE164("+86", "13800138000") = "+8613800138000"。
 *
 * 仅列常用 20+ 区号；ToB WJP 业务当前主战场是国内 + 海外华人。
 * 如需扩展直接 push 到本数组。
 *
 * 关联：src/lib/auth/index.ts phoneNumber plugin.phoneNumberValidator 用同一 E.164 正则
 */

export type PhoneCountry = {
  /** E.164 区号（含 + 前缀） */
  code: string;
  /** ISO 3166-1 alpha-2 国家代码 emoji */
  flag: string;
  /** 英文名（用于 Select dropdown label） */
  name: string;
  /** 中文名（用于 i18n 切换时的备用 label） */
  nameZh: string;
};

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: "+86", flag: "🇨🇳", name: "China", nameZh: "中国大陆" },
  { code: "+852", flag: "🇭🇰", name: "Hong Kong", nameZh: "中国香港" },
  { code: "+853", flag: "🇲🇴", name: "Macau", nameZh: "中国澳门" },
  { code: "+886", flag: "🇹🇼", name: "Taiwan", nameZh: "中国台湾" },
  { code: "+1", flag: "🇺🇸", name: "United States", nameZh: "美国" },
  { code: "+1", flag: "🇨🇦", name: "Canada", nameZh: "加拿大" },
  { code: "+44", flag: "🇬🇧", name: "United Kingdom", nameZh: "英国" },
  { code: "+81", flag: "🇯🇵", name: "Japan", nameZh: "日本" },
  { code: "+82", flag: "🇰🇷", name: "South Korea", nameZh: "韩国" },
  { code: "+65", flag: "🇸🇬", name: "Singapore", nameZh: "新加坡" },
  { code: "+60", flag: "🇲🇾", name: "Malaysia", nameZh: "马来西亚" },
  { code: "+66", flag: "🇹🇭", name: "Thailand", nameZh: "泰国" },
  { code: "+62", flag: "🇮🇩", name: "Indonesia", nameZh: "印度尼西亚" },
  { code: "+84", flag: "🇻🇳", name: "Vietnam", nameZh: "越南" },
  { code: "+63", flag: "🇵🇭", name: "Philippines", nameZh: "菲律宾" },
  { code: "+61", flag: "🇦🇺", name: "Australia", nameZh: "澳大利亚" },
  { code: "+64", flag: "🇳🇿", name: "New Zealand", nameZh: "新西兰" },
  { code: "+49", flag: "🇩🇪", name: "Germany", nameZh: "德国" },
  { code: "+33", flag: "🇫🇷", name: "France", nameZh: "法国" },
  { code: "+39", flag: "🇮🇹", name: "Italy", nameZh: "意大利" },
  { code: "+34", flag: "🇪🇸", name: "Spain", nameZh: "西班牙" },
  { code: "+7", flag: "🇷🇺", name: "Russia", nameZh: "俄罗斯" },
  { code: "+91", flag: "🇮🇳", name: "India", nameZh: "印度" },
  { code: "+971", flag: "🇦🇪", name: "United Arab Emirates", nameZh: "阿联酋" },
];

/** 默认 +86（中国大陆）—— UI 首次打开 */
export const DEFAULT_COUNTRY_CODE = "+86";

/**
 * 拼 E.164：去掉 phone 里的空格 / 横线 / 括号，强制带 countryCode 前缀。
 *
 * 重要：不做任何业务校验（必须 E.164 / 长度匹配等留给 BA plugin 的 phoneNumberValidator）。
 * 仅做格式归一化，避免「+8613800138000」被前缀重复叠成「+86+8613800138000」。
 */
export function toE164(countryCode: string, phone: string): string {
  const cleaned = phone.replace(/[\s\-().]/g, "");
  // 若 phone 本身已带 + 前缀且与 countryCode 一致，优先用 phone
  if (cleaned.startsWith("+")) return cleaned;
  // 兼容国内用户输入 0086... 的情况
  if (cleaned.startsWith("00")) {
    return `+${cleaned.slice(2)}`;
  }
  return `${countryCode}${cleaned}`;
}

/** 显示用：+8613800138000 -> +86 138****8000 */
export function maskPhone(phoneE164: string): string {
  // 拆 countryCode + body（body 长度 4-15 数字）
  const match = phoneE164.match(/^(\+\d{1,3})(\d{4,15})$/);
  if (!match || !match[1] || !match[2]) return phoneE164;
  const cc = match[1];
  const body = match[2];
  if (body.length <= 6) return `${cc} ${body}`;
  return `${cc} ${body.slice(0, 3)}****${body.slice(-4)}`;
}
