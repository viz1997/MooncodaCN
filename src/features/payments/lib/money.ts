/**
 * 金额换算 —— 分 ↔ 支付平台的「元」字符串
 *
 * ## 为什么不用浮点
 *
 * 0.1 + 0.2 !== 0.3。金额一旦用浮点算,就会出现「用户付 $24.30,平台那边
 * 记成 $24.299999」这种差一分钱的事 —— 而这一分钱就是「逐分相等」破了。
 *
 * 所以全程整数:本仓库内部一律**分**,只有在跟支付平台说话的时候才转成
 * 带两位小数的字符串(`"24.30"`),而且转换是纯整数除法 + 取余,没有浮点。
 */

/**
 * 分 → 金额字符串(`"2430"` → `"24.30"`)
 *
 * 带两位小数 —— 微信 / 支付宝 / Shopify 都认这个格式。
 *
 * 负数也认(退款那种场景用得上),`0` → `"0.00"`。
 */
export function centsToAmountString(cents: number): string {
  if (!Number.isFinite(cents)) {
    throw new Error(`金额不是有限数字:${cents}`);
  }
  const rounded = Math.round(cents);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const yuan = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${negative ? "-" : ""}${yuan}.${String(rest).padStart(2, "0")}`;
}

/**
 * 金额字符串 → 分(`"24.30"` → `2430`)
 *
 * 解析不了就抛 —— 金额算错了比算不出来更危险。
 *
 * 接受两位小数(`.30` / `24.3` 也认),不接受三位以上(那是厘,不是分)。
 */
export function amountStringToCents(amount: string): number {
  const text = amount.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new Error(`金额格式不对:${amount}`);
  }
  const [, sign, yuan, fraction] = match;
  const cents =
    Number.parseInt(yuan ?? "0", 10) * 100 +
    Number.parseInt((fraction ?? "0").padEnd(2, "0"), 10);
  return sign === "-" ? -cents : cents;
}
