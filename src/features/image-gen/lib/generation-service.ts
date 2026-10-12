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
import { logger } from "@/lib/logger";
import {
  buildResultFields,
  dispatchGenerateImage,
  dispatchQueryImageTask,
  extractSubmitContext,
  IMAGE_ADAPTERS,
  IMAGE_MODELS,
  logImageGen,
} from "../";
import { saveGenerationResultsAsAssets } from "./asset-writer";
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
  // 2026-09-03 V1 多图：normalize 成 imageUrls[]，旧 client 只传 imageUrl
  // 的也兼容（包成单元素数组）。adapter 内部只看 imageUrls。
  const imageUrls: string[] | undefined =
    input.imageUrls && input.imageUrls.length > 0
      ? input.imageUrls
      : input.imageUrl
        ? [input.imageUrl]
        : undefined;
  return {
    model: input.model,
    mode: input.mode,
    prompt: input.prompt,
    ...(input.negativePrompt && { negativePrompt: input.negativePrompt }),
    ...(imageUrls && { imageUrls }),
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
 * 提交一次内部生图任务（同步版本，向后兼容旧测试与既有调用方）
 *
 * 流程：
 * 1. 检查文件大小权限
 * 2. 计算积分并扣除
 * 3. 插入 imageJob (pending)
 * 4. **同步**调 dispatchGenerateImage → 更新 imageJob 为终态
 *
 * 新版工作台（/p/[token] 架构）走 `createImageJob` + `triggerImageGenSubmit`
 * 异步路径，不再用本函数。本函数保留只是为了让 src/test/image-gen/generate-api.test.ts
 * 这类纯同步测试能继续验证积分扣除 / 行创建 / 结果同步逻辑。
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

  // 拆出来的两步：先插入，再同步 dispatch
  const createResult = await createImageJob({
    userId,
    input,
    creditsConsumed,
  });
  if (!createResult.success) {
    return createResult;
  }
  const dispatchResult = await dispatchImageGenerationJob({
    jobId: createResult.jobId,
    input,
    ip,
  });
  return dispatchResult;
}

/**
 * 仅创建 imageJob 行（status=pending），不调任何模型。
 *
 * 工作台新流程（/p/[token] 架构）：
 *   action:  createImageJob → send Inngest → 立刻 200 给前端
 *   Inngest: dispatchImageGenerationJob 在后台跑，DB 行推进到终态
 *   前端:   轮询 /api/image-gen/jobs/[jobId]/poll
 *
 * 这样把"submit 撞 Vercel 函数预算"的风险从 HTTP 路径挪到 Inngest 云端，
 * 与 gpt-image /upload 路由的 triggerSubmit 模式对齐。
 */
export async function createImageJob(options: {
  userId: string;
  input: InternalGenerateInput;
  creditsConsumed: number;
}): Promise<GenerateImageJobResult> {
  const { userId, input, creditsConsumed } = options;
  const jobId = crypto.randomUUID();
  const now = new Date();

  // photoId 防御：image_job.photo_id 是 photo.id 的外键（onDelete: set null）。
  // 上传模式曾误传 "LOCAL_UPLOAD" 哨兵导致 FK 违反（2026-08-17 生产事故）。
  // photo.id 是 crypto.randomUUID() 生成的 UUID v4，严格匹配；其它
  // （undefined、占位串、空串）一律写 null。
  const photoId =
    input.photoId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.photoId
    )
      ? input.photoId
      : null;

  await db.insert(imageJob).values({
    id: jobId,
    userId,
    photoId,
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

  return {
    success: true,
    jobId,
    status: "pending",
    creditsConsumed,
  };
}

/**
 * 把 imageJob 行推进：调模型适配器，按返回结果写库。
 *
 * 被两处调用：
 * 1. Inngest 函数 `submitImageGenJob` —— 异步主路径
 * 2. `triggerImageGenSubmit` 的同步 fallback —— Inngest 不可用时降级
 *
 * 失败语义：dispatchGenerateImage 抛错 → imageJob 标 failed + 写 errorMsg，
 * 然后**继续抛**让 Inngest 看到 throw（retries=0 不会重试，仅做记录）。
 */
export async function dispatchImageGenerationJob(options: {
  jobId: string;
  input: InternalGenerateInput;
  ip?: string | undefined;
}): Promise<GenerateImageJobResult> {
  const { jobId, input, ip } = options;
  const req = buildGenerateRequest(input);

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
      creditsConsumed: 0,
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

  // 2026-08-23：生图结果入库到 photo 表（source=generation）—— 让"我的资产"
  // 统一承载本地上传 + 生图结果。仅在 completed + 有图时入库；非致命（imageJob
  // 写入已成功），失败只 warn 不抛。userId 不在 input 里，事后从 imageJob 行取。
  if (
    result.status === "completed" &&
    result.images &&
    result.images.length > 0
  ) {
    try {
      const jobRow = await db.query.imageJob.findFirst({
        where: eq(imageJob.id, jobId),
        columns: { id: true, userId: true, prompt: true, model: true },
      });
      if (jobRow) {
        await saveGenerationResultsAsAssets({
          jobId: jobRow.id,
          userId: jobRow.userId,
          resultUrls: result.images.map((img) => img.url),
          prompt: jobRow.prompt,
          model: jobRow.model,
        });
      }
    } catch (err) {
      logger.warn(
        { err, jobId },
        "生图结果入库到 photo 失败，仅 imageJob.resultUrls 写入已成功（前端仍可见结果，「我的资产」会缺失该次生成图）"
      );
    }
  }

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
    creditsConsumed: 0,
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

  // 2026-08-23：生图结果入库到 photo 表（source=generation），与同步路径对齐。
  // 失败非致命，仅 warn —— imageJob.resultUrls 是前端可见结果的权威来源。
  if (
    result.status === "completed" &&
    result.images &&
    result.images.length > 0
  ) {
    try {
      await saveGenerationResultsAsAssets({
        jobId: job.id,
        userId: job.userId,
        resultUrls: result.images.map((img) => img.url),
        prompt: job.prompt,
        model: job.model,
      });
    } catch (err) {
      logger.warn(
        { err, jobId: job.id },
        "生图结果入库到 photo 失败（异步 polling 路径），仅 imageJob.resultUrls 写入已成功"
      );
    }
  }
}

/**
 * 把 imageJob 往前推一步（轮询入口）。
 *
 * 流程（与 gpt-image 的 advanceOrderGeneration 同语义，但 imageJob 只有一个
 * taskId 而不是 JSON 任务列表，更简单）：
 * 1. 读 imageJob
 * 2. 如果 status=processing 且有 taskId：
 *    - 直接用 job.model 列决定走哪个 adapter（DB 已经存了，不从 taskId 反推）
 *    - dispatchQueryImageTask 调上游一次
 *    - updateImageJobFromTaskResult 把结果落库
 * 3. 返回推进后的最新 job 行
 *
 * 无 taskId / 非 processing：直接返回原行（幂等）。
 *
 * 由 /api/image-gen/jobs/[jobId]/poll 路由调用 —— 与 /p/[token] 的
 * /api/orders/[token]/poll 路由对称。
 *
 * 为什么不从 taskId 反推 model：gpt_image_2 的 taskId 是 wellapi/Lingting
 * 真实任务 id（不是 imgtask_xxx 格式），parseTaskModel 永远返 null，
 * 那条 if 分支会被静默跳过 —— imageJob 永远卡 processing。这就是
 * 「image-gen 工作台卡住而 /p/[token] 正常」的根因。/p/[token] 走
 * promptOrder.generationTask 列表 + Lingting 自己的 task_id，根本不依赖
 * parseTaskModel。
 */
export async function advanceImageGenJob(jobId: string): Promise<ImageJob> {
  const job = await db.query.imageJob.findFirst({
    where: eq(imageJob.id, jobId),
  });

  if (!job) {
    throw new Error(`imageJob ${jobId} 不存在`);
  }

  // 只在 processing + 有 taskId 时才需要打上游
  if (job.status === "processing" && job.taskId) {
    // imageJob.model 列已经存了创建时的 model id —— 直接用，不从 taskId 反推。
    const model = job.model as ImageModelId;
    if (model in IMAGE_ADAPTERS) {
      try {
        const upstream = await dispatchQueryImageTask(model, job.taskId);
        await updateImageJobFromTaskResult(job.taskId, upstream);
      } catch (err) {
        // 单次查询失败不能让 /poll 整条挂掉 —— 下次再试
        // eslint-disable-next-line no-console
        console.warn("[advanceImageGenJob] query failed:", err);
      }
    }
  }

  // 再读一次拿最新状态
  const updated = await db.query.imageJob.findFirst({
    where: eq(imageJob.id, jobId),
  });
  if (!updated) {
    throw new Error(`imageJob ${jobId} 推进后丢失`);
  }
  return updated;
}

/**
 * 带校验的 imageJob 创建 —— 提交流程的"前半段"，被 generateImageAction 调用。
 *
 * 步骤：
 * 1. 模型维护检查
 * 2. Plan 文件大小权限
 * 3. createImageJob 写库（status=pending, creditsConsumed=0）
 *
 * 与旧 generateImageJob 的区别：本函数只到"插入 pending 行"为止，
 * 后续的 dispatch 由 triggerImageGenSubmit 异步触发。
 *
 * 注意：此路径不扣积分（2026-08-17 应用户要求去除）。
 * 积分系统仍由 gpt-image 链路消费，本工作台按"免费内部工具"对待。
 */
export async function createImageJobWithValidation(options: {
  userId: string;
  input: InternalGenerateInput;
}): Promise<GenerateImageJobResult> {
  const { userId, input } = options;

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

  // 工作台不扣积分 —— 内部工具性质，不走计费
  return createImageJob({ userId, input, creditsConsumed: 0 });
}
