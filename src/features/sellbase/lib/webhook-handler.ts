/**
 * Sellbase webhook → 本地订单状态
 *
 * ## 两条支付链,一张表结构
 *
 * 打印工单(`print_order`)和商城订单(`storefront_order`)走的是**同一套**
 * Sellbase 收银台,所以 webhook 落库时先按 `sellbase_order_id` 反查 —— 先查
 * 工单表,再查商城表。两张表的 `sellbase_order_id` 都有唯一索引,所以
 * 反查不会命中两张。
 *
 * ## 打印服务进了商城购物车之后:第三种关联
 *
 * 购物车里每条打印服务行都会生成一张工单,而**整张购物车共用一张 Sellbase
 * 订单** —— `print_order.sellbase_order_id` 是唯一索引,挂不上同一个 id。
 *
 * 所以走商城那条路的工单改挂 `storefront_order_id`:webhook 标商城订单
 * paid 的时候,顺带把挂在它下面的工单一起标上(见 `syncLinkedPrintOrders()`)。
 *
 * ## 幂等靠「状态转移本身幂等」
 *
 * webhook 会重投(Sellbase 没收到 2xx 就重投)。这里不另建去重表:
 * 「已经是目标状态 → 直接 no-op」就够了。重投一次和重投十次,结果一样。
 *
 * ## 认不出来的事件一律成功
 *
 * 取不到 `sellbase_order_id`、本地没有这张单、事件类型不认识 —— 全部
 * 回 200 忽略。回 4xx 的话 Sellbase 会一直重投,把这个端点打成噪音源,
 * 还会把真正重要的支付事件挤掉。
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { printOrder, storefrontOrder } from "@/db/schema";
import {
  PrintOrderTransitionError,
  transitionPrintOrderStatus,
} from "@/features/print-quote/lib/order-store";

import type { SellbasePaymentAction } from "./events";
import {
  decideLinkedPrintOrderTransition,
  decideStorefrontTransition,
} from "./storefront-transition";

/** 命中的本地订单类型 */
export type SellbaseLocalOrderType = "print" | "storefront";

/** 落库结果 */
export interface SellbaseWebhookApplyResult {
  /** 是否处理成功(认不出来的事件也算成功) */
  ok: boolean;
  /** 实际执行的动作 */
  kind: SellbasePaymentAction["kind"];
  /** 命中的本地订单类型;没命中是 null */
  orderType: SellbaseLocalOrderType | null;
  /** 本地订单号;没命中是 null */
  orderNo: string | null;
  /** 状态**真的**变了吗 —— 重投时是 false */
  changed: boolean;
  /** 出错时的原因(给日志看) */
  reason?: string;
}

function ignored(
  kind: SellbasePaymentAction["kind"],
  reason: string
): SellbaseWebhookApplyResult {
  return {
    ok: true,
    kind,
    orderType: null,
    orderNo: null,
    changed: false,
    reason,
  };
}

/**
 * 把一个 webhook 动作落到本地订单上
 *
 * 永不抛异常 —— 出错也返回 `{ok:false, reason}`。调用方(路由)统一回 200。
 */
export async function applySellbasePaymentAction(
  action: SellbasePaymentAction,
  sellbaseOrderId: string | null
): Promise<SellbaseWebhookApplyResult> {
  if (action.kind === "ignore") {
    return ignored(action.kind, action.reason);
  }
  if (!sellbaseOrderId) {
    return ignored(action.kind, "事件里没有 sellbase 订单 id");
  }

  // 1. 打印工单
  const printRows = await db
    .select({
      id: printOrder.id,
      orderNo: printOrder.orderNo,
      status: printOrder.status,
      paymentStatus: printOrder.paymentStatus,
    })
    .from(printOrder)
    .where(eq(printOrder.sellbaseOrderId, sellbaseOrderId))
    .limit(1);

  const print = printRows[0];
  if (print) {
    return applyToPrintOrder(action, print);
  }

  // 2. 商城订单
  const storeRows = await db
    .select({
      id: storefrontOrder.id,
      orderNo: storefrontOrder.orderNo,
      status: storefrontOrder.status,
      paymentStatus: storefrontOrder.paymentStatus,
    })
    .from(storefrontOrder)
    .where(eq(storefrontOrder.sellbaseOrderId, sellbaseOrderId))
    .limit(1);

  const store = storeRows[0];
  if (store) {
    return applyToStorefrontOrder(action, store);
  }

  return ignored(
    action.kind,
    `本地没有 sellbase_order_id=${sellbaseOrderId} 的订单`
  );
}

type PrintOrderLookup = {
  id: string;
  orderNo: string;
  status: string;
  paymentStatus: string;
};

/** 打印工单:收款状态 + 取消 */
async function applyToPrintOrder(
  action: SellbasePaymentAction,
  order: PrintOrderLookup
): Promise<SellbaseWebhookApplyResult> {
  const base = {
    ok: true,
    orderType: "print" as const,
    orderNo: order.orderNo,
  };

  switch (action.kind) {
    case "mark_paid": {
      // 幂等:已经付过就别再写一遍(重投)
      if (order.paymentStatus === "paid") {
        return { ...base, kind: "mark_paid", changed: false };
      }
      // 退过款的单不能被迟到的 `order.paid` 改回「已支付」——
      // webhook 会重投,投递顺序不保证(跟商城订单同一个口径)
      if (order.paymentStatus === "refunded") {
        return {
          ...base,
          kind: "mark_paid",
          changed: false,
          reason: "已退款的工单不再改成已支付",
        };
      }
      await db
        .update(printOrder)
        .set({
          paymentStatus: "paid",
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(printOrder.id, order.id));
      return { ...base, kind: "mark_paid", changed: true };
    }

    case "mark_refunded": {
      if (order.paymentStatus === "refunded") {
        return { ...base, kind: "mark_refunded", changed: false };
      }
      await db
        .update(printOrder)
        .set({
          paymentStatus: "refunded",
          updatedAt: new Date(),
        })
        .where(eq(printOrder.id, order.id));
      return { ...base, kind: "mark_refunded", changed: true };
    }

    case "mark_cancelled": {
      // 取消要走状态机 —— 这样时间线上会留下一条事件,用户看得见
      try {
        await transitionPrintOrderStatus({
          orderNo: order.orderNo,
          to: "CANCELLED",
          actor: "system",
          note: null,
          userId: null,
        });
        return { ...base, kind: "mark_cancelled", changed: true };
      } catch (error) {
        if (error instanceof PrintOrderTransitionError) {
          // 已经是终态了 —— 重投或者本来就不该取消,当无事发生
          return {
            ...base,
            kind: "mark_cancelled",
            changed: false,
            reason: error.code,
          };
        }
        throw error;
      }
    }

    default:
      return ignored(action.kind, "不处理的动作");
  }
}

type StorefrontOrderLookup = {
  id: string;
  orderNo: string;
  status: string;
  paymentStatus: string;
};

/**
 * 商城订单:订单状态和支付状态**分开**写
 *
 * - `status` —— 订单走到哪一步了(unpaid → paid → fulfilled / cancelled)
 * - `paymentStatus` —— 钱怎么样了(unpaid → paid / refunded / failed)
 *
 * 分开的两个理由:
 *
 * 1. **退款不是订单状态**。退款的单子还在(用户查得到、能看历史),只是钱
 *    退了 —— 塞进订单状态的话退款会把单子变成「已取消」,用户看着像没买过。
 * 2. **迟到的 `order.paid` 不能把退过款的单改回已付**。webhook 会重投,
 *    投递顺序也不保证 —— 一张退过款的单如果被一个迟到的 `order.paid` 改成
 *    「已支付」,用户看到的和实际收到的钱对不上。靠 `paymentStatus ===
 *    "refunded"` 挡住。
 *
 * 判断逻辑在 `storefront-transition.ts`(纯函数,零 DB 依赖)—— 这里只负责
 * 把判断结果写进库。
 */
async function applyToStorefrontOrder(
  action: SellbasePaymentAction,
  order: StorefrontOrderLookup
): Promise<SellbaseWebhookApplyResult> {
  const base = {
    ok: true,
    orderType: "storefront" as const,
    orderNo: order.orderNo,
  };

  if (
    action.kind !== "mark_paid" &&
    action.kind !== "mark_refunded" &&
    action.kind !== "mark_cancelled"
  ) {
    return ignored(action.kind, "不处理的动作");
  }

  const decision = decideStorefrontTransition(
    { status: order.status, paymentStatus: order.paymentStatus },
    action.kind
  );

  if (decision.kind === "skip") {
    return {
      ...base,
      kind: action.kind,
      changed: false,
      reason: decision.reason,
    };
  }

  const now = new Date();
  await db
    .update(storefrontOrder)
    .set({
      ...(decision.setStatus ? { status: decision.setStatus } : {}),
      ...(decision.setPaymentStatus
        ? { paymentStatus: decision.setPaymentStatus }
        : {}),
      ...(decision.markPaidAt ? { paidAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(storefrontOrder.id, order.id));

  // 挂在它下面的打印工单一起标 —— 钱是整单收的,工单不能还停在「未付款」
  await syncLinkedPrintOrders(order.id, action);

  return { ...base, kind: action.kind, changed: true };
}

/**
 * 把挂在某张商城订单下面的打印工单一起改状态
 *
 * 走商城购物车结算的打印服务行,工单挂在 `print_order.storefront_order_id`
 * 上(整张购物车共用一张 Sellbase 订单,挂不了 `sellbase_order_id` ——
 * 那一列是唯一索引)。
 *
 * ## 为什么工单也要跟着改
 *
 * 工单的 `payment_status` 是**工作室开工的门槛**(见
 * `transitionPrintOrderStatus()` 的 PAYMENT_REQUIRED)。钱已经整单收走了,
 * 工单还显示「未付款」的话,工作室点「开始生产」会被挡住 —— 单子卡住。
 *
 * ## 幂等
 *
 * 逐行判:已经 paid / refunded 的不动;退过款的不会被迟到的 `order.paid`
 * 改回已支付(跟商城订单、跟独立工单同一个口径)。
 */
async function syncLinkedPrintOrders(
  storefrontOrderId: string,
  action: SellbasePaymentAction
): Promise<void> {
  if (action.kind === "ignore") return;

  const rows = await db
    .select({
      id: printOrder.id,
      orderNo: printOrder.orderNo,
      paymentStatus: printOrder.paymentStatus,
    })
    .from(printOrder)
    .where(eq(printOrder.storefrontOrderId, storefrontOrderId));
  if (rows.length === 0) return;

  const now = new Date();

  for (const row of rows) {
    const decision = decideLinkedPrintOrderTransition(
      { paymentStatus: row.paymentStatus },
      action.kind
    );

    if (decision.kind === "skip") continue;

    if (decision.kind === "cancel_via_state_machine") {
      // 取消要走状态机 —— 时间线上要留一条事件,用户看得见
      try {
        await transitionPrintOrderStatus({
          orderNo: row.orderNo,
          to: "CANCELLED",
          actor: "system",
          note: null,
          userId: null,
        });
      } catch (error) {
        // 已经是终态 → 当无事发生(重投或者本来就不该取消)
        if (error instanceof PrintOrderTransitionError) continue;
        throw error;
      }
      continue;
    }

    await db
      .update(printOrder)
      .set({
        paymentStatus: decision.setPaymentStatus,
        ...(decision.setPaymentChannel ? { paymentChannel: "stripe" } : {}),
        ...(decision.markPaidAt ? { paidAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(printOrder.id, row.id));
  }
}
