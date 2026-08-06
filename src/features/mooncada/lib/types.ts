// Mooncada 3D 打印系统 - 业务类型定义

// ============ 角色与权限 ============
export type UserRole = "admin" | "agent" | "designer" | "operator" | "user";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "管理员",
  agent: "代理商",
  designer: "设计师",
  operator: "操作员",
  user: "普通用户",
};

export const ROLE_IDS: Record<UserRole, number> = {
  admin: 1,
  agent: 2,
  designer: 3,
  operator: 4,
  user: 0,
};

// ============ 用户 ============
export interface User {
  userId: string;
  username: string;
  email: string;
  phone: string;
  role: UserRole;
  avatar?: string;
  proxyId?: string;
  balance?: number;
  createdAt: string;
  lastLoginAt: string;
  status: "active" | "disabled";
}

// ============ 图片管理 ============
export interface Photo {
  photoId: string;
  userId: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  thumbnailUrl: string;
  md5: string;
  width: number;
  height: number;
  format: "jpg" | "jpeg" | "png" | "webp";
  uploadedAt: string;
}

// ============ 2D 效果图 ============
export type EffectStatus = "pending" | "processing" | "completed" | "failed";

export interface Effect2D {
  effectId: string;
  userId: string;
  photoId: string;
  photoUrl: string;
  maskId: string;
  maskName: string;
  status: EffectStatus;
  resultUrls: string[];
  prompt: string;
  createdAt: string;
  completedAt?: string;
  errorMsg?: string;
  // 生图模型相关
  imageModel?: string; // 生图模型ID (dalle3/sd3/flux1/midjourney/doubao/wanx/ernie/cogview)
  imageModelName?: string; // 显示名
  mode?: string; // 生成模式 (text_to_image / image_to_image)
  generateDuration?: number; // 生成耗时(ms)
  cost?: number; // 生成成本
  currency?: string;
  revisedPrompt?: string; // 模型重写的提示词 (DALL-E 3 特性)
  seed?: number; // 随机种子
}

// ============ 3D 模型 ============
export interface Model3D {
  modelId: string;
  effectId: string;
  userId: string;
  orderId?: string;
  taskNum?: number;
  status: EffectStatus;
  originalFileUrl?: string;
  printFileUrl?: string;
  previewUrl?: string;
  downloadCount: number;
  suggestedFileName: string;
  createdAt: string;
  warning?: string;
  // 3D 引擎相关
  provider?: string; // 生成该模型的3D引擎ID（tripo3d/hunyuan3d/meshy/hyper3d/hitem3d/triverse3d）
  providerName?: string; // 显示名
  generateDuration?: number; // 生成耗时(ms)
  polyCount?: number; // 面数
  textureResolution?: number;
  cost?: number; // 生成成本
  currency?: string;
  inputType?: "text" | "image";
  prompt?: string; // 输入prompt
}

// ============ 订单 ============
export type OrderStatus =
  | "pending"
  | "paid"
  | "producing"
  | "shipped"
  | "completed"
  | "cancelled";

export interface OrderItem {
  itemId: string;
  modelId: string;
  name: string;
  quantity: number;
  price: number;
  previewUrl: string;
}

export interface Order {
  orderId: string;
  userId: string;
  username: string;
  proxyId?: string;
  items: OrderItem[];
  totalAmount: number;
  currency: string;
  status: OrderStatus;
  shippingAddress: {
    name: string;
    phone: string;
    address: string;
    city: string;
    country: string;
    zipCode: string;
  };
  trackingNumber?: string;
  createdAt: string;
  paidAt?: string;
  shippedAt?: string;
  completedAt?: string;
}

// ============ 任务 ============
export type TaskStatus =
  | "pending_modify" // 等待修改
  | "pending_produce" // 等待生产
  | "in_progress" // 制作中
  | "completed"; // 已完成

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending_modify: "等待修改",
  pending_produce: "等待生产",
  in_progress: "制作中",
  completed: "已完成",
};

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  pending_modify:
    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  pending_produce:
    "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  in_progress:
    "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  completed:
    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
};

export interface Task {
  taskId: string;
  orderId: string;
  userId: string;
  designerId?: string;
  operatorId?: string;
  modelId: string;
  status: TaskStatus;
  priority: "low" | "medium" | "high";
  originalFileUrl?: string;
  modifiedFileUrl?: string;
  remark?: string;
  createdAt: string;
  updatedAt: string;
  deadline: string;
}

// ============ 设计师 ============
export interface DesignerStats {
  completedCount: number;
  pendingCount: number;
  inProgressCount: number;
  totalEarnings: number;
  availableBalance: number;
  frozenBalance: number;
  monthlyEarnings: number;
}

export type WithdrawalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "completed";

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  pending: "审核中",
  approved: "已通过",
  rejected: "已拒绝",
  completed: "已完成",
};

export interface Withdrawal {
  withdrawalId: string;
  designerId: string;
  amount: number;
  status: WithdrawalStatus;
  method: "alipay" | "wechat" | "bank";
  account: string;
  remark?: string;
  createdAt: string;
  processedAt?: string;
}

// ============ 代理商 ============
export interface ProxyInfo {
  proxyId: string;
  userId: string;
  name: string;
  referralCode: string;
  referralUrl: string;
  qrcodeUrl: string;
  totalCommission: number;
  availableBalance: number;
  frozenBalance: number;
  referredUsers: number;
  monthlyCommission: number;
}

export interface ProxyWithdrawal {
  withdrawalId: string;
  proxyId: string;
  amount: number;
  status: WithdrawalStatus;
  method: "alipay" | "wechat" | "bank";
  account: string;
  createdAt: string;
  processedAt?: string;
}

// ============ 产品线（物理商品形态） ============
// 产品线 = 实际生产的物理商品（如：吧唧徽章/钥匙扣/冰箱贴/画框）
// 与 ProductEffect（AI效果模版）多对多关联，组合形成可下单的 SKU
export type ProductCategory =
  | "badge"
  | "keychain"
  | "magnet"
  | "frame"
  | "other";

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  badge: "徽章",
  keychain: "钥匙扣",
  magnet: "冰箱贴",
  frame: "画框",
  other: "其他",
};

export const PRODUCT_CATEGORY_COLORS: Record<ProductCategory, string> = {
  badge: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
  keychain:
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  magnet: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  frame:
    "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  other: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
};

// 产品规格
export interface ProductSpec {
  size: string; // 尺寸描述，如 "直径58mm"
  sizeOptions?: string[]; // 可选尺寸
  material: string; // 主材质
  materialOptions?: string[]; // 可选材质
  thickness: string; // 厚度
  weight: string; // 重量
  process: string; // 工艺，如 "浮雕/烤漆/印刷"
}

// 设计规范（约束 AI 生成 / 用户上传的图片）
export interface DesignSpec {
  supportedRatio: string[]; // 支持的图片比例 ["1:1", "3:4"]
  minResolution: string; // 最低分辨率 "512x512"
  maxResolution: string; // 最高分辨率 "4096x4096"
  printDPI: number; // 打印精度
  safeMargin: number; // 安全区边距 (mm)
  bleedArea: number; // 出血区 (mm)
  colorMode: string; // 颜色模式 RGB/CMYK
  notes?: string; // 设计注意事项
}

// 定价
export interface ProductPricing {
  basePrice: number; // 基础价（1件）
  bulkPrice: number; // 批量价（≥100件）
  moq: number; // 最小起订量
  currency: string;
  // 阶梯定价
  tieredPricing?: { quantity: number; price: number }[];
}

// 生产信息
export interface ProductionInfo {
  productionTime: string; // 生产周期 "3-5个工作日"
  dailyCapacity: number; // 日产能
  factory: string; // 生产工厂
  shippingMethod: string; // 发货方式
  packaging: string; // 包装
}

export interface ProductLine {
  productLineId: string; // PL_001
  name: string; // 浮雕吧唧徽章
  category: ProductCategory;
  description: string;
  previewUrl: string;
  // 规格
  spec: ProductSpec;
  // 设计规范
  designSpec: DesignSpec;
  // 定价
  pricing: ProductPricing;
  // 生产
  production: ProductionInfo;
  // 兼容的 AI 效果模版
  compatibleMaskIds: string[];
  // 状态
  status: "active" | "inactive";
  // 统计
  totalSold: number; // 累计销量
  monthlySold: number; // 月销量
  rating: number; // 评分 0-5
  // 元数据
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

// ============ 产品效果 / 模版 ============
// 产品效果 = AI效果定义 + 自带提示词（支持变量）+ 关联产品线
// 2D效果图直接基于产品效果生成，prompt 字段即提示词（含 {{变量}} 占位符）

// 提示词变量定义
export interface PromptVariable {
  key: string; // 变量名，如 photo_style
  label: string; // 显示名，如 照片风格
  defaultValue: string;
  required: boolean;
  description?: string;
  options?: string[]; // 候选取值；有则生图台渲染下拉，无则渲染文本框
}

// 提示词版本历史
export interface PromptVersion {
  version: string; // 如 v1.0.0
  content: string;
  createdAt: string;
  note?: string;
}

// AI 模型场景
export type PromptScene =
  | "generate_2d" // 2D 效果图生成（豆包）
  | "generate_3d" // 3D 模型生成（Meshy等）
  | "translate" // 文本翻译
  | "stylize" // 风格化
  | "enhance" // 图片增强
  | "custom"; // 自定义

export const PROMPT_SCENE_LABELS: Record<PromptScene, string> = {
  generate_2d: "2D效果图生成",
  generate_3d: "3D 模型生成",
  translate: "文本翻译",
  stylize: "风格化",
  enhance: "图片增强",
  custom: "自定义",
};

export const PROMPT_SCENE_COLORS: Record<PromptScene, string> = {
  generate_2d:
    "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  generate_3d:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  translate: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  stylize:
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  enhance: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
  custom: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
};

export interface ProductEffect {
  maskId: string;
  name: string;
  category: string;
  description: string;
  previewUrl: string;
  // 提示词（支持 {{变量}} 占位符）
  prompt: string;
  // 提示词变量定义
  variables: PromptVariable[];
  // AI 场景与推荐模型
  scene: PromptScene;
  model: string; // 推荐使用的模型，如 doubao-pro / meshy-v2
  // 版本历史
  versions: PromptVersion[];
  config: {
    style: string;
    color?: string;
    material?: string;
  };
  price: number;
  status: "active" | "inactive";
  usageCount: number;
  successRate: number; // 成功率 0-100
  avgDuration: number; // 平均耗时(ms)
  createdAt: string;
  updatedAt: string;
  author: string;
  // 关联的产品线
  productLineIds?: string[];
}

// ============ 平台用户 ============
export interface PlatformUser {
  userId: string;
  username: string;
  email: string;
  role: UserRole;
  permission: string[];
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt?: string;
}

// ============ 系统日志 ============
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface SysLog {
  logId: string;
  logType: "auth" | "business" | "system" | "api";
  level: LogLevel;
  message: string;
  userId?: string;
  ip: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

// ============ 仪表盘统计 ============
export interface DashboardStats {
  totalUsers: number;
  totalOrders: number;
  totalRevenue: number;
  totalModels: number;
  pendingTasks: number;
  completedTasks: number;
  activeDesigners: number;
  totalPhotos: number;
  revenueTrend: { date: string; value: number }[];
  orderTrend: { date: string; value: number }[];
  orderStatusDist: { status: string; count: number; label: string }[];
  taskStatusDist: { status: string; count: number; label: string }[];
}
