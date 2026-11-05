/**
 * POST /api/print-orders/[orderNo]/payment-link —— 重新获取支付链接
 *
 * 下单那一刻就会生成一个 Stripe 支付链接(见 `/api/print-orders` 的 POST),
 * 但那次调用可能失败:
 *
 *   - Sellbase 没配 / 目录没同步 → 压根没有链接
 *   - Stripe 没连上 → 订单建了,链接没生成(订单本身是好的)
 *   - 链接过期(Stripe 的支付链接 23 小时有效)→ 用户点开是坏的
 *
 * 这三个场景在这个接口里收敛成同一个动作:**再要一个链接**。
 *
 * ## 谁可以调
 *
 * 登录 + 本人。跟详情接口一个口径:别人的单按「不存在」处理(404),
 * 不是 403 —— 403 等于告诉别人这个订单号存在。
 *
 * ## 已付的不给链接
 *
 * 付完了还让人付一次是事故。已经付过的单返回 409。
 *
 * ## 限流桶:printOrder(120/min)
 *
 * 这个接口会打 Sellbase(建单 / 重发链接),比纯本地查询贵。但它是用户
 * 主动点的,频率极低 —— 沿用 `printOrder` 桶够用,不单开一个。
 */

import { type NextRequest, NextResponse } from "next/server";

import { getPrintOrderUser } from "@/features/print-quote/lib/auth";
import { getUserPrintOrderByOrderNo } from "@/features/print-quote/lib/order-store";
import { ensurePrintOrderPaymentLink } from "@/features/print-quote/lib/payment";
import { withApiLogging } from "@/lib/api-logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 一次本地读 + 一次 Sellbase 往返(建单 / 重发链接),30s 够 */
export const maxDuration = 30;

async function handle(
  request: NextRequest,
  ctx: { params: Promise<{ orderNo: string }> }
) {
  const ip = getClientIp(request);

  const rl = await checkRateLimit(ip, "printOrder");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  const user = await getPrintOrderUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "请先登录" },
      { status: 401, headers: getRateLimitHeaders(rl) }
    );
  }

  // Next 16:params 是 Promise,漏了 await 会拿到 "[object Promise]"
  const { orderNo } = await ctx.params;

  const row = await getUserPrintOrderByOrderNo(user.id, orderNo);
  if (!row) {
    return NextResponse.json(
      { success: false, error: "工单不存在" },
      { status: 404, headers: getRateLimitHeaders(rl) }
    );
  }

  // 已经付过了 —— 再给链接就是在引导重复付款
  if (row.paymentStatus === "paid") {
    return NextResponse.json(
      {
        success: false,
        error: "ALREADY_PAID",
        message: "这单已经付过了",
      },
      { status: 409, headers: getRateLimitHeaders(rl) }
    );
  }

  const result = await ensurePrintOrderPaymentLink(row);

  if (!result.ok) {
    // 已经付过了 —— 409(上面那个 early return 之外还可能从别处进来)
    if (result.code === "ALREADY_PAID") {
      return NextResponse.json(
        {
          success: false,
          error: "ALREADY_PAID",
          message: "这单已经付过了",
        },
        { status: 409, headers: getRateLimitHeaders(rl) }
      );
    }
    // SELLBASE_NOT_CONFIGURED / LINK_FAILED —— 都不该让用户看到 500
    //
    // 话术分两种:「没配好」的时候重试**没用**(每次都是同一个结果),得让用户
    // 去找工作室;「这次挂了」重试才有意义。口径跟商城那边一样
    // (见 `storefront/lib/payment-issue.ts`)。
    return NextResponse.json(
      {
        success: false,
        error: result.code,
        message:
          result.code === "SELLBASE_NOT_CONFIGURED"
            ? "收款通道没配置好,请联系工作室线下支付"
            : "支付链接生成失败,请稍后重试或联系工作室线下支付",
      },
      { status: 503, headers: getRateLimitHeaders(rl) }
    );
  }

  return NextResponse.json(
    {
      success: true,
      orderNo: row.orderNo,
      paymentUrl: result.paymentUrl,
    },
    { headers: getRateLimitHeaders(rl) }
  );
}

export const POST = withApiLogging(handle);
