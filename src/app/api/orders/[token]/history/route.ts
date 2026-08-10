/**
 * 用户端 - 读取效果图历史快照列表
 * GET /api/orders/[token]/history
 *
 * 返回每轮快照的展示元数据 + 缩略图 URL（不含原始 candidates / uploadedImages）。
 * 每条都附带 restorable 字段，由服务端按当前订单 / 模板做兼容性检查。
 *
 * 状态允许：任何非 CANCELLED / SELECTED；PENDING 也返回空数组（无图可归档）。
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder, promptTemplate } from "@/db/schema";
import {
  parseSelections,
  parseUploadedImages,
} from "@/features/gpt-image/lib/order-helpers";
import {
  isSnapshotTemplateCompatible,
  isSnapshotUploadCompatible,
  listHistoryByOrder,
} from "@/features/gpt-image/lib/order-history";
import type { OrderHistorySnapshotView } from "@/features/gpt-image/lib/types";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

async function getHandler(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;

    const order = await db
      .select({
        id: promptOrder.id,
        uploadedImages: promptOrder.uploadedImages,
        selections: promptOrder.selections,
        templateId: promptOrder.templateId,
        candidateCount: promptTemplate.candidateCount,
        size: promptTemplate.size,
      })
      .from(promptOrder)
      .innerJoin(promptTemplate, eq(promptOrder.templateId, promptTemplate.id))
      .where(eq(promptOrder.token, token))
      .limit(1);
    const row = order[0];
    if (!row) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }

    const snaps = await listHistoryByOrder(row.id);
    const currentUploaded = parseUploadedImages(row.uploadedImages);

    const view: OrderHistorySnapshotView[] = snaps.map((s) => {
      const snapUploaded = parseUploadedImages(s.uploadedImages);
      const snapSelections = parseSelections(s.selections);
      const selectionCount = snapSelections
        ? snapSelections.filter((v) => v !== null).length
        : 0;

      const templateOk = isSnapshotTemplateCompatible(s, {
        id: row.templateId,
        candidateCount: row.candidateCount,
        size: row.size,
      });
      const uploadOk = isSnapshotUploadCompatible(
        snapUploaded,
        currentUploaded
      );
      const restorable = templateOk && uploadOk;

      let reason: string | null = null;
      if (!templateOk) {
        reason = "模板已变更，旧图无法使用";
      } else if (!uploadOk) {
        reason = "原图已被替换";
      }

      // 历史缩略图走候选图路由 + historyId 通道。
      // 原图索引越界（snapshot.imageIdx 超过 history.imageCount - 1）则用 0。
      const thumbIdx =
        typeof s.imageIdx === "number" &&
        s.imageIdx >= 0 &&
        s.imageIdx < s.imageCount
          ? s.imageIdx
          : 0;

      return {
        id: s.id,
        round: s.round,
        trigger: s.trigger,
        imageIdx: s.imageIdx,
        candidateIdx: s.candidateIdx,
        imageCount: s.imageCount,
        candidateCount: s.candidateCount,
        size: s.size,
        selectionCount,
        createdAt: s.createdAt.toISOString(),
        thumbnailUrl: `/api/orders/${token}/candidates/${thumbIdx}/0?historyId=${s.id}&t=${encodeURIComponent(s.createdAt.toISOString())}`,
        restorable,
        incompatibilityReason: reason,
      };
    });

    return NextResponse.json({
      success: true,
      data: view,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "读取历史失败",
      },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler);
