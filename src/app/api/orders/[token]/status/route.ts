/**
 * 用户端 - 订单状态轮询
 * GET /api/orders/[token]/status
 */

import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  countCandidateGroups,
  countUploadedImages,
  parseCandidates,
  parseSelections,
  parseUploadedImages,
} from "@/features/gpt-image/lib/order-helpers";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

async function getHandler(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;
    const order = await db.query.promptOrder.findFirst({
      where: (o, { eq }) => eq(o.token, token),
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
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "查询失败",
      },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler);
