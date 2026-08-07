/**
 * 用户端 - 停止生成（**不是取消订单**）
 * POST /api/orders/[token]/stop-generation
 *
 * 语义区分：
 * - **停止生成**：协作式打断当前 in-flight 的效果图生成任务，订单本身保留。
 *   已完成的候选图继续保留；完成度为 0 → FAILED，部分完成 → CANDIDATES_READY。
 * - **取消订单**（POST /api/orders/[token]/cancel）：终态动作，订单变 CANCELLED，
 *   链接失效。生成阶段不要走那条路。
 *
 * 仅当订单处于 GENERATING 时才允许停止。返回 { success: true } 后，前端轮询
 * /status 可看到状态机的最终落点（FAILED 或带"已停止本次生成"备注的 CANDIDATES_READY）。
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
    if (order.status !== "GENERATING") {
      return NextResponse.json(
        {
          success: false,
          error: `当前状态为 ${order.status}，没有正在进行的生成任务`,
        },
        { status: 400 }
      );
    }

    // 改造为 submit/poll 两段式后，服务端不再持有 in-flight 任务的内存句柄
    // （AbortController 在多实例 Serverless 下本就不可靠）。上游任务无法真正
    // 撤销，但可以立即放弃本轮：清空任务态 + 置 FAILED，前端 /poll 随即停止
    // 轮询，用户点"重新生成"即可复活。
    await db
      .update(promptOrder)
      .set({
        status: "FAILED",
        generationTask: null,
        errorMessage: "已停止本次生成，可点击重新生成",
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, order.id));

    return NextResponse.json({
      success: true,
      message: "已停止本次生成",
      data: { signalled: true },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "停止生成失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler);
