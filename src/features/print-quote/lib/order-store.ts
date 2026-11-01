/**
 * 打印订单的数据库读写
 *
 * 单独一个模块,不写在 route 文件里 —— Next.js 的 route 文件只该导出
 * HTTP 方法处理器和 runtime/maxDuration,多导出一个函数就可能被框架
 * 当成非法导出。
 */

import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { type PrintOrderRow, printOrder } from "@/db/schema";

import type { PrintOrderStatus, PrintQuote } from "./quote-types";

/** 下单要写进库的字段 */
export type CreatePrintOrderInput = {
  orderNo: string;
  accessToken: string;
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
      accessToken: input.accessToken,
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
 * 按订单号 + 令牌查订单
 *
 * 两个条件都是 AND —— 订单号可能被猜到,令牌才是防枚举的那一半。
 * 对不上就当不存在(不区分「订单不存在」和「令牌不对」,免得被用来
 * 探测哪些订单号存在)。
 */
export async function findPrintOrder(
  orderNo: string,
  token: string
): Promise<PrintOrderRow | null> {
  const rows = await db
    .select()
    .from(printOrder)
    .where(
      and(eq(printOrder.orderNo, orderNo), eq(printOrder.accessToken, token))
    )
    .limit(1);
  return rows[0] ?? null;
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
