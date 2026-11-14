/**
 * GET /api/store/orders/[orderNo] —— 查一笔商城订单的状态
 *
 * 给支付成功页轮询用:用户从 Stripe 跳回来时,webhook 可能还没到(Stripe
 * 那边确认 → Sellbase 发事件 → 本仓库收 webhook,有几秒延迟)。页面轮询
 * 这个接口,状态从 `unpaid` 变成 `paid` 就显示成功。
 *
 * ## 归属校验在数据层
 *
 * 别人的订单号查出来就是 404 —— 不是 403。403 等于告诉别人「这个订单号
 * 存在」,而订单号是可以被枚举的。
 */

import { NextResponse } from "next/server";

import { claimReconcileSlot } from "@/features/payments/lib/reconcile-throttle";
import {
  listShipmentsForOrder,
  toShipmentView,
} from "@/features/shipment/lib/shipment-store";
import { getUserStorefrontOrderByOrderNo } from "@/features/storefront/lib/orders";
import { reconcileStorefrontOrderPayment } from "@/features/storefront/lib/payment-reconcile";
import { withApiLogging } from "@/lib/api-logger";
import { getSessionFromRequest } from "@/lib/auth/request-session";

export const runtime = "nodejs";
/** 两次读(订单 + 物流) */
export const maxDuration = 15;

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

  let order = result.order;

  /**
   * 主动查单的结论(2026-11-14)
   *
   * null = 这一轮**没查**(节流挡掉了 / 不是支付宝那一支 / 已经终态)。
   *
   * `reportedPaid` = 「支付宝那边**说**这笔已经付款成功,但我们核对不上」
   * (公钥不对 / 金额对不上)⇒ 界面**必须**撤掉「重新支付」按钮。
   */
  let reconcile: {
    paid: boolean;
    reportedPaid: boolean;
    settled: boolean;
    code: string;
    message: string;
  } | null = null;

  // ---- 主动查单兜底(2026-11-14)----
  //
  // 异步通知丢了的话,订单会永远停在 `unpaid` —— 用户盯着「正在确认支付…」
  // 转圈到超时(线上真踩过:`SO-20261114-657E4A`)。
  //
  // 轮询这条路**顺手查一次**:节流后同一个订单 20 秒内最多打一次支付宝,
  // 不会把接口打爆。查完再重读一次,响应里给的是**新**的状态。
  if (
    order.paymentStatus === "unpaid" &&
    order.paymentChannel === "alipay" &&
    claimReconcileSlot(order.orderNo, Date.now())
  ) {
    try {
      const outcome = await reconcileStorefrontOrderPayment({
        order,
        items: result.items,
      });
      reconcile = {
        paid: outcome.paid,
        reportedPaid: outcome.reportedPaid,
        settled: outcome.settled,
        code: outcome.code,
        message: outcome.message,
      };
      // 重读 —— 落库之后状态变了,响应里要给**新**的那个
      const fresh = await getUserStorefrontOrderByOrderNo(user.id, orderNo);
      if (fresh) order = fresh.order;
    } catch (error) {
      // 查单挂了**不影响**这个接口 —— 它只是「兜底」,主路还是读库
      console.error(
        `[storefront] ${order.orderNo} 主动查单失败(不影响订单状态查询)`,
        error
      );
    }
  }

  // 物流(2026-11-13)—— 一个订单可能有多个包裹(补发 / 分开发)
  const shipments = await listShipmentsForOrder("storefront", order.id);

  return NextResponse.json({
    orderNo: order.orderNo,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalCents: order.totalCents,
    currency: order.currency,
    /**
     * 付款跳转地址
     *
     * ⚠️ **「支付宝说付了、我们核不上」的时候这一项一律给 null**(2026-11-14)
     * —— `order.paymentUrl` 里存的是**建单时**那条链接,它的 `out_trade_no`
     * 已经付过了。买家点它 ⇒ 支付宝回「该订单已付款(TRADE_HAS_SUCCESS)」⇒
     * **死循环**(线上真踩过:`SO-20261114-137332`)。
     *
     * ⇒ 宁可**不给**链接(界面换成「请不要重复付款」那句话),也不给一条
     * 一定会把买家带回原点的路。
     */
    paymentUrl: reconcile?.reportedPaid ? null : order.paymentUrl,
    /**
     * 微信扫码的二维码内容(2026-11-05)
     *
     * 微信 Native 是扫码不是跳转 —— 前端拿这个渲染二维码。其他通道是 null。
     */
    paymentQrCodeUrl: order.paymentQrCodeUrl,
    /** 走的是哪条通道 —— null = 还没开始收款 */
    paymentChannel: order.paymentChannel,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    /**
     * 物流(2026-11-13)
     *
     * **响应形状只涨不破** —— 现有那几处消费者忽略这个字段,不受影响。
     */
    shipments: shipments.map(toShipmentView),
    /**
     * 主动查单的结论(2026-11-14)
     *
     * null = 这一轮没查(节流挡掉了 / 不是支付宝 / 已经终态)。
     *
     * `reportedPaid` = 「支付宝那边**说**这笔已经付款成功,但我们核对不上」
     * ⇒ 界面**必须**撤掉「重新支付」按钮,换成一句「请不要重复付款」。
     *
     * **响应形状只涨不破** —— 现有那几处消费者忽略这个字段,不受影响。
     */
    reconcile,
  });
}

export const GET = withApiLogging(handle);
