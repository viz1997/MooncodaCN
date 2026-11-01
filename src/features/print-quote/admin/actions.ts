"use server";

/**
 * /admin/print-orders —— 打印订单后台 server actions（2026-11-01）
 *
 * 打印服务是**匿名**下单(没有 user id),所以这里的鉴权只有一层:
 * `adminAction` 确认调用者是 admin。
 *
 * 数据流跟商城的 `/admin/orders` 完全分开:
 *  - 商城订单 = `promptOrder` 表(gpt-image 生图订单)
 *  - 打印订单 = `print_order` 表(按克重计价的 3D 打印工单)
 *
 * 两张表、两个后台页,互不干涉。
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  getPrintOrderStats,
  listPrintOrders,
  type PrintOrderStats,
  updatePrintOrderStatus,
} from "@/features/print-quote/lib/order-store";
import { PRINT_ORDER_STATUSES } from "@/features/print-quote/lib/quote-types";
import { adminAction } from "@/lib/safe-action";

import { type AdminPrintOrder, toAdminPrintOrder } from "./types";

const withAdminPrintOrderAction = (name: string) =>
  adminAction.metadata({ action: `admin.printOrders.${name}` });

const listSchema = z.object({
  status: z.enum(PRINT_ORDER_STATUSES).nullable().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

/**
 * 列表查询 —— 后台全局视角(不限用户)。
 *
 * 不做分页游标:打印订单量级远小于商城订单,一次拉 100 条足够看。
 * 真要翻历史再加分页。
 */
export const adminListPrintOrdersAction = withAdminPrintOrderAction("list")
  .schema(listSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<{ orders: AdminPrintOrder[]; stats: PrintOrderStats }> => {
      const [rows, stats] = await Promise.all([
        listPrintOrders({
          status: parsedInput.status ?? null,
          limit: parsedInput.limit ?? 100,
        }),
        getPrintOrderStats(),
      ]);
      return { orders: rows.map(toAdminPrintOrder), stats };
    }
  );

const updateStatusSchema = z.object({
  orderNo: z.string().min(1).max(64),
  status: z.enum(PRINT_ORDER_STATUSES),
});

/**
 * 改订单状态 —— 工作室推进工单用。
 *
 * 状态只往前进,不自动回退:改成更早的状态要人工确认,这里不拦
 * (运营偶尔要纠错),但至少得是合法状态值。
 */
export const adminUpdatePrintOrderStatusAction = withAdminPrintOrderAction(
  "updateStatus"
)
  .schema(updateStatusSchema)
  .action(async ({ parsedInput }) => {
    const row = await updatePrintOrderStatus(
      parsedInput.orderNo,
      parsedInput.status
    );
    if (!row) {
      throw new Error(`订单不存在:${parsedInput.orderNo}`);
    }

    revalidatePath("/admin/print-orders");

    return {
      orderNo: row.orderNo,
      status: row.status,
      message: "状态已更新",
    };
  });
