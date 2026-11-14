/**
 * POST /api/store/orders/[orderNo]/confirm-payment —— 主动查一次支付宝
 *
 * ## 为什么要有这个接口
 *
 * 收钱以**支付宝主动推过来的异步通知**为准。但通知会丢:
 *
 * - `notify_url` 配错 / 指向本地地址 / 域名换过 → 支付宝推不到
 * - 通知验签失败(支付宝公钥贴错 / 不是同一个沙箱应用)→ 回 401,支付宝
 *   重投 8 次之后放弃
 * - `app_id` 对不上 → 代码回 `success`(认不出来的单号不算错误)⇒ 支付宝
 *   **不再重投**
 *
 * ⇒ 结果都是**钱到了、订单永远是 `unpaid`**。用户盯着「正在确认支付…」转圈
 * 到超时,工作室那边看到的是一张没付的单(线上真踩过:`SO-20261114-657E4A`)。
 *
 * ⇒ 用户从支付宝回跳到成功页时,**主动问一次支付宝**「这单到底付了没」。
 * 查单请求用应用私钥签(支付宝认),响应用支付宝公钥验(这才可信)——
 * 跟浏览器带回来的参数不能信是同一个道理。
 *
 * ## 查不到 / 没付 / 验签不过 —— 都不改订单状态
 *
 * 只有「验签过了 + 交易状态是付款成功 + 金额对得上」三条**同时**成立才落库。
 * 少一条都不动 —— 落错了就是「没收到钱却标成已付」,那是资损。
 *
 * ## 归属校验在数据层
 *
 * 别人的订单号查出来就是 404 —— 不是 403(订单号可以枚举)。
 */

import { NextResponse } from "next/server";
import { getUserStorefrontOrderByOrderNo } from "@/features/storefront/lib/orders";
import { reconcileStorefrontOrderPayment } from "@/features/storefront/lib/payment-reconcile";
import { withApiLogging } from "@/lib/api-logger";
import { getSessionFromRequest } from "@/lib/auth/request-session";

export const runtime = "nodejs";
/** 一次查单(网络往返)+ 一次读库 + 一次落库 */
export const maxDuration = 30;

async function handle(
  request: Request,
  context: { params: Promise<{ orderNo: string }> }
) {
  const { orderNo } = await context.params;

  const session = await getSessionFromRequest(request);
  const user = session?.user;
  if (!user?.id) {
    return NextResponse.json(
      { error: "AUTH_REQUIRED", message: "请先登录" },
      { status: 401 }
    );
  }

  const result = await getUserStorefrontOrderByOrderNo(user.id, orderNo);
  if (!result) {
    return NextResponse.json(
      { error: "ORDER_NOT_FOUND", message: "订单不存在" },
      { status: 404 }
    );
  }

  const outcome = await reconcileStorefrontOrderPayment({
    order: result.order,
    items: result.items,
  });

  // 查完之后**重读一次** —— 落库之后状态变了,响应里要��新的那个
  const fresh = await getUserStorefrontOrderByOrderNo(user.id, orderNo);
  const order = fresh?.order ?? result.order;

  return NextResponse.json({
    orderNo: order.orderNo,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    /** 这一次查单的结论 —— 给界面 / 日志看 */
    reconcile: {
      paid: outcome.paid,
      /**
       * 「支付宝那边**说**这笔已经付款成功」
       *
       * 跟 `paid` **正交**(2026-11-14)—— 为真但 `paid` 为假 = 「支付宝说付了,
       * 我们核对不上」(公钥不对 / 金额对不上)⇒ **买家不许再付一次**。
       *
       * 界面的任务是:**看到这个信号就把「重新支付」按钮撤掉**,换成一句
       * 「支付宝那边显示已经付款成功,我们还在核对 —— 请不要重复付款」。
       */
      reportedPaid: outcome.reportedPaid,
      settled: outcome.settled,
      code: outcome.code,
      message: outcome.message,
    },
  });
}

export const POST = withApiLogging(handle);
