// 生图模型适配器实现
// 业界主流异步任务模式: submit → poll → result
// 当前为 Mock 实现，结构已就绪，部署时填充 fetch 调用即可
// Gemini 两个模型走真实 generateContent 接口（需配置 LINGTING_API_KEY）

import { randomUUID } from "node:crypto";
// Phase 起：gpt_image_2 适配器直接跨 feature 复用 gpt-image 的 wellapi 调用。
// 不抽 shared —— 同项目的 PromptTemplateView 也是从 gpt-image/lib/types 导的，
// 跨 feature import 在这个仓库已经是有先例的模式。
import {
  persistBase64ToR2,
  persistCandidateToR2,
  queryLingtingTask,
  submitLingtingTask,
} from "@/features/gpt-image/lib/generation-service";
import { seededRandom } from "../providers/random";
import {
  APIMART_CONFIG,
  getApimartApiKey,
  isApimartConfigured,
} from "./apimart-config";
import { GEMINI_CONFIG } from "./gemini-config";
import {
  type GenerateImageRequest,
  type GenerateImageResult,
  IMAGE_MODELS,
  type ImageModelAdapter,
  type ImageModelConfig,
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
//   - <model> 可以包含下划线（qwen、gpt_image_2、nano_banana2）
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

// ============ 1. 通义千问 qwen-image 适配器（异步任务模式） ============
// 原 wanxAdapter（2026-09-11 重命名）：阿里通义万相 → 通义千问 qwen-image。
// 当前实现仍是占位（submit → poll → 占位图），结构与其它 mock adapter 一致；
// 真实接入 dashscope 时复用 parseTaskModel + genTaskId 即可。
export const qwenAdapter: ImageModelAdapter = {
  config: IMAGE_MODELS.qwen,
  validate(req) {
    if (!req.prompt) return "通义千问 需要 prompt";
    if (req.batchSize && req.batchSize > 4) return "通义千问 单次最多 4 张";
    if (req.negativePrompt) return "通义千问 当前版不支持反向提示词";
    if (req.guidanceScale) return "通义千问 不支持 guidanceScale";
    return null;
  },
  async generate(req) {
    await simulateLatency(500);
    const taskId = genTaskId("qwen");
    const { width, height } = parseSize(
      req.size,
      req.customWidth,
      req.customHeight
    );
    return {
      success: true,
      model: "qwen",
      taskId,
      status: "processing",
      raw: {
        endpoint:
          "POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
        payload: {
          model: "qwen-image",
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
    const seed = taskId.replace("imgtask_qwen_", "");
    return {
      success: true,
      model: "qwen",
      taskId,
      status: "completed",
      images: Array.from({ length: 4 }, (_, i) => ({
        url: genImageUrl(`qwen_${seed}`, i),
      })),
      duration: 6500,
      cost: 0.16 * 4,
      currency: "CNY",
    };
  },
};

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
  imageUrls: string[],
  prompt: string,
  size: string,
  imageIdx: number,
  maxRetries = 2,
  delayMs = 2000,
  n = 1
): Promise<Awaited<ReturnType<typeof submitLingtingTask>>> {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await submitLingtingTask(
        "_wbl",
        // 2026-09-03：多图参考直接传 imageUrls[]（2026-09-02 起的签名）
        imageUrls,
        prompt,
        size,
        imageIdx,
        n
      );
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
    // 2026-09-03：多图改用 imageUrls[]。buildGenerateRequest 已把单数 imageUrl
    // 包成 [imageUrl]，这里只看数组。
    if (
      req.mode === "image_to_image" &&
      (!req.imageUrls || req.imageUrls.length === 0)
    )
      return "图生图模式需要至少 1 张参考图";
    if (req.imageUrls && req.imageUrls.length > 10)
      return "GPT-Image-2 单次最多 10 张参考图";
    if (req.mode === "inpainting" && !req.maskUrl)
      return "局部重绘需要 maskUrl";
    if (req.batchSize && req.batchSize > 10)
      return "GPT-Image-2 单次最多 10 张";
    if (req.negativePrompt) return "GPT-Image-2 不支持反向提示词";
    if (!GEMINI_CONFIG.apiKey) return "LINGTING_API_KEY 未配置";
    return null;
  },
  async generate(req) {
    const refUrls = req.imageUrls ?? [];
    if (refUrls.length === 0) {
      return {
        success: false,
        model: "gpt_image_2",
        status: "failed",
        error: "GPT-Image-2 (via WellAPI) 仅支持图生图模式，请先上传或选参考图",
      };
    }

    const size = req.size === "auto" ? "1024x1024" : req.size;
    // 2026-09-02：改单次调用 submitLingtingTask 并传 n=batchSize（与 gpt-image
    // /p/[token] 的 submitGeneration 同语义），不再 fan-out batchSize 次。
    //
    // 原 fan-out 实现的根因 bug：
    // - submitLingtingTask 不传 n 时默认 n=1 = Lingting 拼宫格模式，每次返 1 张拼接大图
    // - V2 batchSize=4 时 fan-out 4 次 → 拿到 4 张宫格图（不是 4 张独立候选）
    // - V2 workbench autoStitch 把这 4 张宫格图再客户端拼一次 → 宫格的宫格
    // - 用户反馈：「生图工作台生成拼接图后我的资产里只看到拼接图，没有原图」——
    //   根本原因是上游 Lingting 在 n=1 模式下永远只返拼接图，没有"原图"可入库
    //
    // 改后：
    // - n=batchSize 让 Lingting 一次返 N 张独立候选（非拼接），保留原图
    // - batchSize=1 时（用户模板自带宫格 + V2 workbench isGridComposite=true）
    //   仍走 n=1 拼接模式，行为不变
    // - batchSize 上限 10，与 IMAGE_MODELS.gpt_image_2.maxBatchSize 一致
    const batchSize = Math.min(req.batchSize ?? 1, 10);

    // 2026-09-02：单次调用 + n=batchSize。submitLingtingTask 自身没 retry
    // （避免 Lingting 重复扣配额），retry 仍包在外层 2 次 × 2s 覆盖 cold start。
    let submitResult: Awaited<ReturnType<typeof submitLingtingTask>>;
    try {
      submitResult = await retrySubmitLingtingTask(
        refUrls,
        req.prompt,
        size,
        0,
        2,
        2000,
        batchSize
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      return {
        success: false,
        model: "gpt_image_2",
        status: "failed",
        error: `提交生图失败：${msg}`,
      };
    }

    // 同步返 url（n=N 时 Lingting 直接返 N 张独立图，已落 R2）
    if (submitResult.kind === "url") {
      const urls = submitResult.urls;
      if (urls.length === 0) {
        // 防御：理论上不会到这里（kind:"url" 必有 urls）
        return {
          success: false,
          model: "gpt_image_2",
          status: "failed",
          error: "Lingting 未返回任何图片 URL",
        };
      }
      return {
        success: true,
        model: "gpt_image_2",
        status: "completed",
        images: urls.map((u) => ({ url: u })),
        cost: 0.04 * batchSize,
        currency: "USD",
      };
    }

    // 异步 task：拿 taskId 走原有轮询路径（少见 —— n=N 通常 Lingting 同步返）
    {
      const taskId = submitResult.taskId;
      if (!taskId) {
        return {
          success: false,
          model: "gpt_image_2",
          status: "failed",
          error: "Lingting 响应格式异常（无 task_id 也无 url）",
        };
      }
      return {
        success: true,
        model: "gpt_image_2",
        taskId,
        status: "processing",
      };
    }
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

// ============ 2. Nano Banana 2 (gemini-3.1-flash-image-preview) Gemini 接口实现 ============
// 2026-09-11：Nano Banana Pro 已精简移除；callGeminiImageAPI 现在只为 Nano Banana 2 服务。
// 保留 helper 命名结构（modelId/model 参数化）以便后续若再扩展 Gemini 系列时复用。

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

  // 参考图：data URI 抽 base64 走 inline_data；https URL 走 file_data。
  // 2026-09-03 V1 多图：取 imageUrls[]（兼容旧 imageUrl 单数）；
  // 多张按顺序拼 parts，Gemini 支持 inline_data/file_data 多个。
  const refUrls =
    req.imageUrls && req.imageUrls.length > 0
      ? req.imageUrls
      : req.imageUrl
        ? [req.imageUrl]
        : [];
  for (const refUrl of refUrls) {
    if (refUrl.startsWith("data:")) {
      const match = refUrl.match(/^data:(image\/[\w+]+);base64,(.+)$/);
      if (match) {
        parts.push({
          inline_data: { mime_type: match[1], data: match[2] },
        });
      }
    } else if (/^https?:\/\//.test(refUrl)) {
      parts.push({
        file_data: { file_uri: refUrl, mime_type: "image/png" },
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
    // Gemini 这条 path 不走 lingting（gpt_image_2 那条 path 内部 lingting
    // wrapper 已自动 persistCandidateToR2），adapter 自己负责拉 upstream
    // 转存 R2。直接复用 gpt-image/lib/generation-service 已有的 helper：
    // URL 形态 → persistCandidateToR2；inline base64 → persistBase64ToR2。
    // 跨 feature import 在本仓库有先例（gpt_image_2 adapter 同文件就导过
    // lingting helpers），不抽 shared。
    // 失败语义：抛错，与 gpt-image 既有 helper 保持一致，
    // 避免 "R2 未配置 / fetch 撞 timeout 时 Gemini 静默返 TTL URL，
    // 几天后整批图破" 的隐性事故。
    const traceHint = `${modelId}-${Date.now()}-${seededRandom().toString(36).slice(2, 8)}`;
    if (imageUrl) {
      try {
        if (imageUrl.startsWith("data:")) {
          // findImage 已经把 inline_data 拼成 data:<mime>;base64,<b64>
          const m = imageUrl.match(/^data:([^;]+);base64,(.+)$/i);
          if (m) {
            imageUrl = await persistBase64ToR2(m[2]!, m[1]!, traceHint, 0);
          }
          // 形态不对则保守透传（fall through）
        } else if (/^https?:\/\//i.test(imageUrl)) {
          imageUrl = await persistCandidateToR2(imageUrl, traceHint, 0);
        }
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
      // 2026-09-11：Nano Banana Pro 已精简移除；Gemini path 仅剩 Nano Banana 2
      // （gemini-3.1-flash-image-preview），单价固定 0.025 USD/张。
      cost: 0.025,
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

// ============ 4. Apimart gpt-image-2.5 适配器（flare / sunburst 异步任务模式） ============
// 2026-10-XX：gpt-image-2.5-ext 弃用 → 官方文档列 gpt-image-2.5-flare 与
// gpt-image-2.5-sunburst 两个并列 model 字段（不再有 version 子字段）。
// adapter 改成工厂模式 createApimartAdapter({ upstreamModel, config })，
// 同一套 submit / poll / R2 持久化路径给两个 IMAGE_MODELS 条目复用。
//
// 关键设计决策：
// - 每提交带 Idempotency-Key（UUID v4）：apimart 强要求 + 我们重试安全
// - X-APIMart-Response-Version 头固定 2026-07-27：apimart 文档要求
// - size 映射：apimart 接受 aspect ratio（"1:1" / "16:9" 等 15 种）或 "auto"
//   或精确像素（"1600x1200"，文档示例）；pixelToRatio 仅当「WxH 不被 apimart
//   接受」时降级兜底（当前 apimart 接受精确像素，所以多半直接透传）
// - resolution 默认 1K；quality 默认 auto（apimart 按尺寸最高档预留额度，
//   任务完成按真实 token 用量结算）
// - R2 持久化：queryTask 拿到 url 时立即 persistCandidateToR2（wellapi URL
//   TTL 1-24h 教训：参考本文件 gpt_image_2 adapter 注释 +
//   persistCandidateToR2 的实现约定）
// - taskId 格式："task_<id>"（apimart 真实任务 id），不进 legacy
//   /api/image/task/[id] parseTaskModel 解析路径 —— 与 gpt_image_2 一致，
//   新工作台靠 imageJob.model 列 dispatch（见 generation-service.advanceImageGenJob）
// - 上限：n=1..4（与 schema 一致），imageUrls 1..16（schema 现约束 10，
//   adapter 内防御性再校验到 16，超出返 400 错误）
// - mask_url：apimart 接受透明 PNG 局部重绘蒙版（与 image_urls 联用），
//   adapter 透传 req.maskUrl → body.mask_url

/** 像素 → 比例 映射。apimart 文档现接受 "1:1"、"16:9" 等 15 种 ratio + 精确像素（"1600x1200"），
 * 这里只在下游 schema 给的 WxH 不被 apimart 直白认（即 W/H 不在 ratio 表里）时降级
 * 兜底。最近 15 种 ratio。 */
function pixelToRatio(width: number, height: number): string {
  // 2026-10-XX：扩为 15 种（加 2:1 / 1:2 / 3:1 / 1:3 / 9:21）
  // 计算最近 ratio（EPS=0.02，约 ±2%）
  const ratio = width / height;
  const ratios: Array<[string, number]> = [
    ["1:1", 1],
    ["16:9", 16 / 9], // 1.778
    ["9:16", 9 / 16], // 0.5625
    ["4:3", 4 / 3], // 1.333
    ["3:4", 3 / 4], // 0.75
    ["3:2", 3 / 2], // 1.5
    ["2:3", 2 / 3], // 0.667
    ["5:4", 5 / 4], // 1.25
    ["4:5", 4 / 5], // 0.8
    ["21:9", 21 / 9], // 2.333
    ["2:1", 2],
    ["1:2", 0.5],
    ["3:1", 3],
    ["1:3", 1 / 3],
    ["9:21", 9 / 21], // 0.4286
  ];
  let best: { ratio: string; diff: number } = { ratio: "1:1", diff: Infinity };
  for (const [r, v] of ratios) {
    const diff = Math.abs(Math.log(ratio / v));
    if (diff < best.diff) best = { ratio: r, diff };
  }
  return best.ratio;
}

/** schema.quality → apimart resolution（1K/2K/4K）。当前 quality 不在 GenerateImageRequest 暴露，
 * 一律走 1K（最低成本档）；UI 后续接 quality 字段时同步扩此处 */
function qualityToResolution(_quality?: string): "1K" | "2K" | "4K" {
  // 2026-10-XX：gpt-image-2.5 文档 quality 五档 low/medium/high/xhigh/max，
  // 适配档用最高档 max 留预占，4K 我们不主动送 —— 保守走 1K。
  // 留两个分支给未来 UI 扩 quality 切换时用。
  return "1K";
}

/** GenerateImageRequest.size → apimart size string */
function resolveApimartSize(req: GenerateImageRequest): string {
  const size = req.size;
  if (size === "auto" || size === undefined) return "auto";
  // 自定义像素 → 算最近比例
  if (size === "custom") {
    const w = req.customWidth ?? 1024;
    const h = req.customHeight ?? 1024;
    return pixelToRatio(w, h);
  }
  // 标准像素 → 优先透传（apimart 文档示例接受 "1600x1200"），
  // 不在 apimart 文档 16 的倍数 + ≤3840 单边规则附近时才降级到 ratio
  const parts = size.split("x");
  if (parts.length === 2) {
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      const bothMultipleOf16 = w % 16 === 0 && h % 16 === 0;
      const withinLimit = w <= 3840 && h <= 3840;
      // 直接透传精确像素；不满足尺寸规则时降级到 ratio
      return bothMultipleOf16 && withinLimit
        ? size
        : pixelToRatio(w, h);
    }
  }
  return "auto";
}

/** apimart 上游 model 字符串（提交请求 body.model 用） */
type ApimartUpstreamModel = "gpt-image-2.5-flare" | "gpt-image-2.5-sunburst";

/**
 * 提交生图任务（apimart POST /v1/images/generations）。
 *
 * 失败语义：网络/4xx/5xx 抛错，由 dispatchGenerateImage 的外层 try/catch 包成
 * GenerateImageResult{status:"failed"}。同步拿到 taskId 不抛错，返回
 * GenerateImageResult{status:"processing", taskId}。
 *
 * 幂等性：每次调用生成新 Idempotency-Key（UUID v4）—— apimart 文档建议：
 * "每次新的生成操作创建一次；重试同一操作时保留原值"。
 * 我们的 retry 模式是"外层自己重试"（与 gpt_image_2 同语义），所以
 * 每次都生成新 key —— 重试确实视为新操作。
 *
 * 2026-10-XX：submit 响应格式从 { data: { id } } 改为 { data: [{ task_id }] }
 * （apimart 文档明示 "data 是数组，请读取 data[0].task_id"）。此处同时兼容
 * 旧的 object 形态（防御性 fallback），未来全面切新格式后可删。
 */
async function submitApimartTask(
  body: Record<string, unknown>,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ taskId: string }> {
  const url = `${APIMART_CONFIG.baseUrl.replace(/\/+$/, "")}/v1/images/generations`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-APIMart-Response-Version": APIMART_CONFIG.responseVersion,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `apimart submit ${res.status}: ${text.slice(0, 300) || res.statusText}`
    );
  }
  const data = (await res.json()) as {
    code?: number;
    // 新文档：data 是数组 [{ task_id, status }]
    // 旧/保险：data 也可能是对象 { id, status }
    data?:
      | Array<{ task_id?: string; id?: string; status?: string }>
      | { task_id?: string; id?: string; status?: string }
      | undefined;
    error?: { message?: string };
  };
  // apimart 业务错误：{ error: { message, type, code } }
  if (data.error?.message) {
    throw new Error(`apimart submit 业务错误: ${data.error.message}`);
  }
  // 抽 task_id —— 优先新文档数组形态
  let taskId: string | undefined;
  if (Array.isArray(data.data) && data.data.length > 0) {
    const first = data.data[0] as { task_id?: string; id?: string };
    taskId = first.task_id ?? first.id;
  } else if (data.data && typeof data.data === "object") {
    const obj = data.data as { task_id?: string; id?: string };
    taskId = obj.task_id ?? obj.id;
  }
  if (!taskId) {
    throw new Error(
      `apimart submit 响应缺 taskId: ${JSON.stringify(data).slice(0, 200)}`
    );
  }
  return { taskId };
}

/**
 * 查询任务结果（apimart GET /v1/tasks/{taskId}）。
 *
 * 返回：
 * - pending / processing：返 { state: "pending" }
 * - failed：抛错（adapter 外层包成 failed 返回体）
 * - completed：返 { state: "done", urls, cost, creditsCost }
 *
 * 完成后**立刻**走 persistCandidateToR2 把 url 转存（wellapi TTL 教训），
 * adapter 返回的 url 是 R2 永久链接。
 */
async function queryApimartTask(
  taskId: string,
  apiKey: string,
  traceHint: string,
  fetchImpl: typeof fetch = fetch
): Promise<{
  state: "pending" | "failed" | "done";
  urls: string[];
  cost?: number;
  creditsCost?: number;
  error?: string;
}> {
  const url = `${APIMART_CONFIG.baseUrl.replace(/\/+$/, "")}/v1/tasks/${encodeURIComponent(taskId)}`;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-APIMart-Response-Version": APIMART_CONFIG.responseVersion,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `apimart query ${res.status}: ${text.slice(0, 300) || res.statusText}`
    );
  }
  const data = (await res.json()) as {
    code?: number;
    data?: {
      id?: string;
      status?: "pending" | "processing" | "completed" | "failed";
      progress?: number;
      result?: { images?: Array<{ url?: string[]; expires_at?: number }> };
      cost?: number;
      credits_cost?: number;
      error?: { message?: string };
    };
    error?: { message?: string };
  };

  const inner = data.data;
  if (!inner) {
    throw new Error(
      `apimart query 响应缺 data: ${JSON.stringify(data).slice(0, 200)}`
    );
  }

  const status = inner.status;
  if (status === "completed") {
    // 抽 result.images[].url[] 并立即落 R2
    const upstreamUrls = (inner.result?.images ?? []).flatMap((img) =>
      Array.isArray(img.url) ? img.url : []
    );
    const persistedUrls: string[] = [];
    for (let idx = 0; idx < upstreamUrls.length; idx++) {
      try {
        persistedUrls.push(
          await persistCandidateToR2(upstreamUrls[idx]!, traceHint, idx)
        );
      } catch (err) {
        // 单张失败不阻塞整批 —— 透传原 url 兜底
        // eslint-disable-next-line no-console
        console.warn(`[apimart] persistCandidateToR2 失败，透传原 url:`, err);
        persistedUrls.push(upstreamUrls[idx]!);
      }
    }
    return {
      state: "done",
      urls: persistedUrls,
      ...(typeof inner.cost === "number" ? { cost: inner.cost } : {}),
      ...(typeof inner.credits_cost === "number"
        ? { creditsCost: inner.credits_cost }
        : {}),
    };
  }

  if (status === "failed") {
    return {
      state: "failed",
      urls: [],
      error: inner.error?.message ?? "apimart 生成失败",
    };
  }

  // pending / processing
  return { state: "pending", urls: [] };
}

/**
 * Apimart gpt-image-2.5 适配器工厂（2026-10-XX 重构）
 *
 * 替旧的单 apimartGptImageAdapter 常量 —— 现在 flare / sunburst 两个并列
 * IMAGE_MODELS 条目复用同一套 submit / poll / R2 持久化代码，靠 closure 捕获
 * 上游 model 字符串 + 下游 ImageModelId。
 *
 * 异步任务模式：generate 返回 taskId，由前端 /api/image-gen/jobs/[id]/poll
 * → advanceImageGenJob → dispatchQueryImageTask → queryTask 三段式推进。
 */
function createApimartAdapter(opts: {
  upstreamModel: ApimartUpstreamModel;
  config: ImageModelConfig;
}): ImageModelAdapter {
  const { upstreamModel, config } = opts;
  const downstreamId = config.id;

  return {
    config,
    validate(req) {
      if (!req.prompt) return `${config.name} 需要 prompt`;
      // 防御性：schema 已限 imageUrls 最多 10，apimart 上限 16 —— 留作底线
      if (req.imageUrls && req.imageUrls.length > 16)
        return `${config.name} 单次最多 16 张参考图`;
      // batchSize 上限 4（schema 已限，adapter 防御性再校）
      if (req.batchSize && req.batchSize > 4)
        return `${config.name} 单次最多 4 张`;
      // 反向提示词 apimart 不支持
      if (req.negativePrompt) return `${config.name} 不支持反向提示词`;
      // inpainting 必须带 maskUrl
      if (req.mode === "inpainting" && !req.maskUrl)
        return `${config.name} 局部重绘需要 maskUrl`;
      if (!isApimartConfigured()) return "APIMART_API_KEY 未配置";
      return null;
    },
    async generate(req) {
      const apiKey = getApimartApiKey();
      if (!apiKey) {
        return {
          success: false,
          model: downstreamId,
          status: "failed",
          error: "APIMART_API_KEY 未配置，请在环境变量中设置",
        };
      }

      const refUrls = req.imageUrls ?? [];
      const size = resolveApimartSize(req);
      const n = Math.min(Math.max(req.batchSize ?? 1, 1), 4);

      const body: Record<string, unknown> = {
        model: upstreamModel,
        prompt: req.prompt,
        size,
        resolution: qualityToResolution(undefined), // 默认 1K；后续接 quality 字段
        n,
      };
      // 图生图：传 image_urls（apimart 文档用 image_urls 复数）
      if (refUrls.length > 0) {
        body.image_urls = refUrls;
      }
      // 局部重绘：mask_url 与 image_urls 联用。apimart 文档要求蒙版是
      // 带 Alpha 通道的 PNG，与 image_urls[0] 尺寸一致 —— 调用方负责。
      if (req.maskUrl && refUrls.length > 0) {
        body.mask_url = req.maskUrl;
      }

      try {
        const { taskId } = await submitApimartTask(body, apiKey);
        return {
          success: true,
          model: downstreamId,
          taskId,
          status: "processing",
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        return {
          success: false,
          model: downstreamId,
          status: "failed",
          error: `提交生图失败：${msg}`,
        };
      }
    },
    async queryTask(taskId) {
      const apiKey = getApimartApiKey();
      if (!apiKey) {
        return {
          success: false,
          model: downstreamId,
          taskId,
          status: "failed",
          error: "APIMART_API_KEY 未配置",
        };
      }

      const traceHint = `apimart-${upstreamModel}-${taskId}-${seededRandom().toString(36).slice(2, 8)}`;
      try {
        const q = await queryApimartTask(taskId, apiKey, traceHint);
        if (q.state === "pending") {
          return {
            success: true,
            model: downstreamId,
            taskId,
            status: "processing",
          };
        }
        if (q.state === "failed") {
          return {
            success: false,
            model: downstreamId,
            taskId,
            status: "failed",
            error: q.error,
          };
        }
        // done —— urls 已落 R2
        if (q.urls.length === 0) {
          return {
            success: false,
            model: downstreamId,
            taskId,
            status: "failed",
            error: `${config.name} 完成任务但未返回图片 URL`,
          };
        }
        return {
          success: true,
          model: downstreamId,
          taskId,
          status: "completed",
          images: q.urls.map((u) => ({ url: u })),
          cost: q.cost ?? 0.2,
          currency: "USD",
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        return {
          success: false,
          model: downstreamId,
          taskId,
          status: "failed",
          error: `任务查询失败：${msg}`,
        };
      }
    },
  };
}

/** Apimart GPT-Image-2.5 Flare —— 默认款，速度优先 */
export const apimartGptImageAdapter: ImageModelAdapter = createApimartAdapter({
  upstreamModel: "gpt-image-2.5-flare",
  config: IMAGE_MODELS.apimart_gpt_image,
});

/** Apimart GPT-Image-2.5 Sunburst —— 精度优先款，与 flare 并列条目 */
export const apimartGptImageSunburstAdapter: ImageModelAdapter =
  createApimartAdapter({
    upstreamModel: "gpt-image-2.5-sunburst",
    config: IMAGE_MODELS.apimart_gpt_image_sunburst,
  });

// 2026-09-11：精简为 3 个核心 adapter（qwen / gpt_image_2 / nano_banana2）。
// 2026-10-12：新增 apimart_gpt_image adapter（接入 apimart.ai gpt-image-2.5-ext）。
// 2026-10-XX：apimart_gpt_image 改指 flare；新增 apimart_gpt_image_sunburst 并列条目。
export const IMAGE_ADAPTERS: Record<ImageModelId, ImageModelAdapter> = {
  qwen: qwenAdapter,
  gpt_image_2: gptImage2Adapter,
  nano_banana2: nanoBanana2Adapter,
  apimart_gpt_image: apimartGptImageAdapter,
  apimart_gpt_image_sunburst: apimartGptImageSunburstAdapter,
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
