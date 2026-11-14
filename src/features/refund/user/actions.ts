"use server";

/**
 * 买家侧的退款申请 —— **一个 server action,两个单子共用**
 *
 * 商城订单(`/account/orders/[orderNo]`)和打印工单(`/account/print-orders/[orderNo]`)
 * 走的是**同一份实现** ⇒ 两处不可能漂。
 *
 * ## 为什么不用 API route
 *
 * 商城的 `/api/store/**` 那一套主要是给**小程序**用的(小程序调不了 server
 * action)。工作室明确说了「不要管小程序」,所以退款是**纯网页功能** ⇒
 * 一个 server action 就够了,不用开 API、不用改小程序 SDK。
 *
 * ## 「能不能退」由**纯函数**判定
 *
 * `evaluateRefundEligibility()` 是界面和服务端**共用**的一份判定。
 *
 * ⚠️ **服务端这一层才是真正的授权边界** —— 界面上把按钮藏起来只是 UI 便利,
 * 用户照样能直接调这个 action。所以判定在服务端跑一遍,界面再跑一遍(同一个
 * 函数),两边不可能给出相反的结论。
 *
 * ## 金额由服务端取
 *
 * 申请金额 = **整单总额**(整单退)。**客户端不传金额** —— 传了就多一个能
 * 传错的地方(买家把金额改成 1 分,工作室按 1 分退,亏的是工作室)。
 *
 * ## 业务失败**返回**而不是 throw
 *
 * next-safe-action 的 `handleServerError` 在生产环境会把任何异常糊成
 * 「服务器错误,请稍后重试」。用户点了「申请退款」,按钮转圈然后弹一句这个,
 * 等于没告诉他原因。所以这里返回 `{ok:false, code}`,前端按 code 找文案。
 */

import { after } from "next/server";
import { z } from "zod";

import { evaluateRefundEligibility } from "@/features/refund/lib/eligibility";
import { notifyRefundRequestCreated } from "@/features/refund/lib/notifications";
import {
  createRefundRequest,
  getRefundOrderSnapshot,
  hasActiveRefundRequest,
  toRefundView,
} from "@/features/refund/lib/refund-store";
import { protectedAction } from "@/lib/safe-action";

import type { RequestRefundResult } from "./types";

const requestRefundSchema = z.object({
  /** 挂在哪种订单上 —— 两张订单表的 id 不通用 */
  orderKind: z.enum(["storefront", "print"]),
  orderNo: z.string().min(1).max(64),
  /** 买家填的原因 —— 工作室靠它判断要不要退 */
  reason: z.string().min(1).max(500),
});

/**
 * 买家提交退款申请
 *
 * 归属校验在**数据层** —— 查订单时 WHERE 带上 `user_id`,别人的单查出来是
 * null ⇒ 返 `NOT_FOUND`(不是 403 —— 订单号可以枚举)。
 */
export const requestRefundAction = protectedAction
  .metadata({ action: "refund.request" })
  .schema(requestRefundSchema)
  .action(async ({ parsedInput, ctx }): Promise<RequestRefundResult> => {
    const reason = parsedInput.reason.trim();
    if (reason.length === 0) {
      return { ok: false, code: "INVALID_INPUT" };
    }

    // 1. 查订单(带归属校验)
    const snapshot = await getRefundOrderSnapshot({
      orderKind: parsedInput.orderKind,
      orderNo: parsedInput.orderNo,
      userId: ctx.userId,
    });
    if (!snapshot) {
      return { ok: false, code: "NOT_FOUND" };
    }

    // 2. 有没有进行中的申请(`pending` 或 `approved`)
    //
    // ⚠️ `approved` 也算「进行中」—— 钱还在路上,那时候再申请一条就**退两次钱**。
    const hasActiveRequest = await hasActiveRefundRequest(
      snapshot.orderKind,
      snapshot.id
    );

    // 3. 跑那一份纯判定
    const eligibility = evaluateRefundEligibility({
      orderKind: snapshot.orderKind,
      paymentStatus: snapshot.paymentStatus,
      status: snapshot.status,
      hasShipment: snapshot.hasShipment,
      hasActiveRequest,
    });
    if (!eligibility.eligible) {
      return { ok: false, code: eligibility.code };
    }

    // 4. 落一条申请单 —— 金额是**整单总额**,由服务端从订单上取
    const created = await createRefundRequest({
      orderKind: snapshot.orderKind,
      orderId: snapshot.id,
      orderNo: snapshot.orderNo,
      userId: ctx.userId,
      amountCents: snapshot.totalCents,
      reason,
      paymentChannel: snapshot.paymentChannel,
    });
    if (!created.ok) {
      return { ok: false, code: created.code };
    }

    // 5. 通知工作室 —— 挂到响应之后,邮件失败不影响申请结果
    after(async () => {
      await notifyRefundRequestCreated({
        orderKind: snapshot.orderKind,
        orderNo: snapshot.orderNo,
        amountCents: snapshot.totalCents,
        reason,
        paymentChannel: snapshot.paymentChannel,
        buyerEmail: snapshot.buyerEmail,
        buyerName: snapshot.buyerName,
      });
    });

    return { ok: true, refund: toRefundView(created.refund) };
  });
