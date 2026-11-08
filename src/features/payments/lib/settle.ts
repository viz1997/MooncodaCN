/**
 * 收款状态落库 —— **所有支付通道共用**
 *
 * ## 为什么四个通道共用一份
 *
 * 微信 / 支付宝 / Shopify / 旧的 Sellbase —— 回调长得完全不一样(验签方式、
 * 报文结构、状态字段的名字都不同),但回调**落地之后**要做的事是同一件:
 *
 * > 「这笔钱到了」→ 把订单标成已付(以及把挂在它下面的工单一起标上)。
 *
 * 这件事只有一份实现,才有下面两条规矩:
 *
 * 1. **退款不是订单状态** —— 退款只改 `paymentStatus`。
 * 2. **迟到的收款通知不能把退过款的单改回已付** —— 靠
 *    `paymentStatus === "refunded"` 挡住(webhook 会重投,投递顺序不保证)。
 *
 * 判断在 `transitions.ts`(纯函数,零 DB 依赖),这里只负责写库。
 *
 * ## 幂等
 *
 * 不另建去重表:「已经是目标状态 → 直接 no-op」就够了。重投一次和重投十次,
 * 结果一样。
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { printOrder, storefrontOrder, storefrontOrderItem } from "@/db/schema";
import {
  PrintOrderTransitionError,
  transitionPrintOrderStatus,
} from "@/features/print-quote/lib/order-store";
import { buildLineSnapshot } from "@/features/storefront/lib/cart-snapshot";
import { removeOrderedLinesFromCarts } from "@/features/storefront/lib/cart-store";
import type { CartLineItemMetadata } from "@/features/storefront/types";

import {
  decideLinkedPrintOrderTransition,
  decideStorefrontTransition,
  type StorefrontPaymentKind,
} from "./transitions";
import type { PaymentChannel } from "./types";

/** 回调能触发的三种动作 */
export type PaymentAction = StorefrontPaymentKind;

/** 落库结果 */
export interface SettleResult {
  /** 处理成功?(认不出来也算成功 —— 调用方统一回 200) */
  ok: boolean;
  /** 命中的本地订单类型;没命中是 null */
  orderType: "print" | "storefront" | null;
  /** 本地订单号;没命中是 null */
  orderNo: string | null;
  /** 状态**真的**变了吗 —— 重投时是 false */
  changed: boolean;
  /** 出错时的原因(给日志看) */
  reason?: string;
}

/** 查订单要的几列 */
export interface OrderLookup {
  id: string;
  orderNo: string;
  status: string;
  paymentStatus: string;
  /** 下单人 —— 付款成功时要把买掉的行从他的购物车里摘掉 */
  userId: string;
}

function ignored(reason: string): SettleResult {
  return {
    ok: true,
    orderType: null,
    orderNo: null,
    changed: false,
    reason,
  };
}

/* -------------------------------------------------------------------------- */
/*  按订单号反查                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 按**本仓库订单号**反查本地订单
 *
 * 微信 / 支付宝的 `out_trade_no`、Shopify 草稿单备注里的订单号 —— 都是我们
 * 自己的订单号。回调里只有它是可信的关联键(平台侧的单号可能因为重试、
 * 改单而变)。
 *
 * 先查商城订单,再查打印工单:两张表的订单号前缀不一样(`SO-` / `PO-`),
 * 不会撞。
 */
export async function findOrderByOrderNo(
  orderNo: string
): Promise<{ orderType: "print" | "storefront"; order: OrderLookup } | null> {
  const storeRows = await db
    .select({
      id: storefrontOrder.id,
      orderNo: storefrontOrder.orderNo,
      status: storefrontOrder.status,
      paymentStatus: storefrontOrder.paymentStatus,
      userId: storefrontOrder.userId,
    })
    .from(storefrontOrder)
    .where(eq(storefrontOrder.orderNo, orderNo))
    .limit(1);

  const store = storeRows[0];
  if (store) return { orderType: "storefront", order: store };

  const printRows = await db
    .select({
      id: printOrder.id,
      orderNo: printOrder.orderNo,
      status: printOrder.status,
      paymentStatus: printOrder.paymentStatus,
      userId: printOrder.userId,
    })
    .from(printOrder)
    .where(eq(printOrder.orderNo, orderNo))
    .limit(1);

  const print = printRows[0];
  if (print) return { orderType: "print", order: print };

  return null;
}

/* -------------------------------------------------------------------------- */
/*  入口                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 回调入口 —— 按本仓库订单号把一次收款动作落到订单上
 *
 * 找不到本地订单就当无事发生(回 200 忽略):平台可能推一条我们根本不认识的
 * 单(比如在 Shopify 后台手工建的单)。
 */
export async function settleByOrderNo(params: {
  orderNo: string;
  action: PaymentAction;
  /** 哪个通道收的钱 —— 记进 `payment_channel` */
  channel: PaymentChannel;
  /** 平台侧的单号(有就记下来,方便对账) */
  providerOrderId?: string | null;
}): Promise<SettleResult> {
  const found = await findOrderByOrderNo(params.orderNo);
  if (!found) {
    return ignored(`本地没有订单号=${params.orderNo} 的订单`);
  }

  const result =
    found.orderType === "storefront"
      ? await settleStorefrontOrder({
          order: found.order,
          action: params.action,
          channel: params.channel,
        })
      : await settlePrintOrder({
          order: found.order,
          action: params.action,
          channel: params.channel,
        });

  // 平台侧单号记下来 —— 对账时用得上(微信/支付宝的 trade_no、Shopify 的 gid)
  if (result.changed && params.providerOrderId) {
    const table =
      found.orderType === "storefront" ? storefrontOrder : printOrder;
    await db
      .update(table)
      .set({ providerOrderId: params.providerOrderId })
      .where(eq(table.id, found.order.id));
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/*  打印工单                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 打印工单:收款状态 + 取消
 *
 * 「取消」走状态机 —— 时间线上要留一条事件,用户看得见。
 */
export async function settlePrintOrder(params: {
  order: OrderLookup;
  action: PaymentAction;
  channel: PaymentChannel;
}): Promise<SettleResult> {
  const { order, action, channel } = params;
  const base = {
    ok: true,
    orderType: "print" as const,
    orderNo: order.orderNo,
  };

  switch (action) {
    case "mark_paid": {
      // 幂等:已经付过就别再写一遍(重投)
      if (order.paymentStatus === "paid") {
        return { ...base, changed: false };
      }
      // 退过款的单不能被迟到的收款通知改回「已支付」
      if (order.paymentStatus === "refunded") {
        return {
          ...base,
          changed: false,
          reason: "已退款的工单不再改成已支付",
        };
      }
      await db
        .update(printOrder)
        .set({
          paymentStatus: "paid",
          paymentChannel: channel,
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(printOrder.id, order.id));
      return { ...base, changed: true };
    }

    case "mark_refunded": {
      if (order.paymentStatus === "refunded") {
        return { ...base, changed: false };
      }
      await db
        .update(printOrder)
        .set({
          paymentStatus: "refunded",
          updatedAt: new Date(),
        })
        .where(eq(printOrder.id, order.id));
      return { ...base, changed: true };
    }

    case "mark_cancelled": {
      try {
        await transitionPrintOrderStatus({
          orderNo: order.orderNo,
          to: "CANCELLED",
          actor: "system",
          note: null,
          userId: null,
        });
        return { ...base, changed: true };
      } catch (error) {
        if (error instanceof PrintOrderTransitionError) {
          // 已经是终态了 —— 重投或者本来就不该取消,当无事发生
          return { ...base, changed: false, reason: error.code };
        }
        throw error;
      }
    }

    default:
      return ignored("不处理的动作");
  }
}

/* -------------------------------------------------------------------------- */
/*  商城订单                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 商城订单:订单状态和支付状态**分开**写
 *
 * - `status` —— 订单走到哪一步了(unpaid → paid → fulfilled / cancelled)
 * - `paymentStatus` —— 钱怎么样了(unpaid → paid / refunded / failed)
 *
 * 分开的理由写在 `transitions.ts` 的文件头里 —— 一句话:退款不是订单状态,
 * 迟到的收款通知不能把退过款的单改回来。
 */
export async function settleStorefrontOrder(params: {
  order: OrderLookup;
  action: PaymentAction;
  channel: PaymentChannel;
}): Promise<SettleResult> {
  const { order, action, channel } = params;
  const base = {
    ok: true,
    orderType: "storefront" as const,
    orderNo: order.orderNo,
  };

  if (
    action !== "mark_paid" &&
    action !== "mark_refunded" &&
    action !== "mark_cancelled"
  ) {
    return ignored("不处理的动作");
  }

  const decision = decideStorefrontTransition(
    { status: order.status, paymentStatus: order.paymentStatus },
    action
  );

  if (decision.kind === "skip") {
    return { ...base, changed: false, reason: decision.reason };
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
      ...(decision.setPaymentStatus === "paid"
        ? { paymentChannel: channel }
        : {}),
      updatedAt: now,
    })
    .where(eq(storefrontOrder.id, order.id));

  // 挂在它下面的打印工单一起标 —— 钱是整单收的,工单不能还停在「未付款」
  await syncLinkedPrintOrders(order.id, action, channel);

  // 付款成功 → 把买掉的行从购物车里摘掉
  //
  // 购物车是「**付款成功才清空**」(2026-11-05)—— 建单那一刻不动它,钱到了
  // 才摘。摘的是买掉的那几行,用户付款之后又加的别的行留着。
  //
  // **失败不抛** —— 订单已经标成已付了(那才是钱的记录),购物车摘不掉顶多
  // 是用户的购物袋里还留着已经买过的东西。抛出去的话 webhook 会重投,
  // 重投时状态机判「已经标记过收款」直接 skip —— 这一次反而永远摘不掉了。
  if (decision.setPaymentStatus === "paid") {
    try {
      await removeOrderedLinesFromCart(order);
    } catch (error) {
      console.error(
        `[payments] ${order.orderNo} 已付款,但购物车里的行没摘掉`,
        error
      );
    }
  }

  return { ...base, changed: true };
}

/**
 * 付款成功 → 把买掉的行从用户的购物车里摘掉
 *
 * ## 按**规格 hash** 对上
 *
 * 订单行和购物车行不是同一张表,也没有共同的行 id —— 能对上的是规格 hash
 * (同一份规格在哪儿都是同一个 hash,见 `storefront/lib/cart-snapshot.ts`)。
 *
 * ## 为什么这一步在**回调**里,不在下单时
 *
 * 下单只说明「用户点了去支付」,不代表钱到了。下单就清购物车的话,用户没
 * 付钱就走了,回来一看购物车空了(2026-11-05 线上真实踩到过)。
 */
async function removeOrderedLinesFromCart(order: OrderLookup): Promise<void> {
  const items = await db
    .select({
      productId: storefrontOrderItem.productId,
      metadata: storefrontOrderItem.metadata,
      quantity: storefrontOrderItem.quantity,
    })
    .from(storefrontOrderItem)
    .where(eq(storefrontOrderItem.orderId, order.id));
  if (items.length === 0) return;

  const snapshot = buildLineSnapshot(
    items.map((item) => ({
      productId: item.productId,
      metadata: item.metadata as unknown as CartLineItemMetadata,
      quantity: item.quantity,
    }))
  );

  /**
   * 摘车(2026-11-08)
   *
   * 现在只有**一张车**了 —— 打印服务跟目录商品装同一个购物袋(工作室的说法:
   * 「不要 print-order,进入商城那个」)。所以买掉哪几行就在哪张车上摘,
   * 不用再按「有没有 printSpec」分两张车去摘。
   */
  await removeOrderedLinesFromCarts(order.userId, snapshot);
}

/**
 * 把挂在某张商城订单下面的打印工单一起改状态
 *
 * 走商城购物车结算的打印服务行,工单挂在 `print_order.storefront_order_id`
 * 上(整张购物车共用**一张**支付订单,挂不了 `provider_order_id` 那种唯一列)。
 *
 * ## 为什么工单也要跟着改
 *
 * 工单的 `payment_status` 是**工作室开工的门槛**(见
 * `transitionPrintOrderStatus()` 的 PAYMENT_REQUIRED)。钱已经整单收走了,
 * 工单还显示「未付款」的话,工作室点「开始生产」会被挡住 —— 单子卡住。
 *
 * ## 幂等
 *
 * 逐行判:已经 paid / refunded 的不动;退过款的不会被迟到的收款通知改回
 * 已支付(跟商城订单、跟独立工单同一个口径)。
 */
async function syncLinkedPrintOrders(
  storefrontOrderId: string,
  action: PaymentAction,
  channel: PaymentChannel
): Promise<void> {
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
      action
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
        ...(decision.setPaymentChannel ? { paymentChannel: channel } : {}),
        ...(decision.markPaidAt ? { paidAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(printOrder.id, row.id));
  }
}
