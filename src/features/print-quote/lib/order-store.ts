/**
 * 打印订单的数据库读写
 *
 * 单独一个模块,不写在 route 文件里 —— Next.js 的 route 文件只该导出
 * HTTP 方法处理器和 runtime/maxDuration,多导出一个函数就可能被框架
 * 当成非法导出。
 */

import { desc, eq, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { type PrintOrderRow, printOrder } from "@/db/schema";

import type {
  PrintOrderStatus,
  PrintQuote,
  UserPrintOrder,
} from "./quote-types";

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
};

/** 落库一条新订单 */
export async function createPrintOrder(
  input: CreatePrintOrderInput
): Promise<PrintOrderRow> {
  const [row] = await db
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
      totalPriceCents: input.quote.totalPriceCents,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      note: input.note,
    })
    .returning();
  if (!row) {
    throw new Error("insert print_order 没有返回行");
  }
  return row;
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

/** 后台改订单状态 */
export async function updatePrintOrderStatus(
  orderNo: string,
  status: PrintOrderStatus
): Promise<PrintOrderRow | null> {
  const rows = await db
    .update(printOrder)
    .set({ status, updatedAt: new Date() })
    .where(eq(printOrder.orderNo, orderNo))
    .returning();
  return rows[0] ?? null;
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
    createdAt: row.createdAt.toISOString(),
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
