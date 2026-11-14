/**
 * 能不能退款 —— **纯函数**,零 import(除了类型)
 *
 * ## 这一层是真正的授权边界
 *
 * 界面上的「申请退款」按钮**可以藏起来**,但那只是 UI 便利 —— 用户照样能
 * 直接调 action。所以「这个单能不能退」的判断必须在这层,服务端调它,
 * 界面也调它,两边不可能漂。
 *
 * ## 工作室的口径
 *
 * > 「开始打印或者生产开始后无法退款,因为已经进行中」(2026-11-14)
 *
 * ⇒ 打印工单一旦进入 `IN_PRODUCTION`(工作室开始切料 / 打印),就**不能退款**了。
 * `SHIPPED` / `COMPLETED` 更不用说 —— 货已经出去了。
 *
 * 商城那条是对等的规则:**货都寄出去了退不了款**(工作室要「已发货也能退」,
 * 比如客户拒收,说一声,把这一条拆掉即可)。
 *
 * ## 判定顺序**短路**
 *
 * 第一个不满足的条件就是返回的 code —— 买家看到的是**最贴切的那一句**,
 * 不是一串条件的堆叠。
 */

import type { RefundIneligibleCode, RefundOrderKind } from "./types";

/**
 * 判定退款资格时需要的订单信息
 *
 * **刻意用最小字段集** —— 这一层不碰 DB,调用方把需要的几列查出来喂进来。
 */
export interface RefundEligibilityOrder {
  /** 挂在哪种订单上 */
  orderKind: RefundOrderKind;
  /** 收款状态(小写那套:`unpaid` / `paid` / `refunded` / `failed`) */
  paymentStatus: string;
  /** 订单状态 —— 商城是小写那套,打印是大写那套 */
  status: string;
  /**
   * 商城订单:**已经发过货没有**
   *
   * `status === "fulfilled"` 是「已发货」那一步,但工单侧是独立的物流表
   * (`shipment`)—— 两个条件都查才靠谱:发货台刚建了包裹、订单状态还没推到
   * `fulfilled` 的时候,货已经在路上了。
   */
  hasShipment?: boolean;
  /**
   * **已经有一条进行中的申请没有**
   *
   * 「进行中」= `pending` **或** `approved` —— `approved` 是钱还在路上,
   * 那时候钱还没退,买家再申请一条就会**退两次钱**。
   *
   * `rejected` / `refunded` 是终态,**不算** —— 被拒之后允许再申请一条
   * (DB 里那个部分唯一索引也只约束 `status = 'pending'`,但**光靠索引不够**,
   * 索引管不到 `approved` 那一条)。
   */
  hasActiveRequest?: boolean;
}

/** 判定结果 */
export type RefundEligibility =
  | { eligible: true }
  | { eligible: false; code: RefundIneligibleCode };

/**
 * 打印工单里**已经开工**的状态
 *
 * `IN_PRODUCTION` 是工作室真的开始做了(切料 / 打印);`SHIPPED` / `COMPLETED`
 * 是之后 —— 货都出去了。
 */
export const PRINT_ORDER_PRODUCTION_STARTED_STATUSES = [
  "IN_PRODUCTION",
  "SHIPPED",
  "COMPLETED",
] as const;

/** 打印工单里**还能退款**的状态 */
export const PRINT_ORDER_REFUNDABLE_STATUSES = ["PENDING", "CONFIRMED"] as const;

/**
 * 判定一个订单能不能退款
 *
 * @param order 订单信息 —— 查不到订单就传 `null`(⇒ `NOT_FOUND`)
 */
export function evaluateRefundEligibility(
  order: RefundEligibilityOrder | null
): RefundEligibility {
  // 1. 订单不存在 —— 查不到,或者不是这个用户的
  if (!order) {
    return { eligible: false, code: "NOT_FOUND" };
  }

  // 2. 已经有一条进行中的申请
  //
  // 排在「没付款」**前面** —— 买家点「申请退款」看到的最有用的回答是
  // 「你已经申请过了,等工作室处理」,而不是「这笔没付款」(他明明付了钱)。
  if (order.hasActiveRequest === true) {
    return { eligible: false, code: "REQUEST_EXISTS" };
  }

  // 3. 收款状态不对
  //
  // `unpaid` = 没付款(没什么可退的);`refunded` = 已经退过了(退两次 = 亏钱);
  // `failed` = 支付失败(钱压根没到)。
  if (order.paymentStatus !== "paid") {
    return { eligible: false, code: "NOT_PAID" };
  }

  if (order.orderKind === "print") {
    // 4. 打印工单
    if (order.status === "CANCELLED") {
      return { eligible: false, code: "ORDER_CANCELLED" };
    }
    // 工作室原话:开始打印 / 生产开始后不能退
    if (
      (PRINT_ORDER_PRODUCTION_STARTED_STATUSES as readonly string[]).includes(
        order.status
      )
    ) {
      return { eligible: false, code: "PRODUCTION_STARTED" };
    }
    if (
      !(PRINT_ORDER_REFUNDABLE_STATUSES as readonly string[]).includes(
        order.status
      )
    ) {
      // 兜底:不在可退名单里的状态一律按「不能退」
      // (将来加了新状态,这里自动拦住,不会静默放行)
      return { eligible: false, code: "PRODUCTION_STARTED" };
    }
    return { eligible: true };
  }

  // 5. 商城订单
  if (order.status === "cancelled") {
    return { eligible: false, code: "ORDER_CANCELLED" };
  }
  if (order.status === "fulfilled" || order.hasShipment === true) {
    return { eligible: false, code: "ALREADY_SHIPPED" };
  }
  return { eligible: true };
}
