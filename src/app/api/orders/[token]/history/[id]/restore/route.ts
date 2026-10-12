/**
 * 用户端 - 恢复一张历史快照
 * POST /api/orders/[token]/history/[id]/restore
 *
 * 不需要请求体 —— 快照本身已包含聚焦的原图 + 已选候选。
 *
 * 允许状态：CANDIDATES_READY、FAILED（FAILED 会直接落到 CANDIDATES_READY）。
 * 拒绝：GENERATING / SELECTED / CANCELLED / PENDING（409 ORDER_STATUS_NOT_RESTORABLE）。
 *
 * 事务流程：
 * 1. 锁 order 行
 * 2. 校验 status + 取出订单 / 模板
 * 3. 校验快照属于该 order 且 JSON 结构合法
 * 4. 模板 / 上传兼容性
 * 5. **先**归档当前可用状态（trigger="restore"），防止恢复后丢失当前可用图
 * 6. 合并 candidates / selections（0..imageCount 用快照；尾部保留当前）
 * 7. 强制 selections[snapshot.imageIdx] = snapshot.candidateIdx
 * 8. 写回（status=CANDIDATES_READY、generationTask=null、errorMessage=null、selectedAt=null）
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import {
  parseCandidates,
  parseSelections,
  parseUploadedImages,
} from "@/features/gpt-image/lib/order-helpers";
import {
  archiveOrderSnapshot,
  buildRestoredState,
  findHistoryForOrder,
  isSnapshotTemplateCompatible,
  isSnapshotUploadCompatible,
  readLockedOrder,
} from "@/features/gpt-image/lib/order-history";
import type { RestoreHistoryResponseData } from "@/features/gpt-image/lib/types";
import { withApiLogging } from "@/lib/api-logger";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/** 允许 restore 的状态集合 */
const RESTORABLE_STATUSES = new Set(["CANDIDATES_READY", "FAILED"]);

async function postHandler(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> }
) {
  try {
    const { token, id } = await ctx.params;

    // 找 orderId（不锁，先验存在性）
    const orderRow = await db
      .select({ id: promptOrder.id })
      .from(promptOrder)
      .where(eq(promptOrder.token, token))
      .limit(1);
    const order = orderRow[0];
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }

    return await db.transaction(async (tx) => {
      // 锁 + 重读
      const locked = await readLockedOrder(tx, order.id);
      if (!locked) {
        return NextResponse.json(
          { success: false, error: "订单已被删除" },
          { status: 404 }
        );
      }

      // 状态校验
      if (!RESTORABLE_STATUSES.has(locked.status)) {
        return NextResponse.json(
          {
            success: false,
            error: `当前状态为 ${locked.status}，无法恢复历史版本`,
            code: "ORDER_STATUS_NOT_RESTORABLE",
          },
          { status: 409 }
        );
      }

      // 校验快照归属
      const snap = await findHistoryForOrder(id, locked.id);
      if (!snap) {
        return NextResponse.json(
          { success: false, error: "历史快照不存在或不属于该订单" },
          { status: 404 }
        );
      }

      // 模板兼容性
      if (
        !isSnapshotTemplateCompatible(snap, {
          id: locked.templateId,
          candidateCount: locked.template.candidateCount,
          size: locked.template.size,
        })
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "模板已变更，无法恢复旧版本",
            code: "TEMPLATE_MISMATCH",
          },
          { status: 409 }
        );
      }

      // 上传兼容性
      const snapUploads = parseUploadedImages(snap.uploadedImages);
      const curUploads = parseUploadedImages(locked.uploadedImages);
      if (!isSnapshotUploadCompatible(snapUploads, curUploads)) {
        return NextResponse.json(
          {
            success: false,
            error: "原图已被替换，无法恢复旧版本",
            code: "UPLOADED_IMAGES_MISMATCH",
          },
          { status: 409 }
        );
      }

      // 校验快照 JSON 结构
      const snapCandidates = parseCandidates(snap.candidates);
      const snapSelections = parseSelections(snap.selections);
      if (snapCandidates.length !== snap.imageCount) {
        return NextResponse.json(
          {
            success: false,
            error: "历史快照数据结构损坏",
            code: "SNAPSHOT_INVALID",
          },
          { status: 409 }
        );
      }
      void snapSelections;

      // 先归档当前可用状态
      const currentSnapshot = await archiveOrderSnapshot(
        locked.id,
        "restore",
        null,
        { tx }
      );

      // 合并状态
      const curCandidates = parseCandidates(locked.candidates);
      const curSelections = parseSelections(locked.selections);
      const { candidates: mergedCandidates, selections: mergedSelections } =
        buildRestoredState(snap, curCandidates, curSelections);

      const newSelectedIndex = mergedSelections[0] ?? null;
      const uploadedImageCount = mergedCandidates.length;

      await tx
        .update(promptOrder)
        .set({
          candidates: JSON.stringify(mergedCandidates),
          selections: JSON.stringify(mergedSelections),
          selectedIndex: newSelectedIndex,
          status: "CANDIDATES_READY",
          generationTask: null,
          errorMessage: null,
          selectedAt: null,
          generatedAt: snap.generatedAt ?? snap.createdAt,
          updatedAt: new Date(),
        })
        .where(eq(promptOrder.id, locked.id));

      logger.info(
        {
          orderId: locked.id,
          historyId: id,
          round: snap.round,
          archivedRound: currentSnapshot?.round,
        },
        "已恢复历史快照"
      );

      const data: RestoreHistoryResponseData = {
        status: "CANDIDATES_READY",
        restoredHistoryId: id,
        round: snap.round,
        selections: mergedSelections,
        uploadedImageCount,
        updatedAt: new Date().toISOString(),
      };

      return NextResponse.json({
        success: true,
        message: `已恢复第 ${snap.round} 轮效果图`,
        data,
      });
    });
  } catch (err) {
    logger.error({ err }, "恢复历史失败");
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "恢复失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler);
