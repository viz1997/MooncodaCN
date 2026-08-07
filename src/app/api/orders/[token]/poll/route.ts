/**
 * 用户端 - 推进生成并返回订单状态
 * POST /api/orders/[token]/poll
 *
 * 为什么需要这个接口：Serverless（Vercel）在 HTTP 响应后冻结 runtime，
 * 服务端跑不了 90s 长轮询。所以服务端只在 upload/regenerate 时做 submit
 * 拿 task_id，真正的轮询由前端调本接口驱动 —— 每次调用查一次上游，
 * 有结果就落库，没结果就保持 GENERATING 等下一轮。
 *
 * 推进逻辑本身在 advanceOrderGeneration()，与 cron 兜底
 * （/api/jobs/orders/advance）共用同一份实现。
 *
 * 返回体与 GET /status 完全同构，前端可直接复用变化检测逻辑。
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { advanceOrderGeneration } from "@/features/gpt-image/lib/advance-generation";
import {
  countCandidateGroups,
  countUploadedImages,
  parseCandidates,
  parseSelections,
  parseUploadedImages,
} from "@/features/gpt-image/lib/order-helpers";
import { withApiLogging } from "@/lib/api-logger";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
// 只做少量上游 GET 查询，不做长轮询
export const maxDuration = 30;

async function postHandler(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;

  try {
    const found = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      columns: { id: true },
    });
    if (!found) {
      return NextResponse.json(
        { success: false, error: "订单不存在" },
        { status: 404 }
      );
    }

    // 推进在途任务（幂等：无任务时直接返回）
    await advanceOrderGeneration(found.id);

    // 读取推进后的最新状态，返回与 /status 同构的结构
    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.id, found.id),
      columns: {
        status: true,
        errorMessage: true,
        uploadedAt: true,
        generatedAt: true,
        selectedAt: true,
        cancelledAt: true,
        candidates: true,
        selections: true,
        uploadedImages: true,
        updatedAt: true,
      },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在" },
        { status: 404 }
      );
    }

    const candidates = parseCandidates(order.candidates as string | null);
    const uploaded = parseUploadedImages(order.uploadedImages as string | null);
    const selections = parseSelections(order.selections as string | null);

    return NextResponse.json({
      success: true,
      data: {
        status: order.status,
        errorMessage: order.errorMessage,
        uploadedAt: order.uploadedAt?.toISOString() ?? null,
        generatedAt: order.generatedAt?.toISOString() ?? null,
        selectedAt: order.selectedAt?.toISOString() ?? null,
        cancelledAt: order.cancelledAt?.toISOString() ?? null,
        candidateGroups: countCandidateGroups(candidates),
        uploadedImageCount: countUploadedImages(uploaded),
        selections,
        updatedAt: order.updatedAt.toISOString(),
        hasUploadedImage: uploaded.length > 0,
      },
    });
  } catch (err) {
    logger.error({ err, token }, "推进生成失败");
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "推进失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler);
