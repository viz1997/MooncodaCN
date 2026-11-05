/**
 * Sellbase webhook → 本地订单状态
 *
 * ## 过渡期:这条链正在被新的三个通道取代
 *
 * 2026-11-05 起,收款改成**微信 / 支付宝 / Shopify** 三条通道,Sellbase +
 * Stripe 那条**先并行保留**,跑通之后再拆。所以这个文件还在。
 *
 * 但**落库的逻辑已经不再自己写一遍**了 —— 四个通道「钱到了要做的事」是
 * 同一件,那部分在 `@/features/payments/lib/settle.ts`。这里只做两件
 * Sellbase 特有的事:
 *
 * 1. **按 `sellbase_order_id` 反查本地订单**(Sellbase 的回调只带它自己的
 *    单号,不带我们的订单号)
 * 2. 把查到的订单交给 `settle.ts` 落库
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
 * paid 的时候,顺带把挂在它下面的工单一起标上(见 `settle.ts` 的
 * `syncLinkedPrintOrders()`)。
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
  type OrderLookup,
  settlePrintOrder,
  settleStorefrontOrder,
} from "@/features/payments/lib/settle";
import type { PaymentAction } from "@/features/payments/lib/settle";

import type { SellbasePaymentAction } from "./events";

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

/**
 * 打印工单:收款状态 + 取消
 *
 * 落库交给 `settle.ts`(四个通道共用一份)。
 */
async function applyToPrintOrder(
  action: SellbasePaymentAction,
  order: OrderLookup
): Promise<SellbaseWebhookApplyResult> {
  const result = await settlePrintOrder({
    order,
    action: action.kind as PaymentAction,
    channel: "stripe",
  });

  return {
    ok: result.ok,
    kind: action.kind,
    orderType: result.orderType,
    orderNo: result.orderNo,
    changed: result.changed,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

/**
 * 商城订单:订单状态和支付状态**分开**写
 *
 * - `status` —— 订单走到哪一步了(unpaid → paid → fulfilled / cancelled)
 * - `paymentStatus` —— 钱怎么样了(unpaid → paid / refunded / failed)
 *
 * 分开的两个理由(细节见 `@/features/payments/lib/transitions.ts` 的文件头):
 *
 * 1. **退款不是订单状态**。退款的单子还在(用户查得到、能看历史),只是钱
 *    退了 —— 塞进订单状态的话退款会把单子变成「已取消」,用户看着像没买过。
 * 2. **迟到的 `order.paid` 不能把退过款的单改回已付**。webhook 会重投,
 *    投递顺序也不保证 —— 一张退过款的单如果被一个迟到的 `order.paid` 改成
 *    「已支付」,用户看到的和实际收到的钱对不上。靠 `paymentStatus ===
 *    "refunded"` 挡住。
 */
async function applyToStorefrontOrder(
  action: SellbasePaymentAction,
  order: OrderLookup
): Promise<SellbaseWebhookApplyResult> {
  const result = await settleStorefrontOrder({
    order,
    action: action.kind as PaymentAction,
    channel: "stripe",
  });

  return {
    ok: result.ok,
    kind: action.kind,
    orderType: result.orderType,
    orderNo: result.orderNo,
    changed: result.changed,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}
