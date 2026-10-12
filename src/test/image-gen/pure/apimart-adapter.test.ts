/**
 * Apimart GPT-Image-2.5 适配器单元测试
 *
 * 2026-10-12：覆盖 apimartGptImageAdapter 的关键路径，纯单元 mock fetch，
 * 不依赖数据库 / Inngest / R2（persistCandidateToR2 在 queryTask 路径里
 * 真实调用 —— 用 LOCAL_FILE 模式或直接 mock 替代）。
 *
 * 测试覆盖：
 * 1. validate：拒绝空 prompt / 17 张参考图 / batchSize=5 / 反向提示词
 * 2. validate：未配 APIMART_API_KEY 时返友好错误
 * 3. generate：缺 key 时返 failed，不打 fetch
 * 4. generate：mock fetch 验证请求 URL + 必备 header
 *   - Authorization: Bearer <key>
 *   - X-APIMart-Response-Version: 2026-07-27
 *   - Idempotency-Key: UUID
 *   - Content-Type: application/json
 *   - body 含 model=apimart-2.5-ext、version=flare、size、resolution、n
 * 5. generate：图生图带 image_urls
 * 6. queryTask：完成态 → status=completed + persistCandidateToR2 替代为原 url
 * 7. queryTask：pending → status=processing
 * 8. queryTask：业务失败 → status=failed
 * 9. queryTask：网络错误 → status=failed
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 必须在 import adapter 之前设置好 APIMART_API_KEY，避免 validate 直接拒
const ORIGINAL_ENV = { ...process.env };

function setKey(value: string | undefined) {
  if (value) process.env.APIMART_API_KEY = value;
  else delete process.env.APIMART_API_KEY;
}

beforeEach(() => {
  setKey("test_apimart_key");
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

// 挡掉 adapters.ts → @/features/gpt-image/lib/generation-service 的 DB 链。
// 不能 vi.importActual：会真去加载生成 → 触发 @/db → DATABASE_URL 检查抛错。
// 改成纯静态 mock：persistCandidateToR2 透传 url，其他导出给出无害 stub。
vi.mock("@/features/gpt-image/lib/generation-service", () => ({
  persistCandidateToR2: (url: string) => Promise.resolve(url),
  persistBase64ToR2: (b64: string) =>
    Promise.resolve(`data:image/png;base64,${b64}`),
  queryLingtingTask: () =>
    Promise.resolve({ state: "pending" as const, urls: [] }),
  submitLingtingTask: () => Promise.resolve({ kind: "url" as const, urls: [] }),
  // generation-service 还导出 updateImageJobFromTaskResult 等，
  // 这里只关心 4 个 persist/submit/query helper，导出最简形态即可
}));

const { apimartGptImageAdapter } = await import(
  "@/features/image-gen/lib/image-models/adapters"
);
const { IMAGE_MODELS } = await import(
  "@/features/image-gen/lib/image-models/types"
);

/** 构造一个可控的 fetch mock，输入 fetchImpl 字符串 / 响应 body 即可 */
function mockFetchSequence(
  responses: Array<{
    ok: boolean;
    status?: number;
    body: unknown;
  }>
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const next = responses.shift();
    if (!next) {
      throw new Error(`unexpected extra fetch call to ${String(url)}`);
    }
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: next.ok,
      status: next.status ?? (next.ok ? 200 : 500),
      statusText: next.ok ? "OK" : "ERR",
      text: async () =>
        typeof next.body === "string" ? next.body : JSON.stringify(next.body),
      json: async () => next.body,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

const baseReq = {
  model: "apimart_gpt_image" as const,
  mode: "text_to_image" as const,
  prompt: "雨天窗边阅读角",
  size: "1024x1024" as const,
  batchSize: 1,
  enableSafetyCheck: true,
  watermark: false,
};

describe("apimartGptImageAdapter / validate", () => {
  it("拒绝空 prompt", () => {
    const err = apimartGptImageAdapter.validate({ ...baseReq, prompt: "" });
    expect(err).toMatch(/prompt/i);
  });

  it("拒绝 17 张参考图", () => {
    const err = apimartGptImageAdapter.validate({
      ...baseReq,
      mode: "image_to_image",
      imageUrls: Array.from({ length: 17 }, (_, i) => `https://r2/${i}.png`),
    });
    expect(err).toMatch(/16/);
  });

  it("拒绝 batchSize=5", () => {
    const err = apimartGptImageAdapter.validate({
      ...baseReq,
      batchSize: 5,
    });
    expect(err).toMatch(/4/);
  });

  it("拒绝 negativePrompt", () => {
    const err = apimartGptImageAdapter.validate({
      ...baseReq,
      negativePrompt: "blurry",
    });
    expect(err).toMatch(/反向|n不支持/i);
  });

  it("未配置 API key 时返错误", () => {
    setKey(undefined);
    const err = apimartGptImageAdapter.validate(baseReq);
    expect(err).toMatch(/APIMART_API_KEY/);
  });

  it("合规请求应通过", () => {
    expect(apimartGptImageAdapter.validate(baseReq)).toBeNull();
  });
});

describe("apimartGptImageAdapter / generate", () => {
  it("缺 API key 时返失败，不打 fetch", async () => {
    setKey(undefined);
    const { fn } = mockFetchSequence([]);
    const result = await apimartGptImageAdapter.generate(baseReq);
    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/APIMART_API_KEY/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("正确发起 POST 携带必备 header 和 body", async () => {
    const { calls } = mockFetchSequence([
      {
        ok: true,
        body: {
          code: 202,
          data: { id: "task_01ABC", status: "pending", progress: 0 },
        },
      },
    ]);

    const result = await apimartGptImageAdapter.generate(baseReq);

    expect(result.success).toBe(true);
    expect(result.taskId).toBe("task_01ABC");
    expect(result.status).toBe("processing");
    expect(result.model).toBe("apimart_gpt_image");

    expect(calls).toHaveLength(1);
    const call0 = calls[0]!;
    expect(call0.url).toContain("/v1/images/generations");
    expect(call0.init.method).toBe("POST");
    const headers = call0.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test_apimart_key");
    expect(headers["X-APIMart-Response-Version"]).toBe("2026-07-27");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    const body = JSON.parse(String(call0.init.body));
    expect(body.model).toBe("gpt-image-2.5-ext");
    expect(body.version).toBe("flare");
    expect(body.prompt).toBe("雨天窗边阅读角");
    expect(body.size).toBe("1:1"); // 1024x1024 → 1:1
    expect(body.resolution).toBe("1K");
    expect(body.n).toBe(1);
    expect(body.image_urls).toBeUndefined(); // 文生图不应带参考图
  });

  it("图生图带 image_urls", async () => {
    const { calls } = mockFetchSequence([
      {
        ok: true,
        body: { code: 202, data: { id: "task_02XYZ" } },
      },
    ]);

    await apimartGptImageAdapter.generate({
      ...baseReq,
      mode: "image_to_image",
      imageUrls: ["https://r2/ref1.png", "https://r2/ref2.png"],
      size: "1024x1536", // 2:3
    });

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.image_urls).toEqual([
      "https://r2/ref1.png",
      "https://r2/ref2.png",
    ]);
    expect(body.size).toBe("2:3");
  });

  it("像素尺寸映射到最近 ratio", async () => {
    const { calls } = mockFetchSequence([
      { ok: true, body: { code: 202, data: { id: "task_03" } } },
    ]);
    await apimartGptImageAdapter.generate({
      ...baseReq,
      size: "1280x720", // 16:9
    });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.size).toBe("16:9");
  });

  it("响应缺 taskId 抛错 → 返 failed", async () => {
    mockFetchSequence([
      { ok: true, body: { code: 202, data: { status: "pending" } } },
    ]);
    const r = await apimartGptImageAdapter.generate(baseReq);
    expect(r.success).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/taskId/);
  });

  it("上游非 2xx → 抛错 → 返 failed", async () => {
    mockFetchSequence([
      { ok: false, status: 401, body: { error: { message: "unauthorized" } } },
    ]);
    const r = await apimartGptImageAdapter.generate(baseReq);
    expect(r.success).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/401/);
  });
});

describe("apimartGptImageAdapter / queryTask", () => {
  const taskId = "task_polled";

  it("缺 API key 时返失败", async () => {
    setKey(undefined);
    const r = await apimartGptImageAdapter.queryTask!(taskId);
    expect(r.success).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/APIMART_API_KEY/);
  });

  it("pending → processing", async () => {
    const { calls } = mockFetchSequence([
      {
        ok: true,
        body: {
          code: 200,
          data: { id: taskId, status: "processing", progress: 50 },
        },
      },
    ]);
    const r = await apimartGptImageAdapter.queryTask!(taskId);
    expect(r.success).toBe(true);
    expect(r.status).toBe("processing");
    expect(calls[0]!.url).toContain(`/v1/tasks/${taskId}`);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["X-APIMart-Response-Version"]).toBe("2026-07-27");
    expect(headers.Authorization).toBe("Bearer test_apimart_key");
  });

  it("completed → 完成态 + 透传 url", async () => {
    mockFetchSequence([
      {
        ok: true,
        body: {
          code: 200,
          data: {
            id: taskId,
            status: "completed",
            progress: 100,
            completed: 1788912045,
            cost: 0.2,
            credits_cost: 2,
            result: {
              images: [
                {
                  url: ["https://apimart.example/out1.png"],
                  expires_at: 1788998445,
                },
              ],
            },
          },
        },
      },
    ]);
    const r = await apimartGptImageAdapter.queryTask!(taskId);
    expect(r.success).toBe(true);
    expect(r.status).toBe("completed");
    expect(r.images).toHaveLength(1);
    // persistCandidateToR2 被 mock 为透传
    expect(r.images?.[0]?.url).toBe("https://apimart.example/out1.png");
    expect(r.cost).toBe(0.2);
  });

  it("failed（业务失败）→ status=failed", async () => {
    mockFetchSequence([
      {
        ok: true,
        body: {
          code: 200,
          data: {
            id: taskId,
            status: "failed",
            error: { message: "n must be 1..4" },
          },
        },
      },
    ]);
    const r = await apimartGptImageAdapter.queryTask!(taskId);
    expect(r.success).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/1\.\.4/);
  });

  it("completed 但 url 为空 → 返 failed", async () => {
    mockFetchSequence([
      {
        ok: true,
        body: {
          code: 200,
          data: { id: taskId, status: "completed", result: { images: [] } },
        },
      },
    ]);
    const r = await apimartGptImageAdapter.queryTask!(taskId);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/未返回图片/);
  });

  it("HTTP 500 → 抛错 → status=failed", async () => {
    mockFetchSequence([
      { ok: false, status: 500, body: { error: { message: "upstream err" } } },
    ]);
    const r = await apimartGptImageAdapter.queryTask!(taskId);
    expect(r.success).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/500/);
  });
});

describe("IMAGE_MODELS 元数据", () => {
  it("apimart_gpt_image 已注册且元数据自洽", () => {
    const meta = IMAGE_MODELS.apimart_gpt_image;
    expect(meta.id).toBe("apimart_gpt_image");
    expect(meta.vendor).toBe("Apimart");
    expect(meta.asyncMode).toBe(true);
    expect(meta.capabilities.maxBatchSize).toBe(4);
    expect(meta.capabilities.sizes).toContain("1024x1024");
    expect(meta.capabilities.sizes).toContain("auto");
    expect(meta.apiKeyEnv).toBe("APIMART_API_KEY");
  });
});
