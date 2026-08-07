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
 * 单个任务的超时阈值：90s（与改造前服务端轮询上限一致）。
 * 超时的任务由 /poll 判定失败，提示用户重新生成。
 */
export const TASK_TIMEOUT_MS = 90_000;

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
        typeof submittedAt === "number"
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
