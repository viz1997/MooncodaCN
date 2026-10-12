/**
 * 把服务端写入的 `prompt_order.errorMessage` 收敛成给用户看的安全短句。
 *
 * 现状：上游 Lingting 失败时，`errorMessage` 是 `failures.join("；")`，里面混入
 * 了 "HTTP 500 <!DOCTYPE html><!--next_error__-->..." 这种技术细节。让 ToC 用户
 * 看到这种 HTML 源码 + Next.js 内部标记既无用也吓人，所以前端展示前必须过滤。
 *
 * 规则：
 * 1. 命中"噪音关键词"（HTML / Lingting / HTTP / next_error 等技术标记）→ 返回 `null`
 *    让 UI 走通用兜底文案
 * 2. 命中"已知用户原因"（图片过大 / 额度不足 / 超时 / 已停止）→ 返回定型的短句
 * 3. 其他 → 原样返回但截断到 80 字，避免意外的敏感信息泄漏
 *
 * 注：DB 字段原值不动；管理端 `/admin` 仍能拿到完整原文排查。
 */

const NOISE_PATTERNS: RegExp[] = [
  // HTML / 错误页标记
  /<!doctype/i,
  /<html/i,
  /<\/html>/i,
  /next_error/i,
  // 上游 / 框架噪音
  /lingting/i,
  /wellapi/i,
  /\bhttp\s*\d{3}\b/i,
  /\bstatus[:\s]\d{3}\b/i,
  // JS 错误栈
  /\bat\s+\w+\s*\(/i,
  /\bstack:/i,
  /TypeError/i,
  /ReferenceError/i,
  /SyntaxError/i,
  /RangeError/i,
];

const FRIENDLY_PATTERNS: Array<{ pattern: RegExp; text: string }> = [
  {
    pattern: /图片.{0,4}(过大|超过|大于|大)/i,
    text: "图片过大，请压缩到 10MB 以内",
  },
  {
    pattern: /(余额|额度).{0,4}(不足|不够|用完|为0)/i,
    text: "本订单的生图额度不足，请联系服务方",
  },
  { pattern: /超时|timeout/i, text: "生成超时，请点击「重新生成全部」重试" },
  { pattern: /已停止|已中断/i, text: "已停止本次生成" },
  {
    pattern: /(网络|network).{0,4}(异常|错误|失败)/i,
    text: "网络异常，请稍后重试",
  },
];

const MAX_LEN = 80;

export function sanitizeErrorMessage(
  raw: string | null | undefined
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1) 命中已知用户原因 → 直接返回定型文案
  for (const { pattern, text } of FRIENDLY_PATTERNS) {
    if (pattern.test(trimmed)) return text;
  }

  // 2) 命中技术噪音 → 走通用兜底
  for (const re of NOISE_PATTERNS) {
    if (re.test(trimmed)) return null;
  }

  // 3) 其他：截断后返回（避免长串泄漏）
  if (trimmed.length > MAX_LEN) return `${trimmed.slice(0, MAX_LEN)}…`;
  return trimmed;
}
