/**
 * 用户端 - 通过 token 查询订单详情（不返回 prompt 字段）
 * GET /api/orders/[token]
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
      with: {
        template: {
          columns: {
            id: true,
            name: true,
            description: true,
            size: true,
            candidateCount: true,
            coverUrl: true,
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }

    const candidates = parseCandidates(order.candidates as string | null);
    const uploaded = parseUploadedImages(order.uploadedImages as string | null);
    const selections = parseSelections(order.selections as string | null);

    return NextResponse.json({
      success: true,
      data: {
        id: order.id,
        orderNo: order.orderNo,
        recipientName: order.recipientName,
        status: order.status,
        hasUploadedImage: uploaded.length > 0,
        uploadedImageCount: countUploadedImages(uploaded),
        uploadCount: order.uploadCount,
        candidateCount: order.template.candidateCount,
        candidateGroups: countCandidateGroups(candidates),
        selections,
        selectedIndex: order.selectedIndex,
        errorMessage: order.errorMessage,
        uploadedAt: order.uploadedAt?.toISOString() ?? null,
        generatedAt: order.generatedAt?.toISOString() ?? null,
        selectedAt: order.selectedAt?.toISOString() ?? null,
        cancelledAt: order.cancelledAt?.toISOString() ?? null,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        template: {
          id: order.template.id,
          name: order.template.name,
          description: order.template.description,
          size: order.template.size,
          candidateCount: order.template.candidateCount,
          coverUrl: order.template.coverUrl,
        },
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
