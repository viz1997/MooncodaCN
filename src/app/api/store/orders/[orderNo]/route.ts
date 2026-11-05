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

import { getUserStorefrontOrderByOrderNo } from "@/features/storefront/lib/orders";
import { withApiLogging } from "@/lib/api-logger";
import { getSessionFromRequest } from "@/lib/auth/request-session";

export const runtime = "nodejs";
/** 一次主键查询 */
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

  const order = result.order;

  return NextResponse.json({
    orderNo: order.orderNo,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalCents: order.totalCents,
    currency: order.currency,
    paymentUrl: order.paymentUrl,
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
  });
}

export const GET = withApiLogging(handle);
