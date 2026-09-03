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

    // 每批已用重新生成次数：按 imageIdx=batchIdx 分组统计。
    // imageIdx 字段在 2026-09-02 后已对齐到 batchIdx 语义；同一行同时
    // 满足 trigger='regenerate_single' 才是单批重生成（批量重跑 / FAILED
    // 重试用 trigger='regenerate_all' / 'failed_reupload'，不计）。
    // 长度对齐 batchCount，未上传的批补 0。
    const uploadedImageCount = countUploadedImages(uploaded);
    const imagesPerUploadVal = Math.max(1, order.imagesPerUpload);
    const batchCount =
      imagesPerUploadVal > 1
        ? Math.ceil(uploadedImageCount / imagesPerUploadVal)
        : uploadedImageCount;
    const usedByBatchRows = await db
      .select({
        batchIdx: promptOrderHistory.imageIdx,
        used: count(),
      })
      .from(promptOrderHistory)
      .where(
        and(
          eq(promptOrderHistory.orderId, order.id),
          eq(promptOrderHistory.trigger, "regenerate_single")
        )
      )
      .groupBy(promptOrderHistory.imageIdx);
    const regenerateUsedByBatch: number[] = Array.from(
      { length: batchCount },
      () => 0
    );
    for (const row of usedByBatchRows) {
      const idx = row.batchIdx;
      if (
        typeof idx === "number" &&
        idx >= 0 &&
        idx < regenerateUsedByBatch.length
      ) {
        regenerateUsedByBatch[idx] = Number(row.used);
      }
    }

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
        imagesPerUpload: order.imagesPerUpload,
        candidateCount: order.template.candidateCount,
        candidateGroups: countCandidateGroups(candidates),
        regenerateLimit: order.regenerateLimit,
        regenerateUsedByBatch,
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
