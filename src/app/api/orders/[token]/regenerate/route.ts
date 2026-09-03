/**
 * 用户端 - 重新生成指定批次（或全部）效果图
 * POST /api/orders/[token]/regenerate
 *
 * body: { batchIdx?: number }
 *   - 不传 / 传 null：批量重跑所有已上传图（用于 FAILED 状态整体重试）
 *   - 传 batchIdx：仅重跑这一批（用于 CANDIDATES_READY 单批重新生成）
 *
 * 2026-09-02：索引语义从 imageIdx 改成 batchIdx。
 * 旧版单图重生成 = 重跑 1 张原图；新版单批重生成 = 重跑 1 个批次（每批
 * imagesPerUpload 张原图合一次生图）。
 *
 * 允许的状态：
 *   - CANDIDATES_READY：单批或批量重跑
 *   - FAILED：仅允许批量重跑（保证"链接不失效"，失败后可一键重试）
 *
 * 锁定限制（partial select 不可逆语义）：`selections[batchIdx] !== null`
 * 表示该批已提交，用户端不可重新生成。批次模型下用户每完成一次
 * upload → generate → select → submit 后，该批即被服务端"锁定"——
 * 要重新生成必须服务端把该位置 selections[batchIdx] 置 null（解锁后
 * 用户才能在 UI 上重新触发）。
 * - 单批路径：若目标位已锁 → 409
 * - 批量路径：只要有一位已锁 → 409（不能批量重跑覆盖已提交）
 */

import { and, count, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { promptOrder, promptOrderHistory } from "@/db/schema";
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
 *
 * 2026-09-02：参数改为张数维度的 fromIdx / total（与 submitGeneration
 * 内部一致），由调用方把 batchIdx 转张数索引。
 */
async function triggerSubmit(
  orderId: string,
  fromIdx: number,
  total: number,
  candidateCount: number
): Promise<{ mode: "ingest" | "sync" }> {
  try {
    await inngest.send({
      name: "gpt-image/submit-generation",
      data: { orderId, fromIdx, total, candidateCount },
    });
    return { mode: "ingest" };
  } catch (err) {
    logger.warn(
      { err, orderId, fromIdx, total },
      "Inngest send 失败，降级到同步 submitGeneration"
    );
    await submitGeneration(orderId, fromIdx, total, candidateCount);
    return { mode: "sync" };
  }
}

async function postHandler(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { batchIdx?: unknown };
    const batchIdx = body.batchIdx;

    if (
      batchIdx !== undefined &&
      batchIdx !== null &&
      (typeof batchIdx !== "number" ||
        !Number.isInteger(batchIdx) ||
        batchIdx < 0)
    ) {
      return NextResponse.json(
        { success: false, error: "batchIdx 必须是非负整数" },
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

    // 2026-09-02：状态校验按 batch 维度
    const isSingle = typeof batchIdx === "number";

    // 单批重新生成次数上限校验（按批次独立计数；批量 / FAILED 重试不计）。
    // 实际已用次数 = promptOrderHistory 中 trigger='regenerate_single'
    // AND imageIdx=batchIdx 的行数。regenerateLimit=0 意味着禁用。
    if (isSingle && order.regenerateLimit <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: "此订单已禁用主动重新生成功能",
        },
        { status: 403 }
      );
    }
    if (isSingle) {
      const usedRows = await db
        .select({ used: count() })
        .from(promptOrderHistory)
        .where(
          and(
            eq(promptOrderHistory.orderId, order.id),
            eq(promptOrderHistory.trigger, "regenerate_single"),
            eq(promptOrderHistory.imageIdx, batchIdx as number)
          )
        );
      const regenerateUsedCount = usedRows[0]?.used ?? 0;
      if (regenerateUsedCount >= order.regenerateLimit) {
        return NextResponse.json(
          {
            success: false,
            error: `第 ${(batchIdx as number) + 1} 批的重新生成次数已用完（${order.regenerateLimit} 次）。如需继续，请联系服务方调整。`,
          },
          { status: 429 }
        );
      }
    }
    if (isSingle && order.status !== "CANDIDATES_READY") {
      return NextResponse.json(
        {
          success: false,
          error: `当前状态为 ${order.status}，单批重生成仅在 CANDIDATES_READY 时可用`,
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

    // 锁定短路：已提交锁定的批不可重新生成（partial select 不可逆）。
    // 单批：batchIdx 位已锁 → 409
    // 批量：任意一位已锁 → 409（不允许批量覆盖已提交）
    //
    // DB selections 是按 batchIdx 存的 number[]，长度对齐 batchCount。
    // 老订单可能是按 imageIdx 存（长度 = uploadedImageCount），此处按
    // batchIdx 读——旧索引 i 对应 batchIdx i（兼容）但 length 不一致。
    const prevSelections = parseSelections(order.selections);
    const lockedBatchIndices: number[] = [];
    if (prevSelections) {
      for (let i = 0; i < prevSelections.length; i++) {
        if (prevSelections[i] !== null) lockedBatchIndices.push(i);
      }
    }
    if (lockedBatchIndices.length > 0) {
      if (isSingle && lockedBatchIndices.includes(batchIdx as number)) {
        return NextResponse.json(
          {
            success: false,
            error: `第 ${(batchIdx as number) + 1} 批已提交锁定，不可重新生成。如需更换效果请取消订单后联系服务方重新创建。`,
          },
          { status: 409 }
        );
      }
      if (!isSingle) {
        return NextResponse.json(
          {
            success: false,
            error: `订单已有 ${lockedBatchIndices.length} 批已锁定，无法批量重跑。请先取消订单后联系服务方重新创建。`,
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

    const imagesPerUpload = Math.max(1, order.imagesPerUpload);
    const batchCount = Math.ceil(uploadedCount / imagesPerUpload);

    // 2026-09-02：确定本次要重跑的索引范围（batchIdx → 张数 fromIdx）
    let fromIdx: number;
    let total: number;
    if (isSingle) {
      if (batchIdx >= batchCount) {
        return NextResponse.json(
          {
            success: false,
            error: `batchIdx ${batchIdx} 超出已上传批数 ${batchCount}`,
          },
          { status: 400 }
        );
      }
      fromIdx = batchIdx * imagesPerUpload;
      total = Math.min(uploadedCount, (batchIdx + 1) * imagesPerUpload);
    } else {
      fromIdx = 0;
      total = uploadedCount;
    }

    // 清空受影响槽位的 candidates + selections，状态置 GENERATING
    // 2026-09-02：candidates 槽位按 batchIdx 索引
    const nested = parseCandidates(order.candidates);
    for (let i = 0; i < batchCount; i++) {
      if (!Array.isArray(nested[i])) nested[i] = [];
    }
    if (isSingle) {
      nested[batchIdx] = [];
    } else {
      // 批量：清空所有 batchIdx
      for (let i = 0; i < batchCount; i++) nested[i] = [];
    }
    // selections 同步：单批置 null / 批量保持 locked 不动
    const nextSelections: (number | null)[] | null = prevSelections
      ? Array.from({ length: batchCount }, (_, i) => {
          if (isSingle) {
            // 单批：目标 batchIdx 置 null
            return i === batchIdx ? null : (prevSelections[i] ?? null);
          }
          // 批量：锁定短路保证没有锁，清空所有
          return null;
        })
      : null;

    // 归档 + 清空 必须同一个事务（避免半成品快照 + 竞态 round 冲突）。
    // 事务外 send Inngest 事件触发 submitGeneration，让它在后台跑。
    // Inngest 触发是事务外的副作用——即便 send 失败，DB 状态已被事务
    // 正确置为 GENERATING；前端 stall watchdog 5 min 内可发现没真实
    // 进度推进而置 FAILED，不会永久卡住。
    await db.transaction(async (tx) => {
      await archiveOrderSnapshot(
        order.id,
        isSingle ? "regenerate_single" : "regenerate_all",
        isSingle ? batchIdx : null,
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
      { orderId: order.id, fromIdx, total, candidateCount, isSingle, batchIdx },
      isSingle ? "提交单批重新生成" : "提交批量重新生成"
    );
    // 优先 Inngest 异步；失败降级到同步。详见 /upload 路由同函数注释。
    const { mode } = await triggerSubmit(
      order.id,
      fromIdx,
      total,
      candidateCount
    );

    return NextResponse.json(
      {
        success: true,
        message: isSingle
          ? `正在为第 ${batchIdx + 1} 批照片重新生成效果图`
          : `正在为 ${batchCount} 批照片重新生成效果图`,
        data: {
          status: "GENERATING",
          fromIdx,
          total,
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
