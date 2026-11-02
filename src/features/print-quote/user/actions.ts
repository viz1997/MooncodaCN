"use server";

/**
 * 打印工单的用户侧 server action
 *
 * 目前只有一件事:**自助取消**。
 *
 * ## 只能取消「待确认」的工单
 *
 * 工作室一确认(状态变成 CONFIRMED),就意味着产能已经投进去了 —— 这时候
 * 用户一句话撤单,工作室是白干的。所以取消只对 `PENDING` 开放。
 *
 * 这条规则在**三处**同时守着:
 *   1. 按钮的显示(`isUserCancellable`,前端)
 *   2. 这个 action 的前置检查(读一次状态)
 *   3. `transitionPrintOrderStatus()` 里锁行后的强校验(真正的授权边界)
 *
 * 第 3 条才是关键 —— 前两条都可能被绕过(直接调 action、手工构造请求)。
 *
 * ## 业务失败**返回**而不是 throw
 *
 * next-safe-action 的 `handleServerError` 在生产环境会把任何异常糊成
 * 「服务器错误,请稍后重试」。用户点了取消,按钮转圈然后弹一句这个,
 * 等于没告诉他原因。所以这里返回 `{ok:false, code}`,让前端按 code 找文案。
 */

import { after } from "next/server";
import { z } from "zod";

import {
  notifyPrintOrderCancelledByUser,
  toPrintOrderMailInfo,
} from "@/features/print-quote/lib/notifications";
import {
  getUserPrintOrderByOrderNo,
  PrintOrderTransitionError,
  transitionPrintOrderStatus,
} from "@/features/print-quote/lib/order-store";
import { isUserCancellable } from "@/features/print-quote/lib/status-machine";
import { protectedAction } from "@/lib/safe-action";

/** 取消失败的机器可读原因 */
export type CancelPrintOrderErrorCode =
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_CANCELLABLE"
  | "INVALID_TRANSITION"
  | "NOTE_REQUIRED"
  | "SAME_STATUS"
  | "FAILED";

export type CancelPrintOrderResult =
  | { ok: true; orderNo: string; status: "CANCELLED" }
  | { ok: false; code: CancelPrintOrderErrorCode };

const withPrintOrderAction = (name: string) =>
  protectedAction.metadata({ action: `printOrder.${name}` });

const cancelSchema = z.object({
  orderNo: z.string().min(1).max(64),
  /** 取消原因(选填)—— 进时间线,工作室能看到 */
  note: z.string().max(500).nullish(),
});

/**
 * 用户自助取消工单
 *
 * 只有 `PENDING` 能取消。归属校验在数据层(按 userId 查),别人的单按
 * 「不存在」处理。
 */
export const cancelPrintOrderAction = withPrintOrderAction("cancel")
  .schema(cancelSchema)
  .action(async ({ parsedInput, ctx }): Promise<CancelPrintOrderResult> => {
    const note = parsedInput.note?.trim() ? parsedInput.note.trim() : null;

    // 前置检查 —— 只为给出更准确的错误码;真正的把关在下面的锁行强校验
    const current = await getUserPrintOrderByOrderNo(
      ctx.userId,
      parsedInput.orderNo
    );
    if (!current) {
      return { ok: false, code: "ORDER_NOT_FOUND" };
    }
    if (!isUserCancellable(current.status)) {
      return { ok: false, code: "ORDER_NOT_CANCELLABLE" };
    }

    try {
      const { order } = await transitionPrintOrderStatus({
        orderNo: parsedInput.orderNo,
        to: "CANCELLED",
        actor: "user",
        note,
        userId: ctx.userId,
      });

      // 通知挂到响应之后 —— 邮件失败不影响取消结果
      after(async () => {
        await notifyPrintOrderCancelledByUser({
          order: toPrintOrderMailInfo(order),
          note,
        });
      });

      return { ok: true, orderNo: order.orderNo, status: "CANCELLED" };
    } catch (error) {
      if (error instanceof PrintOrderTransitionError) {
        const code: CancelPrintOrderErrorCode =
          error.code === "ORDER_NOT_FOUND"
            ? "ORDER_NOT_FOUND"
            : error.code === "SAME_STATUS"
              ? "SAME_STATUS"
              : error.code === "NOTE_REQUIRED"
                ? "NOTE_REQUIRED"
                : "INVALID_TRANSITION";
        return { ok: false, code };
      }
      // 真的炸了(数据库挂了之类)—— 让 next-safe-action 统一处理
      throw error;
    }
  });
