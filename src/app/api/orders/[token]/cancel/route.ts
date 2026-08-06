/**
 * 用户端 - 取消订单
 * POST /api/orders/[token]/cancel
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

async function postHandler(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;
    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      columns: { id: true, status: true },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }
    if (order.status === "CANCELLED") {
      return NextResponse.json(
        { success: false, error: "订单已取消" },
        { status: 400 }
      );
    }

    await db
      .update(promptOrder)
      .set({ status: "CANCELLED", cancelledAt: new Date() })
      .where(eq(promptOrder.id, order.id));

    return NextResponse.json({
      success: true,
      message: "订单已取消",
      data: { status: "CANCELLED" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "取消失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler);
