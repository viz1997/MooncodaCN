/**
 * 用户端 - 通过 token 查询订单详情（不返回 prompt 字段）
 * GET /api/orders/[token]
 */

import { and, count, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { promptOrderHistory } from "@/db/schema";
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

    // 实际已用重新生成次数 = trigger='regenerate_single' 的快照行数
    // （批量重跑 trigger='regenerate_all' / FAILED 重试同样走 regenerate_all，不计）
    const usedRows = await db
      .select({ used: count() })
      .from(promptOrderHistory)
      .where(
        and(
          eq(promptOrderHistory.orderId, order.id),
          eq(promptOrderHistory.trigger, "regenerate_single")
        )
      );
    const regenerateUsedCount = usedRows[0]?.used ?? 0;

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
        regenerateLimit: order.regenerateLimit,
        regenerateUsedCount,
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
