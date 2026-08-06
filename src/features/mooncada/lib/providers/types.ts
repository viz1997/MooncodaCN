// 3D 模型生成提供商统一抽象层
// 支持 6 个引擎: Tripo3D / 混元3D / Meshy / Hyper3D / Hitem3D / Triverse3D

export type Provider3DId =
  | "tripo3d"
  | "hunyuan3d"
  | "meshy"
  | "hyper3d"
  | "hitem3d"
  | "triverse3d";

// 提供商能力
export interface ProviderCapabilities {
  textTo3d: boolean; // 文本生3D
  imageTo3d: boolean; // 图片生3D
  multiView: boolean; // 多视角生成
  pbrTexture: boolean; // PBR 纹理
  rigging: boolean; // 绑骨
  animation: boolean; // 动画
  // 输出格式
  outputFormats: ("glb" | "gltf" | "obj" | "fbx" | "stl" | "usdz" | "ply")[];
  // 最大面数
  maxPolyCount: number;
  // 最大纹理分辨率
  maxTextureResolution: number;
}

// 提供商状态
export type ProviderStatus = "active" | "maintenance" | "deprecated";

// 提供商配置
export interface Provider3DConfig {
  id: Provider3DId;
  name: string; // 显示名
  fullName: string; // 完整名
  vendor: string; // 厂商
  vendorUrl: string; // 厂商网址
  // 视觉
  color: string; // 主色 (hex)
  gradient: string; // 渐变色 (tailwind classes)
  icon: string; // 图标标识
  // API
  apiEndpoint: string;
  apiKeyEnv: string; // 环境变量名（实际部署用）
  authType: "bearer" | "api_key" | "hmac";
  // 能力
  capabilities: ProviderCapabilities;
  // 性能
  avgDuration: number; // 平均生成耗时(ms)
  qualityScore: number; // 质量评分 0-100
  stabilityScore: number; // 稳定性 0-100
  // 商务
  pricePerGeneration: number; // 单次生成价格 (CNY)
  currency: string;
  freeQuota: number; // 每月免费额度
  // 状态
  status: ProviderStatus;
  // 描述
  description: string;
  bestFor: string[]; // 最佳使用场景
  // 统计（模拟）
  totalGenerated: number;
  successRate: number;
}

// ============ 6 个提供商配置 ============
export const PROVIDERS_3D: Record<Provider3DId, Provider3DConfig> = {
  // 1. Tripo3D
  tripo3d: {
    id: "tripo3d",
    name: "Tripo3D",
    fullName: "Tripo3D",
    vendor: "Tripo",
    vendorUrl: "https://www.tripo3d.ai",
    color: "#6366f1",
    gradient: "from-indigo-500 to-blue-600",
    icon: "triangle",
    apiEndpoint: "https://api.tripo3d.ai/v2/generate",
    apiKeyEnv: "TRIPO3D_API_KEY",
    authType: "bearer",
    capabilities: {
      textTo3d: true,
      imageTo3d: true,
      multiView: true,
      pbrTexture: true,
      rigging: true,
      animation: true,
      outputFormats: ["glb", "gltf", "fbx", "obj", "usdz"],
      maxPolyCount: 100000,
      maxTextureResolution: 4096,
    },
    avgDuration: 25000,
    qualityScore: 88,
    stabilityScore: 95,
    pricePerGeneration: 1.2,
    currency: "USD",
    freeQuota: 50,
    status: "active",
    description:
      "Tripo3D 提供快速且高质量的文本/图片转3D服务，支持骨骼绑定与动画，适合角色与场景生成",
    bestFor: ["角色生成", "动画角色", "游戏资产", "多视角输出"],
    totalGenerated: 15680,
    successRate: 95,
  },

  // 2. 混元3D (Tencent)
  hunyuan3d: {
    id: "hunyuan3d",
    name: "混元3D",
    fullName: "Tencent Hunyuan3D",
    vendor: "腾讯",
    vendorUrl: "https://hunyuan.tencent.com",
    color: "#0ea5e9",
    gradient: "from-sky-500 to-cyan-600",
    icon: "hexagon",
    apiEndpoint: "https://hunyuan.tencent.com/api/v1/3d/generate",
    apiKeyEnv: "HUNYUAN3D_API_KEY",
    authType: "bearer",
    capabilities: {
      textTo3d: true,
      imageTo3d: true,
      multiView: false,
      pbrTexture: true,
      rigging: false,
      animation: false,
      outputFormats: ["glb", "obj", "fbx", "stl"],
      maxPolyCount: 80000,
      maxTextureResolution: 2048,
    },
    avgDuration: 32000,
    qualityScore: 92,
    stabilityScore: 92,
    pricePerGeneration: 2.5,
    currency: "CNY",
    freeQuota: 100,
    status: "active",
    description:
      "腾讯混元3D 大模型，国产自研，高保真纹理，中文场景理解优秀，适合电商与文创",
    bestFor: ["中文场景", "电商产品", "高保真纹理", "国产合规"],
    totalGenerated: 23450,
    successRate: 92,
  },

  // 3. Meshy (已集成)
  meshy: {
    id: "meshy",
    name: "Meshy",
    fullName: "Meshy AI",
    vendor: "Meshy",
    vendorUrl: "https://www.meshy.ai",
    color: "#10b981",
    gradient: "from-emerald-500 to-teal-600",
    icon: "boxes",
    apiEndpoint: "https://api.meshy.ai/v2/generate",
    apiKeyEnv: "MESHY_API_KEY",
    authType: "bearer",
    capabilities: {
      textTo3d: true,
      imageTo3d: true,
      multiView: true,
      pbrTexture: true,
      rigging: true,
      animation: true,
      outputFormats: ["glb", "gltf", "fbx", "obj", "usdz", "stl"],
      maxPolyCount: 120000,
      maxTextureResolution: 4096,
    },
    avgDuration: 18500,
    qualityScore: 90,
    stabilityScore: 94,
    pricePerGeneration: 0.8,
    currency: "USD",
    freeQuota: 200,
    status: "active",
    description:
      "Meshy 是平台默认3D引擎，速度快、格式全、支持动画，社区活跃，文档完善",
    bestFor: ["通用场景", "快速原型", "动画角色", "3D打印"],
    totalGenerated: 38920,
    successRate: 94,
  },

  // 4. Hyper3D (Rodin)
  hyper3d: {
    id: "hyper3d",
    name: "Hyper3D",
    fullName: "Hyper3D Rodin",
    vendor: "Deemos",
    vendorUrl: "https://hyper3d.ai",
    color: "#a855f7",
    gradient: "from-purple-500 to-fuchsia-600",
    icon: "diamond",
    apiEndpoint: "https://api.hyper3d.ai/v1/rodin/generate",
    apiKeyEnv: "HYPER3D_API_KEY",
    authType: "api_key",
    capabilities: {
      textTo3d: true,
      imageTo3d: true,
      multiView: true,
      pbrTexture: true,
      rigging: true,
      animation: false,
      outputFormats: ["glb", "gltf", "fbx", "obj", "stl", "usdz"],
      maxPolyCount: 150000,
      maxTextureResolution: 4096,
    },
    avgDuration: 42000,
    qualityScore: 95,
    stabilityScore: 88,
    pricePerGeneration: 1.5,
    currency: "USD",
    freeQuota: 30,
    status: "active",
    description:
      "Hyper3D Rodin 模型，超高质量输出，面数与纹理精度业界领先，适合高端定制",
    bestFor: ["高端定制", "影视级模型", "复杂几何", "高精度纹理"],
    totalGenerated: 8920,
    successRate: 91,
  },

  // 5. Hitem3D
  hitem3d: {
    id: "hitem3d",
    name: "Hitem3D",
    fullName: "Hitem3D",
    vendor: "Hitem",
    vendorUrl: "https://www.hitem3d.com",
    color: "#f59e0b",
    gradient: "from-amber-500 to-orange-600",
    icon: "cube",
    apiEndpoint: "https://api.hitem3d.com/v1/generate",
    apiKeyEnv: "HITEM3D_API_KEY",
    authType: "hmac",
    capabilities: {
      textTo3d: true,
      imageTo3d: true,
      multiView: false,
      pbrTexture: true,
      rigging: false,
      animation: false,
      outputFormats: ["glb", "obj", "stl"],
      maxPolyCount: 60000,
      maxTextureResolution: 2048,
    },
    avgDuration: 15000,
    qualityScore: 82,
    stabilityScore: 90,
    pricePerGeneration: 1.8,
    currency: "CNY",
    freeQuota: 80,
    status: "active",
    description: "Hitem3D 主打快速低成本3D生成，适合批量生产与原型验证",
    bestFor: ["批量生成", "快速原型", "低成本", "电商展示"],
    totalGenerated: 12450,
    successRate: 90,
  },

  // 6. Triverse3D
  triverse3d: {
    id: "triverse3d",
    name: "Triverse3D",
    fullName: "Triverse3D",
    vendor: "Triverse",
    vendorUrl: "https://www.triverse3d.com",
    color: "#ec4899",
    gradient: "from-pink-500 to-rose-600",
    icon: "orbit",
    apiEndpoint: "https://api.triverse3d.com/v2/create",
    apiKeyEnv: "TRIVERSE3D_API_KEY",
    authType: "bearer",
    capabilities: {
      textTo3d: true,
      imageTo3d: true,
      multiView: true,
      pbrTexture: true,
      rigging: true,
      animation: true,
      outputFormats: ["glb", "gltf", "fbx", "obj", "usdz"],
      maxPolyCount: 110000,
      maxTextureResolution: 4096,
    },
    avgDuration: 28000,
    qualityScore: 87,
    stabilityScore: 86,
    pricePerGeneration: 1.0,
    currency: "USD",
    freeQuota: 60,
    status: "maintenance",
    description:
      "Triverse3D 提供全流程3D生成与优化，含自动拓扑与LOD输出，适合游戏与AR/VR",
    bestFor: ["游戏开发", "AR/VR", "自动拓扑", "LOD输出"],
    totalGenerated: 6820,
    successRate: 88,
  },
};

// 提供商列表
export const PROVIDER_LIST_3D = Object.values(PROVIDERS_3D);

// 默认推荐提供商（按场景）
export const RECOMMEND_BY_SCENE: Record<string, Provider3DId[]> = {
  character_animation: ["tripo3d", "meshy", "triverse3d"],
  high_end_custom: ["hyper3d", "hunyuan3d"],
  ecommerce: ["hunyuan3d", "hitem3d", "meshy"],
  rapid_prototype: ["hitem3d", "meshy", "tripo3d"],
  game_asset: ["triverse3d", "tripo3d", "meshy"],
  "3d_printing": ["meshy", "hunyuan3d"],
};

// ============ 统一生成请求/响应 ============
export interface Generate3DRequest {
  provider: Provider3DId;
  // 输入
  inputType: "text" | "image";
  textPrompt?: string;
  imageUrl?: string;
  // 通用参数
  outputFormat?: "glb" | "gltf" | "fbx" | "obj" | "stl" | "usdz" | "ply";
  quality?: "draft" | "medium" | "high" | "ultra";
  polyCount?: number;
  // 高级
  enablePBR?: boolean;
  enableRigging?: boolean;
  enableAnimation?: boolean;
  // 模板（可选）
  promptTemplateId?: string;
  variables?: Record<string, string>;
}

export interface Generate3DResult {
  success: boolean;
  provider: Provider3DId;
  modelId?: string;
  taskId?: string; // 异步任务ID
  status: "pending" | "processing" | "completed" | "failed";
  // 输出
  modelUrl?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  // 元数据
  duration?: number; // 耗时(ms)
  polyCount?: number;
  textureResolution?: number;
  // 计费
  cost?: number;
  currency?: string;
  // 错误
  error?: string;
  raw?: unknown;
}

// ============ 提供商适配器接口 ============
export interface Provider3DAdapter {
  config: Provider3DConfig;
  // 提交生成任务
  generate(req: Generate3DRequest): Promise<Generate3DResult>;
  // 查询任务状态（异步任务）
  queryTask(taskId: string): Promise<Generate3DResult>;
  // 校验请求
  validate(req: Generate3DRequest): string | null;
}
