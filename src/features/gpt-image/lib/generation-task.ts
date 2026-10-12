/**
 * 生图任务态（promptOrder.generationTask 字段的 JSON 结构）
 *
 * 背景：Serverless 环境下没有长时后台进程，服务端只能做 Lingting 的 submit
 * 拿到 task_id，真正的轮询由前端调 /api/orders/[token]/poll 驱动。
 * 本模块负责这份任务态的类型定义与安全解析。
 *
 * 与 order-helpers.ts 一致：解析失败一律降级为"无任务"，绝不抛错。
 */

/** 单个待查询的 Lingting 任务 */
export interface GenerationTask {
  /** 对应 uploadedImages 的下标 */
  imageIdx: number;
  /** Lingting 返回的 task_id */
  taskId: string;
  /** 提交时刻（Date.now()），用于超时判定 */
  submittedAt: number;
}

/** 本轮生成的整体任务态 */
export interface GenerationTaskState {
  /** 待查询的任务；完成一个移除一个，清空即本轮结束 */
  tasks: GenerationTask[];
  /** 本轮目标 total（沿用 fromIdx/total 语义，收尾时统计成功数用） */
  total: number;
}

/**
 * 单任务软超时（依赖上游可达）：5 分钟。
 *
 * 选择此值的依据：GPT-Image-2 上游单图实际耗时 P99 约 60-180s，
 * 旧值 90s 沿用「改造前服务端轮询上限」，与上游真实耗时明显错位，
 * 导致正常慢任务被误判失败 → 用户重试浪费配额。
 *
 * 提升到 5min 后，正常慢任务不会被误判；真正卡死由下方
 * ORDER_DEADLINE_MS（10min）兜底。
 *
 * 调参不变式：必须保证 `ORDER_DEADLINE_MS > TASK_TIMEOUT_MS`，
 * 否则 SQL 兜底会比在线路径更激进。
 */
export const TASK_TIMEOUT_MS = 300_000;

/**
 * 整单硬超时（不依赖上游可达）：5 分钟。
 *
 * 用途：上游挂死 / Lingting 任务彻底丢失时，保证订单不会无限期卡在
 * GENERATING。命中条件：`generationTask` 非空 + 最小 submittedAt
 * 已超过本阈值。判定写在 advance-generation.ts 的「前置」分支，
 * 见 isOrderPastDeadline。
 *
 * 阈值依据：上传 + Lingting 处理两段的总预算——
 * - R2 下载原图（submitLingtingTask 内）：最多 60s
 * - Lingting `/v1/images/edits` POST 提交：最多 60s
 * - Lingting 单图处理 P99：约 60-180s
 * 三段叠加最坏 300s = 5 min。早期版本用 2 min（120s），仅覆盖上传 + P50
 * 60s；P99 + 网络抖动叠加就会误判 FAILED——用户反馈「上传时间不算
 * 任务时间」：deadline 应该是 Lingting 处理预算，**不**扣除上传链路
 * 占用，所以阈值要够宽。
 *
 * 5 min 与下方 TASK_TIMEOUT_MS（5 min）持平——主路径与 per-task SQL
 * 兜底同时触发，干净收敛。
 *
 * 触发路径：
 * 1. 前端 /poll 每次轮询时 advanceOrderGeneration 进入后立即检查（主路径）
 * 2. cron /api/jobs/orders/advance 在 inFlight 循环之前扫表（关页面兜底）
 *
 * Vercel Hobby cron 只能 1 次/天，所以「关页面后」的兜底实际只有
 * 第 1 条路径可靠；用户长时间关页面时需依靠下一次打开页面被自动推
 * 进。本阈值下，**主路径 5 分钟内必收敛**，不再依赖 cron 频率。
 */
export const ORDER_DEADLINE_MS = 300_000;

/** 解析 generationTask JSON；无任务 / 格式异常均返回 null */
export function parseGenerationTask(
  raw: string | null | undefined
): GenerationTaskState | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    const rawTasks = (obj as { tasks?: unknown }).tasks;
    if (!Array.isArray(rawTasks)) return null;

    const tasks: GenerationTask[] = [];
    for (const t of rawTasks) {
      if (!t || typeof t !== "object") continue;
      const { imageIdx, taskId, submittedAt } = t as Record<string, unknown>;
      if (
        typeof imageIdx === "number" &&
        Number.isInteger(imageIdx) &&
        imageIdx >= 0 &&
        typeof taskId === "string" &&
        taskId.length > 0 &&
        // Number.isFinite 防御 NaN/Infinity：typeof NaN === "number" 为 true，
        // 而 now - NaN > X 恒为 false，会造出永不超时的「不死任务」污染整张表。
        typeof submittedAt === "number" &&
        Number.isFinite(submittedAt)
      ) {
        tasks.push({ imageIdx, taskId, submittedAt });
      }
    }

    const rawTotal = (obj as { total?: unknown }).total;
    const total =
      typeof rawTotal === "number" && Number.isInteger(rawTotal) && rawTotal > 0
        ? rawTotal
        : tasks.length;

    return { tasks, total };
  } catch {
    return null;
  }
}

/** 序列化任务态，用于写入 DB */
export function stringifyGenerationTask(state: GenerationTaskState): string {
  return JSON.stringify(state);
}

/** 该任务是否已超时 */
export function isTaskTimedOut(task: GenerationTask, now: number): boolean {
  return now - task.submittedAt > TASK_TIMEOUT_MS;
}

/**
 * 整单是否已跨过硬超时（不依赖上游可达）。
 *
 * 触发条件：仍有 pending 任务（tasks 非空）+ 最早的 submittedAt 距 now
 * 已超过 ORDER_DEADLINE_MS。返回 true 时调用方应立即把订单置 FAILED，
 * 不必再查 upstream —— 因为查了也大概率挂死，且会拖到平台函数预算。
 */
export function isOrderPastDeadline(
  state: GenerationTaskState,
  now: number
): boolean {
  if (state.tasks.length === 0) return false;
  let earliest = Number.POSITIVE_INFINITY;
  for (const t of state.tasks) {
    if (t.submittedAt < earliest) earliest = t.submittedAt;
  }
  if (!Number.isFinite(earliest)) return false;
  return now - earliest > ORDER_DEADLINE_MS;
}
