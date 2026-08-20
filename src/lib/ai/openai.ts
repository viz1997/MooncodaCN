import OpenAI from "openai";

/**
 * AI 提供商类型
 */
export type AIProvider = "openai" | "deepseek" | "mimo";

/**
 * 获取当前配置的 AI 提供商
 */
export function getAIProvider(): AIProvider {
  return (process.env.AI_PROVIDER as AIProvider) || "openai";
}

/**
 * 获取 AI 模型名称
 */
export function getAIModel(): string {
  const provider = getAIProvider();
  if (provider === "deepseek") {
    return process.env.DEEPSEEK_MODEL || "deepseek-chat";
  }
  if (provider === "mimo") {
    return process.env.MIMO_MODEL || "mimo-v2-flash";
  }
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

/**
 * OpenAI 客户端 baseURL 解析优先级：
 *  1. OPENAI_BASE_URL —— 直连上游 / 自配代理（如用户在中港澳台需自配）
 *  2. CF_AIG_BASE_URL + CF_AIG_TOKEN —— Cloudflare AI Gateway
 *  3. 默认 https://api.openai.com
 *
 * 早期版本只走 CF AI Gateway；画布内置渠道 image/audio 测试时若用户
 * 网关不通，会出现 undici connectTimeout 10s × 3 次重试 ≈ 38s 后
 * SDK 抛 APIConnectionTimeoutError。OPENAI_BASE_URL 直接覆盖网关，
 * 给"不走网关 / 自配代理"的场景一个干净的兜底。
 */
function resolveOpenAIBaseURL(): string | undefined {
  if (process.env.OPENAI_BASE_URL?.trim()) {
    return process.env.OPENAI_BASE_URL.trim();
  }
  const token = process.env.CF_AIG_TOKEN;
  const baseURL = process.env.CF_AIG_BASE_URL;
  if (token && baseURL) return baseURL;
  return undefined;
}

function getOpenAIGatewayConfig(): {
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
} {
  const token = process.env.CF_AIG_TOKEN;
  const baseURL = process.env.CF_AIG_BASE_URL;
  if (!token || !baseURL) return {};

  return {
    baseURL,
    defaultHeaders: {
      "cf-aig-authorization": `Bearer ${token}`,
    },
  };
}

/**
 * OpenAI 客户端实例
 */
const openaiBaseURL = resolveOpenAIBaseURL();
const openaiGatewayConfig = getOpenAIGatewayConfig();
const useOpenAIGateway =
  !!process.env.CF_AIG_TOKEN &&
  !!process.env.CF_AIG_BASE_URL &&
  !process.env.OPENAI_BASE_URL?.trim();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(openaiBaseURL ? { baseURL: openaiBaseURL } : {}),
  ...(useOpenAIGateway
    ? { defaultHeaders: openaiGatewayConfig.defaultHeaders }
    : {}),
});

/**
 * DeepSeek 客户端实例（使用 OpenAI 兼容模式）
 */
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});

/**
 * 小米 MiMo 客户端实例（使用 OpenAI 兼容模式）
 */
const mimo = new OpenAI({
  apiKey: process.env.MIMO_API_KEY,
  baseURL: useOpenAIGateway
    ? openaiGatewayConfig.baseURL
    : "https://api.xiaomimimo.com/v1",
  ...(useOpenAIGateway
    ? { defaultHeaders: openaiGatewayConfig.defaultHeaders }
    : {}),
});

/**
 * 获取当前活跃的 AI 客户端
 */
function getAIClient(): OpenAI {
  const provider = getAIProvider();
  if (provider === "deepseek") return deepseek;
  if (provider === "mimo") return mimo;
  return openai;
}

/**
 * 通用 Chat Completion 调用
 *
 * 模板示例：封装了 provider 切换逻辑，可直接用于业务调用
 *
 * @param messages - 聊天消息列表
 * @param options - 可选参数（temperature、max_tokens、json mode 等）
 * @returns AI 返回的文本内容
 */
export async function chatCompletion(
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
  }
): Promise<string> {
  const client = getAIClient();
  const model = getAIModel();

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
    ...(options?.jsonMode && { response_format: { type: "json_object" } }),
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    const providerNames: Record<AIProvider, string> = {
      openai: "OpenAI",
      deepseek: "DeepSeek",
      mimo: "MiMo",
    };
    throw new Error(`No response from ${providerNames[getAIProvider()]}`);
  }

  return content;
}

export { deepseek, getAIClient, mimo, openai };

/**
 * 多模态生成（image / audio）
 *
 * 画布内置渠道 Phase 3 后端代理（/api/canvas/generate）调用 —— 浏览器
 * 不再直连上游，统一经后端用系统 Key + 走积分扣减 + R2 永久化。
 *
 * 注意：DeepSeek / MiMo 没有 image / audio 能力，调用前请确保
 * `getAIProvider() === "openai"`；其他 provider 应走"自定义渠道"模式。
 */

/**
 * OpenAI Images API 同步生图（DALL-E / gpt-image-1）
 *
 * 返回 base64 数组（response_format=b64_json 是 gpt-image 唯一支持的形式）。
 * 后端会 fetch → R2 putObject → 永久 URL。
 */
export async function imageGeneration(params: {
  prompt: string;
  model?: string;
  n?: number;
  size?: string;
  quality?: string;
  background?: string;
}): Promise<Array<{ b64: string; mimeType: string }>> {
  const model = params.model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const size = params.size || "1024x1024";
  const response = await openai.images.generate({
    model,
    prompt: params.prompt,
    n: params.n ?? 1,
    size: size as "1024x1024" | "1024x1536" | "1536x1024" | "auto",
    ...(params.quality
      ? { quality: params.quality as "auto" | "low" | "medium" | "high" }
      : {}),
    ...(params.background
      ? { background: params.background as "auto" | "transparent" | "opaque" }
      : {}),
    response_format: "b64_json",
  });
  return (response.data ?? [])
    .map((item) => {
      const b64 = item.b64_json;
      if (!b64) return null;
      return { b64, mimeType: "image/png" };
    })
    .filter((item): item is { b64: string; mimeType: string } => Boolean(item));
}

/**
 * OpenAI Images API 编辑（多张参考图 + mask）
 *
 * mask 缺省时只走 references；multipart 形式。gpt-image-1 必须用 OpenAI SDK，
 * DALL-E 2 也走同接口。
 */
export async function imageEdit(params: {
  prompt: string;
  images: Array<{ buffer: Buffer; mimeType: string; name?: string }>;
  mask?: { buffer: Buffer; mimeType: string; name?: string };
  model?: string;
  n?: number;
  size?: string;
}): Promise<Array<{ b64: string; mimeType: string }>> {
  const model = params.model || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const size = params.size || "1024x1024";
  // OpenAI SDK v4 用 toFile + FormData 提交
  const { toFile } = await import("openai/uploads");
  const imageFiles = await Promise.all(
    params.images.map(async (img, idx) =>
      toFile(
        img.buffer,
        img.name ?? `image-${idx}.${img.mimeType.split("/")[1] ?? "png"}`,
        {
          type: img.mimeType,
        }
      )
    )
  );
  const maskFile = params.mask
    ? await toFile(params.mask.buffer, params.mask.name ?? "mask.png", {
        type: params.mask.mimeType,
      })
    : undefined;
  const response = await openai.images.edit({
    model,
    prompt: params.prompt,
    image: imageFiles,
    ...(maskFile ? { mask: maskFile } : {}),
    n: params.n ?? 1,
    size: size as "1024x1024" | "1024x1536" | "1536x1024" | "auto",
    response_format: "b64_json",
  });
  return (response.data ?? [])
    .map((item) => {
      const b64 = item.b64_json;
      if (!b64) return null;
      return { b64, mimeType: "image/png" };
    })
    .filter((item): item is { b64: string; mimeType: string } => Boolean(item));
}

/**
 * OpenAI Audio Speech API（TTS）
 *
 * 返回 Buffer；后端 putObject 到 R2（mimeType 由 format 决定）。
 */
export async function audioSpeech(params: {
  input: string;
  model?: string;
  voice?: string;
  format?: string;
  speed?: number;
  instructions?: string;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const model =
    params.model || process.env.OPENAI_AUDIO_MODEL || "gpt-4o-mini-tts";
  const voice = (params.voice || "alloy") as
    | "alloy"
    | "echo"
    | "fable"
    | "onyx"
    | "nova"
    | "shimmer"
    | "ash"
    | "ballad"
    | "coral"
    | "sage"
    | "verse";
  const format = (params.format || "mp3") as
    | "mp3"
    | "opus"
    | "aac"
    | "flac"
    | "wav"
    | "pcm";
  const response = await openai.audio.speech.create({
    model,
    voice,
    input: params.input,
    response_format: format,
    ...(params.speed ? { speed: params.speed } : {}),
    ...(params.instructions ? { instructions: params.instructions } : {}),
  });
  const arrayBuffer = await response.arrayBuffer();
  const mimeType =
    format === "mp3"
      ? "audio/mpeg"
      : format === "wav"
        ? "audio/wav"
        : `audio/${format}`;
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}
