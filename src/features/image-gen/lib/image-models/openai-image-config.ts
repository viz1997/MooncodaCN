// OpenAI Images API 配置
// 用于 GPT-Image 系列模型的真实 API 调用

/**
 * OpenAI Images API 配置对象
 */
export const OPENAI_IMAGE_CONFIG = {
  /** API 端点 */
  baseUrl: "https://api.openai.com/v1",
  /** 默认模型名称（gpt-image-2 为当前 OpenAI 最新生图模型） */
  model: process.env.GPT_IMAGE_MODEL || "gpt-image-2",
  /** API Key 环境变量名 */
  apiKeyEnv: "OPENAI_API_KEY",
} as const;

/**
 * 获取 OpenAI API Key
 */
export function getOpenAIImageApiKey(): string | undefined {
  return process.env[OPENAI_IMAGE_CONFIG.apiKeyEnv];
}

/**
 * 检查是否已配置 OpenAI Images API
 */
export function isOpenAIImageConfigured(): boolean {
  return (
    typeof getOpenAIImageApiKey() === "string" && getOpenAIImageApiKey() !== ""
  );
}
