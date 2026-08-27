// 生图模型适配器实现
// 业界主流异步任务模式: submit → poll → result
// 当前为 Mock 实现，结构已就绪，部署时填充 fetch 调用即可
// Gemini 两个模型走真实 generateContent 接口（需配置 LINGTING_API_KEY）

// Phase 起：gpt_image_2 适配器直接跨 feature 复用 gpt-image 的 wellapi 调用。
// 不抽 shared —— 同项目的 PromptTemplateView 也是从 gpt-image/lib/types 导的，
// 跨 feature import 在这个仓库已经是有先例的模式。
import {
  queryLingtingTask,
  submitLingtingTask,
} from "@/features/gpt-image/lib/generation-service";
import { seededRandom } from "../providers/random";
import { persistUpstreamImageToR2 } from "../persist-image";
import { GEMINI_CONFIG } from "./gemini-config";
import {
  getOpenAIImageApiKey,
  OPENAI_IMAGE_CONFIG,
} from "./openai-image-config";
import {
  type GenerateImageRequest,
  type GenerateImageResult,
  IMAGE_MODELS,
  type ImageModelAdapter,
  type ImageModelId,
} from "./types";

const simulateLatency = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 生成任务ID
// 格式: imgtask_<model>_<ts>_<rand>，model 可从 ID 前缀解析（轮询无需客户端传 model）
const genTaskId = (model: string) =>
  `imgtask_${model}_${Date.now().toString(36)}_${Math.floor(seededRandom() * 1e6).toString(36)}`;

// 从 taskId 解析模型 id（轮询端点用，避免客户端传 model 暴露内部模型）
//
// taskId 格式：`imgtask_<model>_<base36_ts>_<base36_rand>`
//   - <base36_ts> 与 <base36_rand> 都是 `[0-9a-z]+`
//   - <model> 可以包含下划线（gpt_image_2、nano_banana_pro、nano_banana2）
//
// 实现：从 `imgtask_` 后开始，贪心匹配到倒数第二个 `_\w+` 之前的所有字符
// 作为 model（最末两段是 ts + rand）。
export function parseTaskModel(taskId: string): ImageModelId | null {
  const match = taskId.match(/^imgtask_(.+)_\w+_\w+$/);
  if (!match?.[1]) return null;
  return (match[1] as ImageModelId) in IMAGE_ADAPTERS
    ? (match[1] as ImageModelId)
    : null;
}

// Mock 异步任务的轮询次数记录：前若干次返回 processing，模拟真实异步
const pollCount = new Map<string, number>();
const pollThreshold = 2; // 前 2 次查询返回 processing，第 3 次 completed

// 生成图片URL（用 picsum 模拟）
const genImageUrl = (seed: string, idx: number) =>
  `https://picsum.photos/seed/${seed}${idx}/512/512`;

// 解析尺寸
function parseSize(
  size: string,
  customWidth?: number,
  customHeight?: number
): { width: number; height: number } {
  if (size === "custom") {
    return { width: customWidth ?? 1024, height: customHeight ?? 1024 };
  }
  const parts = size.split("x").map(Number);
  return { width: parts[0] ?? 1024, height: parts[1] ?? 1024 };
}

// ============ 1. DALL-E 3 适配器（真实 OpenAI API） ============
export const dalle3Adapter: ImageModelAdapter = {
  config: IMAGE_MODELS.dalle3,
  validate(req) {
    if (!req.prompt) return "DALL-E 3 需要 prompt";
    if (req.mode === "image_to_image" && !req.imageUrl)
      return "图生图模式需要 imageUrl";
    if (req.negativePrompt) return "DALL-E 3 不支持反向提示词";
    if (req.batchSize && req.batchSize > 1) return "DALL-E 3 单次只能生成 1 张";
    if (!getOpenAIImageApiKey()) return "OPENAI_API_KEY 未配置";
    return null;
  },
  async generate(req) {
    const startTime = Date.now();
    const isEdit =
      req.mode === "image_editing" || req.mode === "image_to_image";
    const quality = req.size === "1024x1024" ? "hd" : "standard";
    const style = req.style === "natural" ? "natural" : "vivid";

    try {
      let response: OpenAIImagesResponse;

      if (isEdit) {
        if (!req.imageUrl) {
          return {
            success: false,
            model: "dalle3",
            status: "failed",
            error: "图像编辑模式需要 imageUrl",
          };
        }
        const { buffer } = await resolveReferenceImage(req.imageUrl);
        const formData = new FormData();
        formData.append(
          "image",
          new Blob([new Uint8Array(buffer)], { type: "image/png" })
        );
        formData.append("prompt", req.prompt);
        formData.append("n", "1");
        formData.append("size", req.size);
        formData.append("model", "dall-e-3");
        response = await callOpenAIImagesApi({
          endpoint: "edits",
          formData,
        });
      } else {
        response = await callOpenAIImagesApi({
          endpoint: "generations",
          jsonBody: {
            model: "dall-e-3",
            prompt: req.prompt,
            n: 1,
            size: req.size,
            quality,
            style,
            response_format: "url",
          },
        });
      }

      const first = response.data?.[0];
      if (!first) {
        return {
          success: false,
          model: "dalle3",
          status: "failed",
          error: response.error?.message ?? "OpenAI 未返回图片",
        };
      }

      return {
        success: true,
        model: "dalle3",
        status: "completed",
        images: [
          {
            url: openAIImageToUrl(first),
            ...(first.revised_prompt
              ? { revisedPrompt: first.revised_prompt }
              : {}),
          },
        ],
        duration: Date.now() - startTime,
        cost: 0.04,
        currency: "USD",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      return {
        success: false,
        model: "dalle3",
        status: "failed",
        error: `DALL-E 3 调用失败: ${msg}`,
      };
    }
  },
};

// ============ 2. Stable Diffusion 3 适配器 ============
export const sd3Adapter: ImageModelAdapter = {
  config: IMAGE_MODELS.sd3,
  validate(req) {
    if (!req.prompt) return "SD 3 需要 prompt";
    if (req.mode === "image_to_image" && !req.imageUrl)
      return "图生图模式需要 imageUrl";
    if (req.batchSize && req.batchSize > 4) return "SD 3 单次最多 4 张";
    return null;
  },
  async generate(req) {
    await simulateLatency(600 + seededRandom() * 400);
    const batchSize = Math.min(req.batchSize ?? 1, 4);
    const seed = `sd3_${Date.now()}`;
    const { width, height } = parseSize(
      req.size,
      req.customWidth,
      req.customHeight
    );
    return {
      success: true,
      model: "sd3",
      status: "completed",
      images: Array.from({ length: batchSize }, (_, i) => ({
        url: genImageUrl(seed, i),
        seed: (req.seed ?? Math.floor(seededRandom() * 1e9)) + i,
      })),
      duration: 8000,
      cost: 0.03 * batchSize,
      currency: "USD",
      raw: {
        endpoint:
          "POST https://api.stability.ai/v2beta/stable-image/generate/sd3",
        payload: {
          prompt: req.prompt,
          negative_prompt: req.negativePrompt,
          aspect_ratio: `${width}:${height}`,
          seed: req.seed,
          guidance_scale: req.guidanceScale ?? 7,
          num_inference_steps: req.numInferenceSteps ?? 30,
          style_preset: req.style,
          output_format: "png",
        },
      },
    };
  },
};

// ============ 3. Flux.1 适配器（异步任务模式） ============
export const flux1Adapter: ImageModelAdapter = {
  config: IMAGE_MODELS.flux1,
  validate(req) {
    if (!req.prompt) return "Flux.1 需要 prompt";
    if (req.mode === "image_to_image" && !req.imageUrl)
      return "图生图模式需要 imageUrl";
    if (req.batchSize && req.batchSize > 4) return "Flux.1 单次最多 4 张";
    return null;
  },
  async generate(req) {
    await simulateLatency(400 + seededRandom() * 300);
    const taskId = genTaskId("flux1");
    return {
      success: true,
      model: "flux1",
      taskId,
      status: "processing",
      raw: {
        endpoint: "POST https://api.bfl.ai/v1/flux-pro-1.1",
        payload: {
          prompt: req.prompt,
          negative_prompt: req.negativePrompt,
          width: parseSize(req.size, req.customWidth, req.customHeight).width,
          height: parseSize(req.size, req.customWidth, req.customHeight).height,
          seed: req.seed,
          guidance: req.guidanceScale ?? 7.5,
          num_inference_steps: req.numInferenceSteps ?? 40,
          safety_tolerance: req.enableSafetyCheck ? 2 : 6,
        },
      },
    };
  },
  async queryTask(taskId) {
    await simulateLatency(300);
    const seed = taskId.replace("imgtask_flux1_", "");
    const count = (pollCount.get(taskId) ?? 0) + 1;
    pollCount.set(taskId, count);
    if (count <= pollThreshold) {
      return {
        success: true,
        model: "flux1",
        taskId,
        status: "processing",
      };
    }
    return {
      success: true,
      model: "flux1",
      taskId,
      status: "completed",
      images: [
        {
          url: genImageUrl(`flux_${seed}`, 0),
          seed: Math.floor(seededRandom() * 1e9),
        },
      ],
      duration: 5500,
      cost: 0.05,
      currency: "USD",
    };
  },
};

// ============ 4. Midjourney 适配器（异步任务模式，长耗时） ============
export const midjourneyAdapter: ImageModelAdapter = {
  config: IMAGE_MODELS.midjourney,
  validate(req) {
    if (!req.prompt) return "Midjourney 需要 prompt";
    if (req.batchSize && req.batchSize > 4) return "Midjourney 单次最多 4 张";
    if (req.guidanceScale) return "Midjourney 不支持 guidanceScale 参数";
    return null;
  },
  async generate(req) {
    await simulateLatency(500);
    const taskId = genTaskId("midjourney");
    return {
      success: true,
      model: "midjourney",
      taskId,
      status: "processing",
      raw: {
        endpoint: "POST https://api.midjourney.com/v6/imagine",
        payload: {
          prompt: `${req.prompt} --style ${req.style ?? "raw"} ${req.negativePrompt ? `--no ${req.negativePrompt}` : ""}`,
          seed: req.seed,
          size: req.size,
        },
      },
    };
  },
  async queryTask(taskId) {
    await simulateLatency(300);
    const seed = taskId.replace("imgtask_midjourney_", "");
    return {
      success: true,
      model: "midjourney",
      taskId,
      status: "completed",
      images: Array.from({ length: 4 }, (_, i) => ({
        url: genImageUrl(`mj_${seed}`, i),
      })),
      duration: 35000,
      cost: 0.1,
      currency: "USD",
    };
  },
};

// ============ 5. 即梦/豆包 适配器（异步任务模式） ============
export const doubaoAdapter: ImageModelAdapter = {
  config: IMAGE_MODELS.doubao,
  validate(req) {
    if (!req.prompt) return "即梦 需要 prompt";
    if (req.mode === "image_to_image" && !req.imageUrl)
      return "图生图模式需要 imageUrl";
    if (req.batchSize && req.batchSize > 4) return "即梦 单次最多 4 张";
    return null;
  },
  async generate(req) {
    await simulateLatency(400 + seededRandom() * 300);
    const taskId = genTaskId("doubao");
    return {
      success: true,
      model: "doubao",
      taskId,
      status: "processing",
      raw: {
        endpoint: "POST https://visual.volcengineapi.com/v1/visual/text2image",
        payload: {
          req_key: "doubao_text2image_v1",
          prompt: req.prompt,
          negative_prompt: req.negativePrompt,
          width: parseSize(req.size, req.customWidth, req.customHeight).width,
          height: parseSize(req.size, req.customWidth, req.customHeight).height,
          seed: req.seed,
          scale: req.guidanceScale ?? 7,
          ddim_steps: req.numInferenceSteps ?? 30,
          return_url: true,
        },
      },
    };
  },
  async queryTask(taskId) {
    await simulateLatency(300);
    const seed = taskId.replace("imgtask_doubao_", "");
    return {
      success: true,
      model: "doubao",
      taskId,
      status: "completed",
      images: Array.from({ length: 4 }, (_, i) => ({
        url: genImageUrl(`doubao_${seed}`, i),
      })),
      duration: 4500,
      cost: 0.06 * 4,
      currency: "CNY",
    };
  },
};

// ============ 6. 通义万相 适配器（异步任务模式） ============
export const wanxAdapter: ImageModelAdapter = {
  config: IMAGE_MODELS.wanx,
  validate(req) {
    if (!req.prompt) return "通义万相 需要 prompt";
    if (req.batchSize && req.batchSize > 4) return "通义万相 单次最多 4 张";
    if (req.negativePrompt) return "通义万相 当前版不支持反向提示词";
    if (req.guidanceScale) return "通义万相 不支持 guidanceScale";
    return null;
  },
  async generate(req) {
    await simulateLatency(500);
    const taskId = genTaskId("wanx");
    const { width, height } = parseSize(
      req.size,
      req.customWidth,
      req.customHeight
    );
    return {
      success: true,
      model: "wanx",
      taskId,
      status: "processing",
      raw: {
        endpoint:
          "POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
        payload: {
          model: "wanx-v1",
          input: { prompt: req.prompt },
          parameters: {
            size: `${width}*${height}`,
            n: Math.min(req.batchSize ?? 1, 4),
            seed: req.seed,
            style: req.style ?? "photography",
          },
        },
        headers: { "X-DashScope-Async": "enable" },
      },
    };
  },
  async queryTask(taskId) {
    await simulateLatency(300);
    const seed = taskId.replace("imgtask_wanx_", "");
    return {
      success: true,
      model: "wanx",
      taskId,
      status: "completed",
      images: Array.from({ length: 4 }, (_, i) => ({
        url: genImageUrl(`wanx_${seed}`, i),
      })),
      duration: 6500,
      cost: 0.16 * 4,
      currency: "CNY",
    };
  },
};

// ============ 7. 文心一格 适配器（异步任务模式） ============
export const ernieAdapter: ImageModelAdapter = {
  config: IMAGE_MODELS.ernie,
  validate(req) {
    if (!req.prompt) return "文心一格 需要 prompt";
    if (req.batchSize && req.batchSize > 2) return "文心一格 单次最多 2 张";
    if (req.negativePrompt) return "文心一格 不支持反向提示词";
    if (req.seed) return "文心一格 不支持随机种子";
    return null;
  },
  async generate(req) {
    await simulateLatency(500);
    const taskId = genTaskId("ernie");
    return {
      success: true,
      model: "ernie",
      taskId,
      status: "processing",
      raw: {
        endpoint: "POST https://aip.baidubce.com/rpc/2.0/ernievilg/v1/txt2img",
        payload: {
          text: req.prompt,
          style: req.style ?? "现实主义",
          resolution: req.size,
          num: Math.min(req.batchSize ?? 1, 2),
        },
      },
    };
  },
  async queryTask(taskId) {
    await simulateLatency(300);
    const seed = taskId.replace("imgtask_ernie_", "");
    return {
      success: true,
      model: "ernie",
      taskId,
      status: "completed",
      images: Array.from({ length: 2 }, (_, i) => ({
        url: genImageUrl(`ernie_${seed}`, i),
      })),
      duration: 8000,
      cost: 0.12 * 2,
      currency: "CNY",
    };
  },
};

// ============ 8. CogView 适配器（同步模式） ============
export const cogviewAdapter: ImageModelAdapter = {
  config: IMAGE_MODELS.cogview,
  validate(req) {
    if (!req.prompt) return "CogView 需要 prompt";
    if (req.batchSize && req.batchSize > 1) return "CogView 单次只能生成 1 张";
    if (req.negativePrompt) return "CogView 当前版本不支持反向提示词";
    return null;
  },
  async generate(req) {
    await simulateLatency(500 + seededRandom() * 300);
    const seed = `cogview_${Date.now()}`;
    return {
      success: true,
      model: "cogview",
      status: "completed",
      images: [
        {
          url: genImageUrl(seed, 0),
          seed: Math.floor(seededRandom() * 1e9),
        },
      ],
      duration: 5500,
      cost: 0.1,
      currency: "CNY",
      raw: {
        endpoint:
          "POST https://open.bigmodel.cn/api/paas/v4/images/generations",
        payload: {
          model: "cogview-3-plus",
          prompt: req.prompt,
          size: req.size,
          user_id: "mooncoda",
        },
      },
    };
  },
};

// ============ OpenAI Images API 辅助函数 ============

/**
 * 将 base64 data URI 转换为 Buffer 与 MIME 类型
 */
function dataUrlToBuffer(dataUrl: string): {
  buffer: Buffer;
  mimeType: string;
} {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid data URL");
  }
  return {
    buffer: Buffer.from(match[2] as string, "base64"),
    mimeType: match[1] as string,
  };
}

/**
 * 下载远程图片为 Buffer
 */
async function urlToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`下载图片失败: ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * 获取参考图 Buffer（支持 data URI 与 https URL）
 */
async function resolveReferenceImage(
  imageUrl: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (imageUrl.startsWith("data:")) {
    return dataUrlToBuffer(imageUrl);
  }
  if (/^https?:\/\//.test(imageUrl)) {
    const buffer = await urlToBuffer(imageUrl);
    return { buffer, mimeType: "image/png" };
  }
  throw new Error("不支持的参考图格式，仅支持 data URI 或 https URL");
}

interface OpenAIImageData {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

interface OpenAIImagesResponse {
  data?: OpenAIImageData[];
  error?: { message?: string };
}

/**
 * 调用 OpenAI Images API
 */
async function callOpenAIImagesApi(opts: {
  endpoint: "generations" | "edits";
  formData?: FormData;
  jsonBody?: Record<string, unknown>;
}): Promise<OpenAIImagesResponse> {
  const apiKey = getOpenAIImageApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 未配置");
  }

  const url = `${OPENAI_IMAGE_CONFIG.baseUrl}/images/${opts.endpoint}`;
  const isMultipart = opts.endpoint === "edits";

  if (isMultipart && !opts.formData) {
    throw new Error("OpenAI Images edits 接口需要 formData");
  }

  const init: RequestInit = isMultipart
    ? {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: opts.formData as FormData,
        signal: AbortSignal.timeout(120000),
      }
    : {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(opts.jsonBody),
        signal: AbortSignal.timeout(120000),
      };

  const res = await fetch(url, init);

  const data = (await res.json()) as OpenAIImagesResponse;
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI API 错误: ${res.status}`);
  }
  return data;
}

/**
 * 将 OpenAI 图片数据转换为 data URL
 */
function openAIImageToUrl(item: OpenAIImageData): string {
  if (item.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }
  if (item.url) {
    return item.url;
  }
  throw new Error("OpenAI 响应中缺少图片数据");
}

/**
 * 单图重试包装器：给 submitLingtingTask 加短间隔重试，吸收偶发 cold start。
 *
 * 为什么不在 submitLingtingTask 内部加：Lingting 没有幂等键，重复提交会
 * 真实扣多张额度 —— gpt-image 链路的硬规则（见 src/inngest/functions.ts
 * submitGenerationJob retries=0 注释）。所以 retry 必须放在调用方、且
 * 必须知道上次到底有没有真提交 —— submitLingtingTask 只要 throw 就是
 * 没有进 Lingting 队列（network/abort/5xx 都是 throw），可以安全重试。
 *
 * @param maxRetries  默认 2：试 1 次 + 重试 2 次 = 最多 3 次
 * @param delayMs     默认 2000：cold start 通常 1-3s 内自动恢复
 */
async function retrySubmitLingtingTask(
  imageUrl: string,
  prompt: string,
  size: string,
  imageIdx: number,
  maxRetries = 2,
  delayMs = 2000
): Promise<Awaited<ReturnType<typeof submitLingtingTask>>> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await submitLingtingTask("_wbl", imageUrl, prompt, size, imageIdx);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await sleep(delayMs);
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("submitLingtingTask 失败");
}

// ============ 9. GPT-Image-2 适配器（via WellAPI） ============
// 直接复用 gpt-image 的 submitLingtingTask / queryLingtingTask /
// persistCandidateToR2，与 /p/[token] 走完全一致的 wellapi 调用路径、R2
// 持久化、超时与轮询策略。
//
// 与 gpt-image submitGeneration 对齐的三个关键点：
// - per-image retry：2 次 × 2s（wellapi 偶发 cold start 撞超时，重试大概率过）
// - R2 持久化：sync url 与 queryTask 拿到 url 都立即 persistCandidateToR2，
//   避免 wellapi URL TTL 过期（实测 1-24h）破图
// - 异步轮询：submit 返回 task_id 后立即结束；前端 workbench 启 setInterval
//   调 /api/image-gen/poll，由 poll 路由转调 queryLingtingTask + 持久化 R2 +
//   写回 imageJob.resultUrls。这样服务端永远不阻塞到 Vercel 60s/300s 上限。
//
// 限制：
// - 单图所以 imageIdx 写 0；size 规范化 "auto" → "1024x1024"
// - wellapi /v1/images/edits 必须带 image，所以 gpt_image_2 仅支持 image_*
//   模式（text_to_image 已在 types.ts capabilities 里移除）
// - 宫格拼接（candidateCount=4/9）：workbench 在调用前已把 prompt 加拼接后缀
//   并 batchSize=1，本适配器无感；拿到 1 张拼接图直接返
export const gptImage2Adapter: ImageModelAdapter = {
  config: IMAGE_MODELS.gpt_image_2,
  validate(req) {
    if (!req.prompt) return "GPT-Image-2 需要 prompt";
    if (req.mode === "image_to_image" && !req.imageUrl)
      return "图生图模式需要 imageUrl";
    if (req.mode === "inpainting" && !req.maskUrl)
      return "局部重绘需要 maskUrl";
    if (req.batchSize && req.batchSize > 10)
      return "GPT-Image-2 单次最多 10 张";
    if (req.negativePrompt) return "GPT-Image-2 不支持反向提示词";
    if (!GEMINI_CONFIG.apiKey) return "LINGTING_API_KEY 未配置";
    return null;
  },
  async generate(req) {
    if (!req.imageUrl) {
      return {
        success: false,
        model: "gpt_image_2",
        status: "failed",
        error: "GPT-Image-2 (via WellAPI) 仅支持图生图模式，请先上传或选参考图",
      };
    }

    const size = req.size === "auto" ? "1024x1024" : req.size;
    // batchSize > 1：wellapi 一次只返 1 张，需要循环调 batchSize 次收集多张候选。
    // 每张独立走 submitLingtingTask（含 R2 下载 + multipart 上传），并行触发避免
    // 串行等待；任一张抛错就让整批失败（与 gpt-image submitGeneration 的语义一致）。
    // 2026-08-18：上限从 4 提到 10，与 IMAGE_MODELS.gpt_image_2.maxBatchSize 保持一致。
    const batchSize = Math.min(req.batchSize ?? 1, 10);

    // 2026-08-18：加 per-image retry（2 次 × 2s），与 gpt-image submitGeneration
    // 同语义。原因：batchSize > 1 时 Promise.allSettled 并发触发 2-N 次
    // submitLingtingTask，Lingting 偶发 cold start 单张超时（AbortError
    // "The operation was aborted due to timeout"）会让整批 failed —
    // 用户体感 "第 2 张失败、其他图也没出来"。submitLingtingTask 自身没
    // retry（避免 Lingting 重复扣配额），retry 包在外层，2 次短间隔足够
    // 覆盖 cold start；都失败才计入 failures 走整批失败分支。
    const tasks = await Promise.allSettled(
      Array.from({ length: batchSize }, (_, i) =>
        retrySubmitLingtingTask(req.imageUrl!, req.prompt, size, i, 2, 2000)
      )
    );

    // 任一失败 → 整批 failed（避免部分成功导致 UI 显示不全）
    const failures = tasks
      .map((t, i) => ({ t, i }))
      .filter((x) => x.t.status === "rejected");
    if (failures.length > 0) {
      const msgs = failures
        .map((x) =>
          x.t.status === "rejected" ? (x.t.reason?.message ?? "未知错误") : ""
        )
        .join("；");
      return {
        success: false,
        model: "gpt_image_2",
        status: "failed",
        error: `第 ${failures.map((x) => x.i + 1).join("/")} 张失败：${msgs}`,
      };
    }

    // 全部成功：收集所有 url（已落 R2 永久 URL）。
    // submitLingtingTask 可能返 sync {kind:"url"} 或 async {kind:"task"}，
    // batchSize>1 时任一是 task 形态就走混合流程——这里只把 url 形态的
    // 收集成 images 立即返回，task 形态目前不接受（workbench UI 也不
    // 支持多 taskId 聚合），单 task 兜底返第一张。
    const urls: string[] = [];
    for (const t of tasks) {
      if (t.status === "fulfilled" && t.value.kind === "url") {
        urls.push(...t.value.urls);
      }
    }
    if (urls.length === 0) {
      // 全部是 async task（少见）：拿第一个 taskId 走原有轮询路径，
      // imageJob.resultUrls 暂时是空，等 queryTask 拿 url 后填。
      const firstTask = tasks.find(
        (t) => t.status === "fulfilled" && t.value.kind === "task"
      );
      if (
        firstTask &&
        firstTask.status === "fulfilled" &&
        firstTask.value.kind === "task"
      ) {
        return {
          success: true,
          model: "gpt_image_2",
          taskId: firstTask.value.taskId,
          status: "processing",
        };
      }
    }

    return {
      success: true,
      model: "gpt_image_2",
      status: "completed",
      images: urls.map((u) => ({ url: u })),
      cost: 0.04 * batchSize,
      currency: "USD",
    };
  },
  /**
   * 异步任务轮询：完全转调 gpt-image 的 queryLingtingTask，
   * 拿到 url 后立即持久化 R2（关键：与 gpt-image submitGeneration 同语义）。
   */
  async queryTask(taskId) {
    const q = await queryLingtingTask("_wbl", taskId, 0);

    if (q.state === "pending") {
      return {
        success: true,
        model: "gpt_image_2",
        taskId,
        status: "processing",
      };
    }
    if (q.state === "failed") {
      return {
        success: false,
        model: "gpt_image_2",
        taskId,
        status: "failed",
        error: q.error,
      };
    }
    // done：queryLingtingTask 已落 R2，直接用 urls[0]（workbench 期望单图）
    return {
      success: true,
      model: "gpt_image_2",
      taskId,
      status: "completed",
      images: [{ url: q.urls[0] ?? "" }],
      cost: 0.04,
      currency: "USD",
    };
  },
};

// ============ 10/11. Gemini 接口统一实现 ============
// Nano Banana Pro (gemini-3-pro-image-preview) 与 Nano Banana 2 (gemini-3.1-flash-image-preview)
// 共用同一个 Gemini generateContent 接口，仅 model 名称不同

async function callGeminiImageAPI(
  modelId: ImageModelId,
  model: string,
  req: GenerateImageRequest
): Promise<GenerateImageResult> {
  const apiKey = GEMINI_CONFIG.apiKey;
  const baseUrl = GEMINI_CONFIG.baseUrl;

  if (!apiKey) {
    return {
      success: false,
      model: modelId,
      status: "failed",
      error: "LINGTING_API_KEY 未配置，请在环境变量中设置",
    };
  }

  const startTime = Date.now();

  // 构造 Gemini generateContent 请求体
  const parts: Array<Record<string, unknown>> = [{ text: req.prompt }];

  // 参考图：data URI 抽 base64 走 inline_data；https URL 走 file_data
  if (req.imageUrl) {
    if (req.imageUrl.startsWith("data:")) {
      const match = req.imageUrl.match(/^data:(image\/[\w+]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inline_data: { mime_type: match[1], data: match[2] },
        });
      }
    } else if (/^https?:\/\//.test(req.imageUrl)) {
      parts.push({
        file_data: { file_uri: req.imageUrl, mime_type: "image/png" },
      });
    }
  }

  // 尺寸映射: ImageSize → aspectRatio + imageSize
  const sizeMap: Record<string, { aspectRatio: string; imageSize: string }> = {
    "512x512": { aspectRatio: "1:1", imageSize: "512" },
    "1024x1024": { aspectRatio: "1:1", imageSize: "1K" },
    "1024x1792": { aspectRatio: "9:16", imageSize: "1K" },
    "1792x1024": { aspectRatio: "16:9", imageSize: "1K" },
    "2048x2048": { aspectRatio: "1:1", imageSize: "2K" },
  };
  const config = sizeMap[req.size] ?? { aspectRatio: "1:1", imageSize: "1K" };

  const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: config.aspectRatio,
            imageSize: config.imageSize,
          },
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        success: false,
        model: modelId,
        status: "failed",
        error: `API 返回 ${res.status}: ${errText.slice(0, 300)}`,
      };
    }

    const data = await res.json();
    const duration = Date.now() - startTime;

    // 递归查找图片数据（兼容 snake_case / camelCase / URL 格式）
    let imageUrl = "";
    let revisedPrompt = "";

    function findImage(obj: unknown): void {
      if (!obj || typeof obj !== "object") return;
      const o = obj as Record<string, unknown>;

      // snake_case: inline_data.data + inline_data.mime_type
      if (o.inline_data && typeof o.inline_data === "object") {
        const d = o.inline_data as Record<string, unknown>;
        const data = d.data as string;
        const mime = (d.mime_type as string) || "image/png";
        if (data?.startsWith("http")) {
          imageUrl = data;
        } else if (data) {
          imageUrl = `data:${mime};base64,${data}`;
        }
        return;
      }

      // camelCase: inlineData.data + inlineData.mimeType
      if (o.inlineData && typeof o.inlineData === "object") {
        const d = o.inlineData as Record<string, unknown>;
        const data = d.data as string;
        const mime = (d.mimeType as string) || "image/png";
        if (data?.startsWith("http")) {
          imageUrl = data;
        } else if (data) {
          imageUrl = `data:${mime};base64,${data}`;
        }
        return;
      }

      // URL 格式: { type: "image", source: { type: "url", url: "..." } }
      if (o.type === "image" && o.source && typeof o.source === "object") {
        const src = o.source as Record<string, unknown>;
        if (src.type === "url" && typeof src.url === "string") {
          imageUrl = src.url;
        }
        return;
      }

      // 文本
      if (typeof o.text === "string" && o.text.length > 0 && !imageUrl) {
        revisedPrompt = o.text;
      }

      // 递归
      for (const v of Object.values(o)) {
        if (Array.isArray(v)) v.forEach(findImage);
        else if (typeof v === "object") findImage(v);
      }
    }

    findImage(data);

    // 2026-08-27：上游 wellapi.cc 返回的 URL 有 TTL（典型 1-24h），
    // 与 gpt_image_2 适配器走 lingting wrapper 时由 persistCandidateToR2
    // 自动转存 R2 一致；Gemini 这条路径不走 lingting，adapter 自己负责
    // 把 http(s) URL fetch + 上传 R2，永久化。data: URL 不转存
    // （thumbnailUrl 短路规则直接走，存 R2 没意义反而膨胀体积）。
    // 失败语义：抛错，与 gpt-image persistCandidateToR2 保持一致，
    // 避免 "R2 未配置 / fetch 撞 timeout 时 Gemini 静默返 TTL URL，
    // 几天后整批图破" 的隐性事故。
    const traceHint = `${modelId}-${Date.now()}-${seededRandom().toString(36).slice(2, 8)}`;
    if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
      try {
        imageUrl = await persistUpstreamImageToR2(imageUrl, traceHint, 0);
      } catch (err) {
        return {
          success: false,
          model: modelId,
          status: "failed",
          error: `上游效果图转存 R2 失败: ${err instanceof Error ? err.message : "unknown"}`,
        };
      }
    }

    if (!imageUrl) {
      return {
        success: false,
        model: modelId,
        status: "failed",
        error: "API 返回成功但未找到图片数据",
        raw: JSON.stringify(data).slice(0, 500),
      };
    }

    return {
      success: true,
      model: modelId,
      status: "completed",
      images: [
        {
          url: imageUrl,
          revisedPrompt: revisedPrompt || undefined,
        },
      ],
      duration,
      cost: modelId === "nano_banana_pro" ? 0.04 : 0.025,
      currency: "USD",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "网络错误";
    return {
      success: false,
      model: modelId,
      status: "failed",
      error: `${model} 调用失败: ${msg}`,
    };
  }
}

export const nanoBananaProAdapter: ImageModelAdapter = {
  config: IMAGE_MODELS.nano_banana_pro,
  validate(req) {
    if (!req.prompt) return "Nano Banana Pro 需要 prompt";
    if (req.batchSize && req.batchSize > 1)
      return "Nano Banana Pro 单次只能生成 1 张";
    if (req.negativePrompt) return "Nano Banana Pro 不支持反向提示词";
    return null;
  },
  async generate(req) {
    return callGeminiImageAPI(
      "nano_banana_pro",
      "gemini-3-pro-image-preview",
      req
    );
  },
};

export const nanoBanana2Adapter: ImageModelAdapter = {
  config: IMAGE_MODELS.nano_banana2,
  validate(req) {
    if (!req.prompt) return "Nano Banana 2 需要 prompt";
    if (req.batchSize && req.batchSize > 1)
      return "Nano Banana 2 单次只能生成 1 张";
    if (req.negativePrompt) return "Nano Banana 2 不支持反向提示词";
    return null;
  },
  async generate(req) {
    return callGeminiImageAPI(
      "nano_banana2",
      "gemini-3.1-flash-image-preview",
      req
    );
  },
};

// ============ 适配器注册表 ============
export const IMAGE_ADAPTERS: Record<ImageModelId, ImageModelAdapter> = {
  dalle3: dalle3Adapter,
  sd3: sd3Adapter,
  flux1: flux1Adapter,
  midjourney: midjourneyAdapter,
  doubao: doubaoAdapter,
  wanx: wanxAdapter,
  ernie: ernieAdapter,
  cogview: cogviewAdapter,
  gpt_image_2: gptImage2Adapter,
  nano_banana_pro: nanoBananaProAdapter,
  nano_banana2: nanoBanana2Adapter,
};

// ============ 统一调度入口 ============
export async function dispatchGenerateImage(
  req: GenerateImageRequest
): Promise<GenerateImageResult> {
  const adapter = IMAGE_ADAPTERS[req.model];
  if (!adapter) {
    return {
      success: false,
      model: req.model,
      status: "failed",
      error: `未知的生图模型: ${req.model}`,
    };
  }
  // 检查状态
  if (adapter.config.status === "maintenance") {
    return {
      success: false,
      model: req.model,
      status: "failed",
      error: `${adapter.config.name} 当前维护中`,
    };
  }
  if (adapter.config.status === "deprecated") {
    return {
      success: false,
      model: req.model,
      status: "failed",
      error: `${adapter.config.name} 已下线`,
    };
  }
  // 校验
  const validationError = adapter.validate(req);
  if (validationError) {
    return {
      success: false,
      model: req.model,
      status: "failed",
      error: validationError,
    };
  }
  // 调用
  try {
    return await adapter.generate(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知错误";
    return { success: false, model: req.model, status: "failed", error: msg };
  }
}

// 查询异步任务
export async function dispatchQueryImageTask(
  model: ImageModelId,
  taskId: string
): Promise<GenerateImageResult> {
  const adapter = IMAGE_ADAPTERS[model];
  if (!adapter || !adapter.queryTask) {
    return {
      success: false,
      model,
      status: "failed",
      error: "该模型不支持异步任务查询",
    };
  }
  try {
    return await adapter.queryTask(taskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知错误";
    return { success: false, model, status: "failed", error: msg };
  }
}
