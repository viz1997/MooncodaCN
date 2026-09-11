// 生图大模型统一抽象层
// 业界主流接入方式: 统一 API + 异步任务模式 + 提供商适配器
// 2026-09-11：精简为 3 个核心模型（qwen / gpt_image_2 / nano_banana2），
// 删除 DALL-E 3 / SD 3 / Flux / Midjourney / 即梦 / 文心一格 / CogView / Nano Banana Pro
// （占位实现未接入，或被新接入替代）。

export type ImageModelId =
  | "qwen" // 阿里 通义千问 qwen-image（原 wanx 重命名）
  | "gpt_image_2" // OpenAI GPT-Image-2 via WellAPI
  | "nano_banana2"; // Google Nano Banana 2 (gemini-3.1-flash-image-preview)

// 生成模式
export type GenerationMode =
  | "text_to_image" // 文生图
  | "image_to_image" // 图生图
  | "image_editing" // 图像编
  | "inpainting" // 局部重绘
  | "upscaling"; // 超分辨率

export const MODE_LABELS: Record<GenerationMode, string> = {
  text_to_image: "文生图",
  image_to_image: "图生图",
  image_editing: "图像编辑",
  inpainting: "局部重绘",
  upscaling: "超分辨率",
};

// 输出尺寸预设
export type ImageSize =
  | "256x256"
  | "512x512"
  | "768x768"
  | "768x1024"
  | "1024x768"
  | "768x1344"
  | "1344x768"
  | "864x1152"
  | "1152x864"
  | "1024x1024"
  | "1024x1536"
  | "1536x1024"
  | "1024x1792"
  | "1792x1024"
  | "2048x2048"
  | "720x1280"
  | "1280x720"
  | "auto"
  | "custom";

// 风格预设
export type ImageStyle =
  | "natural"
  | "vivid"
  | "anime"
  | "photographic"
  | "digital_art"
  | "concept_art"
  | "oil_painting"
  | "watercolor"
  | "3d_render"
  | "pixel_art";

export const STYLE_LABELS: Record<ImageStyle, string> = {
  natural: "自然",
  vivid: "生动",
  anime: "动漫",
  photographic: "摄影",
  digital_art: "数字艺术",
  concept_art: "概念艺术",
  oil_painting: "油画",
  watercolor: "水彩",
  "3d_render": "3D渲染",
  pixel_art: "像素艺术",
};

// 提供商能力
export interface ImageModelCapabilities {
  modes: GenerationMode[]; // 支持的生成模式
  sizes: ImageSize[]; // 支持的尺寸
  maxBatchSize: number; // 单次最大生成数
  supportsNegativePrompt: boolean; // 支持反向提示词
  supportsSeed: boolean; // 支持随机种子
  supportsGuidance: boolean; // 支持引导系数
  supportsStyle: boolean; // 支持风格预设
  supportsSafetyCheck: boolean; // 内置安全检查
  maxInferenceSteps: number; // 最大推理步数
}

// 提供商状态
export type ModelStatus = "active" | "maintenance" | "deprecated";

// 模型配置
export interface ImageModelConfig {
  id: ImageModelId;
  name: string;
  fullName: string;
  vendor: string;
  vendorUrl: string;
  // 视觉
  color: string;
  gradient: string;
  // API
  apiEndpoint: string;
  apiKeyEnv: string;
  authType: "bearer" | "api_key" | "hmac";
  // 异步任务
  asyncMode: boolean; // 是否异步任务模式
  pollingInterval: number; // 轮询间隔(ms)
  maxPollingTime: number; // 最大轮询时间(ms)
  // 能力
  capabilities: ImageModelCapabilities;
  // 性能
  avgDuration: number; // 平均生成耗时(ms)
  qualityScore: number; // 质量评分 0-100
  stabilityScore: number; // 稳定性 0-100
  // 商务
  pricePerImage: number; // 单张价格
  currency: string;
  freeQuota: number; // 每月免费额度
  // 状态
  status: ModelStatus;
  // 描述
  description: string;
  bestFor: string[];
  // 统计
  totalGenerated: number;
  successRate: number;
  // 是否国产（合规要求）
  isDomestic: boolean;
  /**
   * 是否真正接入可调用的 API。
   * false = 占位实现（simulateLatency + picsum 占位图），生产环境选了会失败；
   * 留给前端工作台下拉里 disabled + 「即将上线」标记，避免用户选了踩坑。
   * Phase 起（gpt-image workbench 共用）：dalle3 / gpt_image_2 / nano_banana_pro / nano_banana2 = true，
   * 2026-09-11：精简后仅 qwen / gpt_image_2 / nano_banana2 三个，
   * isAvailable 由各 adapter 真实接入情况决定。
   */
  isAvailable: boolean;
}

// ============ 模型配置 ============
// 2026-09-11：精简为 3 个核心模型（qwen / gpt_image_2 / nano_banana2）。
// 删：DALL-E 3 / SD 3 / Flux.1 / Midjourney / 即梦 / 文心一格 / CogView / Nano Banana Pro
// 重命名：wanx → qwen（通义万相 Wanx-v1 → 通义千问 qwen-image）
export const IMAGE_MODELS: Record<ImageModelId, ImageModelConfig> = {
  // 1. 通义千问 qwen-image（阿里；原 wanx 重命名）
  qwen: {
    id: "qwen",
    name: "通义千问",
    fullName: "阿里 通义千问 qwen-image",
    vendor: "阿里云",
    vendorUrl: "https://tongyi.aliyun.com/qianwen",
    color: "#615ced",
    gradient: "from-indigo-500 to-blue-700",
    apiEndpoint:
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    authType: "bearer",
    asyncMode: true,
    pollingInterval: 2000,
    maxPollingTime: 60000,
    capabilities: {
      modes: ["text_to_image", "image_to_image"],
      sizes: ["1024x1024", "720x1280", "1280x720"],
      maxBatchSize: 4,
      supportsNegativePrompt: false,
      supportsSeed: true,
      supportsGuidance: false,
      supportsStyle: true,
      supportsSafetyCheck: true,
      maxInferenceSteps: 0,
    },
    avgDuration: 6500,
    qualityScore: 89,
    stabilityScore: 94,
    pricePerImage: 0.16,
    currency: "CNY",
    freeQuota: 200,
    status: "active",
    description:
      "阿里云通义千问 qwen-image，多模态理解力强，真实材质与复杂构图表现优秀，中文场景首选",
    bestFor: ["电商产品图", "真实材质", "中文场景", "国产合规"],
    totalGenerated: 22180,
    successRate: 95,
    isDomestic: true,
    isAvailable: true,
  },

  // 2. OpenAI GPT-Image-2 (via WellAPI)
  // image-gen 工作台的 gpt_image_2 与 gpt-image 模块统一走 wellapi.ai，
  // 共用 LINGTING_API_KEY / LINGTING_BASE_URL；不再依赖 OPENAI_API_KEY。
  // 原因：gpt-image 已经验证 wellapi 链路稳定，OpenAI 直接调用常被跨境访问拦，
  // 且 lingting 异步任务模式 + R2 持久化路径已稳定复用。
  gpt_image_2: {
    id: "gpt_image_2",
    name: "GPT-Image-2 (via WellAPI)",
    fullName: "OpenAI GPT-Image-2 via WellAPI",
    vendor: "WellAPI",
    vendorUrl: "https://platform.openai.com/docs/guides/image-generation",
    color: "#10a37f",
    gradient: "from-emerald-500 to-teal-600",
    apiEndpoint: "https://wellapi.ai/v1/images/edits",
    apiKeyEnv: "LINGTING_API_KEY",
    authType: "bearer",
    asyncMode: true,
    pollingInterval: 3000,
    maxPollingTime: 120000,
    capabilities: {
      // 去掉 text_to_image：gpt_image_2 via WellAPI 走的是 gpt-image 同款 submitLingtingTask，
      // 而后者依赖 /v1/images/edits 接口，必须带 image 字段 —— 无图调用
      // 会被 wellapi 返 500（实测）。文生图需求请选 nano_banana2 / qwen。
      modes: ["image_to_image", "image_editing", "inpainting"],
      sizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
      // 2026-08-18：用户希望工作台支持一次最多 10 张（适配器 + wellapi
      // 异步任务链路可承载，循环 submitLingtingTask N 次不会破幂等）。
      maxBatchSize: 10,
      supportsNegativePrompt: false,
      supportsSeed: false,
      supportsGuidance: false,
      supportsStyle: true,
      supportsSafetyCheck: true,
      maxInferenceSteps: 0,
    },
    avgDuration: 9000,
    qualityScore: 95,
    stabilityScore: 96,
    pricePerImage: 0.04,
    currency: "USD",
    freeQuota: 0,
    status: "active",
    description:
      "GPT-Image-2 通过 WellAPI 网关调用，与 gpt-image 业务模块共用同一供应商（LINGTING_API_KEY）；文字渲染业界最强，支持图像编辑与局部重绘",
    bestFor: ["文字渲染", "图像编辑", "局部重绘", "高质量海报", "电商主图"],
    totalGenerated: 15620,
    successRate: 97,
    isDomestic: false,
    isAvailable: true,
  },

  // 3. Google Nano Banana 2 (gemini-3.1-flash-image-preview)
  nano_banana2: {
    id: "nano_banana2",
    name: "Nano Banana 2",
    fullName: "Google Gemini 3.1 Flash Image (Nano Banana 2)",
    vendor: "Google",
    vendorUrl: "https://deepmind.google/technologies/gemini/",
    color: "#fbbc04",
    gradient: "from-amber-400 to-yellow-500",
    apiEndpoint:
      "https://wellapi.cc/v1beta/models/gemini-3.1-flash-image-preview:generateContent",
    apiKeyEnv: "LINGTING_API_KEY",
    authType: "bearer",
    asyncMode: false,
    pollingInterval: 0,
    maxPollingTime: 0,
    capabilities: {
      modes: ["text_to_image", "image_to_image", "image_editing"],
      sizes: ["512x512", "1024x1024", "1024x1792", "1792x1024", "2048x2048"],
      maxBatchSize: 1,
      supportsNegativePrompt: false,
      supportsSeed: false,
      supportsGuidance: false,
      supportsStyle: true,
      supportsSafetyCheck: true,
      maxInferenceSteps: 0,
    },
    avgDuration: 4000,
    qualityScore: 91,
    stabilityScore: 94,
    pricePerImage: 0.025,
    currency: "USD",
    freeQuota: 100,
    status: "active",
    description:
      "Gemini 3.1 Flash Image（Nano Banana 2），速度极快，对话式编辑能力突出，支持 512/1K/2K/4K 分辨率",
    bestFor: ["极速生成", "对话式编辑", "图像修改", "多轮迭代"],
    totalGenerated: 6850,
    successRate: 95,
    isDomestic: false,
    isAvailable: true,
  },
};

export const IMAGE_MODEL_LIST = Object.values(IMAGE_MODELS);

// ============ 统一请求/响应 ============
export interface GenerateImageRequest {
  model: ImageModelId;
  mode: GenerationMode;
  // 输入
  prompt: string; // 主提示词
  negativePrompt?: string | undefined; // 反向提示词
  // 图生图/编辑模式
  /**
   * 单张参考图 URL（向后兼容旧调用方；新代码优先用 imageUrls[]）。
   * 实际语义上等价于 imageUrls=[imageUrl]，adapter 内部 normalize 成数组。
   */
  imageUrl?: string | undefined;
  /**
   * 多张参考图 URL（2026-09-03 V1 多图改造）：
   * - gpt_image_2 (Lingting)：submitLingtingTask 已支持 image[] multipart
   * - dalle3 (OpenAI)：FormData 多 image 字段
   * - gemini：file_data 数组
   * 上限 10（业务约束），下游 API 各自再校验
   */
  imageUrls?: string[] | undefined;
  maskUrl?: string | undefined; // 局部重绘蒙版
  // 输出
  size: ImageSize;
  customWidth?: number | undefined; // custom 模式下的宽度
  customHeight?: number | undefined;
  style?: ImageStyle | undefined;
  // 控制参数
  batchSize?: number | undefined; // 生成数量(1-maxBatchSize)
  seed?: number | undefined;
  guidanceScale?: number | undefined; // 引导系数 1-20
  numInferenceSteps?: number | undefined; // 推理步数
  // 高级
  enableSafetyCheck?: boolean | undefined; // 安全检查
  watermark?: boolean | undefined; // 水印
  // 关联
  maskId?: string | undefined; // 关联的产品效果ID
  photoId?: string | undefined; // 关联的照片ID
}

export interface GeneratedImage {
  url: string;
  base64?: string | undefined;
  seed?: number | undefined;
  revisedPrompt?: string | undefined; // 模型重写的提示词(DALL-E 3 特性)
}

export interface GenerateImageResult {
  success: boolean;
  model: ImageModelId;
  taskId?: string | undefined; // 异步任务ID
  status: "pending" | "processing" | "completed" | "failed";
  images?: GeneratedImage[];
  // 元数据
  duration?: number | undefined;
  // 计费
  cost?: number | undefined;
  currency?: string | undefined;
  // 安全
  safetyFiltered?: boolean | undefined;
  // 错误
  error?: string | undefined;
  raw?: unknown;
}

// ============ 适配器接口 ============
export interface ImageModelAdapter {
  config: ImageModelConfig;
  // 提交生成任务（同步直接返回结果，异步返回 taskId）
  generate(req: GenerateImageRequest): Promise<GenerateImageResult>;
  // 查询异步任务状态
  queryTask?(taskId: string): Promise<GenerateImageResult>;
  // 校验请求
  validate(req: GenerateImageRequest): string | null;
}
