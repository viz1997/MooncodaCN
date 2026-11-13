/**
 * 物流 → 订单状态**联动**
 *
 * ## 一期只做「单向、只推一格、门槛很严」
 *
 * 发货台填了运单号 ⇒ 订单的状态也该往前走一格,不然工作室在「我的订单」里
 * 看到的还是「已付款」,买家那边也还是「还没发货」。
 *
 * | 订单 | 条件 | 改法 |
 * |---|---|---|
 * | 商城 `storefront_order` | `payment_status = "paid"` **且** `status = "paid"` | `status → "fulfilled"` |
 * | 打印 `print_order` | 当前不是终态、也不是 `SHIPPED` / `COMPLETED` | `status → "SHIPPED"` |
 * | 打印 `print_order`(签收时) | `status = "SHIPPED"` | `status → "COMPLETED"` |
 *
 * **其它情况一律不动订单 status**(未收款、已取消、已经推进过了)。
 *
 * ## 为什么商城那两列都要卡
 *
 * 迟到的 `mark_paid` webhook(`payments/lib/transitions.ts`)只跳过
 * `paymentStatus === "paid" / "refunded"` 和 `status === "cancelled"`,
 * **不跳过 `fulfilled`** ⇒ 如果不卡 `payment_status`,一个「已发货但还没标
 * 收款」的单会被 webhook 写成 `paid`,**把 `fulfilled` 倒退回去**。
 *
 * 卡上 `payment_status = "paid"` 之后,已付款的单 webhook 直接 skip
 * (「已经标记过收款」),倒退不可能发生。
 *
 * ## 联动是「尽力而为」,不是硬不变式
 *
 * `transitionPrintOrderStatus()` 会抛 `PrintOrderTransitionError`
 * (SAME_STATUS / INVALID_TRANSITION / …)。这里**catch 掉它、记一条原因、
 * 继续** —— 物流记录已经落库了,那是主记录;订单状态是派生信息。
 *
 * 两张表、两个事务:发货记录是主记录(必须落),订单状态是派生(推不动也不影响
 * 物流信息)。
 *
 * ## 为什么打印工单要复用 `transitionPrintOrderStatus()`
 *
 * 它是**唯一的状态写入口**(锁行 → 状态机 → 改状态 → 写时间线,一个事务里)。
 * 自己写一条 UPDATE 就是当年被删掉的那条「后门」—— 状态变了但用户的时间线上
 * 什么都看不到。复用它 ⇒ 时间线照旧有记录、邮件照旧发。
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import type { PrintOrderRow } from "@/db/schema";
import { storefrontOrder } from "@/db/schema";
import {
  getPrintOrderByOrderNo,
  PrintOrderTransitionError,
  transitionPrintOrderStatus,
} from "@/features/print-quote/lib/order-store";
import type { PrintOrderStatus } from "@/features/print-quote/lib/quote-types";

import type { ShipmentOrderKind, ShipmentStatus } from "./types";

/** 联动的结果 */
export type OrderLinkageResult = {
  /** 真的推了订单状态没有 */
  linked: boolean;
  /** 订单状态推到了哪儿(没推就是当前状态) */
  orderStatus: string | null;
  /** 没推的原因 —— 给日志看,界面不显示 */
  reason: string;
  /** 打印工单联动成功时,推到了哪个状态(发邮件用) */
  printToStatus: PrintOrderStatus | null;
  /**
   * 打印工单联动成功后的那一行 —— 发邮件要它(`toPrintOrderMailInfo()`)
   *
   * **没联动就是 null** —— 别拿联动前的旧行去发邮件,那样邮件里写的是
   * 「还是制作中」,而实际已经发货了。
   */
  printOrder: PrintOrderRow | null;
};

/** 没推 */
const NOT_LINKED = (
  orderStatus: string | null,
  reason: string
): OrderLinkageResult => ({
  linked: false,
  orderStatus,
  reason,
  printToStatus: null,
  printOrder: null,
});

/**
 * 发货 / 改物流状态之后,顺手把订单状态往前推一格
 *
 * **什么时候调** —— 物流记录落库成功之后(主记录必须先落)。
 */
export async function linkOrderStatusAfterShipment(params: {
  orderKind: ShipmentOrderKind;
  orderId: string;
  orderNo: string;
  /** 物流现在的状态 */
  shipmentStatus: ShipmentStatus;
}): Promise<OrderLinkageResult> {
  if (params.orderKind === "storefront") {
    return linkStorefrontOrder(params);
  }
  return linkPrintOrder(params);
}

/**
 * 商城订单 → `fulfilled`
 *
 * **门槛写进 WHERE** —— `payment_status = "paid"` **且** `status = "paid"`。
 * 两个条件都在 UPDATE 语句里原子生效:不满足就一行都不改。
 *
 * 不用 `&&` 拼条件:drizzle 的 SQL 对象是普通对象,`a && b` 求值出来是 `b`
 * —— 第一个条件会被静默丢掉(那样就少了 `payment_status` 的门槛,倒退就
 * 可能发生)。
 */
async function linkStorefrontOrder(params: {
  orderId: string;
  shipmentStatus: ShipmentStatus;
}): Promise<OrderLinkageResult> {
  // 只有「发货」推订单状态 —— 签收 / 异常不动
  // (`fulfilled` 已是终点,签收了订单不一定「完成」,可能还有售后)
  if (params.shipmentStatus !== "shipped") {
    return NOT_LINKED(null, "只有发货才推商城订单状态");
  }

  const [updated] = await db
    .update(storefrontOrder)
    .set({ status: "fulfilled" })
    .where(
      and(
        eq(storefrontOrder.id, params.orderId),
        eq(storefrontOrder.paymentStatus, "paid"),
        eq(storefrontOrder.status, "paid")
      )
    )
    .returning({ status: storefrontOrder.status });

  if (!updated) {
    return NOT_LINKED(null, "订单不满足推进门槛(需已收款且状态为 paid)");
  }
  return {
    linked: true,
    orderStatus: updated.status,
    reason: "商城订单推进到 fulfilled",
    printToStatus: null,
    printOrder: null,
  };
}

/**
 * 打印工单 → `SHIPPED` / `COMPLETED`
 *
 * **复用 `transitionPrintOrderStatus()`** —— 锁行 → 状态机 → 改状态 →
 * 写时间线,一个事务里。自已写 UPDATE 就是「绕过时间线的后门」。
 */
async function linkPrintOrder(params: {
  orderNo: string;
  shipmentStatus: ShipmentStatus;
}): Promise<OrderLinkageResult> {
  // 异常 / 退回不联动 —— `print_order.status` 里没有对应的状态,
  // 硬塞一个会破坏它自己的状态机。物流面板摆「异常/退回」就够。
  if (params.shipmentStatus === "returned") {
    return NOT_LINKED(null, "异常/退回不联动工单状态");
  }

  const order = await getPrintOrderByOrderNo(params.orderNo);
  if (!order) {
    return NOT_LINKED(null, "工单不存在");
  }

  const target: PrintOrderStatus =
    params.shipmentStatus === "delivered" ? "COMPLETED" : "SHIPPED";

  if (params.shipmentStatus === "delivered") {
    // 签收 → COMPLETED 的前提是工单已经到过 SHIPPED
    if (order.status !== "SHIPPED") {
      return NOT_LINKED(order.status, "工单还没到已发货,签收联动跳过");
    }
  } else if (order.status === "SHIPPED" || order.status === "COMPLETED") {
    // 已经推过了 —— 两个入口都能到 SHIPPED,谁先谁后都对
    return NOT_LINKED(order.status, "工单已经推进过发货了");
  }

  try {
    const { order: updated } = await transitionPrintOrderStatus({
      orderNo: params.orderNo,
      to: target,
      actor: "admin",
      note: null,
      // 后台不限归属 —— 工作室看得到所有人的单
      userId: null,
    });
    return {
      linked: true,
      orderStatus: updated.status,
      reason: `工单推进到 ${updated.status}`,
      printToStatus: updated.status,
      printOrder: updated,
    };
  } catch (error) {
    // 推不动就推不动 —— 物流记录已经落库了,那是主记录
    if (error instanceof PrintOrderTransitionError) {
      return NOT_LINKED(order.status, `工单状态机拒绝:${error.code}`);
    }
    return NOT_LINKED(order.status, "工单状态联动失败");
  }
}
