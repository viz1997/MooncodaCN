/**
 * 用户端 - 提交选择
 * POST /api/orders/[token]/select
 * body: { selections: number[] }
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { parseUploadedImages } from "@/features/gpt-image/lib/order-helpers";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

async function postHandler(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      selections?: unknown;
    };
    const { selections } = body;

    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      with: { template: true },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }
    if (order.status !== "CANDIDATES_READY") {
      return NextResponse.json(
        {
          success: false,
          error: `当前状态为 ${order.status}，无法选择。${
            order.status === "SELECTED" ? "已提交不可修改，只能取消。" : ""
          }`,
        },
        { status: 400 }
      );
    }

    if (!Array.isArray(selections) || selections.length === 0) {
      return NextResponse.json(
        { success: false, error: "请提交有效选择数组" },
        { status: 400 }
      );
    }

    const uploadedImageCount = parseUploadedImages(
      order.uploadedImages as string | null
    ).length;

    if (selections.length !== uploadedImageCount) {
      return NextResponse.json(
        {
          success: false,
          error: `请为每张原图各选一张（需要 ${uploadedImageCount} 个选择，实际 ${selections.length} 个）`,
        },
        { status: 400 }
      );
    }

    for (let i = 0; i < selections.length; i++) {
      const v = selections[i];
      if (
        typeof v !== "number" ||
        v < 0 ||
        v >= order.template.candidateCount
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `第 ${i + 1} 张原图的选择无效（应在 0-${order.template.candidateCount - 1} 之间）`,
          },
          { status: 400 }
        );
      }
    }

    await db
      .update(promptOrder)
      .set({
        status: "SELECTED",
        selections: JSON.stringify(selections),
        selectedIndex: (selections as number[])[0] ?? null,
        selectedAt: new Date(),
      })
      .where(eq(promptOrder.id, order.id));

    return NextResponse.json({
      success: true,
      message: "已提交，结果不可修改，如需更改请取消订单",
      data: { status: "SELECTED", selections },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "提交失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler);
