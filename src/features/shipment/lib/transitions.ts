/**
 * 物流状态机
 *
 * ## 为什么要单独一个模块
 *
 * 状态规则有**三处**要用:
 *   - 后台的 `<Select>`(决定给什么选项)
 *   - 服务端的校验(决定拒绝什么)
 *   - 买家侧的文案(决定显示什么状态)
 *
 * 三处各写一份 if-else,迟早漂移 —— 后台放开了不该放开的按钮,或者服务端漏判
 * 某个非法跳转。所以规则只在这里定义一次,其它地方 import。
 *
 * 这个文件是**纯函数**:不 import db / React / next,可以直接跑单测。
 */

import type { ShipmentStatus } from "./types";

export type { ShipmentStatus };

/**
 * 主线顺序(线性)—— 下标越大 = 越靠后
 *
 * `returned` 不在这条链上:它是**旁路**(任何状态都能标异常 / 退回),
 * 不是流程的一环。
 */
export const SHIPMENT_FLOW = ["shipped", "delivered"] as const;

/** 全部状态 —— 后台下拉、zod 枚举都用这一份 */
export const SHIPMENT_STATUSES = ["shipped", "delivered", "returned"] as const;

/**
 * 一次状态转换的类别
 *
 * - forward  —— 往前推进(发货 → 签收)
 * - backward —— 往回退(撤销误标的异常),**必须写备注**
 * - cancel   —— 标成异常 / 退回,**必须写备注**
 */
export type ShipmentTransitionKind = "forward" | "backward" | "cancel";

/**
 * 迁移表 —— **唯一一份**
 *
 * | 从 | 到 | 分类 | 备注 |
 * |---|---|---|---|
 * | —(创建) | `shipped` | — | 发货那一刻建行 |
 * | `shipped` | `delivered` | forward | 不要求备注 |
 * | `shipped` | `returned` | cancel | **要求备注**(退回 / 丢件得说清楚) |
 * | `delivered` | `returned` | cancel | **要求备注**(买家说没收到) |
 * | `returned` | `shipped` | backward | **要求备注**(撤销误标) |
 *
 * **表里没有的 = 非法** —— `classifyShipmentTransition` 返 `null`,
 * 服务端回 `INVALID_TRANSITION`,后台下拉里也不会出现那个选项。
 *
 * 特别地:**`delivered → shipped` 不在表里**。误签收要走
 * 「`delivered → returned`(写明原因)→ `returned → shipped`(写明撤销)」两步,
 * 每一步都留下备注 —— 状态改动的**留痕**比一键回退重要。
 */
const TRANSITIONS: Readonly<
  Record<
    ShipmentStatus,
    Partial<Record<ShipmentStatus, ShipmentTransitionKind>>
  >
> = {
  shipped: { delivered: "forward", returned: "cancel" },
  delivered: { returned: "cancel" },
  returned: { shipped: "backward" },
};

/**
 * 判定一次状态转换属于哪一类;**非法返回 null**
 *
 * 同状态(from === to)也是 null —— 重复点「保存」不刷时间线,也不报错
 * (调用方返 `{ok:true, changed:false}`)。
 */
export function classifyShipmentTransition(
  from: ShipmentStatus,
  to: ShipmentStatus
): ShipmentTransitionKind | null {
  return TRANSITIONS[from]?.[to] ?? null;
}

/** 这次转换是否合法 */
export function canShipmentTransition(
  from: ShipmentStatus,
  to: ShipmentStatus
): boolean {
  return classifyShipmentTransition(from, to) !== null;
}

/**
 * 这次转换是否必须写备注
 *
 * **回退和异常必须** —— 「这单被退回来了」「撤销误标」都是需要解释的动作,
 * 工作室得知道为什么。往前推(发货 → 签收)的备注是可选的。
 */
export function shipmentTransitionRequiresNote(
  from: ShipmentStatus,
  to: ShipmentStatus
): boolean {
  const kind = classifyShipmentTransition(from, to);
  return kind === "cancel" || kind === "backward";
}

/**
 * 从 from 可以去的所有状态 —— 后台 `<Select>` 的选项来源
 *
 * 顺序按 `SHIPMENT_STATUSES`(发货 → 签收 → 异常),选项看起来是顺的。
 */
export function allowedNextShipmentStatuses(
  from: ShipmentStatus
): ShipmentStatus[] {
  const allowed = TRANSITIONS[from];
  return SHIPMENT_STATUSES.filter(
    (status) => status !== from && allowed[status] !== undefined
  );
}

/**
 * 状态的 i18n 文案键 —— 买家侧和后台共用
 *
 * 显示名**不**在代码里写死:快递公司名和状态名在两个语言站要不一样
 * (「顺丰速运」/「SF Express」),所以只给键,文案在 `messages/*.json` 里。
 *
 * ## 键是**相对 `Shipment` 命名空间**的
 *
 * 消费方一律 `const tShipment = useTranslations("Shipment")` 然后
 * `tShipment(shipmentStatusLabelKey(status))`。
 *
 * ⚠️ **别写成绝对路径**(`Shipment.status.shipped`)—— 命名空间化的 `t` 会
 * 去找 `Shipment.Shipment.status.shipped`,查不到。仓库里 `MaterialPricing`
 * 的 `products.pet.name` 就是这个套路(见 `pricing/components/shared.tsx`)。
 */
export function shipmentStatusLabelKey(status: ShipmentStatus): string {
  return `status.${status}`;
}
