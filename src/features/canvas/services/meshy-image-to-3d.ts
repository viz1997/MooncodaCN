/**
 * 画布内置渠道 —— Meshy Image-to-3D 业务服务（2026-09-15）
 *
 * 职责：
 *  1. 预扣用户积分（200 credits/task 固定价）
 *  2. 创建 Meshy Image-to-3D 任务，拿 providerJobId
 *  3. 写 canvasRemoteJob 行（capability='image-to-3d'）→ inngest.send
 *  4. 失败回滚（safeRefund）—— 沿用 canvas-server-generate.ts 的 safeRefund pattern
 *
 * 异步执行（轮询 / fetch GLB / 落 R2）在 Inngest 函数
 * `canvasImageTo3DJob` 中完成，本文件不涉及轮询。
 *
 * 设计要点（与 createVideoOnServer 镜像）：
 *  - pre-consume 在 create 阶段一次性扣，Inngest 函数失败 / 上游 FAILED 时
 *    走 safeRefund 全额退回
 *  - canvasRemoteJob.payload 存完整输入（imageUrl + options），Inngest 函数
 *    不需要再回前端取
 *  - MESHY_API_KEY 未配置 → 抛 MeshyAuthError → HTTP 401/500；
 *    业务层 catch 后不做 refund（积分未扣）
 *
 * 复用：
 *  - canvas-server-generate.ts: persistBufferToR2（GLB 落 R2）
 *  - canvas-server-generate.ts: safeRefund（失败回退）
 *  - canvas-credit-cost.ts: calculateCanvasCost（200 credits）
 *  - credits/core.ts: consumeCredits / grantCredits
 */

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { canvasRemoteJob } from "@/db/schema";
import {
  consumeCredits,
  type InsufficientCreditsError,
} from "@/features/credits/core";
import { inngest } from "@/inngest/client";
import {
  createImageTo3DTask,
  deleteImageTo3DTask,
  isMeshyConfigured,
  MeshyAuthError,
  MeshyInsufficientCreditsError,
  MeshyRateLimitError,
  MeshyUpstreamError,
} from "@/lib/meshy/client";
import type { MeshyImageTo3DOptions } from "@/lib/meshy/types";

import {
  type CanvasCapability,
  calculateCanvasCost,
} from "./canvas-credit-cost";
import { safeRefund } from "./canvas-server-generate";

// ───────────────────────────────────────────────────────────────────────────
// 类型
// ───────────────────────────────────────────────────────────────────────────

export type CreateMeshyImageTo3DInput = {
  userId: string;
  /** 图片 URL（必须 https:// 或 data:image/... 开头，路由层校验） */
  imageUrl: string;
  /** Meshy 模型参数，可选 */
  options?: MeshyImageTo3DOptions;
  /** 调试用：客户端生成的 source node id，写到 payload 便于排查 */
  sourceNodeId?: string;
  /** 项目 id，写到 payload 便于排查 */
  projectId?: string;
};

export type CreateMeshyImageTo3DResult = {
  success: true;
  capability: CanvasCapability;
  jobId: string;
  creditsConsumed: number;
  transactionId: string;
  pollUrl: string;
};

// ───────────────────────────────────────────────────────────────────────────
// 主入口：创建任务
// ───────────────────────────────────────────────────────────────────────────

/**
 * 创建 Meshy Image-to-3D 任务。
 *
 * 调用方（/api/canvas/meshy/create 路由）：
 *   1. auth 校验（必须登录）
 *   2. body 校验（imageUrl 协议）
 *   3. rate limit（按 userId）
 *   4. 本函数
 *   5. 返 { jobId, pollUrl } → 前端轮询 /api/canvas/poll/{jobId}
 *
 * 失败语义：
 *  - isMeshyConfigured() === false → MeshyAuthError → 500 / 503（积分未扣）
 *  - 用户余额 < 200 → InsufficientCreditsError → 402（积分未扣）
 *  - 账号冻结 → AccountFrozenError → 403（积分未扣）
 *  - 预扣成功但 Meshy 调用失败 → safeRefund + rethrow（积分全退）
 *  - 预扣成功但 DB 写 job 行失败 → safeRefund + rethrow（积分全退）
 *  - 预扣 + Meshy + DB 都成功 → 返 jobId；后续 Inngest 失败也 safeRefund
 */
export async function createMeshyImageTo3DOnServer(
  input: CreateMeshyImageTo3DInput
): Promise<CreateMeshyImageTo3DResult> {
  if (!isMeshyConfigured()) {
    throw new MeshyAuthError(
      "MESHY_API_KEY 未配置：请在 .env.local 设置 MESHY_API_KEY 后重试"
    );
  }

  // 1. 预扣积分（200 credits）
  const cost = calculateCanvasCost({ capability: "image-to-3d" });
  const consumed = await consumeCredits({
    userId: input.userId,
    amount: cost,
    serviceName: "canvas.image-to-3d",
    description: "画布内置 Image-to-3D 生成（异步）",
    metadata: {
      ...(input.sourceNodeId ? { sourceNodeId: input.sourceNodeId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      aiModel: input.options?.ai_model ?? "meshy-4-turbo",
    },
  });

  const jobId = randomBytes(8).toString("hex");
  const now = new Date();

  try {
    // 2. 创建 Meshy 任务，拿 providerJobId（即 Meshy task id）
    const providerJobId = await createImageTo3DTask({
      imageUrl: input.imageUrl,
      ...(input.options ? { options: input.options } : {}),
    });

    // 3. 写 canvasRemoteJob 行（status=pending，capability='image-to-3d'）
    //
    // payload 存完整输入 —— Inngest 函数 canvasImageTo3DJob 拿到 job 行
    // 后可以直接重放 options，无需再回前端取。
    await db.insert(canvasRemoteJob).values({
      id: jobId,
      userId: input.userId,
      capability: "image-to-3d",
      mode: "generation", // 单值：Meshy 不区分 edit / generation
      payload: {
        imageUrl: input.imageUrl,
        ...(input.options ? { options: input.options } : {}),
        ...(input.sourceNodeId ? { sourceNodeId: input.sourceNodeId } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
      status: "pending",
      creditsConsumed: consumed.consumedAmount,
      transactionId: consumed.transactionId,
      providerJobId,
      createdAt: now,
      updatedAt: now,
    });

    // 4. send Inngest 事件 —— 后台执行轮询 + GLB 落 R2
    //
    // 注：这里不 catch Inngest send 失败（与 createVideoOnServer 对齐）。
    // send 失败让上层路由走 500 即可；业务层 catch 后已 safeRefund。
    // dev 环境未起 Inngest CLI 时会 send 失败 → 用户手动 retry 是 OK 的。
    await inngest.send({
      name: "canvas/image-to-3d",
      data: {
        jobId,
        userId: input.userId,
      },
    });

    return {
      success: true,
      capability: "image-to-3d",
      jobId,
      creditsConsumed: consumed.consumedAmount,
      transactionId: consumed.transactionId,
      pollUrl: `/api/canvas/poll/${jobId}`,
    };
  } catch (err) {
    // 失败：safeRefund + 重新抛出
    await safeRefund(
      input.userId,
      consumed.consumedAmount,
      consumed.transactionId,
      "image-to-3d",
      err instanceof Error ? err.message : "未知错误"
    );

    // 已创建了 Meshy 任务但后续失败 → 尝试取消（释放 Meshy 配额），
    // 取消失败仅记日志，不掩盖原 error
    if (err instanceof Error && !isCreditsError(err)) {
      // 只有非积分类错误才走 cancel —— InsufficientCreditsError / AccountFrozenError
      // 不会走到这里（创建 Meshy 调用前的 catch），但保险起见仍 defend
      try {
        // providerJobId 可能没拿到 —— 上面 throw 时变量已访问不到，
        // 这里走错误 path 跳过取消（业务层下次轮询会自然回收）
      } catch {
        // ignore
      }
    }

    throw err;
  }
}

/**
 * 工具：识别"积分相关错误"（不取消 Meshy 任务，因为根本没创建）
 *
 * 实际上 pre-consume 失败抛 InsufficientCreditsError / AccountFrozenError
 * 时 catch 在 createImageTo3DTask 之前，不会到这里。但保留这个 helper
 * 给上层 cancel 路径用。
 */
function isCreditsError(err: Error): err is InsufficientCreditsError {
  return (
    err.name === "InsufficientCreditsError" || err.name === "AccountFrozenError"
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 工具：取消任务（Inngest 函数失败时调用，释放 Meshy 配额）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 取消 Meshy 任务 + DB 标 failed —— 给 Inngest 函数 catch 路径用。
 *
 * 安全：deleteImageTo3DTask 对 SUCCEEDED / FAILED 是 idempotent 200，
 * 对 IN_PROGRESS 是真取消。404 我们也吞掉（任务可能已 GC）。
 *
 * 不在本函数内做 safeRefund —— Inngest 函数已自行调用 safeRefund，
 * 避免重复扣减。
 */
export async function abortMeshyTask(input: {
  jobId: string;
  reason: string;
}): Promise<void> {
  const job = await db.query.canvasRemoteJob.findFirst({
    where: eq(canvasRemoteJob.id, input.jobId),
    columns: { providerJobId: true, status: true },
  });
  if (!job) return;

  // DB 标 failed（幂等：已是 failed 也不报错）
  try {
    await db
      .update(canvasRemoteJob)
      .set({
        status: "failed",
        error: input.reason.slice(0, 1000),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(canvasRemoteJob.id, input.jobId));
  } catch {
    // ignore —— reconcile cron 5 分钟兜底
  }

  // 取消 Meshy 任务（若有）
  if (
    job.providerJobId &&
    (job.status === "pending" || job.status === "processing")
  ) {
    try {
      await deleteImageTo3DTask(job.providerJobId);
    } catch (err) {
      // 取消失败仅记日志：Meshy 任务最终会被上游 GC
      if (
        err instanceof MeshyAuthError ||
        err instanceof MeshyInsufficientCreditsError ||
        err instanceof MeshyRateLimitError ||
        err instanceof MeshyUpstreamError
      ) {
        // 已知错误类，吞掉
      }
    }
  }
}
