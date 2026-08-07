/**
 * 推进订单的生图任务（submit/poll 两段式的 poll 半边）
 *
 * 被两处复用：
 * - POST /api/orders/[token]/poll —— 前端在页面上轮询时驱动（主路径）
 * - POST /api/jobs/orders/advance —— cron 兜底，处理用户关掉页面后无人推进的订单
 *
 * 幂等：非 GENERATING / 无待轮询任务时直接返回，不产生副作用。
 * 写库前重新读取，避免覆盖并发写入（多标签页、cron 与前端同时推进）。
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { logger } from "@/lib/logger";

import { queryLingtingTask } from "./generation-service";
import {
  isTaskTimedOut,
  parseGenerationTask,
  stringifyGenerationTask,
} from "./generation-task";
import { parseCandidates } from "./order-helpers";

/** 推进结果，供调用方记日志 / 汇总 */
export interface AdvanceResult {
  /** 是否发生了状态变更（落库） */
  changed: boolean;
  /** 推进后的订单状态；未变更时为原状态 */
  status: string;
  /** 本次新完成的图片数 */
  completed: number;
  /** 仍在等待上游的任务数 */
  pending: number;
}

/**
 * 查询并推进一个订单的所有在途生图任务。
 *
 * @param orderId 订单 id
 */
export async function advanceOrderGeneration(
  orderId: string
): Promise<AdvanceResult> {
  const order = await db.query.promptOrder.findFirst({
    where: eq(promptOrder.id, orderId),
    columns: {
      id: true,
      status: true,
      candidates: true,
      generationTask: true,
      templateId: true,
    },
  });

  if (!order) {
    return { changed: false, status: "NOT_FOUND", completed: 0, pending: 0 };
  }

  const state = parseGenerationTask(order.generationTask as string | null);

  // 无进行中任务 → 幂等返回
  if (order.status !== "GENERATING" || !state || state.tasks.length === 0) {
    return { changed: false, status: order.status, completed: 0, pending: 0 };
  }

  // 查询上游（uploadCount 基本为 1，并行代价可忽略）
  const now = Date.now();
  const results = await Promise.all(
    state.tasks.map(async (task) => ({
      task,
      res: await queryLingtingTask(task.taskId),
    }))
  );

  const remaining: typeof state.tasks = [];
  const failures: string[] = [];
  const doneUrls: Array<{ imageIdx: number; url: string }> = [];

  for (const { task, res } of results) {
    if (res.state === "done") {
      doneUrls.push({ imageIdx: task.imageIdx, url: res.url });
    } else if (res.state === "failed") {
      failures.push(`第 ${task.imageIdx + 1} 张：${res.error}`);
    } else if (isTaskTimedOut(task, now)) {
      failures.push(`第 ${task.imageIdx + 1} 张：生成超时，请重新生成`);
    } else {
      remaining.push(task);
    }
  }

  // 重新读取再写，避免覆盖并发写入
  const current = await db.query.promptOrder.findFirst({
    where: eq(promptOrder.id, orderId),
    columns: { candidates: true, status: true },
  });
  if (!current || current.status === "CANCELLED") {
    return {
      changed: false,
      status: current?.status ?? "NOT_FOUND",
      completed: 0,
      pending: 0,
    };
  }

  const nested = parseCandidates(current.candidates);
  for (let i = 0; i < state.total; i++) {
    if (!Array.isArray(nested[i])) nested[i] = [];
  }
  for (const { imageIdx, url } of doneUrls) {
    nested[imageIdx] = [url];
  }

  // 仍有任务在跑 → 保持 GENERATING，写回剩余任务
  if (remaining.length > 0) {
    await db
      .update(promptOrder)
      .set({
        candidates: JSON.stringify(nested),
        generationTask: stringifyGenerationTask({
          tasks: remaining,
          total: state.total,
        }),
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, orderId));
    return {
      changed: doneUrls.length > 0,
      status: "GENERATING",
      completed: doneUrls.length,
      pending: remaining.length,
    };
  }

  // 本轮结束：按成功数落终态
  const successCount = nested.filter(
    (g) => Array.isArray(g) && g.length > 0
  ).length;

  if (successCount === 0) {
    await db
      .update(promptOrder)
      .set({
        status: "FAILED",
        generationTask: null,
        errorMessage: failures.join("；") || "生成失败，请重新生成",
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, orderId));
    logger.warn({ orderId, failures }, "生图全部失败");
    return { changed: true, status: "FAILED", completed: 0, pending: 0 };
  }

  await db
    .update(promptOrder)
    .set({
      candidates: JSON.stringify(nested),
      status: "CANDIDATES_READY",
      generationTask: null,
      generatedAt: new Date(),
      templateId: order.templateId,
      errorMessage:
        failures.length > 0 ? `部分失败：${failures.join("；")}` : null,
      updatedAt: new Date(),
    })
    .where(eq(promptOrder.id, orderId));
  logger.info({ orderId, successCount }, "生图完成");
  return {
    changed: true,
    status: "CANDIDATES_READY",
    completed: doneUrls.length,
    pending: 0,
  };
}
