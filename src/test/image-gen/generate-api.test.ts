/**
 * 内部生图 API 测试
 *
 * 测试范围：
 * - generateImageJob 积分扣除与 imageJob 创建
 * - listImageJobs / getImageJob 查询
 * - 异步任务结果同步到 imageJob
 */

import { afterAll, describe, expect, it } from "vitest";
import {
  generateImageJob,
  getImageJob,
  listImageJobs,
  updateImageJobFromTaskResult,
} from "@/features/image-gen/lib/generation-service";
import type { GenerateImageResult } from "@/features/image-gen/lib/image-models/types";
import {
  cleanupUserImageGenData,
  createTestPhoto,
  createTestProductEffect,
  createTestUserWithCredits,
} from "../utils";

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const userId of createdUserIds) {
    await cleanupUserImageGenData(userId);
  }
});

describe("Internal Image Generation", () => {
  it("应该为登录用户创建生图任务并扣除积分", async () => {
    const { user } = await createTestUserWithCredits({ initialCredits: 1000 });
    createdUserIds.push(user.id);

    const effect = await createTestProductEffect({
      id: `test_mask_${Date.now()}`,
    });

    const result = await generateImageJob({
      userId: user.id,
      input: {
        model: "doubao",
        mode: "text_to_image",
        prompt: effect.prompt,
        size: "1024x1024",
        batchSize: 1,
        maskId: effect.id,
        enableSafetyCheck: true,
        watermark: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.jobId).toBeDefined();
    expect(result.creditsConsumed).toBeGreaterThan(0);

    const job = await getImageJob(user.id, result.jobId);
    expect(job).toBeDefined();
    expect(job?.userId).toBe(user.id);
    expect(job?.maskId).toBe(effect.id);
    expect(job?.creditsConsumed).toBe(result.creditsConsumed);
  });

  it("应该列出用户的生图任务", async () => {
    const { user } = await createTestUserWithCredits({ initialCredits: 1000 });
    createdUserIds.push(user.id);

    await generateImageJob({
      userId: user.id,
      input: {
        model: "doubao",
        mode: "text_to_image",
        prompt: "test prompt",
        size: "1024x1024",
        batchSize: 1,
        enableSafetyCheck: true,
        watermark: false,
      },
    });

    const jobs = await listImageJobs(user.id);
    expect(jobs.length).toBeGreaterThan(0);
  });

  it("应该支持带参考图的照片 ID", async () => {
    const { user } = await createTestUserWithCredits({ initialCredits: 1000 });
    createdUserIds.push(user.id);

    const testPhoto = await createTestPhoto({ userId: user.id });

    const result = await generateImageJob({
      userId: user.id,
      input: {
        model: "doubao",
        mode: "image_to_image",
        prompt: "convert to relief",
        size: "1024x1024",
        batchSize: 1,
        photoId: testPhoto.id,
        imageUrl: testPhoto.fileUrl,
        enableSafetyCheck: true,
        watermark: false,
      },
    });

    expect(result.success).toBe(true);

    const job = await getImageJob(user.id, result.jobId);
    expect(job?.photoId).toBe(testPhoto.id);
  });

  it("应该将异步任务结果同步到 imageJob", async () => {
    const { user } = await createTestUserWithCredits({ initialCredits: 1000 });
    createdUserIds.push(user.id);

    const result = await generateImageJob({
      userId: user.id,
      input: {
        model: "flux1",
        mode: "text_to_image",
        prompt: "async task test",
        size: "1024x1024",
        batchSize: 1,
        enableSafetyCheck: true,
        watermark: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.taskId).toBeDefined();

    const mockResult: GenerateImageResult = {
      success: true,
      model: "flux1",
      status: "completed",
      images: [{ url: "https://example.com/result.png" }],
      duration: 5000,
      cost: 0.05,
      currency: "USD",
    };

    await updateImageJobFromTaskResult(result.taskId!, mockResult);

    const job = await getImageJob(user.id, result.jobId);
    expect(job?.status).toBe("completed");
    expect(job?.resultUrls).toContain("https://example.com/result.png");
    expect(job?.completedAt).not.toBeNull();
  });
});
