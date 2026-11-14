/**
 * 退款 —— 服务端落库层
 *
 * ## 这一层的四条硬规矩
 *
 * 1. **不抛异常** —— 业务失败一律返 `{ok:false, code}`。抛出去的话
 *    next-safe-action 会把原因糊成「服务器错误」,工作室看不到「这个状态不允许
 *    这么改」这种能照着改的信息。
 * 2. **状态机是唯一裁判** —— 判断「这个跳转合不合法」只问 `transitions.ts`,
 *    别在这里另写一份 if-else。
 * 3. **「能不能退」只问 `eligibility.ts`** —— 界面和服务端共用同一份判定,
 *    两处不可能漂。
 * 4. **钱只由平台退款 API 动** —— 这一层**只记账**。它不调平台、不改
 *    `payment_status` —— 那是 `payments/lib/settle.ts` 的 `mark_refunded`
 *    分支的活(全仓**只有那一处**能写 `payment_status = "refunded"`)。
 *
 * ## 归属校验在数据层
 *
 * 查订单时 WHERE 带上 `user_id` —— 别人的单查出来是 null(⇒ `NOT_FOUND`),
 * 不是 403(订单号可以枚举)。
 */

import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import {
  printOrder,
  type PrintOrderRow,
  type RefundRequestEventRow,
  type RefundRequestRow,
  refundRequest,
  refundRequestEvent,
  shipment,
  storefrontOrder,
  type StorefrontOrderRow,
  storefrontOrderItem,
  user,
} from "@/db/schema";
import type { DbOrTx } from "@/features/gpt-image/lib/order-history";
import { describeDbError } from "@/features/shared/lib/db-error";

import {
  classifyRefundTransition,
  refundTransitionRequiresNote,
} from "./transitions";
import type {
  AdminRefundRow,
  RefundActor,
  RefundErrorCode,
  RefundEventView,
  RefundOrderKind,
  RefundStatus,
  RefundView,
} from "./types";

// ============================================
// DB 行 → 视图
// ============================================

/**
 * DB 行 → 买家侧 / 后台看到的退款申请
 *
 * 时间戳转成 **ISO 字符串** —— 这一份要穿过 API(JSON)和 RSC props 两条路,
 * `Date` 对象在 JSON 序列化那一步会变成字符串,两边长得不一样。
 */
export function toRefundView(row: RefundRequestRow): RefundView {
  return {
    id: row.id,
    orderKind: row.orderKind,
    orderNo: row.orderNo,
    amountCents: row.amountCents,
    reason: row.reason,
    status: row.status,
    refundedCents: row.refundedCents,
    paymentChannel: row.paymentChannel,
    note: row.note,
    providerRefundId: row.providerRefundId,
    providerRefundStatus: row.providerRefundStatus,
    refundError: row.refundError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** DB 行 → 时间线上的一条事件 */
export function toRefundEventView(
  row: RefundRequestEventRow
): RefundEventView {
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
// 订单快照
// ============================================

/**
 * 一个订单的退款判定需要的全部信息
 *
 * **刻意是最小字段集** —— `eligibility.ts` 是纯函数,喂它这几列就够。
 */
export type RefundOrderSnapshot = {
  id: string;
  orderNo: string;
  orderKind: RefundOrderKind;
  userId: string;
  /** 订单状态 —— 商城小写 / 打印大写 */
  status: string;
  /** 收款状态(小写那套) */
  paymentStatus: string;
  /** 收款通道 —— 退款要走的那个通道 */
  paymentChannel: string | null;
  /** 平台侧单号 —— 退款 API 要用它反查 */
  providerOrderId: string | null;
  /** **整单总额**(分)—— 退款申请金额就是它 */
  totalCents: number;
  /** 商城订单:已经发过货没有 */
  hasShipment: boolean;
  /** 买家邮箱 —— 工作室收到退款申请后要联系买家 */
  buyerEmail: string | null;
  /** 买家昵称 */
  buyerName: string | null;
};

/**
 * 查一个订单(退款判定用)
 *
 * @param userId 传 `null` = **不限归属**(后台用);传 id = 只查这个人的单
 *                (买家侧用 —— 归属校验在数据层)
 */
export async function getRefundOrderSnapshot(params: {
  orderKind: RefundOrderKind;
  orderNo: string;
  userId?: string | null;
}): Promise<RefundOrderSnapshot | null> {
  if (params.orderKind === "storefront") {
    const rows = await db
      .select({
        id: storefrontOrder.id,
        orderNo: storefrontOrder.orderNo,
        userId: storefrontOrder.userId,
        status: storefrontOrder.status,
        paymentStatus: storefrontOrder.paymentStatus,
        paymentChannel: storefrontOrder.paymentChannel,
        providerOrderId: storefrontOrder.providerOrderId,
        totalCents: storefrontOrder.totalCents,
        buyerEmail: user.email,
        buyerName: user.name,
      })
      .from(storefrontOrder)
      .leftJoin(user, eq(user.id, storefrontOrder.userId))
      .where(
        and(
          eq(storefrontOrder.orderNo, params.orderNo),
          params.userId ? eq(storefrontOrder.userId, params.userId) : undefined
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      orderKind: "storefront",
      hasShipment: await orderHasShipment("storefront", row.id),
    };
  }

  const rows = await db
    .select({
      id: printOrder.id,
      orderNo: printOrder.orderNo,
      userId: printOrder.userId,
      status: printOrder.status,
      paymentStatus: printOrder.paymentStatus,
      paymentChannel: printOrder.paymentChannel,
      providerOrderId: printOrder.providerOrderId,
      totalCents: printOrder.totalPriceCents,
      buyerEmail: user.email,
      buyerName: user.name,
    })
    .from(printOrder)
    .leftJoin(user, eq(user.id, printOrder.userId))
    .where(
      and(
        eq(printOrder.orderNo, params.orderNo),
        params.userId ? eq(printOrder.userId, params.userId) : undefined
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    orderKind: "print",
    hasShipment: await orderHasShipment("print", row.id),
  };
}

/** 这个订单有没有发过货(物流表里有行就是发过) */
async function orderHasShipment(
  orderKind: RefundOrderKind,
  orderId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: shipment.id })
    .from(shipment)
    .where(
      and(eq(shipment.orderKind, orderKind), eq(shipment.orderId, orderId))
    )
    .limit(1);
  return rows.length > 0;
}

// ============================================
// 申请
// ============================================

/** 建退款申请的入参 */
export type CreateRefundRequestParams = {
  orderKind: RefundOrderKind;
  orderId: string;
  orderNo: string;
  userId: string;
  /** 申请金额(分)—— **整单总额**,由服务端从订单上取 */
  amountCents: number;
  /** 买家填的原因 */
  reason: string;
  /** 这单走的收款通道(退款要走的那个) */
  paymentChannel?: string | null;
};

/** 建退款申请的结果 */
export type CreateRefundRequestResult =
  | { ok: true; refund: RefundRequestRow; changed: true }
  | { ok: false; code: RefundErrorCode };

/**
 * 买家提交退款申请 —— **申请单**的唯一写入口
 *
 * **事务里三步**:
 * 1. 查有没有**进行中**的申请(`pending` 或 `approved`)⇒ 有 ⇒ `REQUEST_EXISTS`
 * 2. 插申请行(status = `pending`)
 * 3. 插一条时间线事件(`from = null` → `to = "pending"`,actor = `user`)
 *
 * 第 2、3 步必须同一个事务:申请落了时间线没写,工作室看到的是一个**凭空出现**
 * 的申请。
 *
 * ## 为什么金额由服务端取
 *
 * `amountCents` 是**整单总额** —— 客户端不传。客户端传了就多一个能传错的地方
 * (买家把金额改成 1 分,工作室按 1 分退,亏的是工作室)。
 */
export async function createRefundRequest(
  params: CreateRefundRequestParams
): Promise<CreateRefundRequestResult> {
  const reason = params.reason.trim();
  if (reason.length === 0) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  try {
    const run = async (
      executor: DbOrTx
    ): Promise<CreateRefundRequestResult> => {
      // 1. 有没有进行中的申请
      //
      // ⚠️ **「进行中」= `pending` 或 `approved`** —— `approved` 是钱还在路上,
      // 那时候再申请一条就会**退两次钱**。
      //
      // DB 里那个部分唯一索引只约束 `status = 'pending'` ⇒ 光靠索引挡不住
      // `approved` 那一条,这里必须自己查。
      const existing = await executor
        .select({ id: refundRequest.id })
        .from(refundRequest)
        .where(
          and(
            eq(refundRequest.orderKind, params.orderKind),
            eq(refundRequest.orderId, params.orderId),
            or(
              eq(refundRequest.status, "pending"),
              eq(refundRequest.status, "approved")
            )
          )
        )
        .limit(1)
        .for("update");
      if (existing.length > 0) {
        return { ok: false, code: "REQUEST_EXISTS" };
      }

      // 2. 插申请行
      const [row] = await executor
        .insert(refundRequest)
        .values({
          id: nanoid(),
          orderKind: params.orderKind,
          orderId: params.orderId,
          orderNo: params.orderNo,
          userId: params.userId,
          amountCents: params.amountCents,
          reason,
          status: "pending",
          paymentChannel: params.paymentChannel ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      if (!row) {
        return { ok: false, code: "SAVE_FAILED" };
      }

      // 3. 写时间线
      await executor.insert(refundRequestEvent).values({
        id: nanoid(),
        refundRequestId: row.id,
        fromStatus: null,
        toStatus: "pending",
        actor: "user",
        note: null,
        createdAt: new Date(),
      });

      return { ok: true, refund: row, changed: true };
    };

    return await db.transaction(run);
  } catch (error) {
    return { ok: false, code: classifyRefundDbError(error) };
  }
}

// ============================================
// 状态变更
// ============================================

/** 改状态的入参 */
export type TransitionRefundParams = {
  refundRequestId: string;
  /** 目标状态 */
  toStatus: RefundStatus;
  /** 备注 —— 拒绝时**必填** */
  note?: string | null;
  /** 谁改的 */
  actor?: RefundActor;
  /** 处理人(admin 用户 id)—— 记进 `reviewed_by` */
  reviewedBy?: string | null;
  /** 实际退款金额(分)—— 写 `refunded` 时给 */
  refundedCents?: number | null;
  /** 平台侧退款单号 */
  providerRefundId?: string | null;
  /** 平台侧退款状态 */
  providerRefundStatus?: string | null;
  /** 退款失败原因 */
  refundError?: string | null;
};

/** 改状态的结果 */
export type TransitionRefundResult =
  | { ok: true; refund: RefundRequestRow; changed: boolean }
  | { ok: false; code: RefundErrorCode };

/**
 * 改退款申请的状态 —— **唯一的状态写入口**
 *
 * **事务里四步**:
 * 1. 锁这一行(并发处理同一个申请时串行化)
 * 2. 状态机判定:非法 → `INVALID_TRANSITION`;同状态 → `{ok:true, changed:false}`;
 *    该写备注没写 → `NOTE_REQUIRED`
 * 3. 改 `status` + 几个列 + `updated_at`
 * 4. 插一条时间线事件
 *
 * ## 这层**不动钱**
 *
 * 它只改**申请单**。`payment_status` 由 `payments/lib/settle.ts` 的
 * `mark_refunded` 分支写(那是全仓唯一能写它的地方)⇒ **退款这条线不会
 * 出现「申请单说退了、订单说没退」的第二个真相来源**。
 */
export async function transitionRefundStatus(
  params: TransitionRefundParams
): Promise<TransitionRefundResult> {
  const note = params.note?.trim() ? params.note.trim() : null;

  try {
    const run = async (
      executor: DbOrTx
    ): Promise<TransitionRefundResult> => {
      // 1. 锁行
      const locked = await executor
        .select()
        .from(refundRequest)
        .where(eq(refundRequest.id, params.refundRequestId))
        .limit(1)
        .for("update");
      const current = locked[0];
      if (!current) {
        return { ok: false, code: "REFUND_NOT_FOUND" };
      }

      const from = current.status;

      // 同状态 = 不动 —— 重复点「保存」不刷时间线,也不报错
      if (from === params.toStatus) {
        return { ok: true, refund: current, changed: false };
      }

      // 2. 状态机判定
      if (!classifyRefundTransition(from, params.toStatus)) {
        return { ok: false, code: "INVALID_TRANSITION" };
      }
      // 拒绝必须写备注 —— 「为什么不退」工作室和买家都得知道
      if (refundTransitionRequiresNote(from, params.toStatus) && !note) {
        return { ok: false, code: "NOTE_REQUIRED" };
      }

      // 3. 改状态 + 几个列
      const now = new Date();
      const patch: Partial<typeof refundRequest.$inferInsert> = {
        status: params.toStatus,
        updatedAt: now,
      };
      if (params.refundedCents !== undefined && params.refundedCents !== null) {
        patch.refundedCents = params.refundedCents;
      }
      if (params.providerRefundId !== undefined) {
        patch.providerRefundId = params.providerRefundId;
      }
      if (params.providerRefundStatus !== undefined) {
        patch.providerRefundStatus = params.providerRefundStatus;
      }
      if (params.refundError !== undefined) {
        patch.refundError = params.refundError;
      }
      // 备注只在写了的时候才覆盖 —— 往前推不写备注,不该把之前那条原因抹掉
      if (note) {
        patch.note = note;
      }
      // 处理人 / 处理时间 —— 谁点的「同意」要能追到
      if (params.reviewedBy) {
        patch.reviewedBy = params.reviewedBy;
      }
      if (params.actor === "admin") {
        patch.reviewedAt = now;
      }

      const [updated] = await executor
        .update(refundRequest)
        .set(patch)
        .where(eq(refundRequest.id, current.id))
        .returning();
      if (!updated) {
        return { ok: false, code: "SAVE_FAILED" };
      }

      // 4. 写时间线
      await executor.insert(refundRequestEvent).values({
        id: nanoid(),
        refundRequestId: current.id,
        fromStatus: from,
        toStatus: params.toStatus,
        actor: params.actor ?? "admin",
        note,
        createdAt: now,
      });

      return { ok: true, refund: updated, changed: true };
    };

    return await db.transaction(run);
  } catch (error) {
    return { ok: false, code: classifyRefundDbError(error) };
  }
}

/**
 * 只写**平台侧那几列** —— **不改状态**
 *
 * ## 为什么需要这一层
 *
 * 「执行退款」回 `processing` 时,申请单的状态可能**已经是** `approved`
 * (工作室先点了「同意退款」)⇒ `transitionRefundStatus` 走「同状态不动」
 * 那条路,**平台单号写不进去**。
 *
 * 而 `providerRefundId` 是**幂等键的证据** —— 工作室要知道这个号,才能在
 * 平台后台查这一笔、才能确认「这一笔退过了,别再退一次」。丢了它等于
 * 「钱在路上,但我们不知道是哪一笔」。
 *
 * ## 这一层**不碰 `status`**
 *
 * 状态机还是唯一的状态写入口 —— 这里只补平台侧那几列。
 */
export async function recordRefundProviderOutcome(params: {
  refundRequestId: string;
  /** 平台侧退款单号 */
  providerRefundId?: string | null;
  /** 平台侧退款状态(`SUCCESS` / `PROCESSING` / `TRADE_SUCCESS` …) */
  providerRefundStatus?: string | null;
  /** 平台给的失败原因(原文) */
  refundError?: string | null;
  /** 处理备注 —— 只在给了非空值的时候才写(空串**不覆盖**之前那条) */
  note?: string | null;
}): Promise<{ ok: true } | { ok: false; code: RefundErrorCode }> {
  const note = params.note?.trim() ? params.note.trim() : null;

  try {
    const patch: Partial<typeof refundRequest.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (params.providerRefundId !== undefined) {
      patch.providerRefundId = params.providerRefundId;
    }
    if (params.providerRefundStatus !== undefined) {
      patch.providerRefundStatus = params.providerRefundStatus;
    }
    if (params.refundError !== undefined) {
      patch.refundError = params.refundError;
    }
    if (note) {
      patch.note = note;
    }

    const updated = await db
      .update(refundRequest)
      .set(patch)
      .where(eq(refundRequest.id, params.refundRequestId))
      .returning({ id: refundRequest.id });
    if (!updated.length) {
      return { ok: false, code: "REFUND_NOT_FOUND" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, code: classifyRefundDbError(error) };
  }
}

/**
 * 把写库的异常认成一个稳定的码
 *
 * **表不存在 = 迁移脚本没跑** ⇒ `MIGRATION_MISSING` —— 界面据此说「先跑
 * 迁移脚本」,而不是甩一个 500 给工作室。
 */
function classifyRefundDbError(error: unknown): RefundErrorCode {
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
 * 某个订单的**最新一条**退款申请 —— 买家侧详情页用
 *
 * 「最新」而不是「唯一」:被拒之后买家可以再申请一条 ⇒ 一个订单可能有多条
 * 申请(历史)。买家侧只该看见**当前那一条**。
 */
export async function getLatestRefundRequestForOrder(
  orderKind: RefundOrderKind,
  orderId: string
): Promise<RefundRequestRow | null> {
  const rows = await db
    .select()
    .from(refundRequest)
    .where(
      and(eq(refundRequest.orderKind, orderKind), eq(refundRequest.orderId, orderId))
    )
    .orderBy(desc(refundRequest.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** 某个订单有没有**进行中**的申请(`pending` 或 `approved`) */
export async function hasActiveRefundRequest(
  orderKind: RefundOrderKind,
  orderId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: refundRequest.id })
    .from(refundRequest)
    .where(
      and(
        eq(refundRequest.orderKind, orderKind),
        eq(refundRequest.orderId, orderId),
        or(
          eq(refundRequest.status, "pending"),
          eq(refundRequest.status, "approved")
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** 按 id 查一条退款申请 */
export async function getRefundRequestById(
  refundRequestId: string
): Promise<RefundRequestRow | null> {
  const rows = await db
    .select()
    .from(refundRequest)
    .where(eq(refundRequest.id, refundRequestId))
    .limit(1);
  return rows[0] ?? null;
}

/** 某条申请的时间线 —— 按时间正序 */
export async function listRefundRequestEvents(
  refundRequestId: string
): Promise<RefundRequestEventRow[]> {
  return db
    .select()
    .from(refundRequestEvent)
    .where(eq(refundRequestEvent.refundRequestId, refundRequestId))
    .orderBy(asc(refundRequestEvent.createdAt));
}

/**
 * 后台退款管理 —— 商城订单 + 打印工单**摆在一张表里**
 *
 * 工作室一天几十单,拆成两个页面等于来回切。一张表里按类型分列,一眼看完
 * 「哪些还没处理」。
 *
 * ## 筛选口径
 *
 * 筛的是**申请单本身的状态**(`pending` / `approved` / `refunded` / `rejected`),
 * 跟物流那一页的「按包裹状态筛」不是一回事。
 *
 * ⚠️ **筛选是在「最近 limit 条申请」里做的** —— 不是全库筛。工作室一天几十单,
 * 200 条够翻好几天;真要翻历史再加分页。
 */
export async function listAdminRefundRows(params?: {
  status?: RefundStatus | null;
  limit?: number;
}): Promise<AdminRefundRow[]> {
  const limit = Math.min(Math.max(params?.limit ?? 200, 1), 500);
  const filter = params?.status ?? null;

  const rows = await db
    .select()
    .from(refundRequest)
    .orderBy(desc(refundRequest.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];

  const filtered = filter ? rows.filter((r) => r.status === filter) : rows;

  // 买家信息 + 订单摘要 —— 一次把两张表查完,不按行逐个查(N+1)
  const userIds = [...new Set(filtered.map((r) => r.userId))];
  const users = userIds.length
    ? await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(inArray(user.id, userIds))
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const mallIds = filtered
    .filter((r) => r.orderKind === "storefront")
    .map((r) => r.orderId);
  const printIds = filtered
    .filter((r) => r.orderKind === "print")
    .map((r) => r.orderId);

  const [mallOrders, printOrders, mallItems] = await Promise.all([
    mallIds.length
      ? db
          .select()
          .from(storefrontOrder)
          .where(inArray(storefrontOrder.id, mallIds))
      : Promise.resolve([] as StorefrontOrderRow[]),
    printIds.length
      ? db
          .select()
          .from(printOrder)
          .where(inArray(printOrder.id, printIds))
      : Promise.resolve([] as PrintOrderRow[]),
    mallIds.length
      ? db
          .select({
            orderId: storefrontOrderItem.orderId,
            productTitle: storefrontOrderItem.productTitle,
            quantity: storefrontOrderItem.quantity,
          })
          .from(storefrontOrderItem)
          .where(inArray(storefrontOrderItem.orderId, mallIds))
      : Promise.resolve(
          [] as Array<{ orderId: string; productTitle: string; quantity: number }>
        ),
  ]);

  const mallOrderById = new Map(mallOrders.map((o) => [o.id, o]));
  const printOrderById = new Map(printOrders.map((o) => [o.id, o]));
  const itemsByOrder = new Map<
    string,
    Array<{ productTitle: string; quantity: number }>
  >();
  for (const item of mallItems) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push({ productTitle: item.productTitle, quantity: item.quantity });
    itemsByOrder.set(item.orderId, list);
  }

  return filtered.map((row) => {
    const buyer = userById.get(row.userId);
    const buyerLabel = buyer
      ? `${buyer.name}（${buyer.email}）`
      : (row.userId || "—");

    if (row.orderKind === "storefront") {
      const order = mallOrderById.get(row.orderId);
      const items = itemsByOrder.get(row.orderId) ?? [];
      return {
        id: row.id,
        orderKind: row.orderKind,
        orderId: row.orderId,
        orderNo: row.orderNo,
        userId: row.userId,
        buyerLabel,
        summary: summarizeMallItems(items),
        amountCents: row.amountCents,
        reason: row.reason,
        status: row.status,
        refundedCents: row.refundedCents,
        paymentChannel: row.paymentChannel,
        providerRefundId: row.providerRefundId,
        providerRefundStatus: row.providerRefundStatus,
        refundError: row.refundError,
        note: row.note,
        orderStatus: order?.status ?? "—",
        paymentStatus: order?.paymentStatus ?? "—",
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }

    const order = printOrderById.get(row.orderId);
    return {
      id: row.id,
      orderKind: row.orderKind,
      orderId: row.orderId,
      orderNo: row.orderNo,
      userId: row.userId,
      buyerLabel,
      summary: order?.modelFileName ?? "",
      amountCents: row.amountCents,
      reason: row.reason,
      status: row.status,
      refundedCents: row.refundedCents,
      paymentChannel: row.paymentChannel,
      providerRefundId: row.providerRefundId,
      providerRefundStatus: row.providerRefundStatus,
      refundError: row.refundError,
      note: row.note,
      orderStatus: order?.status ?? "—",
      paymentStatus: order?.paymentStatus ?? "—",
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
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
