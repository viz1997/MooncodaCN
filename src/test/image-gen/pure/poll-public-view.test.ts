/**
 * 2026-10-14 外部轮询响应投影 —— 纯函数单元测试
 *
 * 上一版 /api/image-gen/jobs/[jobId]/poll 把 imageJob 全行返给 x-api-key
 * 客户端,泄露上游 provider 名称 + apimart request_id + 内部 model /
 * prompt / cost 等。本测试聚焦 todo:
 *     1) toPublicJobView 投影字段正确(completed → resultUrls, failed → errorMessage,
 *        pending/processing → 不带结果字段)
 *     2) sanitizeExternalFailureMessage 严格脱敏上游指纹
 *         - JSON 对象(以 `{` 开头)
 *         - apimart / request_id / build_request_failed / "submit 500" 关键字
 *         - null / undefined / 空字符串 → 通用文案
 *         - 业务文案(例 "积分不足")保留原文
 */

import { describe, expect, it } from "vitest";

import {
  EXTERNAL_EMPTY_FAILURE_MESSAGE,
  EXTERNAL_GENERIC_FAILURE_MESSAGE,
  type ImageJobRow,
  sanitizeExternalFailureMessage,
  toPublicJobView,
} from "@/features/image-gen/lib/poll-public-view";

// imageJob $inferSelect 是 timestamp(string|...),测试 fixture 简化
function makeJob(overrides: Partial<ImageJobRow>): ImageJobRow {
  return {
    id: "job-1",
    userId: null,
    photoId: null,
    maskId: "MASK_1",
    model: "apimart_gpt_image",
    mode: "image_to_image",
    prompt: "SECRET PROMPT",
    negativePrompt: null,
    imageUrl: "https://r2.example.com/signed/abc?sig=xyz",
    size: "1024x1024",
    batchSize: 1,
    seed: 42,
    guidanceScale: 7,
    numInferenceSteps: 30,
    status: "pending",
    resultUrls: [],
    revisedPrompt: null,
    errorMsg: null,
    generateDuration: null,
    cost: 999,
    currency: "USD",
    creditsConsumed: 5,
    taskId: "internal-task-id",
    createdAt: new Date("2026-10-14T00:00:00Z"),
    completedAt: null,
    ...overrides,
  };
}

describe("toPublicJobView", () => {
  it("completed → 透传 resultUrls,不暴露内部字段", () => {
    const view = toPublicJobView(
      makeJob({
        status: "completed",
        resultUrls: ["https://r2.example.com/out/1.webp"],
        completedAt: new Date("2026-10-14T00:01:00Z"),
        generateDuration: 1234,
      })
    );
    expect(view.id).toBe("job-1");
    expect(view.status).toBe("completed");
    expect(view.resultUrls).toEqual(["https://r2.example.com/out/1.webp"]);
    expect(view.generateDuration).toBe(1234);
    expect(view.completedAt).toEqual(new Date("2026-10-14T00:01:00Z"));
    expect(view.errorMessage).toBeNull();
    // @ts-expect-error 投影故意不带这些内部字段
    expect(view.model).toBeUndefined();
    // @ts-expect-error
    expect(view.prompt).toBeUndefined();
    // @ts-expect-error
    expect(view.imageUrl).toBeUndefined();
    // @ts-expect-error
    expect(view.errorMsg).toBeUndefined();
    // @ts-expect-error
    expect(view.userId).toBeUndefined();
    // @ts-expect-error
    expect(view.cost).toBeUndefined();
    // @ts-expect-error
    expect(view.creditsConsumed).toBeUndefined();
    // @ts-expect-error
    expect(view.taskId).toBeUndefined();
    // @ts-expect-error
    expect(view.seed).toBeUndefined();
    // @ts-expect-error
    expect(view.guidanceScale).toBeUndefined();
    // @ts-expect-error
    expect(view.numInferenceSteps).toBeUndefined();
    // @ts-expect-error
    expect(view.maskId).toBeUndefined();
  });

  it("failed → resultUrls 空数组 + errorMessage 走 sanitize", () => {
    const view = toPublicJobView(
      makeJob({
        status: "failed",
        // 2026-10-14 用户上报的真实污染字符串
        errorMsg:
          '提交生图失败：apimart submit 500: {"error":{"code":"build_request_failed","message":"prepare image_urls[0] failed: failed to download image: HTTP 403","param":"","type":"build_request_failed"},"request_id":"20261014145519621188625rL5j5av5"}',
      })
    );
    expect(view.status).toBe("failed");
    expect(view.resultUrls).toEqual([]);
    expect(view.errorMessage).toBe(EXTERNAL_GENERIC_FAILURE_MESSAGE);
    // 不应泄露 request_id 关键词
    expect(view.errorMessage).not.toMatch(/request_id/);
    expect(view.errorMessage).not.toMatch(/apimart/);
  });

  it("pending / processing → 不带 errorMessage", () => {
    for (const s of ["pending", "processing"] as const) {
      const view = toPublicJobView(makeJob({ status: s }));
      expect(view.errorMessage).toBeNull();
      expect(view.resultUrls).toEqual([]);
    }
  });

  it("UX 字段透传(mode / size / batchSize)", () => {
    const view = toPublicJobView(
      makeJob({ mode: "inpainting", size: "2048x2048", batchSize: 4 })
    );
    expect(view.mode).toBe("inpainting");
    expect(view.size).toBe("2048x2048");
    expect(view.batchSize).toBe(4);
  });
});

describe("sanitizeExternalFailureMessage", () => {
  it("null / undefined / 空串 → 通用文案", () => {
    expect(sanitizeExternalFailureMessage(null)).toBe(
      EXTERNAL_EMPTY_FAILURE_MESSAGE
    );
    expect(sanitizeExternalFailureMessage(undefined)).toBe(
      EXTERNAL_EMPTY_FAILURE_MESSAGE
    );
    expect(sanitizeExternalFailureMessage("")).toBe(
      EXTERNAL_EMPTY_FAILURE_MESSAGE
    );
    expect(sanitizeExternalFailureMessage("   ")).toBe(
      EXTERNAL_EMPTY_FAILURE_MESSAGE
    );
  });

  it("JSON 对象(以 { 开头)→ 通用文案,剥离 fingerprint", () => {
    const polluted =
      '{"error":{"code":"build_request_failed","request_id":"abc"}}';
    expect(sanitizeExternalFailureMessage(polluted)).toBe(
      EXTERNAL_GENERIC_FAILURE_MESSAGE
    );
  });

  it("包含 apimart / request_id / build_request_failed / submit NNN → 通用文案", () => {
    const cases = [
      '提交生图失败：apimart submit 500: {"error":{...},"request_id":"abc"}',
      "apimart 上游异常",
      "request_id: 20261014145519621188625rL5j5av5",
      "build_request_failed: bad param",
      "submit 500: network down",
      "Submit 502 Bad Gateway",
    ];
    for (const raw of cases) {
      expect(sanitizeExternalFailureMessage(raw)).toBe(
        EXTERNAL_GENERIC_FAILURE_MESSAGE
      );
    }
  });

  it("业务文案(用户友好的中文)→ 原文透传", () => {
    expect(sanitizeExternalFailureMessage("积分不足,请充值")).toBe(
      "积分不足,请充值"
    );
    expect(sanitizeExternalFailureMessage("文件过大,超过 20MB 上限")).toBe(
      "文件过大,超过 20MB 上限"
    );
    expect(sanitizeExternalFailureMessage("已超过本月免费次数")).toBe(
      "已超过本月免费次数"
    );
  });

  it("前后空白 → trim 后判空 / 不 match", () => {
    expect(sanitizeExternalFailureMessage("  积分不足  ")).toBe("积分不足");
  });

  it("关键检测对大小写不敏感", () => {
    expect(sanitizeExternalFailureMessage("APIMART fail")).toBe(
      EXTERNAL_GENERIC_FAILURE_MESSAGE
    );
    expect(sanitizeExternalFailureMessage("REQUEST_ID present")).toBe(
      EXTERNAL_GENERIC_FAILURE_MESSAGE
    );
    expect(sanitizeExternalFailureMessage("BUILD_REQUEST_FAILED")).toBe(
      EXTERNAL_GENERIC_FAILURE_MESSAGE
    );
  });
});
