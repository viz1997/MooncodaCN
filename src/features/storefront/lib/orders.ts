/**
 * 商城订单 —— 读
 *
 * ## 归属校验写在 WHERE 里
 *
 * 用户的订单详情只按 `user_id` 查。别人的订单号查出来就是 null(上层转 404,
 * 不是 403 —— 403 等于告诉别人「这个订单号存在」,而订单号是可以被枚举的)。
 *
 * ## 状态由 webhook 回写
 *
 * `status` 从 `unpaid` → `paid` 是 Sellbase 的 webhook 干的,不是这里
 * 算的。这里只读。
 */

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  type StorefrontOrderRow,
  storefrontOrder,
  storefrontOrderItem,
} from "@/db/schema";

/** 一笔订单 + 它的行 */
export interface StorefrontOrderWithItems {
  order: StorefrontOrderRow;
  items: Array<typeof storefrontOrderItem.$inferSelect>;
}

/**
 * 按订单号取一单 —— 用户的订单详情页 / 支付成功页用
 */
export async function getUserStorefrontOrderByOrderNo(
  userId: string,
  orderNo: string
): Promise<StorefrontOrderWithItems | null> {
  const rows = await db
    .select()
    .from(storefrontOrder)
    .where(
      and(
        eq(storefrontOrder.orderNo, orderNo),
        eq(storefrontOrder.userId, userId)
      )
    )
    .limit(1);

  const order = rows[0];
  if (!order) return null;

  const items = await db
    .select()
    .from(storefrontOrderItem)
    .where(eq(storefrontOrderItem.orderId, order.id))
    .orderBy(storefrontOrderItem.createdAt);

  return { order, items };
}

/**
 * 某个用户的订单列表 —— 「我的订单」页用
 *
 * 按下单时间倒序。订单行一次批量取回(不是每单查一次)。
 */
export async function listUserStorefrontOrders(
  userId: string,
  limit = 50
): Promise<StorefrontOrderWithItems[]> {
  const capped = Math.min(Math.max(limit, 1), 200);

  const orders = await db
    .select()
    .from(storefrontOrder)
    .where(eq(storefrontOrder.userId, userId))
    .orderBy(desc(storefrontOrder.createdAt))
    .limit(capped);

  if (orders.length === 0) return [];

  const allItems = await db
    .select()
    .from(storefrontOrderItem)
    .where(
      inArray(
        storefrontOrderItem.orderId,
        orders.map((o) => o.id)
      )
    );

  const byOrder = new Map<string, typeof allItems>();
  for (const item of allItems) {
    const list = byOrder.get(item.orderId) ?? [];
    list.push(item);
    byOrder.set(item.orderId, list);
  }

  return orders.map((order) => ({
    order,
    items: byOrder.get(order.id) ?? [],
  }));
}
