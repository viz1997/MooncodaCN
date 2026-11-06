"use server";

/**
 * /admin/print-orders —— 打印订单后台 server actions（2026-11-01）
 *
 * 打印服务改成**登录后下单**之后,每张工单都挂在 `user_id` 下 —— 后台是
 * 全局视角,能看到所有人的单;用户侧只看自己的(`/account/print-orders`)。
 * 鉴权还是 `adminAction` 这一层:确认调用者是 admin。
 *
 * 数据流跟商城的 `/admin/orders` 完全分开:
 *  - 商城订单 = `promptOrder` 表(gpt-image 生图订单)
 *  - 打印订单 = `print_order` 表(按克重计价的 3D 打印工单)
 *
 * 两张表、两个后台页,互不干涉。
 *
 * ## 改状态走状态机,不是随便写
 *
 * 2026-11-02 之前这里是 `updatePrintOrderStatus(orderNo, status)` —— 传什么
 * 写什么,不校验、不留痕。现在统一走 `transitionPrintOrderStatus()`:
 * 锁行 → 状态机判定 → 改状态 → **写时间线**,全在一个事务里。
 *
 * 后台的 `<Select>` 只是给人看的便利,真正的拒绝发生在数据层:
 *   - 终态(已完成/已取消)没有出边
 *   - 回退必须写备注(用户得知道为什么被退回来)
 */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import {
  notifyPrintOrderStatusChanged,
  toPrintOrderMailInfo,
} from "@/features/print-quote/lib/notifications";
import {
  listPrintOrderEvents,
  toPrintOrderEventView,
} from "@/features/print-quote/lib/order-events";
import {
  getPrintOrderByOrderNo,
  getPrintOrderStats,
  listPrintOrders,
  type PrintOrderStats,
  PrintOrderTransitionError,
  transitionPrintOrderStatus,
} from "@/features/print-quote/lib/order-store";
import {
  markPrintOrderPaidOffline,
  revokePrintOrderOfflinePayment,
} from "@/features/print-quote/lib/payment";
import {
  PRINT_ORDER_STATUSES,
  type PrintOrderStatus,
} from "@/features/print-quote/lib/quote-types";
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
  /**
   * 备注 —— 回退时**必填**(服务端强校验)
   *
   * 前端也会拦一道(选了回退目标就展开输入框,不填不让提交),但那只是
   * 便利:这里才是权威。
   */
  note: z.string().max(1000).nullish(),
});

/** 改状态的返回 */
export type AdminUpdateStatusResult =
  | { ok: true; orderNo: string; status: PrintOrderStatus }
  | { ok: false; code: string };

/**
 * 改订单状态 —— 工作室推进工单用。
 *
 * 允许推进,也允许回退(跨级也允许)—— 但**回退必须写备注**。
 * 非法跳转返回 `{ok:false, code}`,不 throw:抛出去会被 next-safe-action
 * 糊成「服务器错误」,工作室根本不知道是哪儿错了。
 */
export const adminUpdatePrintOrderStatusAction = withAdminPrintOrderAction(
  "updateStatus"
)
  .schema(updateStatusSchema)
  .action(async ({ parsedInput }): Promise<AdminUpdateStatusResult> => {
    try {
      const { order } = await transitionPrintOrderStatus({
        orderNo: parsedInput.orderNo,
        to: parsedInput.status,
        actor: "admin",
        note: parsedInput.note ?? null,
        // 后台不限归属 —— 工作室看得到所有人的单
        userId: null,
      });

      // 通知用户 —— 邮件按**订单的语言**发,不是按后台界面的语言
      after(async () => {
        await notifyPrintOrderStatusChanged({
          order: toPrintOrderMailInfo(order),
          toStatus: parsedInput.status,
          note: parsedInput.note ?? null,
        });
      });

      revalidatePath("/[locale]/admin/print-orders", "page");

      return { ok: true, orderNo: order.orderNo, status: order.status };
    } catch (error) {
      if (error instanceof PrintOrderTransitionError) {
        return { ok: false, code: error.code };
      }
      throw error;
    }
  });

const detailSchema = z.object({
  orderNo: z.string().min(1).max(64),
});

/** 详情(订单 + 时间线)—— 后台弹窗用 */
export type AdminPrintOrderDetailResult =
  | {
      ok: true;
      order: AdminPrintOrder;
      events: ReturnType<typeof toPrintOrderEventView>[];
    }
  | { ok: false; code: "ORDER_NOT_FOUND" };

/**
 * 取一张工单的详情 + 完整时间线
 *
 * 弹窗打开时拉一次:时间线是这条链路新加的东西,后台也得看得见 ——
 * 「工作室改了什么、什么时候改的、为什么回退」全在这儿。
 */
export const adminGetPrintOrderDetailAction = withAdminPrintOrderAction(
  "detail"
)
  .schema(detailSchema)
  .action(async ({ parsedInput }): Promise<AdminPrintOrderDetailResult> => {
    const row = await getPrintOrderByOrderNo(parsedInput.orderNo);
    if (!row) {
      return { ok: false, code: "ORDER_NOT_FOUND" };
    }
    const events = await listPrintOrderEvents(row.id);
    return {
      ok: true,
      order: toAdminPrintOrder(row),
      events: events.map(toPrintOrderEventView),
    };
  });

// ============================================
// 收款(线下)
// ============================================

const paymentSchema = z.object({
  orderNo: z.string().min(1).max(64),
});

/** 收款动作的结果 */
export type AdminPaymentResult =
  | { ok: true; orderNo: string; alreadyPaid?: boolean }
  | { ok: false; code: "ORDER_NOT_FOUND" | "ONLINE_PAYMENT" };

/**
 * 标记已收款(线下转账)
 *
 * 工作室线下收到款之后点这个。**不建 Sellbase 订单** —— 线下单在
 * Sellbase 里没有对应实体,写进去会让两边的订单数对不上。
 *
 * 幂等:已经付过就当无事发生(后台连点两下不该报错)。
 */
export const adminMarkPrintOrderPaidOfflineAction = withAdminPrintOrderAction(
  "markPaidOffline"
)
  .schema(paymentSchema)
  .action(async ({ parsedInput }): Promise<AdminPaymentResult> => {
    const result = await markPrintOrderPaidOffline(parsedInput.orderNo);
    if (!result.ok) {
      return { ok: false, code: "ORDER_NOT_FOUND" };
    }
    revalidatePath("/[locale]/admin/print-orders", "page");
    return {
      ok: true,
      orderNo: parsedInput.orderNo,
      alreadyPaid: result.alreadyPaid,
    };
  });

/**
 * 撤销线下收款 —— 防误点
 *
 * 线上付款**不能**走这条路:钱已经进账了,本地标成未付只会让两边对不上。
 * 所以 `revokePrintOrderOfflinePayment()` 会拒绝 `paymentChannel === "stripe"`
 * 的单,这里把那个拒绝原样传回后台。
 */
export const adminRevokePrintOrderOfflinePaymentAction =
  withAdminPrintOrderAction("revokeOfflinePayment")
    .schema(paymentSchema)
    .action(async ({ parsedInput }): Promise<AdminPaymentResult> => {
      const result = await revokePrintOrderOfflinePayment(parsedInput.orderNo);
      if (!result.ok) {
        return { ok: false, code: result.code ?? "ORDER_NOT_FOUND" };
      }
      revalidatePath("/[locale]/admin/print-orders", "page");
      return { ok: true, orderNo: parsedInput.orderNo };
    });
