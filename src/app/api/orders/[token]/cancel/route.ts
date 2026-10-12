/**
 * 用户端 - 取消订单
 * POST /api/orders/[token]/cancel
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { previewShare, promptOrder } from "@/db/schema";
import { grantCredits } from "@/features/credits/grant";
import { withApiLogging } from "@/lib/api-logger";
import { logger } from "@/lib/logger";

import { getPreviewShareByToken } from "../../_lib/preview-share-helpers";

export const runtime = "nodejs";

async function postHandler(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;

    // 2026-09-14：preview 流 cancel —— preview_share 优先。
    // preview 流取消语义：客人放弃预览，把预扣的 credits 全额释放。
    // 与 promptOrder cancel 不同（promptOrder 是终态动作，链接失效，积分
    // 早就在创建时扣完了，cancel 不退；preview 流预扣的全额在 cancel 时
    // 一次性 grantCredits refund 回去）。
    const preview = await getPreviewShareByToken(token);
    if (preview) {
      if (preview.status === "cancelled" || preview.status === "confirmed") {
        return NextResponse.json(
          {
            success: false,
            error:
              preview.status === "confirmed"
                ? "已确认的预览不可取消"
                : "预览已取消",
          },
          { status: 400 }
        );
      }
      const locked = preview.creditsLocked ?? 0;
      // 防重：仅第一次 cancel 触发退款；status='cancelled' 上面已拦
      // 拿到 preview 时 status 一定不在 cancelled / confirmed。
      const previewUserId = preview.createdBy;
      if (locked > 0 && previewUserId) {
        try {
          await grantCredits({
            userId: previewUserId,
            amount: locked,
            sourceType: "refund",
            transactionType: "refund",
            debitAccount: "SYSTEM:preview_release",
            description: `预览取消，释放锁定积分（凭证 ${preview.orderNo}）`,
            metadata: {
              trigger: "preview_release",
              previewShareId: preview.id,
              previewOrderNo: preview.orderNo,
            },
          });
        } catch (err) {
          logger.error(
            { err, previewShareId: preview.id, locked },
            "preview cancel: 释放积分失败"
          );
          // 释放失败：不让 cancel 翻车，记错误留给后续 reconcile
        }
      }
      await db
        .update(previewShare)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          creditsLocked: 0,
          updatedAt: new Date(),
        })
        .where(eq(previewShare.id, preview.id));
      return NextResponse.json({
        success: true,
        message: "预览已取消",
        data: { status: "cancelled", releasedCredits: locked },
      });
    }

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
