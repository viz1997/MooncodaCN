/**
 * 用户端 - 重新生成指定原图（或全部）效果图
 * POST /api/orders/[token]/regenerate
 *
 * body: { imageIdx?: number }
 *   - 不传 / 传 null：批量重跑所有已上传图（用于 FAILED 状态整体重试）
 *   - 传 imageIdx：仅重跑这一张（用于 CANDIDATES_READY 单图重新生成）
 *
 * 允许的状态：
 *   - CANDIDATES_READY：单图或批量重跑
 *   - FAILED：仅允许批量重跑（保证"链接不失效"，失败后可一键重试）
 *
 * 锁定限制（2026-08 保留 partial select 不可逆语义）：`selections[i] !== null`
 * 表示该张已提交，用户端不可重新生成。批次模型下用户每完成一次
 * upload → generate → select → submit 后，那张图即被服务端"锁定"——要
 * 重新生成必须服务端把该位置 selections[i] 置 null（解锁后用户才能在
 * UI 上重新触发）。
 * - 单图路径：若目标位已锁 → 409
 * - 批量路径：只要有一位已锁 → 409（不能批量重跑覆盖已提交）
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { submitGeneration } from "@/features/gpt-image/lib/generation-service";
import {
  parseCandidates,
  parseSelections,
} from "@/features/gpt-image/lib/order-helpers";
import { archiveOrderSnapshot } from "@/features/gpt-image/lib/order-history";
import { inngest } from "@/inngest";
import { withApiLogging } from "@/lib/api-logger";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
// 90s：主路径是 Inngest 异步（路由 30s 内返回 202），但 Inngest send
// 可能失败 → 降级到同步 submitGeneration（245s 墙钟）。90s 预算
// 不够 245s 同步路径，下面 triggerSubmit 失败时仍会撞 Vercel
// 硬超时；用户应配置 Inngest 让降级不触发，或把 maxDuration 拉到
// 300s（与 /upload 对齐）。这里先 90s，与旧版本一致，配置 Inngest
// 后自动走异步路径不再撞线。
export const maxDuration = 90;

/**
 * 触发 submitGeneration：优先 Inngest 异步，失败降级同步。
 * 详见 /upload 路由同名函数注释。
 */
async function triggerSubmit(
  orderId: string,
  fromIdx: number,
  toIdx: number,
  candidateCount: number
): Promise<{ mode: "ingest" | "sync" }> {
  try {
    await inngest.send({
      name: "gpt-image/submit-generation",
      data: { orderId, fromIdx, total: toIdx, candidateCount },
    });
    return { mode: "ingest" };
  } catch (err) {
    logger.warn(
      { err, orderId, fromIdx, toIdx },
      "Inngest send 失败，降级到同步 submitGeneration"
    );
    await submitGeneration(orderId, fromIdx, toIdx, candidateCount);
    return { mode: "sync" };
  }
}

async function postHandler(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { imageIdx?: unknown };
    const imageIdx = body.imageIdx;

    if (
      imageIdx !== undefined &&
      imageIdx !== null &&
      (typeof imageIdx !== "number" ||
        !Number.isInteger(imageIdx) ||
        imageIdx < 0)
    ) {
      return NextResponse.json(
        { success: false, error: "imageIdx 必须是非负整数" },
        { status: 400 }
      );
    }

    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      with: { template: { columns: { candidateCount: true } } },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }

    // 状态校验
    const isSingle = typeof imageIdx === "number";
    if (isSingle && order.status !== "CANDIDATES_READY") {
      return NextResponse.json(
        {
          success: false,
          error: `当前状态为 ${order.status}，单图重生成仅在 CANDIDATES_READY 时可用`,
        },
        { status: 400 }
      );
    }
    if (
      !isSingle &&
      order.status !== "CANDIDATES_READY" &&
      order.status !== "FAILED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `当前状态为 ${order.status}，无法重新生成。请等待当前生成完成后再试。`,
        },
        { status: 400 }
      );
    }

    // 锁定短路：已提交锁定的位不可重新生成（partial select 不可逆）。
    // 单图：imageIdx 位已锁 → 409
    // 批量：任意一位已锁 → 409（不允许批量覆盖已提交）
    const prevSelections = parseSelections(order.selections);
    const lockedIndices: number[] = [];
    if (prevSelections) {
      for (let i = 0; i < prevSelections.length; i++) {
        if (prevSelections[i] !== null) lockedIndices.push(i);
      }
    }
    if (lockedIndices.length > 0) {
      if (isSingle && lockedIndices.includes(imageIdx as number)) {
        return NextResponse.json(
          {
            success: false,
            error: `第 ${(imageIdx as number) + 1} 张已提交锁定，不可重新生成。如需更换效果请取消订单后联系服务方重新创建。`,
          },
          { status: 409 }
        );
      }
      if (!isSingle) {
        return NextResponse.json(
          {
            success: false,
            error: `订单已有 ${lockedIndices.length} 张已锁定，无法批量重跑。请先取消订单后联系服务方重新创建。`,
          },
          { status: 409 }
        );
      }
    }

    const uploadedCount = parseUploadedLength(order.uploadedImages);
    if (uploadedCount === 0) {
      return NextResponse.json(
        { success: false, error: "尚未上传任何图片" },
        { status: 400 }
      );
    }

    // 确定本次要重跑的索引范围
    let fromIdx: number;
    let toIdx: number;
    if (isSingle) {
      if (imageIdx >= uploadedCount) {
        return NextResponse.json(
          {
            success: false,
            error: `imageIdx ${imageIdx} 超出已上传数量 ${uploadedCount}`,
          },
          { status: 400 }
        );
      }
      fromIdx = imageIdx;
      toIdx = imageIdx + 1;
    } else {
      // 批量：重跑全部
      fromIdx = 0;
      toIdx = uploadedCount;
    }

    // 清空受影响槽位的 candidates + selections，状态置 GENERATING
    const nested = parseCandidates(order.candidates);
    for (let i = 0; i < uploadedCount; i++) {
      if (!Array.isArray(nested[i])) nested[i] = [];
    }
    for (let i = fromIdx; i < toIdx; i++) {
      nested[i] = [];
    }
    // prevSelections 来自上方锁定短路检测；此处目标区间 [fromIdx, toIdx)
    // 内的位已被保证为 null（409 已拦截 isSingle 命中锁定、!isSingle 任意
    // 锁定），无需再 .map 清空。直接复用，让 locked 位的 selections 不被踩坏。
    const nextSelections = prevSelections;

    // 归档 + 清空 必须同一个事务（避免半成品快照 + 竞态 round 冲突）。
    // 事务外 send Inngest 事件触发 submitGeneration，让它在后台跑。
    // Inngest 触发是事务外的副作用——即便 send 失败，DB 状态已被事务
    // 正确置为 GENERATING；前端 stall watchdog 5 min 内可发现没真实
    // 进度推进而置 FAILED，不会永久卡住。
    await db.transaction(async (tx) => {
      await archiveOrderSnapshot(
        order.id,
        isSingle ? "regenerate_single" : "regenerate_all",
        isSingle ? imageIdx : null,
        { tx }
      );
      await tx
        .update(promptOrder)
        .set({
          candidates: JSON.stringify(nested),
          ...(nextSelections !== null
            ? { selections: JSON.stringify(nextSelections) }
            : {}),
          status: "GENERATING",
          errorMessage: null,
          // 清掉上一轮遗留的任务态，避免 /poll 查到已废弃的 task_id
          generationTask: null,
          updatedAt: new Date(),
        })
        .where(eq(promptOrder.id, order.id));
    });

    const candidateCount = order.template.candidateCount;
    logger.info(
      { orderId: order.id, fromIdx, toIdx, candidateCount },
      isSingle ? "提交单图重新生成" : "提交批量重新生成"
    );
    // 优先 Inngest 异步；失败降级到同步。详见 /upload 路由同函数注释。
    const { mode } = await triggerSubmit(
      order.id,
      fromIdx,
      toIdx,
      candidateCount
    );

    return NextResponse.json(
      {
        success: true,
        message: isSingle
          ? `正在为第 ${fromIdx + 1} 张照片重新生成效果图`
          : `正在为 ${toIdx - fromIdx} 张照片重新生成效果图`,
        data: {
          status: "GENERATING",
          fromIdx,
          toIdx,
          triggerMode: mode,
        },
      },
      { status: 202 }
    );
  } catch (err) {
    logger.error({ err }, "重新生成失败");
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "重新生成失败",
      },
      { status: 500 }
    );
  }
}

/** 只读 uploadedImages 的长度，避免引入额外依赖 */
function parseUploadedLength(raw: string | null): number {
  if (!raw) return 0;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

export const POST = withApiLogging(postHandler);
