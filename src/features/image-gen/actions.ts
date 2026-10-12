"use server";

/**
 * 生图业务 Server Actions
 *
 * 供 Dashboard 工作台/照片/效果页面调用
 */

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { photo } from "@/db/schema";
import { protectedAction } from "@/lib/safe-action";

import {
  createImageJobWithValidation,
  getImageJob,
  listImageJobs,
  updateImageJobFromTaskResult,
} from "./lib/generation-service";
import { triggerImageGenSubmit } from "./lib/submit";
import { createPhotoSchema, internalGenerateSchema } from "./lib/validation";

const withImageGenAction = (name: string) =>
  protectedAction.metadata({ action: `imageGen.${name}` });

/**
 * 提交生图任务（/p/[token] 架构版）
 *
 * 链路：
 *   1. 同步校验：模型维护 / 文件大小 / 积分扣除
 *   2. createImageJob 写 imageJob (pending) 行
 *   3. triggerImageGenSubmit  → inngest.send（或同步 fallback）
 *   4. 立刻返 jobId 给前端 —— 此时 imageJob 状态还是 pending，submit
 *      在 Inngest cloud 异步跑 / 在 dev 同步 fallback 跑
 *
 * 与旧 `generateImageJob`（含同步 dispatch）的区别：HTTP 路径不再等
 * dispatchGenerateImage。submit 撞 Vercel 函数预算的风险移到 Inngest。
 */
export const generateImageAction = withImageGenAction("generate")
  .schema(internalGenerateSchema)
  .action(async ({ parsedInput, ctx }) => {
    const result = await createImageJobWithValidation({
      userId: ctx.userId,
      input: parsedInput,
    });

    if (!result.success) {
      throw new Error(result.error ?? "生成失败");
    }

    // 触发 Inngest submit（开发环境无 Inngest 时降级为同步 dispatch）
    const { mode: triggerMode } = await triggerImageGenSubmit(
      result.jobId,
      parsedInput
    );

    revalidatePath("/dashboard/effects");

    return {
      jobId: result.jobId,
      status: "pending" as const,
      creditsConsumed: result.creditsConsumed,
      triggerMode,
    };
  });

/**
 * 查询当前用户的生图任务列表
 */
export const listImageJobsAction = withImageGenAction("listJobs")
  .schema(
    z
      .object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
      })
      .optional()
  )
  .action(async ({ parsedInput, ctx }) => {
    const jobs = await listImageJobs(ctx.userId, {
      ...(parsedInput?.limit !== undefined && { limit: parsedInput.limit }),
      ...(parsedInput?.offset !== undefined && { offset: parsedInput.offset }),
    });

    return { jobs };
  });

/**
 * 获取单个任务详情
 */
export const getImageJobAction = withImageGenAction("getJob")
  .schema(z.object({ jobId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const job = await getImageJob(ctx.userId, parsedInput.jobId);
    if (!job) {
      throw new Error("任务不存在");
    }
    return { job };
  });

/**
 * 轮询并刷新异步任务状态
 */
export const pollImageJobAction = withImageGenAction("pollJob")
  .schema(z.object({ jobId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const job = await getImageJob(ctx.userId, parsedInput.jobId);
    if (!job) {
      throw new Error("任务不存在");
    }

    // 只有关联了 taskId 且处于 processing 时才需要查询
    if (!job.taskId || job.status !== "processing") {
      return { job };
    }

    const { dispatchQueryImageTask, parseTaskModel } = await import(
      "./lib/image-models/adapters"
    );

    const model = parseTaskModel(job.taskId);
    if (!model) {
      throw new Error("任务模型解析失败");
    }

    const result = await dispatchQueryImageTask(model, job.taskId);
    await updateImageJobFromTaskResult(job.taskId, result);

    const updatedJob = await getImageJob(ctx.userId, parsedInput.jobId);
    return { job: updatedJob ?? job };
  });

/**
 * 创建照片记录（上传成功后回调）
 */
export const createPhotoAction = withImageGenAction("createPhoto")
  .schema(createPhotoSchema)
  .action(async ({ parsedInput, ctx }) => {
    const [created] = await db
      .insert(photo)
      .values({
        id: crypto.randomUUID(),
        userId: ctx.userId,
        fileName: parsedInput.fileName,
        fileUrl: parsedInput.fileUrl,
        thumbnailUrl: parsedInput.thumbnailUrl ?? null,
        md5: parsedInput.md5 ?? null,
        width: parsedInput.width ?? null,
        height: parsedInput.height ?? null,
        format: parsedInput.format ?? null,
        fileSize: parsedInput.fileSize ?? null,
      })
      .returning();

    if (!created) {
      throw new Error("创建照片记录失败");
    }

    revalidatePath("/dashboard/photos");
    return { photo: created };
  });

/**
 * 获取当前用户的照片列表
 */
export const listPhotosAction = withImageGenAction("listPhotos")
  .schema(
    z
      .object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
      })
      .optional()
  )
  .action(async ({ parsedInput, ctx }) => {
    const { limit = 50, offset = 0 } = parsedInput ?? {};

    const photos = await db.query.photo.findMany({
      where: eq(photo.userId, ctx.userId),
      orderBy: [desc(photo.createdAt)],
      limit,
      offset,
    });

    return { photos };
  });

/**
 * 删除照片
 */
export const deletePhotoAction = withImageGenAction("deletePhoto")
  .schema(z.object({ photoId: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const result = await db
      .delete(photo)
      .where(
        and(eq(photo.id, parsedInput.photoId), eq(photo.userId, ctx.userId))
      )
      .returning();

    if (result.length === 0) {
      throw new Error("照片不存在或无权删除");
    }

    revalidatePath("/dashboard/photos");
    return { success: true };
  });
