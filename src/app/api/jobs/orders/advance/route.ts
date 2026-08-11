/**
 * 生图订单推进 Cron Job API
 *
 * 兜底用途：submit/poll 两段式下，轮询主要由用户页面上的前端驱动
 * （POST /api/orders/[token]/poll）。用户关掉页面后就没人推进了，
 * 订单会停在 GENERATING。本 job 定期扫描并推进这些订单。
 *
 * 处理三类订单：
 * 1. **超时卡死订单**（status=GENERATING + generationTask 非空 + updatedAt 早于
 *    ORDER_DEADLINE_MS，默认 2 分钟）→ 强制 FAILED。**不查上游**，单条
 *    UPDATE 自带 RETURNING。这是最关键的一类——前端开着时由
 *    advanceOrderGeneration 的前置硬超时兜底；前端关掉时由本分支兜底。
 * 2. 有在途任务（generationTask 非空）→ 查询上游并推进，复用
 *    advanceOrderGeneration()，与前端 /poll 走同一份逻辑
 * 3. 孤儿订单（generationTask 为空但状态仍是 GENERATING）→ 这类订单
 *    没有任何任务句柄，永远不会自己恢复（改造前遗留的卡死订单即属此类）。
 *    超过 ORPHAN_THRESHOLD_MS 未更新则判失败，提示用户重新生成。
 *
 * 顺序：先扫超时卡死单 → 再走 inFlight 推进 → 最后清孤儿。
 * 第 1 步放在最前是为了避免 BATCH_LIMIT=30 的推进配额被必死订单吃掉。
 *
 * 需要通过 Bearer Token 认证（CRON_SECRET），与 /api/jobs/credits/expire 一致。
 *
 * 配置 Vercel Cron（见 vercel.json）。
 *
 * 注意频率限制：Vercel Hobby 计划的 Cron **每天只能触发一次**，
 * 配置更高频的 schedule 会导致整个部署失败。因此 vercel.json 中
 * 默认用 "0 3 * * *"（每天一次），Hobby / Pro 都能正常部署。
 *
 * 想要分钟级兜底（推荐，能显著缩短用户关页面后的等待）：
 * - Pro 计划：把 vercel.json schedule 改成每 5 分钟一次（cron 表达式每段同位 `*`）。
 * - Hobby 计划：用外部 cron 服务（如 cron-job.org）以 10 分钟一次 schedule
 *   定时 POST 本端点，带上 Authorization: Bearer $CRON_SECRET 即可，
 *   与调用方无关。
 *
 * 注：timeout-scan 的判据依赖 `updatedAt` 是「最后一次真实进展时钟」。
 * advance-generation.ts 已修掉「无进展也写库」的污染源。
 */

import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { advanceOrderGeneration } from "@/features/gpt-image/lib/advance-generation";
import { ORDER_DEADLINE_MS } from "@/features/gpt-image/lib/generation-task";
import { withApiLogging } from "@/lib/api-logger";
import { logError, logWarn } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 单次最多处理多少个订单，避免超出函数时长 */
const BATCH_LIMIT = 30;

/**
 * 孤儿订单判定阈值：GENERATING 但无任务句柄，且超过这么久没更新。
 * 取 10 分钟 —— 远大于 submit 阶段耗时，不会误伤正在提交中的订单。
 */
const ORPHAN_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * 验证 Cron Job 请求的 Bearer Token
 */
function validateCronSecret(authHeader: string | null): boolean {
  if (!authHeader) return false;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logWarn("CRON_SECRET environment variable is not set");
    return false;
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  return token === cronSecret;
}

/**
 * POST /api/jobs/orders/advance
 *
 * 推进所有在途生图订单，并清理孤儿订单
 */
export const POST = withApiLogging(async () => {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");

  if (!validateCronSecret(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. 扫超时卡死订单：status=GENERATING + generationTask 非空 +
    //    updatedAt 早于 ORDER_DEADLINE_MS（默认 10 分钟）。
    //    单条 UPDATE ... RETURNING，不查上游，不占用 BATCH_LIMIT 配额。
    //    谓词依赖 updatedAt 是「最后一次真实进展时钟」（advance-generation
    //    已修掉无进展污染）。
    const deadlineCutoff = new Date(Date.now() - ORDER_DEADLINE_MS);
    const timedOut = await db
      .update(promptOrder)
      .set({
        status: "FAILED",
        generationTask: null,
        errorMessage: "生成超时，请重新生成",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(promptOrder.status, "GENERATING"),
          isNotNull(promptOrder.generationTask),
          lt(promptOrder.updatedAt, deadlineCutoff)
        )
      )
      .returning({ id: promptOrder.id });

    // 2. 推进有在途任务的订单（剩余 inFlight）
    const inFlight = await db.query.promptOrder.findMany({
      where: and(
        eq(promptOrder.status, "GENERATING"),
        isNotNull(promptOrder.generationTask)
      ),
      columns: { id: true },
      limit: BATCH_LIMIT,
    });

    const advanced: Array<{
      orderId: string;
      status: string;
      completed: number;
    }> = [];

    for (const order of inFlight) {
      try {
        const result = await advanceOrderGeneration(order.id);
        if (result.changed) {
          advanced.push({
            orderId: order.id,
            status: result.status,
            completed: result.completed,
          });
        }
      } catch (err) {
        // 单个订单失败不影响整批
        logError("Failed to advance order", {
          orderId: order.id,
          error: String(err),
        });
      }
    }

    // 3. 清理孤儿订单：GENERATING 但无任务句柄，且已停滞足够久
    const orphanCutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS);
    const orphans = await db
      .update(promptOrder)
      .set({
        status: "FAILED",
        errorMessage: "生成任务已丢失，请点击重新生成",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(promptOrder.status, "GENERATING"),
          isNull(promptOrder.generationTask),
          lt(promptOrder.updatedAt, orphanCutoff)
        )
      )
      .returning({ id: promptOrder.id });

    return NextResponse.json({
      success: true,
      scanned: inFlight.length,
      advanced: advanced.length,
      timedOutCleaned: timedOut.length,
      orphansCleaned: orphans.length,
      details: advanced,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logError("Failed to advance generating orders", { error: String(error) });

    return NextResponse.json(
      {
        success: false,
        error: "Failed to advance generating orders",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
});

/**
 * GET /api/jobs/orders/advance
 *
 * 健康检查端点，用于验证 Cron Job 配置是否正确
 */
export const GET = withApiLogging(async () => {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/jobs/orders/advance",
    method: "POST",
    description: "Advance in-flight image generation orders and clean orphans",
    authentication: "Bearer token required (CRON_SECRET)",
  });
});
