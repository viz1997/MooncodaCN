/**
 * Preview 分享凭证的生图服务（2026-09-14）
 *
 * 与 src/features/gpt-image/lib/generation-service.ts:519 submitGeneration
 * + src/features/gpt-image/lib/advance-generation.ts:44 advanceOrderGeneration
 * 镜像：操作 preview_share 表而非 promptOrder，R2 路径走 gpt-image/results/preview/{shareId}
 * 而非 gpt-image/results/{orderId}，状态机 9 态。
 *
 * 设计动机：preview 流走自己状态机（pending → uploaded → generating →
 * candidates_ready → selected → confirmed），不创建 promptOrder。
 * Lingting 提交 / 轮询 / R2 持久化复用 promptOrder 链路的 submitLingtingTask /
 * queryLingtingTask / persistCandidateToR2（这些函数无 promptOrder 耦合，
 * 只接 orderId 字符串）。
 *
 * 复用与不复用清单：
 * - 复用：submitLingtingTask, queryLingtingTask, persistCandidateToR2,
 *   parseGenerationTask, stringifyGenerationTask, TASK_TIMEOUT_MS,
 *   ORDER_DEADLINE_MS, isOrderPastDeadline, isTaskTimedOut
 * - 不复用：parseCandidates（preview 自己的 candidates JSON 形状与 promptOrder 相同
 *   但仅 batchCount=1，直接用 parseCandidates 即可）
 *
 * 关于「不写 imageJob 表」：preview 流无 imageJob 跟踪，提交/轮询进度仅靠
 * preview_share.generationTask JSON 字段表达。前端 useOrderActions 轮询走
 * /api/orders/[token]/poll，poll 路由入口加 preview_share 优先分支调本模块。
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { previewShare } from "@/db/schema";
import { logger } from "@/lib/logger";
import { queryLingtingTask, submitLingtingTask } from "./generation-service";
import type { GenerationTask } from "./generation-task";
import {
  isOrderPastDeadline,
  isTaskTimedOut,
  parseGenerationTask,
  stringifyGenerationTask,
} from "./generation-task";
import { parseCandidates, parseUploadedImages } from "./order-helpers";

/**
 * 提交 preview 凭证的 Lingting 生图任务（submit 半边，不轮询）。
 *
 * 与 submitGeneration 的差异：
 * - 查 preview_share（status='uploaded' 或 'selected' 或 'failed'，进入 generating）
 * - R2 命名空间走 gpt-image/results/preview/{shareId}/
 * - status 9 态字符串而非 promptOrder 的 PENDING/GENERATING/CANDIDATES_READY
 *
 * 调用方（/api/orders/[token]/upload / regenerate 路由）await 本函数，
 * 落入 status='generating' + generationTask JSON，/poll 路由后续推进。
 *
 * 失败抛错，由调用方落 status='failed' + errorMessage。
 */
export async function submitPreviewGeneration(
  shareId: string,
  fromIdx: number,
  total: number,
  candidateCount: number
): Promise<void> {
  const share = await db.query.previewShare.findFirst({
    where: eq(previewShare.id, shareId),
    with: { template: true },
  });
  if (!share) {
    logger.warn({ shareId }, "preview 凭证不存在，跳过生成");
    return;
  }

  const uploaded = parseUploadedImages(share.uploadedImages as string | null);
  if (uploaded.length === 0) {
    throw new Error("preview 凭证尚未上传原图");
  }

  const outputMode =
    (share.template.outputMode as "grid" | "separate") ?? "grid";
  let effectivePrompt: string;
  let n: number;
  if (outputMode === "separate") {
    effectivePrompt = share.template.prompt;
    n = candidateCount;
  } else {
    // 宫格模式：n=1 + prompt 末尾追加宫格指令（与 promptOrder 路径一致）
    const layout = buildGridLayoutForPreview(candidateCount);
    effectivePrompt = share.template.prompt + layout.suffix;
    n = 1;
  }
  const size = share.template.size;

  // preview 流 batchCount=1（imagesPerUpload 硬编码 1，单张图）。
  // 但 imagesPerUpload 字段保留以兼容 future multi-image per batch 场景。
  const perBatch = Math.max(1, share.imagesPerUpload ?? 1);
  const batchCount = Math.ceil(uploaded.length / perBatch);
  const fromBatch = Math.floor(fromIdx / perBatch);
  const toBatch = Math.min(batchCount, Math.ceil(total / perBatch));

  const MAX_SUBMIT_ATTEMPTS = 2;
  const SUBMIT_RETRY_DELAY_MS = 2_000;

  const settled = await Promise.all(
    Array.from({ length: toBatch - fromBatch }, (_, localIdx) => {
      const batchIdx = fromBatch + localIdx;
      return (async () => {
        const start = batchIdx * perBatch;
        const end = Math.min(uploaded.length, start + perBatch);
        const imageUrls = uploaded.slice(start, end);
        if (imageUrls.length === 0) {
          return {
            batchIdx,
            error: `第 ${batchIdx + 1} 批：本批无参考图`,
          };
        }
        let lastError: string | null = null;
        for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
          try {
            const result = await submitLingtingTask(
              shareId,
              imageUrls,
              effectivePrompt,
              size,
              batchIdx,
              n
            );
            if (attempt > 1) {
              logger.info(
                { shareId, batchIdx, attempt },
                "preview 提交生图任务重试成功"
              );
            }
            return { batchIdx, result };
          } catch (err) {
            lastError = err instanceof Error ? err.message : "未知错误";
            logger.warn(
              { err, shareId, batchIdx, attempt },
              "preview 提交生图任务失败"
            );
            if (attempt < MAX_SUBMIT_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, SUBMIT_RETRY_DELAY_MS));
            }
          }
        }
        return {
          batchIdx,
          error: `第 ${batchIdx + 1} 批：${lastError ?? "未知错误"}`,
        };
      })();
    })
  );

  // 汇总：同步拿到 url 的直接落 candidates，拿到 taskId 的进待轮询列表
  const nested = fillSparseSlotsForPreview(
    parseCandidates(share.candidates as string | null),
    batchCount
  );
  const tasks: GenerationTask[] = [];
  const failures: string[] = [];
  const now = Date.now();
  let readyCount = 0;

  for (const item of settled) {
    if ("error" in item && item.error) {
      failures.push(item.error);
      continue;
    }
    const result = item.result;
    if (!result) continue;
    if (result.kind === "url") {
      // submitLingtingTask 内部用的是 promptOrder 版本的 persistWellapiDataToR2，
      // 落 R2 路径是 gpt-image/results/{shareId}/ —— 注意 shareId 字符串与 orderId
      // 字符串格式都是 nanoid，没有歧义
      nested[item.batchIdx] = result.urls;
      readyCount += result.urls.length;
    } else {
      tasks.push({
        imageIdx: item.batchIdx,
        taskId: result.taskId,
        submittedAt: now,
      });
    }
  }

  if (tasks.length > 0) {
    await db
      .update(previewShare)
      .set({
        candidates: JSON.stringify(nested),
        generationTask: stringifyGenerationTask({ tasks, total: batchCount }),
        status: "generating",
        errorMessage: failures.length > 0 ? failures.join("；") : null,
        updatedAt: new Date(),
      })
      .where(eq(previewShare.id, shareId));
    logger.info(
      { shareId, taskCount: tasks.length, fromIdx, total, batchCount },
      "preview 生图任务已提交，等待前端轮询推进"
    );
    return;
  }

  const successCount = nested.filter(
    (g) => Array.isArray(g) && g.length > 0
  ).length;

  if (successCount === 0) {
    await db
      .update(previewShare)
      .set({
        status: "failed",
        generationTask: null,
        errorMessage: failures.join("；") || "preview 生图任务提交失败",
        updatedAt: new Date(),
      })
      .where(eq(previewShare.id, shareId));
    logger.error({ shareId, failures }, "preview 生图任务全部提交失败");
    return;
  }

  await db
    .update(previewShare)
    .set({
      candidates: JSON.stringify(nested),
      status: "candidates_ready",
      generationTask: null,
      generatedAt: new Date(),
      errorMessage:
        failures.length > 0 ? `部分失败：${failures.join("；")}` : null,
      updatedAt: new Date(),
    })
    .where(eq(previewShare.id, shareId));
  logger.info({ shareId, readyCount }, "preview 生图任务同步完成");
}

/** 推进结果 */
export interface AdvanceResult {
  changed: boolean;
  status: string;
  completed: number;
  pending: number;
}

/**
 * 推进一个 preview 凭证的生图任务（poll 半边）。
 *
 * 与 advanceOrderGeneration 镜像，差异：查/写 preview_share 而非 promptOrder。
 * 调用方：/api/orders/[token]/poll 路由入口加 preview_share 优先分支。
 *
 * 幂等：status!='generating' 或 generationTask 为空时直接返回，不产生副作用。
 */
export async function advancePreviewShareGeneration(
  shareId: string
): Promise<AdvanceResult> {
  const share = await db.query.previewShare.findFirst({
    where: eq(previewShare.id, shareId),
    columns: {
      id: true,
      status: true,
      candidates: true,
      generationTask: true,
      templateId: true,
    },
  });
  if (!share) {
    return { changed: false, status: "NOT_FOUND", completed: 0, pending: 0 };
  }

  const state = parseGenerationTask(share.generationTask as string | null);

  if (share.status !== "generating" || !state || state.tasks.length === 0) {
    return { changed: false, status: share.status, completed: 0, pending: 0 };
  }

  // 硬超时前置（与 advance-generation.ts:79-111 同模式）
  if (isOrderPastDeadline(state, Date.now())) {
    const failed = await db
      .update(previewShare)
      .set({
        status: "failed",
        generationTask: null,
        errorMessage: "生成超时，请重新生成",
        updatedAt: new Date(),
      })
      .where(
        and(eq(previewShare.id, shareId), eq(previewShare.status, "generating"))
      )
      .returning({ id: previewShare.id });
    if (failed.length > 0) {
      logger.warn(
        { shareId, submittedAt: state.tasks[0]?.submittedAt },
        "preview 跨过硬超时，强制 FAILED（不查上游）"
      );
      return { changed: true, status: "failed", completed: 0, pending: 0 };
    }
    const after = await db.query.previewShare.findFirst({
      where: eq(previewShare.id, shareId),
      columns: { status: true },
    });
    return {
      changed: false,
      status: after?.status ?? "UNKNOWN",
      completed: 0,
      pending: 0,
    };
  }

  const now = Date.now();
  const results = await Promise.all(
    state.tasks.map(async (task) => ({
      task,
      res: await queryLingtingTask(shareId, task.taskId, task.imageIdx),
    }))
  );

  const remaining: typeof state.tasks = [];
  const failures: string[] = [];
  const doneUrls: Array<{ imageIdx: number; urls: string[] }> = [];

  for (const { task, res } of results) {
    if (res.state === "done") {
      doneUrls.push({ imageIdx: task.imageIdx, urls: res.urls });
    } else if (res.state === "failed") {
      failures.push(`第 ${task.imageIdx + 1} 批：${res.error}`);
    } else if (isTaskTimedOut(task, now)) {
      failures.push(`第 ${task.imageIdx + 1} 批：生成超时，请重新生成`);
    } else {
      remaining.push(task);
    }
  }

  // 重新读取再写，避免覆盖并发写入
  const current = await db.query.previewShare.findFirst({
    where: eq(previewShare.id, shareId),
    columns: { candidates: true, status: true },
  });
  if (!current || current.status === "cancelled") {
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
  for (const { imageIdx, urls } of doneUrls) {
    nested[imageIdx] = urls;
  }

  // 「无进展不写库」原则：避免 updatedAt 被纯 pending 轮询顶到当前时间，
  // 污染 ORDER_DEADLINE_MS 扫描与前端停滞提示的判据。
  const progressed =
    doneUrls.length > 0 || remaining.length !== state.tasks.length;
  if (remaining.length > 0) {
    if (progressed) {
      await db
        .update(previewShare)
        .set({
          candidates: JSON.stringify(nested),
          generationTask: stringifyGenerationTask({
            tasks: remaining,
            total: state.total,
          }),
          updatedAt: new Date(),
        })
        .where(eq(previewShare.id, shareId));
    }
    return {
      changed: progressed,
      status: "generating",
      completed: doneUrls.reduce((n, d) => n + d.urls.length, 0),
      pending: remaining.length,
    };
  }

  const successCount = nested.filter(
    (g) => Array.isArray(g) && g.length > 0
  ).length;

  if (successCount === 0) {
    await db
      .update(previewShare)
      .set({
        status: "failed",
        generationTask: null,
        errorMessage: failures.join("；") || "生成失败，请重新生成",
        updatedAt: new Date(),
      })
      .where(eq(previewShare.id, shareId));
    logger.warn({ shareId, failures }, "preview 生图全部失败");
    return { changed: true, status: "failed", completed: 0, pending: 0 };
  }

  await db
    .update(previewShare)
    .set({
      candidates: JSON.stringify(nested),
      status: "candidates_ready",
      generationTask: null,
      generatedAt: new Date(),
      errorMessage:
        failures.length > 0 ? `部分失败：${failures.join("；")}` : null,
      updatedAt: new Date(),
    })
    .where(eq(previewShare.id, shareId));
  logger.info({ shareId, successCount }, "preview 生图完成");
  return {
    changed: true,
    status: "candidates_ready",
    completed: doneUrls.reduce((n, d) => n + d.urls.length, 0),
    pending: 0,
  };
}

/** 宫格布局辅助（与 generation-service.ts:480 buildGridLayout 同结构，单独写一份避免循环依赖） */
function buildGridLayoutForPreview(candidateCount: number): {
  cols: number;
  rows: number;
  suffix: string;
} {
  // preview 流 candidateCount 默认 4（与 promptOrder 一致）
  if (candidateCount <= 1) {
    return { cols: 1, rows: 1, suffix: "" };
  }
  if (candidateCount <= 4) {
    return {
      cols: 2,
      rows: 2,
      suffix:
        "\n\n请将 4 种不同效果以 2x2 宫格的形式呈现在同一张图片中，每格清晰可辨、无重叠。",
    };
  }
  return {
    cols: 3,
    rows: 3,
    suffix:
      "\n\n请将 9 种不同效果以 3x3 宫格的形式呈现在同一张图片中，每格清晰可辨、无重叠。",
  };
}

function fillSparseSlotsForPreview(
  nested: string[][],
  upTo: number
): string[][] {
  for (let i = 0; i < upTo; i++) {
    if (!Array.isArray(nested[i])) nested[i] = [];
  }
  return nested;
}
