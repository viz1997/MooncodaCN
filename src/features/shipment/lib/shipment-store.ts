/**
 * 物流 —— 服务端落库层
 *
 * ## 这一层的三条硬规矩
 *
 * 1. **不抛异常** —— 业务失败一律返 `{ok:false, code}`。抛出去的话
 *    next-safe-action 会把原因糊成「服务器错误」,工作室看不到「这个状态不允许
 *    这么改」这种能照着改的信息。
 * 2. **状态机是唯一裁判** —— 判断「这个跳转合不合法」只问
 *    `transitions.ts`,别在这里另写一份 if-else。
 * 3. **订单状态联动是尽力而为** —— 见 `order-linkage.ts`:物流记录是主记录,
 *    订单的 `status` 是派生信息,推不动也不影响物流本身。
 *
 * ## 为什么要「锁行」
 *
 * 两个入口都能发货(发货台 + 后台的工单页),两个人同时点「发货」会算出**两个
 * 相同的 `package_index`**。所以建单那一路先锁**订单行**(`FOR UPDATE`)——
 * 订单行永远存在,锁它能真正串行化;再算 `package_index = 现有最大值 + 1`。
 *
 * 唯一索引 `(order_kind, order_id, package_index)` 是最后一道防线(锁在两个
 * 不同的事务/不同连接上时仍可能撞上),撞上了就当这次保存失败。
 */

import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import {
  type PrintOrderRow,
  printOrder,
  type ShipmentEventRow,
  type ShipmentRow,
  type StorefrontOrderRow,
  shipment,
  shipmentEvent,
  storefrontOrder,
  storefrontOrderItem,
} from "@/db/schema";
import { formatAddressLine } from "@/features/address/types";
import type { DbOrTx } from "@/features/gpt-image/lib/order-history";
import { describeDbError } from "@/features/shared/lib/db-error";

import {
  isShipmentCarrierCode,
  normalizeShippingCompanyLabel,
  normalizeTrackingNumber,
  OTHER_CARRIER_CODE,
} from "./carriers";
import {
  classifyShipmentTransition,
  shipmentTransitionRequiresNote,
} from "./transitions";
import type {
  AdminShipmentRow,
  ShipmentActor,
  ShipmentErrorCode,
  ShipmentEventView,
  ShipmentOrderKind,
  ShipmentStatus,
  ShipmentView,
} from "./types";

// ============================================
// DB 行 → 视图
// ============================================

/**
 * DB 行 → 买家侧 / 后台看到的物流
 *
 * 时间戳转成 **ISO 字符串** —— 这一份要穿过 API(JSON)和 RSC props 两条路,
 * `Date` 对象在 JSON 序列化那一步会变成字符串,两边长得不一样。
 */
export function toShipmentView(row: ShipmentRow): ShipmentView {
  return {
    id: row.id,
    packageIndex: row.packageIndex,
    status: row.status,
    shippingCompany: row.shippingCompany,
    shippingCompanyLabel: row.shippingCompanyLabel,
    trackingNumber: row.trackingNumber,
    note: row.note,
    shippedAt: row.shippedAt.toISOString(),
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
    returnedAt: row.returnedAt ? row.returnedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** DB 行 → 时间线上的一条事件 */
export function toShipmentEventView(row: ShipmentEventRow): ShipmentEventView {
  return {
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actor: row.actor,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

// ============================================
// 建发货单
// ============================================

/** 建发货单的入参 */
export type CreateShipmentParams = {
  /** 商城订单 / 打印工单 */
  orderKind: ShipmentOrderKind;
  /** 订单 id */
  orderId: string;
  /** 订单号 —— 跟 `orderId` 一起当 WHERE 条件,两个对不上就是「不存在」 */
  orderNo: string;
  /** 快递公司代码(清单在 `carriers.ts`) */
  shippingCompany: string;
  /** 选了「其它」时自己填的名字 */
  shippingCompanyLabel?: string | null;
  /** 运单号(入库前归一化) */
  trackingNumber: string;
  /** 备注 */
  note?: string | null;
  /** 谁建的 —— 一期只有后台 */
  actor?: ShipmentActor;
};

/** 建发货单的结果 */
export type CreateShipmentResult =
  | { ok: true; shipment: ShipmentRow; changed: true }
  | { ok: false; code: ShipmentErrorCode };

/**
 * 建发货单(第一次发货 / 加一个包裹)
 *
 * **事务里四步**:
 * 1. 锁订单行(顺带校验这单真的存在)⇒ 不存在返 `ORDER_NOT_FOUND`
 * 2. 算 `package_index` = 现有最大值 + 1(第一个包裹 = 1)
 * 3. 插物流行(status = `shipped`,`shipped_at` = 此刻)
 * 4. 插一条时间线事件(`from = null` → `to = "shipped"`)
 *
 * 第 3、4 步必须同一个事务:状态落了时间线没写,买家侧看到的是一个**凭空
 * 出现**的包裹,工作室也追不到是谁发的。
 */
export async function createShipment(
  params: CreateShipmentParams
): Promise<CreateShipmentResult> {
  // 入参归一化 —— 在入库前做,不是只在界面层做
  const trackingNumber = normalizeTrackingNumber(params.trackingNumber ?? "");
  if (trackingNumber.length === 0) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (!isShipmentCarrierCode(params.shippingCompany)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const companyLabel = normalizeShippingCompanyLabel(
    params.shippingCompanyLabel ?? ""
  );
  // 选了「其它」就必须填名字 —— 否则买家侧只看到一个没有名字的快递
  if (params.shippingCompany === OTHER_CARRIER_CODE && !companyLabel) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const note = params.note?.trim() ? params.note.trim() : null;

  try {
    const run = async (executor: DbOrTx): Promise<CreateShipmentResult> => {
      // 1. 锁订单行 —— 顺便校验存在 + 订单号对得上
      const locked = await lockOrderRow(
        executor,
        params.orderKind,
        params.orderId,
        params.orderNo
      );
      if (!locked) {
        return { ok: false, code: "ORDER_NOT_FOUND" };
      }

      // 2. 第几个包裹
      const [maxRow] = await executor
        .select({ maxIndex: max(shipment.packageIndex) })
        .from(shipment)
        .where(
          and(
            eq(shipment.orderKind, params.orderKind),
            eq(shipment.orderId, params.orderId)
          )
        );
      const packageIndex = (maxRow?.maxIndex ?? 0) + 1;

      // 3. 插物流行
      const [row] = await executor
        .insert(shipment)
        .values({
          id: nanoid(),
          orderKind: params.orderKind,
          orderId: params.orderId,
          packageIndex,
          status: "shipped",
          shippingCompany: params.shippingCompany,
          shippingCompanyLabel: companyLabel,
          trackingNumber,
          note,
          shippedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!row) {
        return { ok: false, code: "SAVE_FAILED" };
      }

      // 4. 写时间线 —— 建包裹这一格
      await executor.insert(shipmentEvent).values({
        id: nanoid(),
        shipmentId: row.id,
        fromStatus: null,
        toStatus: "shipped",
        actor: params.actor ?? "admin",
        note,
        createdAt: new Date(),
      });

      return { ok: true, shipment: row, changed: true };
    };

    return await db.transaction(run);
  } catch (error) {
    return { ok: false, code: classifyShipmentDbError(error) };
  }
}

/**
 * 锁住订单行(顺带校验订单号对得上)
 *
 * **两张订单表各查一次** —— 物流行的 `order_id` 可能指其中任意一张,
 * 所以归属校验靠「查的时候带 `order_kind`」。
 *
 * 用 `and()` 拼条件,别用 `&&`:drizzle 的 SQL 对象是普通对象,
 * `a && b` 求值出来是 `b` —— 第一个条件会被静默丢掉。
 */
async function lockOrderRow(
  executor: DbOrTx,
  orderKind: ShipmentOrderKind,
  orderId: string,
  orderNo: string
): Promise<{ id: string; orderNo: string } | null> {
  if (orderKind === "storefront") {
    const rows = await executor
      .select({
        id: storefrontOrder.id,
        orderNo: storefrontOrder.orderNo,
      })
      .from(storefrontOrder)
      .where(
        and(
          eq(storefrontOrder.id, orderId),
          eq(storefrontOrder.orderNo, orderNo)
        )
      )
      .limit(1)
      .for("update");
    return rows[0] ?? null;
  }

  const rows = await executor
    .select({
      id: printOrder.id,
      orderNo: printOrder.orderNo,
    })
    .from(printOrder)
    .where(and(eq(printOrder.id, orderId), eq(printOrder.orderNo, orderNo)))
    .limit(1)
    .for("update");
  return rows[0] ?? null;
}

// ============================================
// 改物流状态
// ============================================

/** 改状态的入参 */
export type TransitionShipmentParams = {
  shipmentId: string;
  /** 目标状态 */
  toStatus: ShipmentStatus;
  /** 备注 —— 回退 / 异常时**必填** */
  note?: string | null;
  /** 谁改的 */
  actor?: ShipmentActor;
};

/** 改状态的结果 */
export type TransitionShipmentResult =
  | { ok: true; shipment: ShipmentRow; changed: boolean }
  | { ok: false; code: ShipmentErrorCode };

/**
 * 改物流状态 —— **唯一的物流状态写入口**
 *
 * **事务里四步**:
 * 1. 锁这一行(并发改同一个包裹时串行化)
 * 2. 状态机判定:非法 → `INVALID_TRANSITION`;同状态 → `{ok:true, changed:false}`;
 *    该写备注没写 → `NOTE_REQUIRED`
 * 3. 改 `status` + 三个时间戳
 * 4. 插一条时间线事件
 *
 * ## 三个时间戳怎么走
 *
 * - **`shipped_at` 永远不动** —— 它记的是「实际寄出去」那一刻,跟当前状态无关。
 *   退回再重发,寄出去的时刻还是第一次那个。
 * - **`delivered_at` / `returned_at`** —— 进入对应状态时写,离开时清空。
 *   买家侧显示「X 月 X 日签收」直接读列,不用从时间线里推。
 */
export async function transitionShipmentStatus(
  params: TransitionShipmentParams
): Promise<TransitionShipmentResult> {
  const note = params.note?.trim() ? params.note.trim() : null;

  try {
    const run = async (executor: DbOrTx): Promise<TransitionShipmentResult> => {
      // 1. 锁行
      const locked = await executor
        .select()
        .from(shipment)
        .where(eq(shipment.id, params.shipmentId))
        .limit(1)
        .for("update");
      const current = locked[0];
      if (!current) {
        return { ok: false, code: "SHIPMENT_NOT_FOUND" };
      }

      const from = current.status;

      // 同状态 = 不动 —— 重复点「保存」不刷时间线,也不报错
      if (from === params.toStatus) {
        return { ok: true, shipment: current, changed: false };
      }

      // 2. 状态机判定
      if (!classifyShipmentTransition(from, params.toStatus)) {
        return { ok: false, code: "INVALID_TRANSITION" };
      }
      // 回退 / 异常必须写备注 —— 「为什么被退回来」工作室得知道
      if (shipmentTransitionRequiresNote(from, params.toStatus) && !note) {
        return { ok: false, code: "NOTE_REQUIRED" };
      }

      // 3. 改状态 + 时间戳
      const now = new Date();
      const patch: Partial<typeof shipment.$inferInsert> = {
        status: params.toStatus,
        updatedAt: now,
      };
      if (params.toStatus === "delivered") {
        patch.deliveredAt = now;
        patch.returnedAt = null;
      } else if (params.toStatus === "returned") {
        patch.returnedAt = now;
        patch.deliveredAt = null;
      } else {
        // 回到「已发货」—— 签收 / 异常都没发生过
        patch.deliveredAt = null;
        patch.returnedAt = null;
      }
      // 备注只在写了的时候才覆盖 —— 往前推不写备注,不该把之前那条原因抹掉
      if (note) {
        patch.note = note;
      }
      // ⚠️ `shippedAt` **不动** —— 见文件头的说明

      const [updated] = await executor
        .update(shipment)
        .set(patch)
        .where(eq(shipment.id, current.id))
        .returning();
      if (!updated) {
        return { ok: false, code: "SAVE_FAILED" };
      }

      // 4. 写时间线
      await executor.insert(shipmentEvent).values({
        id: nanoid(),
        shipmentId: current.id,
        fromStatus: from,
        toStatus: params.toStatus,
        actor: params.actor ?? "admin",
        note,
        createdAt: now,
      });

      return { ok: true, shipment: updated, changed: true };
    };

    return await db.transaction(run);
  } catch (error) {
    return { ok: false, code: classifyShipmentDbError(error) };
  }
}

/**
 * 把写库的异常认成一个稳定的码
 *
 * **表不存在 = 迁移脚本没跑** ⇒ `MIGRATION_MISSING` —— 界面据此说「先跑
 * 迁移脚本」,而不是甩一个 500 给工作室。
 */
function classifyShipmentDbError(error: unknown): ShipmentErrorCode {
  const described = describeDbError(error);
  if (described.missingRelation) {
    return "MIGRATION_MISSING";
  }
  return "SAVE_FAILED";
}

// ============================================
// 读
// ============================================

/**
 * 某个订单的物流 —— 买家侧详情页 + 后台发货台都用它
 *
 * 按包裹序号排(第一个包裹在前)。
 */
export async function listShipmentsForOrder(
  orderKind: ShipmentOrderKind,
  orderId: string
): Promise<ShipmentRow[]> {
  return db
    .select()
    .from(shipment)
    .where(
      and(eq(shipment.orderKind, orderKind), eq(shipment.orderId, orderId))
    )
    .orderBy(asc(shipment.packageIndex), asc(shipment.createdAt));
}

/** 某个包裹的时间线 —— 按时间正序 */
export async function listShipmentEvents(
  shipmentId: string
): Promise<ShipmentEventRow[]> {
  return db
    .select()
    .from(shipmentEvent)
    .where(eq(shipmentEvent.shipmentId, shipmentId))
    .orderBy(asc(shipmentEvent.createdAt));
}

/**
 * 物流行 → 它挂在哪个订单上(**带订单号**)
 *
 * ## 为什么物流表上没有 `order_no` 列
 *
 * 订单号是**订单表自己生成的**(两张订单表的号段还不一样),物流表存一份就是
 * 抄一份 —— 抄的那份迟早跟订单表对不上。所以这里按 `order_kind` 回原表取。
 *
 * 订单状态联动需要订单号(`transitionPrintOrderStatus()` 按单号找工单),
 * 所以这个查询在那条路上是**必须的**。
 */
export type ShipmentOrderRef = {
  orderKind: ShipmentOrderKind;
  orderId: string;
  orderNo: string;
};

/**
 * 查物流行挂在哪个订单上 —— 查不到返回 null
 *
 * **归属校验在数据层** —— 物流行的 `order_id` 指向哪张表由 `order_kind` 决定,
 * 查错表就查不到(不会串到别的订单上)。
 */
export async function getShipmentOrderRef(
  shipmentId: string
): Promise<ShipmentOrderRef | null> {
  const [row] = await db
    .select({
      orderKind: shipment.orderKind,
      orderId: shipment.orderId,
    })
    .from(shipment)
    .where(eq(shipment.id, shipmentId))
    .limit(1);
  if (!row) {
    return null;
  }

  if (row.orderKind === "storefront") {
    const [order] = await db
      .select({ orderNo: storefrontOrder.orderNo })
      .from(storefrontOrder)
      .where(eq(storefrontOrder.id, row.orderId))
      .limit(1);
    return order
      ? {
          orderKind: "storefront",
          orderId: row.orderId,
          orderNo: order.orderNo,
        }
      : null;
  }

  const [order] = await db
    .select({ orderNo: printOrder.orderNo })
    .from(printOrder)
    .where(eq(printOrder.id, row.orderId))
    .limit(1);
  return order
    ? { orderKind: "print", orderId: row.orderId, orderNo: order.orderNo }
    : null;
}

/**
 * 后台发货台 —— 商城订单 + 打印工单**摆在一张表里**
 *
 * ## 为什么合并而不是分两个页面
 *
 * 工作室一天几十单,拆成两个页面等于来回切。一张表里按类型分列,一眼看完
 * 「哪些还没寄」。
 *
 * ## 筛选口径
 *
 * - `pending` —— **一个包裹都没有**的单(还没发货)
 * - `shipped` / `delivered` / `returned` —— **至少有一个**包裹在那个状态的单
 *   (一个单可能拆了三个包裹,其中两个已签收一个异常,这条筛选会命中它)
 *
 * ⚠️ **筛选是在「最近 limit 条订单」里做的** —— 不是全库筛。工作室一天几十单,
 * 200 条够翻好几天;真要翻历史再加分页。
 */
export async function listAdminShipmentRows(params?: {
  status?: ShipmentStatus | "pending" | null;
  limit?: number;
}): Promise<AdminShipmentRow[]> {
  const limit = Math.min(Math.max(params?.limit ?? 200, 1), 500);
  const filter = params?.status ?? null;

  const [mallOrders, printOrders] = await Promise.all([
    listStorefrontOrdersForAdmin(limit),
    listPrintOrdersForAdmin(limit),
  ]);

  // 一次把两种订单的物流都取回来 —— 不按订单逐个查(N+1)
  const mallIds = mallOrders.map((o) => o.order.id);
  const printIds = printOrders.map((o) => o.id);

  const [mallShipments, printShipments] = await Promise.all([
    mallIds.length
      ? db
          .select()
          .from(shipment)
          .where(
            and(
              eq(shipment.orderKind, "storefront"),
              inArray(shipment.orderId, mallIds)
            )
          )
      : Promise.resolve([] as ShipmentRow[]),
    printIds.length
      ? db
          .select()
          .from(shipment)
          .where(
            and(
              eq(shipment.orderKind, "print"),
              inArray(shipment.orderId, printIds)
            )
          )
      : Promise.resolve([] as ShipmentRow[]),
  ]);

  const mallByOrder = groupByOrderId(mallShipments);
  const printByOrder = groupByOrderId(printShipments);

  const rows: AdminShipmentRow[] = [];

  for (const { order, items } of mallOrders) {
    const list = mallByOrder.get(order.id) ?? [];
    rows.push({
      orderKind: "storefront",
      orderId: order.id,
      orderNo: order.orderNo,
      summary: summarizeMallItems(items),
      recipientName: order.shippingAddress?.recipientName ?? "",
      recipientPhone: order.shippingAddress?.phone ?? "",
      addressLine: order.shippingAddress
        ? formatAddressLine(order.shippingAddress)
        : "",
      totalCents: order.totalCents,
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
      shipments: list.map(toShipmentView),
      createdAt: order.createdAt.toISOString(),
    });
  }

  for (const order of printOrders) {
    const list = printByOrder.get(order.id) ?? [];
    rows.push({
      orderKind: "print",
      orderId: order.id,
      orderNo: order.orderNo,
      summary: order.modelFileName,
      // 打印工单的联系人跟地址快照是分开的两个字段 —— 地址没填时也还能
      // 打电话问
      recipientName: order.shippingAddress?.recipientName ?? order.contactName,
      recipientPhone: order.shippingAddress?.phone ?? order.contactPhone ?? "",
      addressLine: order.shippingAddress
        ? formatAddressLine(order.shippingAddress)
        : "",
      totalCents: order.totalPriceCents,
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
      shipments: list.map(toShipmentView),
      createdAt: order.createdAt.toISOString(),
    });
  }

  const filtered = filter
    ? rows.filter((row) => matchesFilter(row, filter))
    : rows;

  // 新的单在前 —— 工作室刚接到的单要先看见
  return filtered
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/** 筛选判定 —— 见 `listAdminShipmentRows` 的口径说明 */
function matchesFilter(
  row: AdminShipmentRow,
  filter: ShipmentStatus | "pending"
): boolean {
  if (filter === "pending") {
    return row.shipments.length === 0;
  }
  return row.shipments.some((s) => s.status === filter);
}

/** 按订单 id 分组 */
function groupByOrderId(rows: ShipmentRow[]): Map<string, ShipmentRow[]> {
  const map = new Map<string, ShipmentRow[]>();
  for (const row of rows) {
    const list = map.get(row.orderId) ?? [];
    list.push(row);
    map.set(row.orderId, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.packageIndex - b.packageIndex);
  }
  return map;
}

/** 商城订单的摘要 —— 「钥匙扣 ×2、冰箱贴 ×1」 */
function summarizeMallItems(
  items: Array<{ productTitle: string; quantity: number }>
): string {
  if (items.length === 0) return "";
  return items
    .map((item) => `${item.productTitle} ×${item.quantity}`)
    .join("、");
}

// ============================================
// 订单查询(发货台用)
// ============================================

/**
 * 商城订单 —— 后台发货台用(不限归属)
 *
 * 放在本文件里而不是 `storefront/lib/orders.ts`:发货台要的是**两类订单的
 * 统一视图**,两边查完再合并 —— 拆到两个模块里各查各的,合并逻辑就得在调用
 * 方写,调用方一多就漂了。
 */
async function listStorefrontOrdersForAdmin(limit: number): Promise<
  Array<{
    order: StorefrontOrderRow;
    items: Array<{
      productTitle: string;
      quantity: number;
    }>;
  }>
> {
  const orders = await db
    .select()
    .from(storefrontOrder)
    .orderBy(desc(storefrontOrder.createdAt))
    .limit(limit);
  if (orders.length === 0) return [];

  const items = await db
    .select({
      orderId: storefrontOrderItem.orderId,
      productTitle: storefrontOrderItem.productTitle,
      quantity: storefrontOrderItem.quantity,
    })
    .from(storefrontOrderItem)
    .where(
      inArray(
        storefrontOrderItem.orderId,
        orders.map((o) => o.id)
      )
    );

  const byOrder = new Map<
    string,
    Array<{ productTitle: string; quantity: number }>
  >();
  for (const item of items) {
    const list = byOrder.get(item.orderId) ?? [];
    list.push({ productTitle: item.productTitle, quantity: item.quantity });
    byOrder.set(item.orderId, list);
  }

  return orders.map((order) => ({
    order,
    items: byOrder.get(order.id) ?? [],
  }));
}

/** 打印工单 —— 后台发货台用(不限归属) */
async function listPrintOrdersForAdmin(
  limit: number
): Promise<PrintOrderRow[]> {
  return db
    .select()
    .from(printOrder)
    .orderBy(desc(printOrder.createdAt))
    .limit(limit);
}
