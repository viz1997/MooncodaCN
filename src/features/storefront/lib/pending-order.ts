/**
 * 「上一张还没付的订单」能不能直接复用
 *
 * ## 为什么需要这个
 *
 * 2026-11-05 起购物车**付款成功才清空** —— 没付钱就走的用户,购物车还是
 * 原样(这是那个 bug 的正解:原来是在**建单那一刻**就把购物车清掉了)。
 *
 * 但这带来一个新问题:用户没付钱 → 购物车还在 → 又点一次「去支付」→
 * **多出一张一模一样的待付款订单**。
 *
 * 后果有两个,都不小:
 *
 * - 工作室那边多一张永远不付的僵尸单(后台看着像真单)
 * - 支付入口有两份 —— 用户可能付了**旧的那张**,而订单被标 paid 的是**新
 *   的那张**,或者反过来。两张都付 = 收两次钱
 *
 * ## 所以:同一批货 → 复用上一张单
 *
 * 判据(全都得一样才算同一单):
 *
 * - 买的货一样(规格 hash + 数量,见 `cart-snapshot.ts`)
 * - 合计一样(分)—— 定价规则改了就不算同一单
 * - 收货地址一样
 * - 留言一样
 *
 * ## 为什么是「复用」不是「取消旧的」
 *
 * 取消旧单会有个**要命**的副作用:用户可能已经扫了旧单的付款码,钱正准备
 * 到账 —— 旧单一取消,回调按状态机判断就会跳过「标已付」(见
 * `payments/lib/transitions.ts`),**钱收了但系统不认**。
 *
 * 复用没有这个问题:旧单还在,码还是那张码,钱到了照样标已付。
 */

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  printOrder,
  type ShippingAddressSnapshot,
  type StorefrontOrderItemRow,
  type StorefrontOrderRow,
  storefrontOrder,
  storefrontOrderItem,
} from "@/db/schema";
import { ENABLED_PAYMENT_CHANNELS } from "@/features/payments/lib/registry";
import type { CartLineItemMetadata } from "../types";
import {
  buildLineSnapshot,
  isSameAddress,
  isSameLineSnapshot,
  type LineSnapshot,
} from "./cart-snapshot";

/** 能复用的一单 */
export interface ReusablePendingOrder {
  /** 那一单 */
  order: StorefrontOrderRow;
  /** 那一单的行 */
  items: StorefrontOrderItemRow[];
  /** 那一单里的打印工单号 */
  printOrderNos: string[];
}

/**
 * 找一张可以复用的待付款订单
 *
 * 找不到返回 null(那就在 `checkout()` 里正常落一张新单)。
 */
export async function findReusablePendingOrder(params: {
  userId: string;
  /** 这次要买的货(购物车算出来的) */
  snapshot: LineSnapshot[];
  /** 这次要付的总价(分) */
  totalCents: number;
  /** 这次的收货地址 */
  address: ShippingAddressSnapshot;
  /** 这次的留言 */
  note: string | null;
}): Promise<ReusablePendingOrder | null> {
  const channels = [...ENABLED_PAYMENT_CHANNELS];
  if (channels.length === 0) return null;

  // 只看「还没付、没取消、走的还是开放的通道」的订单
  //
  // 通道这一条要卡:`payment_channel` 可能是 `stripe`(旧路的单)或者 null ——
  // 那些单不能拿来复用(旧路的付款入口跟现在的通道不是一回事)。
  const orders = await db
    .select()
    .from(storefrontOrder)
    .where(
      and(
        eq(storefrontOrder.userId, params.userId),
        eq(storefrontOrder.status, "unpaid"),
        eq(storefrontOrder.paymentStatus, "unpaid"),
        inArray(storefrontOrder.paymentChannel, channels)
      )
    )
    .orderBy(desc(storefrontOrder.createdAt))
    .limit(5);

  for (const order of orders) {
    if (order.totalCents !== params.totalCents) continue;
    if ((order.note ?? "") !== (params.note ?? "")) continue;
    if (!isSameAddress(order.shippingAddress, params.address)) continue;

    const items = await db
      .select()
      .from(storefrontOrderItem)
      .where(eq(storefrontOrderItem.orderId, order.id));

    const orderSnapshot = buildLineSnapshot(
      items.map((item) => ({
        productId: item.productId,
        metadata: item.metadata as unknown as CartLineItemMetadata,
        quantity: item.quantity,
      }))
    );
    if (!isSameLineSnapshot(orderSnapshot, params.snapshot)) continue;

    const printRows = await db
      .select({ orderNo: printOrder.orderNo })
      .from(printOrder)
      .where(eq(printOrder.storefrontOrderId, order.id));

    return {
      order,
      items,
      printOrderNos: printRows.map((row) => row.orderNo),
    };
  }

  return null;
}
