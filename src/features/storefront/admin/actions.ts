"use server";

/**
 * /admin/store-orders —— 商城订单后台 server actions(2026-11-18)
 *
 * 买家不信任一个新店 ⇒ 结算页除了支付宝,多一个「**淘宝下单**」:点了跳到
 * 这件设计对应的淘宝商品页,在淘宝付款(享受平台担保)。钱进的是**淘宝那个
 * 账户**,不在本仓库的收钱链路里 ⇒ 工作室在淘宝后台看到钱到了,再回本站
 * 把那笔单**手工标成已收款**。
 *
 * 这一组 action 就是那件事的地方:
 *
 * - `adminListStoreOrdersAction` —— 读列表(最近 200 笔)
 * - `adminMarkStoreOrderPaidAction` —— 手工标「已收款」
 *
 * ## 出错返回 `{ok:false, code}`,不 throw
 *
 * throw 会被 next-safe-action 糊成「服务器错误」—— 工作室根本不知道是哪儿
 * 错了(订单号打错了?这一单退过款了?表还没建?)。所以这里把**能预见的**失败
 * 都变成一个 code,界面照着 code 给话。
 *
 * ## 「use server」文件只导出 async 函数
 *
 * 类型**不能**在这里 re-export —— Turbopack 会把它注册成 server action,
 * 运行时引用一个不存在的类型绑定 → `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。类型全在
 * `./types.ts`。
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { settleByOrderNo } from "@/features/payments/lib/settle";
import { describeDbError } from "@/features/shared/lib/db-error";
import { adminAction } from "@/lib/safe-action";

import {
  getAdminStoreOrder,
  listAdminStoreOrders,
  setExternalPaidCents,
} from "./store";
import type {
  AdminStoreOrderListResult,
  AdminStoreOrderWriteResult,
} from "./types";

const withAdminStoreOrderAction = (name: string) =>
  adminAction.metadata({ action: `admin.storeOrder.${name}` });

/** 每次写完都要刷的路径 */
const REVALIDATE_PATH = "/[locale]/admin/store-orders";

/** 买家侧那一页 —— 工作室标完已收款,买家刷新就能看到 */
const BUYER_ORDER_PATH = "/[locale]/account/orders";

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 读后台列表
 *
 * **迁移脚本没跑也能打开** —— `external_paid_cents` 那一列走单独一条查询,
 * 读失败就当「没填过实收金额」(见 `store.ts` 的「那一列单独读」)。
 */
export const adminListStoreOrdersAction = withAdminStoreOrderAction(
  "list"
).action(async (): Promise<AdminStoreOrderListResult> => {
  try {
    const rows = await listAdminStoreOrders();
    return { ok: true, rows };
  } catch (error) {
    const info = describeDbError(error);
    console.error("[storefront/admin] 读商城订单失败:", info.message || error);
    if (info.missingRelation) {
      return { ok: false, code: "MIGRATION_MISSING" };
    }
    return { ok: false, code: "LOAD_FAILED" };
  }
});

/* -------------------------------------------------------------------------- */
/*  写                                                                         */
/* -------------------------------------------------------------------------- */

/** 「手工标已收款」的入参 */
const markPaidSchema = z.object({
  /** 本站订单号(`SO-…`) */
  orderNo: z.string().min(1, "订单号必填").max(64),
  /** 走哪条路收的钱 —— 只有淘宝和线下转账支持手工标 */
  channel: z.enum(["taobao", "offline"]),
  /**
   * 平台侧单号(淘宝订单号)—— 工作室从淘宝商家后台**抄**进来的
   *
   * 淘宝那一档**必填** —— 没有它就认不出「这一笔是淘宝上哪一笔」。
   */
  externalOrderNo: z.string().max(64).nullish(),
  /**
   * 实收金额(分)
   *
   * - **淘宝** —— 工作室在淘宝后台看到的实收。**允许跟本站应付对不上**
   *   (淘宝那边有自己的运费模板和优惠券)⇒ 对不上的差额在界面上摆出来,
   *   不报错。
   * - **线下** —— 不传就按订单应付记(= 工作室收的就是这个数);传了
   *   **必须跟订单应付一分不差**,否则拒(打错一位数字就会算错账)。
   */
  paidCents: z.number().int().nonnegative().nullish(),
});

/**
 * 手工标「已收款」
 *
 * ## 闸的顺序(短路,第一个不通过就返回)
 *
 * ```
 * ORDER_NOT_FOUND → ORDER_REFUNDED → ORDER_CANCELLED
 * → EXTERNAL_ORDER_NO_REQUIRED(淘宝)→ AMOUNT_MISMATCH(线下)
 * ```
 *
 * ## 状态**不在这儿**写
 *
 * 状态机只有一份:`payments/lib/transitions.ts` 的 `decideStorefrontTransition()`
 * + `payments/lib/settle.ts` 的 `settleByOrderNo()`。自己写一条 UPDATE 就是
 * 当年被删掉的那条「后门」—— 退款单会被改回「已支付」、迟到的通知能推翻
 * 已发的货。
 *
 * ## ⚠️ **不核对金额**(这一步)
 *
 * `settleByOrderNo` 的金额核对(`amount-guard.ts`)只在**回调**那一档有意义
 * —— 那是「平台报回来的金额 == 我们收的那笔钱」。
 *
 * 手工标这一档**不传** `paidAmountCents` ⇒ 核对那一档直接放行。
 *
 * 淘宝那一单跟本站金额**本来就不该相等**(本站是参考价,淘宝有它自己的运费
 * 模板和优惠券)⇒ 拿本站应付去比淘宝的实收,会把每一笔正常的淘宝单都拒掉。
 *
 * 线下那一档的「必须相等」是**本 action 自己**判的(见上面的 `AMOUNT_MISMATCH`),
 * 不是靠回调那个核对。
 */
export const adminMarkStoreOrderPaidAction = withAdminStoreOrderAction(
  "markPaid"
)
  .schema(markPaidSchema)
  .action(async ({ parsedInput }): Promise<AdminStoreOrderWriteResult> => {
    // ---- 1. 订单在不在 ----
    const order = await getAdminStoreOrder(parsedInput.orderNo);
    if (!order) {
      return { ok: false, code: "ORDER_NOT_FOUND" };
    }

    // ---- 2. 退过款的单不能改成已收款 ----
    //
    // 迟到的收款通知也不能把它改回来(同一个口径,见 `transitions.ts`)。
    if (order.paymentStatus === "refunded") {
      return { ok: false, code: "ORDER_REFUNDED" };
    }

    // ---- 3. 已取消的单不改 ----
    if (order.status === "cancelled") {
      return { ok: false, code: "ORDER_CANCELLED" };
    }

    // ---- 4. 淘宝那一档必须填淘宝订单号 ----
    const externalOrderNo = parsedInput.externalOrderNo?.trim() || null;
    if (parsedInput.channel === "taobao" && !externalOrderNo) {
      return { ok: false, code: "EXTERNAL_ORDER_NO_REQUIRED" };
    }

    // ---- 5. 线下那一档:实收必须等于订单应付 ----
    let paidCents = parsedInput.paidCents ?? undefined;
    if (parsedInput.channel === "offline") {
      if (paidCents === undefined) {
        // 没填 ⇒ 就是订单应付(工作室收的就是这个数)
        paidCents = order.totalCents;
      }
      if (paidCents !== order.totalCents) {
        return { ok: false, code: "AMOUNT_MISMATCH" };
      }
    }

    // ---- 6. 状态往前推(状态机只有一份) ----
    let changed = false;
    try {
      const result = await settleByOrderNo({
        orderNo: parsedInput.orderNo,
        action: "mark_paid",
        channel: parsedInput.channel,
        providerOrderId: externalOrderNo,
        // ⚠️ **不传金额** —— 见文件头「不核对金额」
        paidAmountCents: undefined,
      });
      changed = result.changed;
    } catch (error) {
      const info = describeDbError(error);
      console.error(
        `[storefront/admin] ${parsedInput.orderNo} 标已收款失败:`,
        info.message || error
      );
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }

    // ---- 7. 补填外部实收 + 平台单号 ----
    //
    // ⚠️ **这一步自己写** —— `settleByOrderNo` 只在「状态真的变了」的时候
    // 才记 `providerOrderId` ⇒ 「已经标过已收款、现在补填淘宝金额」这条路
    // 记不上单号。
    //
    // ⚠️ **`external_paid_cents` 这一列可能还不存在**(迁移脚本没跑)⇒ 那时
    // 整页 500。所以把 42703 认出来,回一个 `MIGRATION_MISSING` 给界面。
    try {
      await setExternalPaidCents({
        orderId: order.id,
        externalPaidCents: paidCents,
        providerOrderId: externalOrderNo ?? undefined,
      });
    } catch (error) {
      const info = describeDbError(error);
      console.error(
        "[storefront/admin] 写 external_paid_cents 失败:",
        info.message || error
      );
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    revalidatePath(BUYER_ORDER_PATH, "page");
    revalidatePath(`${BUYER_ORDER_PATH}/[orderNo]`, "page");
    return { ok: true, changed };
  });

/*
 * `AdminStoreOrderRow` / `AdminStoreOrderListResult` /
 * `AdminStoreOrderWriteResult` **不在这里 re-export** —— 「use server」文件
 * 只能导出 async 函数,类型 re-export 会被 Turbopack 注册成 server action,
 * 运行时引用一个不存在的类型绑定 → ReferenceError,整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * 界面从 `@/features/storefront/admin/types` 直接 import 那些类型。
 */
