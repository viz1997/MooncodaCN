/**
 * 退款申请状态机
 *
 * ## 为什么要单独一个模块
 *
 * 状态规则有**三处**要用:
 *   - 后台的按钮(决定给什么操作)
 *   - 服务端的校验(决定拒绝什么)
 *   - 买家侧的文案(决定显示什么状态)
 *
 * 三处各写一份 if-else,迟早漂移 —— 后台放开了不该放开的按钮,或者服务端漏判
 * 某个非法跳转。所以规则只在这里定义一次,其它地方 import。
 *
 * 这个文件是**纯函数**:不 import db / React / next,可以直接跑单测。
 */

import type { RefundStatus } from "./types";

export type { RefundStatus };

/** 全部状态 —— 后台下拉、zod 枚举都用这一份 */
export const REFUND_STATUSES = [
  "pending",
  "approved",
  "refunded",
  "rejected",
] as const;

/**
 * 一次状态转换的类别
 *
 * - forward —— 往前走(同意 / 退成功)
 * - cancel  —— 写掉(拒绝)**,必须写备注**
 */
export type RefundTransitionKind = "forward" | "cancel";

/**
 * 迁移表 —— **唯一一份**
 *
 * | 从 | 到 | 分类 | 备注 |
 * |---|---|---|---|
 * | —(创建) | `pending` | — | 买家申请那一刻建行 |
 * | `pending` | `approved` | forward | 工作室受理,平台还在处理 |
 * | `pending` | `refunded` | forward | 平台回 SUCCESS,或者工作室在平台后台手工退完 |
 * | `pending` | `rejected` | cancel | 工作室驳回 —— **要求备注** |
 * | `approved` | `refunded` | forward | 平台异步通知说退款成功 |
 * | `approved` | `rejected` | cancel | 平台明确退不了,工作室写掉 —— **要求备注** |
 *
 * **表里没有的 = 非法** —— `classifyRefundTransition` 返 `null`,
 * 服务端回 `INVALID_TRANSITION`,后台也不会给那个按钮。
 *
 * ## `approved → rejected` 为什么留着
 *
 * `approved` = **钱还在路上**(平台回了 `PROCESSING`)。如果平台随后明确退不了
 * (`CLOSED` / `ABNORMAL`),工作室需要一条路把这一条写掉 —— 否则申请永远卡在
 * 「处理中」,买家那边也永远等不到一个结论。
 *
 * ⚠️ **这条要求备注** —— 备注里放平台给的原文,工作室和买家都看得见「为什么
 * 没退成」。写掉之后**不会**把钱退给买家,也不该退 —— 平台压根没退。
 *
 * ## `refunded` 是终态
 *
 * 钱已经回到买家账上了,这条申请**不再能改**。真要再退一次,那是**另一笔**
 * 退款(而且仓库现在只支持整单退)。
 */
const TRANSITIONS: Readonly<
  Record<RefundStatus, Partial<Record<RefundStatus, RefundTransitionKind>>>
> = {
  pending: { approved: "forward", refunded: "forward", rejected: "cancel" },
  approved: { refunded: "forward", rejected: "cancel" },
  refunded: {},
  rejected: {},
};

/**
 * 判定一次状态转换属于哪一类;**非法返回 null**
 *
 * 同状态(from === to)也是 null —— 重复点「保存」不刷时间线,也不报错
 * (调用方返 `{ok:true, changed:false}`)。
 */
export function classifyRefundTransition(
  from: RefundStatus,
  to: RefundStatus
): RefundTransitionKind | null {
  return TRANSITIONS[from]?.[to] ?? null;
}

/** 这次转换是否合法 */
export function canRefundTransition(
  from: RefundStatus,
  to: RefundStatus
): boolean {
  return classifyRefundTransition(from, to) !== null;
}

/**
 * 这次转换是否必须写备注
 *
 * **写掉(拒绝)必须** —— 「为什么不退」工作室和买家都得知道。往前推
 * (同意 / 退成功)的备注是可选的。
 */
export function refundTransitionRequiresNote(
  from: RefundStatus,
  to: RefundStatus
): boolean {
  return classifyRefundTransition(from, to) === "cancel";
}

/**
 * 从 from 可以去的所有状态 —— 后台按钮的来源
 *
 * 顺序按 `REFUND_STATUSES`(待处理 → 已同意 → 已退款 → 已拒绝)。
 */
export function allowedNextRefundStatuses(
  from: RefundStatus
): RefundStatus[] {
  const allowed = TRANSITIONS[from];
  return REFUND_STATUSES.filter(
    (status) => status !== from && allowed[status] !== undefined
  );
}

/** 是不是终态(不可再改) */
export function isTerminalRefundStatus(status: RefundStatus): boolean {
  return status === "refunded" || status === "rejected";
}

/**
 * 状态的 i18n 文案键 —— 买家侧和后台共用
 *
 * 显示名**不**在代码里写死:两个语言站要不一样(「退款申请已提交」/
 * "Refund request submitted"),所以只给键,文案在 `messages/*.json` 里。
 *
 * ## 键是**相对 `Refund` 命名空间**的
 *
 * 消费方一律 `const tRefund = useTranslations("Refund")` 然后
 * `tRefund(refundStatusLabelKey(status))`。
 */
export function refundStatusLabelKey(status: RefundStatus): string {
  return `status.${status}`;
}
