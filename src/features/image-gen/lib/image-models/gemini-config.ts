// Gemini 图片模型配置 - 从环境变量读取
// 未配置 LINGTING_API_KEY 时，Gemini 适配器将返回友好错误而非崩溃

export const GEMINI_CONFIG = {
  // 仅从环境变量读取；不再内置硬编码 key（避免泄露）
  apiKey: process.env.LINGTING_API_KEY || "",
  baseUrl: process.env.LINGTING_BASE_URL || "https://wellapi.ai",
};

// 外部生图服务 API Key（公共入口预配置）
export const PUBLIC_API_KEY =
  process.env.PUBLIC_API_KEY || "mk_public_demo_default_key_2026";
