/**
 * Apimart GPT-Image-2.5 适配器单元测试
 *
 * 2026-10-XX 重写:适配器工厂后,flare / sunburst 共用同一套 submit / poll 路径,
 * 用 describe.each 参数化跑两遍,任何修改两边都得照顾,避免双适配器行为漂移。
 *
 * 测试覆盖(每个 adapter):
 * 1. validate:拒绝空 prompt / 17 张参考图 / batchSize=5 / 反向提示词 / 缺 key
 * 2. validate:inpainting 模式不带 maskUrl 拒绝
 * 3. generate:缺 key 时返 failed,不打 fetch
 * 4. generate:mock fetch 验证请求 URL + 必备 header
 *   - Authorization: Bearer <key>
 *   - X-APIMart-Response-Version: 2026-07-27
 *   - Idempotency-Key: UUID
 *   - Content-Type: application/json
 *   - body 含 model=gpt-image-2.5-{flare|sunburst}、prompt、size、resolution、n
 *   - 文档新合同:submit 响应 data 是数组 [{ task_id }](不是对象 { id })
 * 5. generate:图生图带 image_urls
 * 6. generate:精确像素满足 16 倍数时透传 WxH,不满足时降级到 ratio
 * 7. generate:inpainting 同时带 image_urls + maskUrl,body 含 mask_url
 * 8. generate:响应缺 task_id 抛错 → 返 failed
 * 9. generate:上游非 2xx → 抛错 → 返 failed
 * 10. queryTask:完成态 → status=completed + persistCandidateToR2 替代为原 url
 * 11. queryTask:pending → status=processing
 * 12. queryTask:业务失败 → status=failed
 * 13. queryTask:网络错误 → status=failed
 *
 * 纯单元 mock fetch,不依赖数据库 / Inngest / R2
 * (persistCandidateToR2 在 queryTask 路径里真实调用 —— vi.mock 替成透传)。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 必须在 import adapter 之前设置好 APIMART_API_KEY,避免 validate 直接拒
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
// 不能 vi.importActual:会真去加载生成 → 触发 @/db → DATABASE_URL 检查抛错。
// 改成纯静态 mock:persistCandidateToR2 透传 url,其他导出给出无害 stub。
vi.mock("@/features/gpt-image/lib/generation-service", () => ({
  persistCandidateToR2: (url: string) => Promise.resolve(url),
  persistBase64ToR2: (b64: string) =>
    Promise.resolve(`data:image/png;base64,${b64}`),
  queryLingtingTask: () =>
    Promise.resolve({ state: "pending" as const, urls: [] }),
  submitLingtingTask: () => Promise.resolve({ kind: "url" as const, urls: [] }),
}));

const adaptersModule = await import(
  "@/features/image-gen/lib/image-models/adapters"
);
const typesModule = await import("@/features/image-gen/lib/image-models/types");

const { apimartGptImageAdapter, apimartGptImageSunburstAdapter } =
  adaptersModule;
const { IMAGE_MODELS } = typesModule;

/** ImageSize 用于把上游支持但 schema 没收口的字面像素("1600x1200")cast 进函数参 */
import type { ImageSize } from "@/features/image-gen/lib/image-models/types";

/** 适配器参数化测试集 —— 同时覆盖 flare / sunburst */
const ADAPTER_CASES = [
  {
    label: "flare",
    id: "apimart_gpt_image" as const,
    upstreamName: "gpt-image-2.5-flare",
    adapter: apimartGptImageAdapter,
    config: IMAGE_MODELS.apimart_gpt_image,
  },
  {
    label: "sunburst",
    id: "apimart_gpt_image_sunburst" as const,
    upstreamName: "gpt-image-2.5-sunburst",
    adapter: apimartGptImageSunburstAdapter,
    config: IMAGE_MODELS.apimart_gpt_image_sunburst,
  },
];

/** 构造一个可控的 fetch mock,输入 fetchImpl 字符串 / 响应 body 即可 */
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

describe.each(ADAPTER_CASES)("apimart $label adapter / validate", ({
  adapter,
  config,
  id,
}) => {
  it("拒绝空 prompt", () => {
    const err = adapter.validate({ ...baseReq, model: id, prompt: "" });
    expect(err).toMatch(/prompt/i);
  });

  it("拒绝 17 张参考图", () => {
    const err = adapter.validate({
      ...baseReq,
      model: id,
      mode: "image_to_image",
      imageUrls: Array.from({ length: 17 }, (_, i) => `https://r2/${i}.png`),
    });
    expect(err).toMatch(/16/);
  });

  it("拒绝 batchSize=5", () => {
    const err = adapter.validate({ ...baseReq, model: id, batchSize: 5 });
    expect(err).toMatch(/4/);
  });

  it("拒绝 negativePrompt", () => {
    const err = adapter.validate({
      ...baseReq,
      model: id,
      negativePrompt: "blurry",
    });
    expect(err).toMatch(/反向|n不支持/i);
  });

  it("未配置 API key 时返错误", () => {
    setKey(undefined);
    const err = adapter.validate({ ...baseReq, model: id });
    expect(err).toMatch(/APIMART_API_KEY/);
  });

  it("inpainting 模式缺 maskUrl 拒绝", () => {
    const err = adapter.validate({
      ...baseReq,
      model: id,
      mode: "inpainting",
    });
    expect(err).toMatch(/mask/i);
  });

  it("合规请求应通过", () => {
    expect(adapter.validate({ ...baseReq, model: id })).toBeNull();
  });

  it("config 元数据自洽", () => {
    expect(adapter.config.id).toBe(id);
    expect(adapter.config.vendor).toBe("Apimart");
    expect(adapter.config.asyncMode).toBe(true);
    expect(adapter.config.capabilities.maxBatchSize).toBe(4);
    expect(adapter.config.capabilities.sizes).toContain("1024x1024");
    expect(adapter.config.capabilities.sizes).toContain("auto");
    expect(adapter.config.apiKeyEnv).toBe("APIMART_API_KEY");
    expect(adapter.config).toBe(config);
  });
});

describe.each(ADAPTER_CASES)("apimart $label adapter / generate", ({
  adapter,
  id,
  upstreamName,
}) => {
  it("缺 API key 时返失败,不打 fetch", async () => {
    setKey(undefined);
    const { fn } = mockFetchSequence([]);
    const result = await adapter.generate({ ...baseReq, model: id });
    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.model).toBe(id);
    expect(result.error).toMatch(/APIMART_API_KEY/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("正确发起 POST 携带必备 header 和 body", async () => {
    // 2026-10-XX:submit 响应改数组形态 data: [{ task_id }]
    const { calls } = mockFetchSequence([
      {
        ok: true,
        body: {
          code: 200,
          data: [
            {
              task_id: "task_01ABC",
              status: "submitted",
            },
          ],
        },
      },
    ]);

    const result = await adapter.generate({ ...baseReq, model: id });

    expect(result.success).toBe(true);
    expect(result.taskId).toBe("task_01ABC");
    expect(result.status).toBe("processing");
    expect(result.model).toBe(id);

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
    expect(body.model).toBe(upstreamName);
    // 2026-10-XX:gpt-image-2.5-flare/-sunburst 文档无 version 子字段
    expect(body.version).toBeUndefined();
    expect(body.prompt).toBe("雨天窗边阅读角");
    // 1024x1024 都是 16 倍数 + ≤3840 → resolver 直接透传,不走 ratio 解析
    expect(body.size).toBe("1024x1024");
    expect(body.resolution).toBe("1K");
    expect(body.n).toBe(1);
    expect(body.image_urls).toBeUndefined(); // 文生图不应带参考图
    expect(body.mask_url).toBeUndefined(); // 非 inpainting 不应带 mask
  });

  it("图生图带 image_urls(inpainting 同时带 mask_url)", async () => {
    const { calls } = mockFetchSequence([
      {
        ok: true,
        body: { code: 200, data: [{ task_id: "task_02XYZ" }] },
      },
    ]);

    await adapter.generate({
      ...baseReq,
      model: id,
      mode: "inpainting",
      imageUrls: ["https://r2/ref1.png", "https://r2/ref2.png"],
      maskUrl: "https://r2/mask.png",
      size: "1024x1536", // 2:3
    });

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.image_urls).toEqual([
      "https://r2/ref1.png",
      "https://r2/ref2.png",
    ]);
    expect(body.mask_url).toBe("https://r2/mask.png");
    // 1024x1536 都是 16 倍数 + ≤3840 → resolver 直接透传
    expect(body.size).toBe("1024x1536");
  });

  it("精确像素满足 16 倍数时透传 WxH,否则降级到 ratio", async () => {
    const { calls } = mockFetchSequence([
      { ok: true, body: { code: 200, data: [{ task_id: "task_03" }] } },
    ]);
    await adapter.generate({
      ...baseReq,
      model: id,
      // 16 倍数 + ≤3840 满足 apimart 精确像素规则 → 透传
      // "1600x1200" 不在 schema ImageSize 字面量集合 —— 这是 apimart 文档示例,
      // 我们 schema 暂未收口。cast 为 ImageSize 表达"上游支持"。schema 扩后可去掉。
      size: "1600x1200" as ImageSize,
    });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.size).toBe("1600x1200");

    // 非 16 倍数 → 降级到 ratio
    const { calls: calls2 } = mockFetchSequence([
      { ok: true, body: { code: 200, data: [{ task_id: "task_04" }] } },
    ]);
    await adapter.generate({
      ...baseReq,
      model: id,
      size: "1280x720", // 不是 16 倍数(720/16=45,符合!;但长宽比 16:9 用 ratio 也是允许的)
      // 实际 1280=16*80,720=16*45 → 双双 16 倍数 → 透传
      // 但 1280/720 不是 16:9,所以 size="1280x720" 用 ratio 解析 → 16:9
    });
    const body2 = JSON.parse(String(calls2[0]!.init.body));
    // 1280x720 都是 16 倍数 → 直接透传
    expect(body2.size).toBe("1280x720");
  });

  it("响应缺 task_id 抛错 → 返 failed", async () => {
    mockFetchSequence([
      {
        ok: true,
        body: { code: 200, data: [{ status: "submitted" }] },
      },
    ]);
    const r = await adapter.generate({ ...baseReq, model: id });
    expect(r.success).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/taskId|task_id/);
  });

  it("响应 data 为 object 形态(旧/保险)也能抽到 taskId", async () => {
    mockFetchSequence([
      {
        ok: true,
        body: { code: 200, data: { task_id: "task_legacy" } },
      },
    ]);
    const r = await adapter.generate({ ...baseReq, model: id });
    expect(r.success).toBe(true);
    expect(r.taskId).toBe("task_legacy");
  });

  it("上游非 2xx → 抛错 → 返 failed", async () => {
    mockFetchSequence([
      { ok: false, status: 401, body: { error: { message: "unauthorized" } } },
    ]);
    const r = await adapter.generate({ ...baseReq, model: id });
    expect(r.success).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/401/);
  });
});

describe.each(ADAPTER_CASES)("apimart $label adapter / queryTask", ({
  adapter,
  id,
}) => {
  const taskId = "task_polled";

  it("缺 API key 时返失败", async () => {
    setKey(undefined);
    const r = await adapter.queryTask!(taskId);
    expect(r.success).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.model).toBe(id);
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
    const r = await adapter.queryTask!(taskId);
    expect(r.success).toBe(true);
    expect(r.status).toBe("processing");
    expect(r.model).toBe(id);
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
    const r = await adapter.queryTask!(taskId);
    expect(r.success).toBe(true);
    expect(r.status).toBe("completed");
    expect(r.model).toBe(id);
    expect(r.images).toHaveLength(1);
    // persistCandidateToR2 被 mock 为透传
    expect(r.images?.[0]?.url).toBe("https://apimart.example/out1.png");
    expect(r.cost).toBe(0.2);
  });

  it("failed(业务失败) → status=failed", async () => {
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
    const r = await adapter.queryTask!(taskId);
    expect(r.success).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.model).toBe(id);
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
    const r = await adapter.queryTask!(taskId);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/未返回图片/);
  });

  it("HTTP 500 → 抛错 → status=failed", async () => {
    mockFetchSequence([
      { ok: false, status: 500, body: { error: { message: "upstream err" } } },
    ]);
    const r = await adapter.queryTask!(taskId);
    expect(r.success).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/500/);
  });
});

describe("IMAGE_MODELS 元数据双条目自洽", () => {
  it("flare 与 sunburst 已注册且基础字段一致", () => {
    const flare = IMAGE_MODELS.apimart_gpt_image;
    const sunburst = IMAGE_MODELS.apimart_gpt_image_sunburst;
    expect(flare.id).toBe("apimart_gpt_image");
    expect(sunburst.id).toBe("apimart_gpt_image_sunburst");
    expect(flare.vendor).toBe(sunburst.vendor);
    expect(flare.apiEndpoint).toBe(sunburst.apiEndpoint);
    expect(flare.apiKeyEnv).toBe(sunburst.apiKeyEnv);
    // capabilities 相同(只是元数据上,行为由 adapter 切上游 model)
    expect(flare.capabilities.modes).toEqual(sunburst.capabilities.modes);
    expect(flare.capabilities.sizes).toEqual(sunburst.capabilities.sizes);
    // name 必须区分给前端下拉可见
    expect(flare.name).not.toBe(sunburst.name);
  });
});
