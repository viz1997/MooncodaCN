/**
 * 商城订单后台 —— 服务端落库层(2026-11-18)
 *
 * 买家不信任一个新店 ⇒ 结算页除了支付宝,多一个「**淘宝下单**」。钱进的是
 * **淘宝那个账户** ⇒ 工作室在淘宝后台看到钱到了,回本站把那笔单**手工标成
 * 已收款**。
 *
 * ## 这一层的三条硬规矩
 *
 * 1. **不抛异常** —— 业务失败一律返 `{ok:false, code}`(在 action 层)。
 * 2. **列要写全,不能 `db.select()`** —— 见下面「为什么不许 `db.select()`」。
 * 3. **`external_paid_cents` 单独读、单独写** —— 见下面「那一列单独读」。
 *
 * ## 为什么不许 `db.select()`
 *
 * `storefront_order.external_paid_cents` 是 2026-11-18 才加的列
 * (`scripts/apply-taobao-link-schema.ts`)。**迁移脚本还没跑**的时候:
 *
 * - `db.select()`(选全部列)⇒ PG 报 `42703 column does not exist`
 *   ⇒ **整页 500** —— 工作台连「有哪些订单」都看不到。
 * - 显式列出来(不选那一列)⇒ 页面照常工作,那一格显示「—」。
 *
 * ⇒ **这一页必须在迁移脚本跑之前也能打开。** 工作室打开后台发现整页崩了,
 * 第一反应是「网站坏了」,而不是「记得跑迁移」。
 *
 * ## 那一列单独读
 *
 * 显式列出来还不够 —— `external_paid_cents` 就是**要**读的。所以它走**另一条
 * 查询**:读失败(列还在)就当「没填过实收金额」,**不抛**。
 *
 * ⚠️ **静默降级要留日志** —— 「读不到」和「没填过」在界面上长得一样,
 * 工作室分不出来。日志里说清楚。
 */

import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { storefrontOrder, storefrontOrderItem, user } from "@/db/schema";
import { describeDbError } from "@/features/shared/lib/db-error";
import { summarizeOrderItems } from "@/features/storefront/lib/order-summary";

import {
  type AdminStoreOrderRow,
  type AdminStoreOrderSource,
  toAdminStoreOrderRow,
} from "./types";

/* -------------------------------------------------------------------------- */
/*  列                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 订单表要选的列
 *
 * ⚠️ **这里不许加 `externalPaidCents`** —— 它走单独那条查询(见
 * `readExternalPaidCents`)。加进来 = 迁移没跑就整页 500。
 */
const ORDER_COLUMNS = {
  id: storefrontOrder.id,
  orderNo: storefrontOrder.orderNo,
  userId: storefrontOrder.userId,
  status: storefrontOrder.status,
  paymentStatus: storefrontOrder.paymentStatus,
  paymentChannel: storefrontOrder.paymentChannel,
  providerOrderId: storefrontOrder.providerOrderId,
  totalCents: storefrontOrder.totalCents,
  shippingCents: storefrontOrder.shippingCents,
  couponCode: storefrontOrder.couponCode,
  createdAt: storefrontOrder.createdAt,
};

/* -------------------------------------------------------------------------- */
/*  外部实收金额(单独读)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 读一批订单的**外部实收金额**
 *
 * 读不出来(列还没建)⇒ 返回空表 + 一条 error 日志 —— **不抛**。
 *
 * 返回空表的意思是:界面上「实收金额」那一格显示「—」(还没填),其余照常。
 */
async function readExternalPaidCents(
  orderIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (orderIds.length === 0) return map;

  try {
    const rows = await db
      .select({
        id: storefrontOrder.id,
        externalPaidCents: storefrontOrder.externalPaidCents,
      })
      .from(storefrontOrder)
      .where(inArray(storefrontOrder.id, orderIds));

    for (const row of rows) {
      if (row.externalPaidCents === null) continue;
      map.set(row.id, row.externalPaidCents);
    }
  } catch (error) {
    const info = describeDbError(error);
    console.error(
      "[storefront/admin] 读 external_paid_cents 失败(当没填过实收金额):",
      info.message || error
    );
  }

  return map;
}

/* -------------------------------------------------------------------------- */
/*  列表                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 商城订单列表(后台用)
 *
 * **最新在前** —— 工作室刚处理完的那几单在最上面。
 *
 * 默认只取最近 200 笔:后台这一页是「处理今天/这周的单」用的,不是对账报表
 * (对账在发货台 / 淘宝后台那边)。
 */
export async function listAdminStoreOrders(
  limit = 200
): Promise<AdminStoreOrderRow[]> {
  const orders = await db
    .select({
      ...ORDER_COLUMNS,
      buyerEmail: user.email,
      buyerName: user.name,
    })
    .from(storefrontOrder)
    .leftJoin(user, eq(user.id, storefrontOrder.userId))
    .orderBy(desc(storefrontOrder.createdAt))
    .limit(limit);

  if (orders.length === 0) return [];

  const orderIds = orders.map((order) => order.id);
  const items = await db
    .select({
      orderId: storefrontOrderItem.orderId,
      productTitle: storefrontOrderItem.productTitle,
      quantity: storefrontOrderItem.quantity,
    })
    .from(storefrontOrderItem)
    .where(inArray(storefrontOrderItem.orderId, orderIds));

  const itemsByOrderId = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsByOrderId.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrderId.set(item.orderId, list);
  }

  const externalMap = await readExternalPaidCents(orderIds);

  return orders.map((order) => {
    const orderItems = itemsByOrderId.get(order.id) ?? [];
    const source: AdminStoreOrderSource = {
      orderNo: order.orderNo,
      createdAt: order.createdAt,
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      itemSummary: summarizeOrderItems(orderItems),
      itemCount: orderItems.reduce((sum, item) => sum + item.quantity, 0),
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentChannel: order.paymentChannel,
      providerOrderId: order.providerOrderId,
      totalCents: order.totalCents,
      shippingCents: order.shippingCents,
      couponCode: order.couponCode,
      externalPaidCents: externalMap.get(order.id) ?? null,
    };
    return toAdminStoreOrderRow(source);
  });
}

/* -------------------------------------------------------------------------- */
/*  单笔                                                                       */
/* -------------------------------------------------------------------------- */

/** 一笔订单(标已收款用) */
export interface AdminStoreOrderRecord {
  id: string;
  orderNo: string;
  status: string;
  paymentStatus: string;
  paymentChannel: string | null;
  providerOrderId: string | null;
  /** 订单应付(分) */
  totalCents: number;
  /** 外部实收(分)—— null = 没填过 / 读不到 */
  externalPaidCents: number | null;
}

/**
 * 查一笔订单(标已收款用)
 *
 * 查不到 ⇒ `null`(界面报「订单不存在」)。
 */
export async function getAdminStoreOrder(
  orderNo: string
): Promise<AdminStoreOrderRecord | null> {
  const rows = await db
    .select({
      id: storefrontOrder.id,
      orderNo: storefrontOrder.orderNo,
      status: storefrontOrder.status,
      paymentStatus: storefrontOrder.paymentStatus,
      paymentChannel: storefrontOrder.paymentChannel,
      providerOrderId: storefrontOrder.providerOrderId,
      totalCents: storefrontOrder.totalCents,
    })
    .from(storefrontOrder)
    .where(eq(storefrontOrder.orderNo, orderNo))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const externalMap = await readExternalPaidCents([row.id]);

  return {
    ...row,
    externalPaidCents: externalMap.get(row.id) ?? null,
  };
}

/**
 * 写外部实收金额(分)+ 平台侧单号
 *
 * ⚠️ **这一列可能还不存在**(迁移脚本没跑)⇒ 那时候整页 500。
 * 所以调用方要把 42703 认出来,回一个 `MIGRATION_MISSING` 给界面,
 * 而不是让它冒成「服务器错误」。
 */
export async function setExternalPaidCents(params: {
  orderId: string;
  /**
   * 分
   *
   * - `undefined` —— **不动这一列**(工作室补填淘宝订单号的时候,金额已经
   *   填过了,不能被这一次「没填金额」擦掉)
   * - `null` —— 清掉
   */
  externalPaidCents?: number | null | undefined;
  /** 平台侧单号(淘宝订单号)—— 不传 = 不动这一列 */
  providerOrderId?: string | null | undefined;
}): Promise<void> {
  const patch: Partial<typeof storefrontOrder.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (params.externalPaidCents !== undefined) {
    patch.externalPaidCents = params.externalPaidCents;
  }
  if (params.providerOrderId) {
    patch.providerOrderId = params.providerOrderId;
  }

  await db
    .update(storefrontOrder)
    .set(patch)
    .where(eq(storefrontOrder.id, params.orderId));
}

/* -------------------------------------------------------------------------- */
/*  状态往前推 —— 不在这儿做                                                    */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ **「订单已收款」这一下不在这儿写 UPDATE**
 *
 * 状态机只有一份:`payments/lib/transitions.ts` 的 `decideStorefrontTransition()`
 * + `payments/lib/settle.ts` 的 `settleByOrderNo()`。
 *
 * 自己写一条 UPDATE 就是当年被删掉的那条「后门」——
 * 退款单会被改回「已支付」、迟到的通知能推翻已发的货。
 */
