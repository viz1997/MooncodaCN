/**
 * 内部生图业务服务
 *
 * 封装登录用户的生图流程：
 * 校验 → 检查 Plan 权限 → 计算并扣除积分 → 调用模型适配器 → 写入 imageJob
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { type ImageJob, imageJob } from "@/db/schema";
import { consumeCredits } from "@/features/credits/core";
import { checkFileSizePrivilege } from "@/features/subscription/services/user-plan";
import {
  buildResultFields,
  dispatchGenerateImage,
  extractSubmitContext,
  IMAGE_MODELS,
  logImageGen,
} from "../";
import { updateEffectUsageStats } from "./db-effects";
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageModelId,
} from "./image-models/types";
import type { InternalGenerateInput } from "./validation";

/**
 * 美元到人民币估算汇率
 *
 * 仅用于积分折算，后续可改为运营配置
 */
const USD_TO_CNY = 7.2;

/**
 * 将模型单张价格折算为积分
 *
 * 规则：1 积分 = 0.001 CNY
 * - CNY 模型：price * 1000
 * - USD 模型：price * USD_TO_CNY * 1000
 */
function calculateCreditsCost(
  modelId: ImageModelId,
  batchSize: number
): number {
  const config = IMAGE_MODELS[modelId];
  const cnyPrice =
    config.currency === "CNY"
      ? config.pricePerImage
      : config.pricePerImage * USD_TO_CNY;
  return Math.ceil(cnyPrice * 1000 * batchSize);
}

/**
 * 构建 GenerateImageRequest
 */
function buildGenerateRequest(
  input: InternalGenerateInput
): GenerateImageRequest {
  return {
    model: input.model,
    mode: input.mode,
    prompt: input.prompt,
    ...(input.negativePrompt && { negativePrompt: input.negativePrompt }),
    ...(input.imageUrl && { imageUrl: input.imageUrl }),
    ...(input.maskUrl && { maskUrl: input.maskUrl }),
    size: input.size,
    ...(input.customWidth && { customWidth: input.customWidth }),
    ...(input.customHeight && { customHeight: input.customHeight }),
    ...(input.style && { style: input.style }),
    batchSize: input.batchSize,
    ...(input.seed !== undefined && { seed: input.seed }),
    ...(input.guidanceScale && { guidanceScale: input.guidanceScale }),
    ...(input.numInferenceSteps && {
      numInferenceSteps: input.numInferenceSteps,
    }),
    enableSafetyCheck: input.enableSafetyCheck,
    watermark: input.watermark,
    ...(input.maskId && { maskId: input.maskId }),
    ...(input.photoId && { photoId: input.photoId }),
  };
}

export interface GenerateImageJobOptions {
  userId: string;
  input: InternalGenerateInput;
  ip?: string | undefined;
}

export interface GenerateImageJobResult {
  success: boolean;
  jobId: string;
  taskId?: string | undefined;
  status: ImageJob["status"];
  images?: GenerateImageResult["images"];
  error?: string | undefined;
  creditsConsumed: number;
}

/**
 * 提交一次内部生图任务
 *
 * 1. 检查文件大小权限（如有参考图 URL，尝试估算大小；实际生产建议在上传时记录）
 * 2. 计算积分并扣除
 * 3. 调用模型适配器
 * 4. 创建 imageJob 记录
 */
export async function generateImageJob(
  options: GenerateImageJobOptions
): Promise<GenerateImageJobResult> {
  const { userId, input, ip } = options;

  const modelConfig = IMAGE_MODELS[input.model];
  if (modelConfig.status === "maintenance") {
    return {
      success: false,
      jobId: "",
      status: "failed",
      error: "模型维护中，请稍后再试",
      creditsConsumed: 0,
    };
  }

  // Plan 文件大小权限检查（参考图场景）
  // 由于前端上传后通常已知 fileSize，这里传 0 表示不检查；生产可要求前端/上传接口提供
  const fileSizeCheck = await checkFileSizePrivilege(userId, 0);
  if (!fileSizeCheck.allowed) {
    return {
      success: false,
      jobId: "",
      status: "failed",
      error: fileSizeCheck.errorMessage ?? "当前计划不支持此操作",
      creditsConsumed: 0,
    };
  }

  const creditsConsumed = calculateCreditsCost(input.model, input.batchSize);

  // 扣积分
  const consumeResult = await consumeCredits({
    userId,
    amount: creditsConsumed,
    serviceName: "image-generation",
    description: `生图: ${modelConfig.name}`,
    metadata: {
      model: input.model,
      mode: input.mode,
      maskId: input.maskId,
      photoId: input.photoId,
      batchSize: input.batchSize,
      size: input.size,
    },
  });

  if (!consumeResult.success) {
    return {
      success: false,
      jobId: "",
      status: "failed",
      error: "积分扣除失败",
      creditsConsumed: 0,
    };
  }

  const req = buildGenerateRequest(input);
  const jobId = crypto.randomUUID();
  const now = new Date();

  // 先创建 pending 记录
  await db.insert(imageJob).values({
    id: jobId,
    userId,
    photoId: input.photoId ?? null,
    maskId: input.maskId ?? null,
    model: input.model,
    mode: input.mode,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt ?? null,
    imageUrl: input.imageUrl ?? null,
    size: input.size,
    batchSize: input.batchSize,
    seed: input.seed ?? null,
    guidanceScale: input.guidanceScale ?? null,
    numInferenceSteps: input.numInferenceSteps ?? null,
    status: "pending",
    resultUrls: [],
    creditsConsumed,
    createdAt: now,
    completedAt: null,
  });

  // 调用模型适配器
  let result: GenerateImageResult;
  try {
    result = await dispatchGenerateImage(req);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "模型调用失败";
    await db
      .update(imageJob)
      .set({ status: "failed", errorMsg: msg, completedAt: new Date() })
      .where(eq(imageJob.id, jobId));

    logImageGen({
      ...extractSubmitContext(req, "internal"),
      ...buildResultFields({
        success: false,
        model: input.model,
        status: "failed",
        error: msg,
      }),
      ip,
    });

    return {
      success: false,
      jobId,
      status: "failed",
      error: msg,
      creditsConsumed,
    };
  }

  // 更新 imageJob 为最终结果
  const updateData: Partial<typeof imageJob.$inferInsert> = {
    status: result.status,
    resultUrls: result.images?.map((img) => img.url) ?? [],
    generateDuration: result.duration ?? null,
    cost: result.cost ? Math.round(result.cost * 1000) : null,
    currency: result.currency ?? null,
    taskId: result.taskId ?? null,
    completedAt:
      result.status === "completed" || result.status === "failed"
        ? new Date()
        : null,
  };

  if (!result.success) {
    updateData.errorMsg = result.error ?? "生成失败";
  }

  await db.update(imageJob).set(updateData).where(eq(imageJob.id, jobId));

  logImageGen({
    ...extractSubmitContext(req, "internal"),
    ...buildResultFields(result),
    ip,
  });

  // 若任务关联了产品效果，自动更新效果统计
  if (
    input.maskId &&
    (result.status === "completed" || result.status === "failed")
  ) {
    await updateEffectUsageStats(input.maskId, {
      success: result.success,
      durationMs: result.duration ?? 0,
    });
  }

  return {
    success: result.success,
    jobId,
    taskId: result.taskId,
    status: result.status,
    images: result.images,
    error: result.error,
    creditsConsumed,
  };
}

/**
 * 查询当前用户的生图任务列表
 */
export async function listImageJobs(
  userId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<ImageJob[]> {
  const { limit = 50, offset = 0 } = options;

  return db.query.imageJob.findMany({
    where: eq(imageJob.userId, userId),
    orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
    limit,
    offset,
  });
}

/**
 * 获取单个任务（带用户权限校验）
 */
export async function getImageJob(
  userId: string,
  jobId: string
): Promise<ImageJob | undefined> {
  const row = await db.query.imageJob.findFirst({
    where: eq(imageJob.id, jobId),
  });

  if (!row || row.userId !== userId) return undefined;
  return row;
}

/**
 * 更新异步任务状态
 *
 * 由 /api/image/task/[id] 在查询到终态时调用
 */
export async function updateImageJobFromTaskResult(
  taskId: string,
  result: GenerateImageResult
): Promise<void> {
  const rows = await db.query.imageJob.findMany({
    where: eq(imageJob.taskId, taskId),
    limit: 1,
  });

  const job = rows[0];
  if (!job) return;

  const isTerminal =
    result.status === "completed" || result.status === "failed";

  await db
    .update(imageJob)
    .set({
      status: result.status,
      resultUrls: result.images?.map((img) => img.url) ?? [],
      generateDuration: result.duration ?? job.generateDuration,
      cost: result.cost ? Math.round(result.cost * 1000) : job.cost,
      currency: result.currency ?? job.currency,
      errorMsg: result.success ? null : (result.error ?? job.errorMsg),
      completedAt: isTerminal ? new Date() : job.completedAt,
    })
    .where(eq(imageJob.id, job.id));
}
