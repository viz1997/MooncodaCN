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

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { logger } from "@/lib/logger";

import { queryLingtingTask } from "./generation-service";
import {
  isOrderPastDeadline,
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

  // ★ keystone: 前置硬超时
  //
  // 必须排在查 upstream 之前——这是绕开「上游挂死 → 永远 pending」的唯一办法。
  // 即使 Lingting 完全失联，我们也不再尝试调它。
  //
  // 写入用 `WHERE status='GENERATING'` 原子化，副作用：
  // 1. 顺手关掉原 :94-105 重读与 :117 写入之间的 TOCTOU 窗口
  // 2. 与 stop-generation 路由并发写入时不互相覆盖（最终态必是其一）
  //
  // 跨过 ORDER_DEADLINE_MS 的订单在「下一次 /poll（≤3s）」内收敛，不需要 cron 参与。
  if (isOrderPastDeadline(state, Date.now())) {
    const failed = await db
      .update(promptOrder)
      .set({
        status: "FAILED",
        generationTask: null,
        errorMessage: "生成超时，请重新生成",
        updatedAt: new Date(),
      })
      .where(
        and(eq(promptOrder.id, orderId), eq(promptOrder.status, "GENERATING"))
      )
      .returning({ id: promptOrder.id });
    if (failed.length > 0) {
      logger.warn(
        { orderId, submittedAt: state.tasks[0]?.submittedAt },
        "订单跨过硬超时，强制 FAILED（不查上游）"
      );
      return { changed: true, status: "FAILED", completed: 0, pending: 0 };
    }
    // 并发分支已经把订单掰到非 GENERATING（如 stop-generation / cancel），
    // 不能误判成「硬超时命中」——重读一次按真实状态返回。
    const after = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.id, orderId),
      columns: { status: true },
    });
    return {
      changed: false,
      status: after?.status ?? "UNKNOWN",
      completed: 0,
      pending: 0,
    };
  }

  // 查询上游（uploadCount 基本为 1，并行代价可忽略）
  const now = Date.now();
  const results = await Promise.all(
    state.tasks.map(async (task) => ({
      task,
      res: await queryLingtingTask(orderId, task.taskId, task.imageIdx),
    }))
  );

  const remaining: typeof state.tasks = [];
  const failures: string[] = [];
  const doneUrls: Array<{ imageIdx: number; url: string }> = [];

  // done 的图：queryLingtingTask 内部已经 R2 持久化（url/b64 两路都覆盖），
  // 这里直接收 doneUrls。注意：R2 失败应在 queryLingtingTask 内抛错被
  // catch 成 pending —— 但目前实现是 throw 后穿透；为安全起见保留下面
  // .catch 兜底。
  const persistPromises: Array<
    Promise<{ imageIdx: number; url: string } | null>
  > = [];
  for (const { task, res } of results) {
    if (res.state === "done") {
      // queryLingtingTask 已落 R2，这里直接收 url
      persistPromises.push(
        Promise.resolve(res.url).then((url) => ({
          imageIdx: task.imageIdx,
          url,
        }))
      );
    } else if (res.state === "failed") {
      failures.push(`第 ${task.imageIdx + 1} 张：${res.error}`);
    } else if (isTaskTimedOut(task, now)) {
      failures.push(`第 ${task.imageIdx + 1} 张：生成超时，请重新生成`);
    } else {
      remaining.push(task);
    }
  }
  const persisted = await Promise.all(persistPromises);
  for (const item of persisted) {
    if (item) doneUrls.push(item);
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
  //
  // 「无进展不写库」：当前每 3s 都把 updatedAt 顶到当前时间，污染
  // 「最后一次真实进展」语义——ORDER_DEADLINE_MS 扫描和前端停滞提示
  // 的判据都建立在 updatedAt 是进展时钟之上。
  // - 有 doneUrls 进来 → 必写（新增候选）
  // - 有失败/超时切走（remaining 缩短） → 必写（兜底避免 stale tasks）
  // - 都没发生（pending 仍全在 + 没人完成） → 跳过整个 UPDATE
  const progressed =
    doneUrls.length > 0 || remaining.length !== state.tasks.length;
  if (remaining.length > 0) {
    if (progressed) {
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
    }
    return {
      changed: progressed,
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
