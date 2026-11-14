/**
 * 退款的错误码 → i18n 文案 key
 *
 * ## 为什么要有这张表
 *
 * 界面按 code 查文案 ⇒ 买家看到的是**具体原因**（「已经开始生产了,不能退款」),
 * 不是一句笼统的「操作失败」。
 *
 * ⚠️ **兜底必须有** —— `t()` 查不到 key 会抛错(生产环境直接把页面搞挂)。
 * 拿到一个不认识 code 时退回 `errors.FAILED`,那一条是**一定存在**的。
 *
 * ## 一张表,买家侧 + 后台共用
 *
 * 买家侧的「申请退款」和后台的「处理退款」返回的是**同一批 code**
 * (`RefundErrorCode` + `RefundIneligibleCode`)⇒ 两处各写一张表的话,迟早
 * 一边漏一个 key。
 *
 * 这个文件是**纯函数 + 纯数据**,零 import ⇒ 能直接跑单测。
 */

/**
 * 全部错误码 —— **跟 `types.ts` 的两个联合类型一一对应**
 *
 * 改 `RefundErrorCode` / `RefundIneligibleCode` 的时候记得同步这张表,
 * 否则界面会退到 `errors.FAILED`。
 */
export const REFUND_ERROR_CODES = [
  // —— RefundErrorCode ——
  "ORDER_NOT_FOUND",
  "REFUND_NOT_FOUND",
  "INVALID_TRANSITION",
  "NOTE_REQUIRED",
  "INVALID_INPUT",
  "NOT_REFUNDABLE",
  "REQUEST_EXISTS",
  "REFUND_NOT_SUPPORTED",
  "PROVIDER_REJECTED",
  "REFUND_PROCESSING",
  "MIGRATION_MISSING",
  "SAVE_FAILED",
  // —— RefundIneligibleCode ——
  "NOT_PAID",
  "ORDER_CANCELLED",
  "PRODUCTION_STARTED",
  "ALREADY_SHIPPED",
  "NOT_FOUND",
] as const;

export type RefundErrorTextCode = (typeof REFUND_ERROR_CODES)[number];

/** 兜底文案 key —— 它**一定**存在 */
export const REFUND_ERROR_FALLBACK_KEY = "errors.FAILED";

/**
 * 错误码 → i18n key(相对 `Refund` 命名空间)
 *
 * 认不出来的 code 一律退回兜底 —— **绝不能**把一个没注册过的 key 交给
 * `t()`,那会抛错。
 */
export function refundErrorTextKey(code: string | null | undefined): string {
  if (code && (REFUND_ERROR_CODES as readonly string[]).includes(code)) {
    return `errors.${code}`;
  }
  return REFUND_ERROR_FALLBACK_KEY;
}
