/**
 * 打印工单状态机
 *
 * ## 为什么要单独一个模块
 *
 * 状态规则有**三处**要用:
 *   - 后台的 `<Select>`(决定给什么选项)
 *   - 服务端的校验(决定拒绝什么)
 *   - 用户侧的按钮(决定「能不能自己取消」)
 *
 * 三处各写一份 if-else,迟早漂移 —— 后台放开了用户能取消的按钮,或者服务端
 * 漏判某个非法跳转。所以规则只在这里定义一次,其它地方 import。
 *
 * 这个文件是**纯函数**:不 import db / React / next,可以直接跑单测。
 */

import type { PrintOrderStatus } from "./quote-types";

/**
 * 主流程顺序(线性)—— 下标越大 = 越靠后
 *
 * CANCELLED 不在这条链上:它是**旁路**(任何非终态都能取消),不是流程的一环。
 */
export const PRINT_ORDER_FLOW: readonly PrintOrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "SHIPPED",
  "COMPLETED",
];

/**
 * 终态 —— 没有任何出边
 *
 * COMPLETED(已签收)和 CANCELLED(已取消)都是死路:没有「撤销取消」。
 * 将来真要支持「撤销取消」,得**显式**加一条规则并单独设计,不能靠放宽
 * `isTerminalStatus` 顺手带出来 —— 那会把「已完成还能改」也一起放开。
 */
export const PRINT_ORDER_TERMINAL_STATUSES: readonly PrintOrderStatus[] = [
  "COMPLETED",
  "CANCELLED",
];

/**
 * 一次状态转换的类别
 *
 * - forward  —— 往前推进(允许跨级,如 PENDING → SHIPPED)
 * - backward —— 往回退(允许跨级,如 SHIPPED → PENDING),**必须写备注**
 * - cancel   —— 取消
 */
export type PrintOrderTransitionKind = "forward" | "backward" | "cancel";

/** 终态判定 */
export function isTerminalStatus(status: PrintOrderStatus): boolean {
  return PRINT_ORDER_TERMINAL_STATUSES.includes(status);
}

/**
 * 在主流程里的位置;CANCELLED 不在主流程里 → -1
 */
export function statusFlowIndex(status: PrintOrderStatus): number {
  return PRINT_ORDER_FLOW.indexOf(status);
}

/**
 * 判定一次状态转换属于哪一类;**非法返回 null**
 *
 * 规则:
 *   - from === to        → null(空转,不写事件)
 *   - from 是终态        → null(已完成/已取消没有出边)
 *   - to === "CANCELLED" → "cancel"(任何非终态都能取消)
 *   - to 位置 > from     → "forward"
 *   - to 位置 < from     → "backward"
 */
export function classifyTransition(
  from: PrintOrderStatus,
  to: PrintOrderStatus
): PrintOrderTransitionKind | null {
  if (from === to) return null;
  if (isTerminalStatus(from)) return null;
  if (to === "CANCELLED") return "cancel";

  const fromIdx = statusFlowIndex(from);
  const toIdx = statusFlowIndex(to);
  if (fromIdx < 0 || toIdx < 0) return null;
  if (toIdx > fromIdx) return "forward";
  return "backward";
}

/** 这次转换是否合法 */
export function canTransition(
  from: PrintOrderStatus,
  to: PrintOrderStatus
): boolean {
  return classifyTransition(from, to) !== null;
}

/**
 * 这次转换是否必须写备注
 *
 * **只有回退必须** —— 「把已发货的工单退回生产中」是一个需要解释的动作,
 * 用户得知道为什么。推进和取消的备注是可选的(工作室想补一句就补)。
 */
export function transitionRequiresNote(
  from: PrintOrderStatus,
  to: PrintOrderStatus
): boolean {
  return classifyTransition(from, to) === "backward";
}

/**
 * 从 from 可以去的所有状态 —— 后台 `<Select>` 的选项来源
 *
 * 终态返回空数组:已完成的单子不允许再改。
 */
export function allowedNextStatuses(
  from: PrintOrderStatus
): PrintOrderStatus[] {
  if (isTerminalStatus(from)) return [];
  // 顺序按 PRINT_ORDER_FLOW 的顺序 + CANCELLED 收尾,选项看起来是顺的
  const ordered: PrintOrderStatus[] = [
    ...PRINT_ORDER_FLOW.filter((s) => s !== from),
    "CANCELLED",
  ];
  return ordered.filter((s) => canTransition(from, s));
}

/** 工单是否还「活着」(还没到终态)—— 前端据此决定要不要继续轮询 */
export function isLiveStatus(status: PrintOrderStatus): boolean {
  return !isTerminalStatus(status);
}

/**
 * 用户能不能自己取消 —— **只有 PENDING**
 *
 * 跟后台的取消规则不同:后台能从任何非终态取消(单子已经开工了,工作室
 * 有权中止);用户只能在「工作室还没确认」时取消 —— 确认之后意味着工作室
 * 已经投入产能,不能一句话撤单。
 */
export function isUserCancellable(status: PrintOrderStatus): boolean {
  return status === "PENDING";
}
