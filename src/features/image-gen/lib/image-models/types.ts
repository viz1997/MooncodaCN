// 生图大模型统一抽象层
// 业界主流接入方式: 统一 API + 异步任务模式 + 提供商适配器
// 支持主流生图模型: DALL-E 3 / SD 3 / Flux / Midjourney / 即梦 / 通义万相 / 文心一格 / CogView / GPT-Image-2 / Nano Banana Pro / Nano Banana 2

export type ImageModelId =
  | "dalle3" // OpenAI DALL-E 3
  | "sd3" // Stability AI Stable Diffusion 3
  | "flux1" // Black Forest Labs Flux.1
  | "midjourney" // Midjourney
  | "doubao" // 字节 即梦/豆包
  | "wanx" // 阿里 通义万相
  | "ernie" // 百度 文心一格
  | "cogview" // 智谱 CogView
  | "gpt_image_2" // OpenAI GPT-Image-2
  | "nano_banana_pro" // Google Nano Banana Pro (gemini-3-pro-image-preview)
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
   * 其他 sd3/flux1/midjourney/doubao/wanx/ernie/cogview 仍为 false。
   */
  isAvailable: boolean;
}

// ============ 模型配置 ============
export const IMAGE_MODELS: Record<ImageModelId, ImageModelConfig> = {
  // 1. DALL-E 3
  dalle3: {
    id: "dalle3",
    name: "DALL·E 3",
    fullName: "OpenAI DALL·E 3",
    vendor: "OpenAI",
    vendorUrl: "https://openai.com/dall-e-3",
    color: "#10a37f",
    gradient: "from-emerald-500 to-teal-600",
    apiEndpoint: "https://api.openai.com/v1/images/generations",
    apiKeyEnv: "OPENAI_API_KEY",
    authType: "bearer",
    asyncMode: false,
    pollingInterval: 0,
    maxPollingTime: 0,
    capabilities: {
      modes: ["text_to_image", "image_editing"],
      sizes: ["1024x1024", "1024x1792", "1792x1024"],
      maxBatchSize: 1,
      supportsNegativePrompt: false,
      supportsSeed: false,
      supportsGuidance: false,
      supportsStyle: true,
      supportsSafetyCheck: true,
      maxInferenceSteps: 0,
    },
    avgDuration: 12000,
    qualityScore: 92,
    stabilityScore: 96,
    pricePerImage: 0.04,
    currency: "USD",
    freeQuota: 0,
    status: "active",
    description: "OpenAI 旗舰生图模型，文本理解能力强，支持长描述与文字渲染",
    bestFor: ["文字渲染", "复杂场景", "英文场景", "高质量海报"],
    totalGenerated: 18650,
    successRate: 98,
    isDomestic: false,
    isAvailable: true,
  },

  // 2. Stable Diffusion 3
  sd3: {
    id: "sd3",
    name: "SD 3",
    fullName: "Stable Diffusion 3.5 Large",
    vendor: "Stability AI",
    vendorUrl: "https://stability.ai",
    color: "#7c3aed",
    gradient: "from-violet-500 to-purple-600",
    apiEndpoint: "https://api.stability.ai/v2beta/stable-image/generate/sd3",
    apiKeyEnv: "STABILITY_API_KEY",
    authType: "bearer",
    asyncMode: false,
    pollingInterval: 0,
    maxPollingTime: 0,
    capabilities: {
      modes: ["text_to_image", "image_to_image"],
      sizes: ["1024x1024", "1024x1792", "1792x1024", "2048x2048"],
      maxBatchSize: 4,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsGuidance: true,
      supportsStyle: true,
      supportsSafetyCheck: true,
      maxInferenceSteps: 50,
    },
    avgDuration: 8000,
    qualityScore: 90,
    stabilityScore: 92,
    pricePerImage: 0.03,
    currency: "USD",
    freeQuota: 25,
    status: "active",
    description: "Stability AI 旗舰开源模型，支持反向提示词与精细参数控制",
    bestFor: ["精细控制", "反向提示词", "批量生成", "开源生态"],
    totalGenerated: 32480,
    successRate: 94,
    isDomestic: false,
    isAvailable: false,
  },

  // 3. Flux.1
  flux1: {
    id: "flux1",
    name: "Flux.1",
    fullName: "Black Forest Labs Flux.1 Pro",
    vendor: "Black Forest Labs",
    vendorUrl: "https://blackforestlabs.ai",
    color: "#0ea5e9",
    gradient: "from-sky-500 to-blue-600",
    apiEndpoint: "https://api.bfl.ai/v1/flux-pro-1.1",
    apiKeyEnv: "BFL_API_KEY",
    authType: "bearer",
    asyncMode: true,
    pollingInterval: 2000,
    maxPollingTime: 60000,
    capabilities: {
      modes: ["text_to_image", "image_to_image", "upscaling"],
      sizes: ["1024x1024", "1024x1792", "1792x1024", "2048x2048"],
      maxBatchSize: 4,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsGuidance: true,
      supportsStyle: false,
      supportsSafetyCheck: true,
      maxInferenceSteps: 50,
    },
    avgDuration: 5500,
    qualityScore: 94,
    stabilityScore: 91,
    pricePerImage: 0.05,
    currency: "USD",
    freeQuota: 0,
    status: "active",
    description:
      "Black Forest Labs 推出的新一代 SOTA 生图模型，提示词理解业界最强",
    bestFor: ["SOTA质量", "复杂提示词", "快速生成", "高分辨率"],
    totalGenerated: 12860,
    successRate: 95,
    isDomestic: false,
    isAvailable: false,
  },

  // 4. Midjourney
  midjourney: {
    id: "midjourney",
    name: "Midjourney",
    fullName: "Midjourney v6",
    vendor: "Midjourney",
    vendorUrl: "https://www.midjourney.com",
    color: "#ec4899",
    gradient: "from-pink-500 to-rose-600",
    apiEndpoint: "https://api.midjourney.com/v6/imagine",
    apiKeyEnv: "MIDJOURNEY_API_KEY",
    authType: "api_key",
    asyncMode: true,
    pollingInterval: 5000,
    maxPollingTime: 180000,
    capabilities: {
      modes: ["text_to_image", "image_to_image"],
      sizes: ["1024x1024", "1024x1792", "1792x1024"],
      maxBatchSize: 4,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsGuidance: false,
      supportsStyle: true,
      supportsSafetyCheck: true,
      maxInferenceSteps: 0,
    },
    avgDuration: 35000,
    qualityScore: 96,
    stabilityScore: 86,
    pricePerImage: 0.1,
    currency: "USD",
    freeQuota: 0,
    status: "active",
    description: "业界艺术风格最强的生图模型，适合插画、概念艺术、海报设计",
    bestFor: ["艺术风格", "插画", "概念艺术", "海报设计"],
    totalGenerated: 8920,
    successRate: 89,
    isDomestic: false,
    isAvailable: false,
  },

  // 5. 即梦/豆包 (字节)
  doubao: {
    id: "doubao",
    name: "即梦",
    fullName: "字节跳动 即梦/豆包生图",
    vendor: "字节跳动",
    vendorUrl: "https://jimeng.jianying.com",
    color: "#ff6b35",
    gradient: "from-orange-500 to-red-600",
    apiEndpoint: "https://visual.volcengineapi.com/v1/visual/text2image",
    apiKeyEnv: "DOUBAO_API_KEY",
    authType: "bearer",
    asyncMode: true,
    pollingInterval: 1500,
    maxPollingTime: 30000,
    capabilities: {
      modes: ["text_to_image", "image_to_image", "image_editing"],
      sizes: ["512x512", "1024x1024", "1024x1792", "1792x1024"],
      maxBatchSize: 4,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsGuidance: true,
      supportsStyle: true,
      supportsSafetyCheck: true,
      maxInferenceSteps: 50,
    },
    avgDuration: 4500,
    qualityScore: 91,
    stabilityScore: 95,
    pricePerImage: 0.06,
    currency: "CNY",
    freeQuota: 100,
    status: "active",
    description: "字节跳动自研生图大模型，中文场景理解优秀，平台默认生图引擎",
    bestFor: ["中文场景", "电商图", "国产合规", "快速生成"],
    totalGenerated: 45820,
    successRate: 96,
    isDomestic: true,
    isAvailable: false,
  },

  // 6. 通义万相 (阿里)
  wanx: {
    id: "wanx",
    name: "通义万相",
    fullName: "阿里 通义万相 Wanx-v1",
    vendor: "阿里云",
    vendorUrl: "https://tongyi.aliyun.com/wanxiang",
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
    description: "阿里云通义万相，电商场景训练充分，适合产品图与营销物料",
    bestFor: ["电商产品图", "营销物料", "中文场景", "国产合规"],
    totalGenerated: 22180,
    successRate: 95,
    isDomestic: true,
    isAvailable: false,
  },

  // 7. 文心一格 (百度)
  ernie: {
    id: "ernie",
    name: "文心一格",
    fullName: "百度 文心一格 ERNIE-ViLG",
    vendor: "百度",
    vendorUrl: "https://yige.baidu.com",
    color: "#2932e1",
    gradient: "from-blue-600 to-indigo-700",
    apiEndpoint: "https://aip.baidubce.com/rpc/2.0/ernievilg/v1/txt2img",
    apiKeyEnv: "ERNIE_API_KEY",
    authType: "api_key",
    asyncMode: true,
    pollingInterval: 2000,
    maxPollingTime: 60000,
    capabilities: {
      modes: ["text_to_image", "image_to_image"],
      sizes: ["1024x1024", "768x1024", "1024x768"],
      maxBatchSize: 2,
      supportsNegativePrompt: false,
      supportsSeed: false,
      supportsGuidance: false,
      supportsStyle: true,
      supportsSafetyCheck: true,
      maxInferenceSteps: 0,
    },
    avgDuration: 8000,
    qualityScore: 86,
    stabilityScore: 90,
    pricePerImage: 0.12,
    currency: "CNY",
    freeQuota: 50,
    status: "active",
    description: "百度文心一格，与文心一言深度整合，中文场景理解优秀",
    bestFor: ["中文场景", "国风插画", "内容创作", "国产合规"],
    totalGenerated: 15680,
    successRate: 92,
    isDomestic: true,
    isAvailable: false,
  },

  // 8. CogView (智谱)
  cogview: {
    id: "cogview",
    name: "CogView",
    fullName: "智谱 CogView-3 Plus",
    vendor: "智谱AI",
    vendorUrl: "https://open.bigmodel.cn",
    color: "#16a34a",
    gradient: "from-green-500 to-emerald-700",
    apiEndpoint: "https://open.bigmodel.cn/api/paas/v4/images/generations",
    apiKeyEnv: "ZHIPU_API_KEY",
    authType: "bearer",
    asyncMode: false,
    pollingInterval: 0,
    maxPollingTime: 0,
    capabilities: {
      modes: ["text_to_image", "image_to_image"],
      sizes: ["1024x1024", "768x1344", "1344x768", "864x1152", "1152x864"],
      maxBatchSize: 1,
      supportsNegativePrompt: false,
      supportsSeed: false,
      supportsGuidance: false,
      supportsStyle: true,
      supportsSafetyCheck: true,
      maxInferenceSteps: 0,
    },
    avgDuration: 5500,
    qualityScore: 88,
    stabilityScore: 93,
    pricePerImage: 0.1,
    currency: "CNY",
    freeQuota: 100,
    status: "active",
    description: "智谱 CogView-3 Plus，开放 API 体验友好，与 GLM 模型协同",
    bestFor: ["开放API", "中文场景", "快速集成", "国产合规"],
    totalGenerated: 9820,
    successRate: 94,
    isDomestic: true,
    isAvailable: false,
  },

  // 9. OpenAI GPT-Image-2 (via WellAPI)
  // Phase 起：image-gen 工作台的 gpt_image_2 与 gpt-image 模块统一走 wellapi.ai，
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
      // Phase 起：去掉 text_to_image。
      // 原因：gpt_image_2 via WellAPI 走的是 gpt-image 同款 submitLingtingTask，
      // 而后者依赖 /v1/images/edits 接口，必须带 image 字段 —— 无图调用
      // 会被 wellapi 返 500（实测）。文生图需求请选 nano_banana2 / dalle3。
      modes: ["image_to_image", "image_editing", "inpainting"],
      sizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
      maxBatchSize: 4,
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

  // 10. Google Nano Banana Pro (gemini-3-pro-image-preview)
  nano_banana_pro: {
    id: "nano_banana_pro",
    name: "Nano Banana Pro",
    fullName: "Google Gemini 3 Pro Image (Nano Banana Pro)",
    vendor: "Google",
    vendorUrl: "https://deepmind.google/technologies/gemini/",
    color: "#e8710a",
    gradient: "from-orange-500 to-amber-600",
    apiEndpoint:
      "https://wellapi.cc/v1beta/models/gemini-3-pro-image-preview:generateContent",
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
    avgDuration: 8000,
    qualityScore: 95,
    stabilityScore: 93,
    pricePerImage: 0.04,
    currency: "USD",
    freeQuota: 100,
    status: "active",
    description:
      "Gemini 3 Pro Image（Nano Banana Pro），高质量写实生图，支持 4K 分辨率，适合产品海报与商业摄影",
    bestFor: ["写实摄影", "产品海报", "高质量输出", "4K分辨率"],
    totalGenerated: 3200,
    successRate: 94,
    isDomestic: false,
    isAvailable: true,
  },

  // 11. Google Nano Banana 2 (gemini-3.1-flash-image-preview)
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
      "Gemini 3.1 Flash Image（Nano Banana 2），速度极，对话式编辑能力突出，支持 512/1K/2K/4K 分辨率",
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
  imageUrl?: string | undefined; // 输入图片URL
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
