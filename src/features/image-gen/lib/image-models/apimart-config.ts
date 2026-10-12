// Apimart 生图模型配置 - 从环境变量读取
// 2026-10-12：接入 apimart.ai gpt-image-2.5-ext（flare / sunburst 双版本）
// 未配置 APIMART_API_KEY 时，apimart adapter 返友好错误而非崩溃

export const APIMART_CONFIG = {
  /** API 端点（apimart OpenAI 兼容） */
  baseUrl: process.env.APIMART_BASE_URL || "https://api.apimart.ai",
  /** API Key 环境变量 */
  apiKeyEnv: "APIMART_API_KEY",
  /** 响应版本头（apimart 强制要求，未传可能返 400） */
  responseVersion: "2026-07-27",
} as const;

/**
 * 获取 Apimart API Key（只读 process.env，绝不内置硬编码）
 */
export function getApimartApiKey(): string | undefined {
  const key = process.env[APIMART_CONFIG.apiKeyEnv];
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

/**
 * 是否已配置 Apimart（adapter 在 generate 前主动校验，未配置返友好错误）
 */
export function isApimartConfigured(): boolean {
  return Boolean(getApimartApiKey());
}
