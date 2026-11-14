/**
 * 打印订单的数据库读写
 *
 * 单独一个模块,不写在 route 文件里 —— Next.js 的 route 文件只该导出
 * HTTP 方法处理器和 runtime/maxDuration,多导出一个函数就可能被框架
 * 当成非法导出。
 *
 * ## 状态变更只有一个入口:`transitionPrintOrderStatus()`
 *
 * 以前这里是 `updatePrintOrderStatus(orderNo, status)` —— 传什么状态就写什么,
 * 不校验、不留痕。它是一条**绕过时间线的后门**:状态变了但用户的时间线上
 * 什么都看不到,工作室也无法追责。现在这个函数已经删掉,所有状态变更都必须
 * 走 `transitionPrintOrderStatus()`,它把「锁行 → 判状态机 → 改状态 → 写
 * 时间线」放在一个事务里。
 */

import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import {
  type PrintOrderEventRow,
  type PrintOrderRow,
  printOrder,
  type ShippingAddressSnapshot,
} from "@/db/schema";
import type { DbOrTx } from "@/features/gpt-image/lib/order-history";

import { getDeliveryTier } from "./delivery-tier";
import { appendPrintOrderEvent } from "./order-events";
import type {
  PrintOrderEventActor,
  PrintOrderLocale,
  PrintOrderStatus,
  PrintQuote,
  UserPrintOrder,
  UserPrintOrderDetail,
} from "./quote-types";
import { classifyTransition } from "./status-machine";

/** 下单要写进库的字段 */
export type CreatePrintOrderInput = {
  orderNo: string;
  /** 下单人 —— 订单挂在账号名下 */
  userId: string;
  modelFileName: string;
  modelUrl: string;
  modelSizeBytes: number | null;
  quote: PrintQuote;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  note: string | null;
  /** 这单的邮件通知语言 */
  locale: PrintOrderLocale;
  /**
   * 关联的商城订单(2026-11-05)
   *
   * 打印服务走商城购物车结算时,工单是**跟着商城订单**建的 —— 钱由商城
   * 订单收(Sellbase 一张订单覆盖整张购物车),webhook 标 paid 时按这个
   * 关联把工单一起标上。
   *
   * 独立下单那条路(旧路「直接提交订单」)不传这一列 —— 工单自己建 Sellbase
   * 订单,靠 `sellbase_order_id` 反查。
   */
  storefrontOrderId?: string | null;
  /** 收货地址快照 —— 走商城结算时跟商城订单共用一份 */
  shippingAddress?: ShippingAddressSnapshot | null;
  /**
   * 优惠码(2026-11-08)
   *
   * 只存**码**,不存折扣金额 —— 折扣是建单那一刻服务端算出来的
   * (`evaluateCoupon`),客户端带来的任何金额都不采信。
   */
  couponCode?: string | null;
  /**
   * 这一单优惠了多少(分)
   *
   * **`total_price_cents` 存的是应付净额**(= 报价合计 − 这个数)——
   * 收银台就是按那一列收钱的。四个费用列(`weight` / `varnish` /
   * `support` / `delivery`)存的是**折前**的,不动。
   */
  couponDiscountCents?: number | null;
};

/**
 * 落库一条新订单
 *
 * **事务**:插订单 + 插第一条时间线事件(`from=null` → `to=PENDING`,actor=user)。
 * 两条要一起成功 —— 只有订单没有事件,时间线就是空的,用户看到一张空白的
 * 流水,根本不知道工单是从哪来的。
 *
 * ## `tx` 参数
 *
 * 传了就用调用方的事务(不新开一个)—— 商城结算那条路要在**同一个事务**里
 * 建商城订单和工单:两张表要么都成,要么都不成。半张订单(收了钱没工单)
 * 比整笔失败更难收拾。
 */
export async function createPrintOrder(
  input: CreatePrintOrderInput,
  tx?: DbOrTx
): Promise<PrintOrderRow> {
  /**
   * 应付净额(2026-11-08)
   *
   * `total_price_cents` 存**要收多少钱** —— 报价合计减去优惠。
   *
   * 为什么不是「折前总额另存一列应付」—— 代码里有一堆地方读
   * `totalPriceCents` 当成「用户要付多少」来显示(工单邮件、列表、详情页、
   * 后台)。有两个金额列的话,任何一个读成折前总额,用户就会看到
   * 「邮件里写 ¥74.82、实际收 ¥69.82」—— 正是「逐分相等」要防的那种
   * 不一致。**要收多少钱,就只有那一列。**
   *
   * 四个费用列照旧抄**折前**的(它们是「这单收了什么费」的明细)。
   */
  const couponDiscountCents = Math.max(
    0,
    Math.round(input.couponDiscountCents ?? 0)
  );
  const payableCents = Math.max(
    0,
    input.quote.totalPriceCents - couponDiscountCents
  );

  const run = async (executor: DbOrTx): Promise<PrintOrderRow> => {
    const [row] = await executor
      .insert(printOrder)
      .values({
        id: nanoid(),
        orderNo: input.orderNo,
        userId: input.userId,
        status: "PENDING",
        modelFileName: input.modelFileName,
        modelUrl: input.modelUrl,
        modelSizeBytes: input.modelSizeBytes,
        volumeCM3: String(input.quote.volumeCM3),
        surfaceAreaCM2: String(input.quote.surfaceAreaCM2),
        dimX: String(input.quote.dims[0]),
        dimY: String(input.quote.dims[1]),
        dimZ: String(input.quote.dims[2]),
        materialWeightG: String(input.quote.materialWeightG),
        supportWeightG:
          input.quote.supportWeightG === null
            ? null
            : String(input.quote.supportWeightG),
        materialDensity: String(input.quote.density),
        unitPriceCentsPerGram: input.quote.unitPriceCentsPerGram,
        weightFeeCents: input.quote.weightFeeCents,
        varnishFeeCents: input.quote.varnishFeeCents,
        supportFeeCents: input.quote.supportFeeCents,
        deliveryTier: input.quote.deliveryTier,
        deliveryFeeCents: input.quote.deliveryFeeCents,
        // 应付净额(2026-11-08)—— 收银台按这一列收钱
        totalPriceCents: payableCents,
        couponCode: input.couponCode ?? null,
        couponDiscountCents,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        note: input.note,
        locale: input.locale,
        storefrontOrderId: input.storefrontOrderId ?? null,
        shippingAddress: input.shippingAddress ?? null,
      })
      .returning();
    if (!row) {
      throw new Error("insert print_order 没有返回行");
    }

    // 建单事件:时间线的第一格
    await appendPrintOrderEvent(executor, {
      orderId: row.id,
      fromStatus: null,
      toStatus: "PENDING",
      actor: "user",
      note: null,
    });

    return row;
  };

  return tx ? run(tx) : db.transaction(run);
}

/**
 * 某个用户自己的订单 —— 按提交时间倒序
 *
 * `userId` 是**唯一**的过滤条件:用户侧只看自己的单,后台的全局视角走
 * `listPrintOrders()`。
 */
export async function listUserPrintOrders(
  userId: string,
  limit = 50
): Promise<PrintOrderRow[]> {
  const capped = Math.min(Math.max(limit, 1), 200);
  return db
    .select()
    .from(printOrder)
    .where(eq(printOrder.userId, userId))
    .orderBy(desc(printOrder.createdAt))
    .limit(capped);
}

/** 后台列表:按状态筛 + 时间倒序 */
export async function listPrintOrders(opts?: {
  status?: PrintOrderStatus | null;
  limit?: number;
}): Promise<PrintOrderRow[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const where: SQL | undefined = opts?.status
    ? eq(printOrder.status, opts.status)
    : undefined;
  return db
    .select()
    .from(printOrder)
    .where(where)
    .orderBy(desc(printOrder.createdAt))
    .limit(limit);
}

/**
 * 按订单号 + 用户取一单 —— 用户的订单详情页用
 *
 * 归属校验写在 WHERE 里:别人的单查出来就是 null(上层转 404,不是 403 ——
 * 403 等于告诉别人「这个订单号存在」,订单号是可以被枚举的)。
 */
export async function getUserPrintOrderByOrderNo(
  userId: string,
  orderNo: string
): Promise<PrintOrderRow | null> {
  const rows = await db
    .select()
    .from(printOrder)
    .where(eq(printOrder.orderNo, orderNo))
    .limit(1);
  const row = rows[0];
  if (!row || row.userId !== userId) return null;
  return row;
}

/** 按订单号取一单 —— 后台用(不校验归属) */
export async function getPrintOrderByOrderNo(
  orderNo: string
): Promise<PrintOrderRow | null> {
  const rows = await db
    .select()
    .from(printOrder)
    .where(eq(printOrder.orderNo, orderNo))
    .limit(1);
  return rows[0] ?? null;
}

// ============================================
// 状态流转
// ============================================

/**
 * 状态流转失败的机器可读原因
 *
 * action 层拿这个 code 去 i18n 找对应文案 —— **不要 throw 字符串**,生产环境
 * next-safe-action 的 `handleServerError` 会把异常统一糊成「服务器错误」,
 * 用户等于没被告知原因。
 */
export type PrintOrderTransitionErrorCode =
  /** 订单不存在,或者不是当前用户的 */
  | "ORDER_NOT_FOUND"
  /** 状态机不认这个跳转(终态无出边 / 越权) */
  | "INVALID_TRANSITION"
  /** 回退必须写备注 */
  | "NOTE_REQUIRED"
  /** 目标状态 = 当前状态(空转) */
  | "SAME_STATUS"
  /** 还没收款,不能开工(2026-11-04) */
  | "PAYMENT_REQUIRED"
  /**
   * 已经收了款,不能直接取消 —— 要退钱得走**退款申请**(2026-11-14)
   *
   * 这不是「多一道限制」,是**堵一个漏钱的洞**:取消只改 `status`,从不碰
   * `payment_status` ⇒ 一个已付款的工单被买家自己取消掉,订单变成
   * 「已取消」而 `payment_status` 还是 `paid` ⇒ **买家看着像退过款了,
   * 钱其实没退**。
   */
  | "REFUND_REQUIRED";

export class PrintOrderTransitionError extends Error {
  readonly code: PrintOrderTransitionErrorCode;

  constructor(code: PrintOrderTransitionErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PrintOrderTransitionError";
    this.code = code;
  }
}

/** 状态流转的入参 */
export type TransitionPrintOrderInput = {
  orderNo: string;
  /** 目标状态 */
  to: PrintOrderStatus;
  /** 谁改的 —— 决定时间线上这句话怎么写 */
  actor: PrintOrderEventActor;
  /** 人工备注;回退时必填 */
  note: string | null;
  /**
   * 归属用户 —— **用户自助操作时必须传**
   *
   * 传了就写进 WHERE:查不到就是 ORDER_NOT_FOUND(别人的单按不存在处理)。
   * 后台改状态时不传(不限归属)。
   */
  userId: string | null;
};

/**
 * 状态流转 —— **唯一的状态写入口**
 *
 * 事务内四步:
 *   1. `SELECT … FOR UPDATE` 锁住这一行(并发改同一单时串行化)
 *   2. 状态机判定:非法 → 抛 INVALID_TRANSITION;同状态 → SAME_STATUS;
 *      回退没备注 → NOTE_REQUIRED
 *   3. 更新 `status` + `updated_at`
 *   4. 追加一条时间线事件
 *
 * 第 3、4 步必须在同一个事务里:状态改了事件没写,或反过来,都是坏数据。
 *
 * ## 用户自助操作的两条额外限制
 *
 * `actor="user"` 时只允许「取消」,且只允许从 `PENDING` 取消:
 *   - 不能自己推进状态 —— 否则用户可以把单子标成「已签收」,绕过结算
 *   - 确认之后不能撤单 —— 工作室已经投入产能了
 *
 * 这两条在**这里**兜住,而不是只写在 action 里 —— action 层的判断是 UI 便利,
 * 这里是服务端授权边界。
 */
export async function transitionPrintOrderStatus(
  input: TransitionPrintOrderInput
): Promise<{ order: PrintOrderRow; event: PrintOrderEventRow }> {
  const note = input.note?.trim() ? input.note.trim() : null;

  return db.transaction(async (tx) => {
    // 1. 锁行。归属过滤放在 WHERE 里 —— 查不到就是「不存在或不是你的」。
    //    用 `and()` 拼条件,别用 `&&`:drizzle 的 SQL 对象是普通对象,
    //    `a && b` 求值出来是 `b` —— 第一个条件会被静默丢掉。
    const where = input.userId
      ? and(
          eq(printOrder.orderNo, input.orderNo),
          eq(printOrder.userId, input.userId)
        )
      : eq(printOrder.orderNo, input.orderNo);

    const locked = await tx
      .select({
        id: printOrder.id,
        status: printOrder.status,
        paymentStatus: printOrder.paymentStatus,
      })
      .from(printOrder)
      .where(where)
      .limit(1)
      .for("update");

    const current = locked[0];
    if (!current) {
      throw new PrintOrderTransitionError(
        "ORDER_NOT_FOUND",
        `找不到工单 ${input.orderNo}`
      );
    }

    const from = current.status;

    // 2. 状态机判定
    if (from === input.to) {
      throw new PrintOrderTransitionError(
        "SAME_STATUS",
        `工单 ${input.orderNo} 已经是 ${from} 了`
      );
    }

    const kind = classifyTransition(from, input.to);
    if (!kind) {
      throw new PrintOrderTransitionError(
        "INVALID_TRANSITION",
        `工单 ${input.orderNo} 不能从 ${from} 改到 ${input.to}`
      );
    }

    // 回退必须写备注 —— 用户得知道为什么被退回来
    if (kind === "backward" && !note) {
      throw new PrintOrderTransitionError(
        "NOTE_REQUIRED",
        `工单 ${input.orderNo} 回退到 ${input.to} 必须写备注`
      );
    }

    // 用户自助操作只允许取消
    if (input.actor === "user") {
      if (input.to !== "CANCELLED") {
        throw new PrintOrderTransitionError(
          "INVALID_TRANSITION",
          "用户不能自己推进工单状态"
        );
      }
      if (from !== "PENDING") {
        throw new PrintOrderTransitionError(
          "INVALID_TRANSITION",
          "只有待确认的工单可以自己取消"
        );
      }

      // 2026-11-14:已付款的工单**不许直接取消**
      //
      // 「取消」只改 `status`,**从不碰 `payment_status`** ⇒ 一个已付款的工单
      // 被买家自己取消掉,订单变成「已取消」,`payment_status` 还留在 `paid`
      // ⇒ **买家看着像退过款了,钱其实没退**。工作室那边也会以为这一单退过了。
      //
      // ⇒ 要退钱得走**退款申请**那条路(后台会调平台退款 API,退完
      // `payment_status` 才变成 `refunded`)。
      if (current.paymentStatus === "paid") {
        throw new PrintOrderTransitionError(
          "REFUND_REQUIRED",
          `工单 ${input.orderNo} 已经收款,要退钱请走退款申请`
        );
      }
    }

    // 2026-11-04:没收款不许开工
    //
    // 「开工」= 生产中 —— 工作室开始切料/打印的那一刻。在这之前收不到钱,
    // 单子就开工了,后面追款的难度会陡增。所以门槛卡在**状态流转**这一层,
    // 而不是靠后台界面把选项藏起来(那是 UI 便利,不是授权边界)。
    //
    // 只卡 IN_PRODUCTION —— PENDING / CONFIRMED 是在跟客户对齐,还没到花钱
    // 的时候;SHIPPED / COMPLETED 是往回推,拦下来没有意义。
    if (input.to === "IN_PRODUCTION" && current.paymentStatus !== "paid") {
      throw new PrintOrderTransitionError(
        "PAYMENT_REQUIRED",
        `工单 ${input.orderNo} 还没收款,不能开始生产`
      );
    }

    // 3. 改状态
    const [updated] = await tx
      .update(printOrder)
      .set({ status: input.to, updatedAt: new Date() })
      .where(eq(printOrder.id, current.id))
      .returning();
    if (!updated) {
      throw new PrintOrderTransitionError(
        "ORDER_NOT_FOUND",
        `更新工单 ${input.orderNo} 失败`
      );
    }

    // 4. 写时间线
    const event = await appendPrintOrderEvent(tx, {
      orderId: current.id,
      fromStatus: from,
      toStatus: input.to,
      actor: input.actor,
      note,
    });

    return { order: updated, event };
  });
}

/**
 * DB 行 → 用户侧视图
 *
 * numeric 列从 pg 出来是字符串,这里统一转成数字 —— 别让每个组件各写一遍
 * `Number(row.materialWeightG)`。
 */
export function toUserPrintOrder(row: PrintOrderRow): UserPrintOrder {
  return {
    orderNo: row.orderNo,
    status: row.status,
    modelFileName: row.modelFileName,
    materialWeightG: Number(row.materialWeightG),
    supportWeightG:
      row.supportWeightG === null ? null : Number(row.supportWeightG),
    dims: [Number(row.dimX), Number(row.dimY), Number(row.dimZ)],
    totalPriceCents: row.totalPriceCents,
    // 优惠码(2026-11-08)—— 列表上也要显示「减了多少」
    couponCode: row.couponCode,
    couponDiscountCents: row.couponDiscountCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    paymentStatus: row.paymentStatus,
    paymentUrl: row.paymentUrl,
    paymentQrCodeUrl: row.paymentQrCodeUrl,
    paymentChannel: row.paymentChannel,
    // 跟着商城订单结的账 —— 界面据此不给「去支付」(见 `quote-types.ts`)
    viaStorefrontOrder: row.storefrontOrderId !== null,
  };
}

/**
 * DB 行 → 用户侧详情视图
 *
 * 比列表多的是报价明细和联系方式。仍然**不含模型 URL** —— 那是工作室取件用的。
 */
export function toUserPrintOrderDetail(
  row: PrintOrderRow
): UserPrintOrderDetail {
  return {
    ...toUserPrintOrder(row),
    modelSizeBytes: row.modelSizeBytes,
    volumeCM3: Number(row.volumeCM3),
    surfaceAreaCM2: Number(row.surfaceAreaCM2),
    materialDensity: Number(row.materialDensity),
    unitPriceCentsPerGram: row.unitPriceCentsPerGram,
    weightFeeCents: row.weightFeeCents,
    varnishFeeCents: row.varnishFeeCents,
    supportFeeCents: row.supportFeeCents,
    deliveryFeeCents: row.deliveryFeeCents,
    deliveryTier: row.deliveryTier,
    deliveryHours: getDeliveryTier(row.deliveryTier).hours,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    // 收货地址快照 —— 买家侧第一次渲染它(见 `quote-types.ts`)
    shippingAddress: row.shippingAddress,
    note: row.note,
    locale: row.locale === "en" ? "en" : "zh",
  };
}

/** 后台统计 */
export type PrintOrderStats = {
  /** 全部订单数 */
  total: number;
  /** 待确认 */
  pending: number;
  /** 生产中 */
  producing: number;
  /** 全部订单的金额合计(分) */
  amountCents: number;
};

/**
 * 汇总统计 —— **不受状态筛选影响**
 *
 * 后台那四张统计卡片要的是「一共多少单 / 总共多少钱」,而不是「当前筛选
 * 出来的那批」。所以这里单独查,不能拿列表数据在客户端算 —— 列表是分页的,
 * 而且列表跟着筛选走,拿它算出来的「合计金额」会随筛选条件变。
 */
export async function getPrintOrderStats(): Promise<PrintOrderStats> {
  const rows = await db
    .select({
      status: printOrder.status,
      count: sql<number>`count(*)::int`,
      amount: sql<string>`coalesce(sum(${printOrder.totalPriceCents}), 0)`,
    })
    .from(printOrder)
    .groupBy(printOrder.status);

  let total = 0;
  let pending = 0;
  let producing = 0;
  let amountCents = 0;

  for (const row of rows) {
    total += row.count;
    amountCents += Number(row.amount ?? 0);
    if (row.status === "PENDING") pending += row.count;
    if (row.status === "IN_PRODUCTION") producing += row.count;
  }

  return { total, pending, producing, amountCents };
}
