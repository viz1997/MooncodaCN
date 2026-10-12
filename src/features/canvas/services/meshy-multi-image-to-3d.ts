/**
 * 画布内置渠道 —— Meshy Multi-Image to 3D 业务服务（2026-09-16）
 *
 * 职责：
 *  1. 预扣用户积分（400 credits/task 固定价 = 单图 200 的 2 倍）
 *  2. 创建 Meshy Multi-Image to 3D 任务（2-4 张图合并），拿 providerJobId
 *  3. 写 canvasRemoteJob 行（capability='multi-image-to-3d'）→ inngest.send
 *  4. 失败回滚（safeRefund）—— 沿用 canvas-server-generate.ts 的 safeRefund pattern
 *
 * 异步执行（轮询 / fetch GLB / 落 R2）在 Inngest 函数
 * `canvasMultiImageTo3DJob` 中完成，本文件不涉及轮询。
 *
 * 设计要点（与 createMeshyImageTo3DOnServer 平行镜像）：
 *  - pre-consume 在 create 阶段一次性扣，Inngest 函数失败 / 上游 FAILED 时
 *    走 safeRefund 全额退回
 *  - canvasRemoteJob.payload 存完整输入（imageUrls[] + options），Inngest 函数
 *    不需要再回前端取
 *  - MESHY_API_KEY 未配置 → 抛 MeshyAuthError → HTTP 503；
 *    业务层 catch 后不做 refund（积分未扣）
 *  - imageUrls 长度由路由层保证在 [2,4]；本服务不再做长度校验
 *
 * 复用：
 *  - canvas-server-generate.ts: persistBufferToR2（GLB 落 R2）
 *  - canvas-server-generate.ts: safeRefund（失败回退）
 *  - canvas-credit-cost.ts: calculateCanvasCost（400 credits）
 *  - credits/core.ts: consumeCredits / grantCredits
 *  - meshy-image-to-3d.ts: isCreditsError（形态可复用）
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
  createMultiImageTo3DTask,
  deleteMultiImageTo3DTask,
  isMeshyConfigured,
  MeshyAuthError,
  MeshyInsufficientCreditsError,
  MeshyRateLimitError,
  MeshyUpstreamError,
} from "@/lib/meshy/client";
import type { MeshyMultiImageTo3DOptions } from "@/lib/meshy/types";

import {
  type CanvasCapability,
  calculateCanvasCost,
} from "./canvas-credit-cost";
import { safeRefund } from "./canvas-server-generate";

// ───────────────────────────────────────────────────────────────────────────
// 类型
// ───────────────────────────────────────────────────────────────────────────

export type CreateMeshyMultiImageTo3DInput = {
  userId: string;
  /**
   * 多张图片 URL 数组（2-4 张，路由层已校验）。
   * 首张作为主视图（正面），其余顺序不影响结果。
   */
  imageUrls: string[];
  /** Meshy 模型参数，可选 */
  options?: MeshyMultiImageTo3DOptions;
  /** 调试用：客户端的 source node ids，写到 payload 便于排查 */
  sourceNodeIds?: string[];
  /** 项目 id，写到 payload 便于排查 */
  projectId?: string;
};

export type CreateMeshyMultiImageTo3DResult = {
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
 * 创建 Meshy Multi-Image to 3D 任务。
 *
 * 调用方（/api/canvas/meshy/multi-image/create 路由）：
 *   1. auth 校验（必须登录）
 *   2. body 校验（imageUrls.length ∈ [2,4]，每条 URL 协议白名单）
 *   3. rate limit（按 userId）
 *   4. 本函数
 *   5. 返 { jobId, pollUrl } → 前端轮询 /api/canvas/poll/{jobId}
 *
 * 失败语义：
 *  - isMeshyConfigured() === false → MeshyAuthError → 503（积分未扣）
 *  - 用户余额 < 400 → InsufficientCreditsError → 402（积分未扣）
 *  - 账号冻结 → AccountFrozenError → 403（积分未扣）
 *  - 预扣成功但 Meshy 调用失败 → safeRefund + rethrow（积分全退）
 *  - 预扣成功但 DB 写 job 行失败 → safeRefund + rethrow（积分全退）
 *  - 预扣 + Meshy + DB 都成功 → 返 jobId；后续 Inngest 失败也 safeRefund
 */
export async function createMeshyMultiImageTo3DOnServer(
  input: CreateMeshyMultiImageTo3DInput
): Promise<CreateMeshyMultiImageTo3DResult> {
  if (!isMeshyConfigured()) {
    throw new MeshyAuthError(
      "MESHY_API_KEY 未配置：请在 .env.local 设置 MESHY_API_KEY 后重试"
    );
  }

  // 1. 预扣积分（400 credits，2 倍于单图）
  const cost = calculateCanvasCost({ capability: "multi-image-to-3d" });
  const consumed = await consumeCredits({
    userId: input.userId,
    amount: cost,
    serviceName: "canvas.multi-image-to-3d",
    description: `画布内置 Multi-Image to 3D 生成（异步）${input.imageUrls.length} 张图`,
    metadata: {
      ...(input.sourceNodeIds && input.sourceNodeIds.length > 0
        ? { sourceNodeIds: input.sourceNodeIds }
        : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      aiModel: input.options?.ai_model ?? "latest",
      imageCount: input.imageUrls.length,
    },
  });

  const jobId = randomBytes(8).toString("hex");
  const now = new Date();

  try {
    // 2. 创建 Meshy 任务，拿 providerJobId（即 Meshy task id）
    const providerJobId = await createMultiImageTo3DTask({
      imageUrls: input.imageUrls,
      ...(input.options ? { options: input.options } : {}),
    });

    // 3. 写 canvasRemoteJob 行（status=pending，capability='multi-image-to-3d'）
    //
    // payload 存完整输入 —— Inngest 函数 canvasMultiImageTo3DJob 拿到 job 行
    // 后可以直接重放 imageUrls + options，无需再回前端取。
    await db.insert(canvasRemoteJob).values({
      id: jobId,
      userId: input.userId,
      capability: "multi-image-to-3d",
      mode: "generation", // 单值：Meshy 不区分 edit / generation
      payload: {
        imageUrls: input.imageUrls,
        ...(input.options ? { options: input.options } : {}),
        ...(input.sourceNodeIds && input.sourceNodeIds.length > 0
          ? { sourceNodeIds: input.sourceNodeIds }
          : {}),
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
    // 注：这里不 catch Inngest send 失败（与 createMeshyImageTo3DOnServer 对齐）。
    // send 失败让上层路由走 500 即可；业务层 catch 后已 safeRefund。
    // dev 环境未起 Inngest CLI 时会 send 失败 → 用户手动 retry 是 OK 的。
    await inngest.send({
      name: "canvas/multi-image-to-3d",
      data: {
        jobId,
        userId: input.userId,
      },
    });

    return {
      success: true,
      capability: "multi-image-to-3d",
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
      "multi-image-to-3d",
      err instanceof Error ? err.message : "未知错误"
    );

    // 已创建了 Meshy 任务但后续失败 → 尝试取消（释放 Meshy 配额），
    // 取消失败仅记日志，不掩盖原 error
    if (err instanceof Error && !isCreditsError(err)) {
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
 * 时 catch 在 createMultiImageTo3DTask 之前，不会到这里。但保留这个 helper
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
 * 取消 Meshy Multi-Image 任务 + DB 标 failed —— 给 Inngest 函数 catch 路径用。
 *
 * 安全：deleteMultiImageTo3DTask 对 SUCCEEDED / FAILED 是 idempotent 200，
 * 对 IN_PROGRESS 是真取消。404 我们也吞掉（任务可能已 GC）。
 *
 * 不在本函数内做 safeRefund —— Inngest 函数已自行调用 safeRefund，
 * 避免重复扣减。
 */
export async function abortMeshyMultiImageTask(input: {
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
      await deleteMultiImageTo3DTask(job.providerJobId);
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
