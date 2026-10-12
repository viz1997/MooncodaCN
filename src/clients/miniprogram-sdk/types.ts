/**
 * 小程序 SDK —— 全量类型契约
 *
 * 用法:把 src/clients/miniprogram-sdk/ 整个目录复制到小程序仓库 src/api/sdk/ 后
 *      import { loginWithWechat, submitGenerate, ... } from "@/api/sdk"
 *
 * 所有时间字段为 ISO 8601 字符串(JSON 友好),金额为 cents(整数,展示时 /100)。
 *
 * 鉴权约定:
 *  - 免登录 endpoint:无需 Authorization header
 *  - Bearer 端点:必须传 Authorization: Bearer <token>(token 由 loginWithWechat 返)
 *  - Token 匿名端点(/orders/[token]/**,/store/**):不传 Authorization,
 *    资源 ID(token / cartId)本身就是凭证
 */

// ============================================================================
// 公共基础类型
// ============================================================================

export interface ApiError {
  /** HTTP 状态码 4xx/5xx */
  status: number;
  /** 服务端业务错误码(POST /public/generate 等路由自定义),无则 undefined */
  code?: string | undefined;
  /** 服务端错误文案,可直接展示给用户 */
  message: string;
  /** 原始响应体(用于排查) */
  raw?: unknown;
}

/** 服务端成功的标准响应包装(部分路由使用) */
export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// ============================================================================
// 1. 认证 / WeChat 登录
// ============================================================================

/** POST /api/auth/wechat-phone-login 请求 */
export interface WeChatLoginRequest {
  /** wx.login() 拿到的临时登录凭证 */
  code: string;
  /** getPhoneNumber 回调的 encryptedData(用户主动授权后才有) */
  encryptedData: string;
  /** getPhoneNumber 回调的 iv */
  iv: string;
}

/** POST /api/auth/wechat-phone-login 响应 */
export interface WeChatLoginResponse {
  /** BA session token;小程序存到 Taro storage,后续 Bearer 调用 */
  token: string;
  /** Better Auth user 行 */
  user: {
    id: string;
    email: string | null;
    name: string | null;
    phoneNumber: string | null;
    wechatOpenid: string | null;
    image: string | null;
    emailVerifiedAt: string | null;
  };
}

// ============================================================================
// 2. 上传
// ============================================================================

/** POST /api/public/upload 请求(formData) — 公共 R2 上传 */
export interface PublicUploadRequest {
  /** 单文件必填 */
  file: File | Blob;
}

/** POST /api/public/upload 响应 */
export interface PublicUploadResponse {
  /** R2 永久 URL,后续生图/订单用作 imageUrl[] */
  url: string;
}

/** POST /api/orders/[token]/upload-url 请求 */
export interface OrderUploadUrlRequest {
  /** 文件 content-type,后端用于决定 R2 path 前缀 */
  contentType: string;
  /** 原始文件名(可选,用于 R2 path 后缀) */
  filename?: string;
}

/** POST /api/orders/[token]/upload-url 响应 */
export interface OrderUploadUrlResponse {
  /** R2 presigned PUT URL */
  uploadUrl: string;
  /** 上传成功后访问的永久 URL */
  publicUrl: string;
  /** 后端期望的 R2 key(校验用) */
  key: string;
  /** URL 有效期(秒),默认 600 */
  expiresIn: number;
}

// ============================================================================
// 3. AI 生图
// ============================================================================

/** POST /api/public/generate 请求 */
export interface PublicGenerateRequest {
  /** 关联的产品效果 ID(从 prompt-templates 拉;不传则纯 prompt 模式) */
  maskId?: string;
  /** 用户追加的自定义 prompt(选填,会拼到模板 prompt 末尾) */
  prompt?: string;
  /** 参考图 URL 数组(R2 URL,顺序敏感);至少 1 张 */
  imageUrls: string[];
  /** 输出尺寸 cm(钥匙扣/冰箱贴场景);可选 */
  size?: number;
  /** 生成数量 1-10;默认 1 */
  count?: number;
  /** 模型 ID 锁定(默认 qwen);不传服务端按 mask 推荐 */
  model?: "qwen" | "gpt_image_2" | "nano_banana2";
  /** 模板 prompt 中的变量取值(模板定义的 form 字段);可选 */
  params?: Record<string, string>;
}

/** POST /api/public/generate 响应 */
export interface PublicGenerateResponse {
  /** 异步任务 ID,前端轮询 /api/image/task/[taskId] 用 */
  taskId: string;
  /** 已登录用户关联的内部 jobId(可选) */
  jobId?: string;
  /** 本次消费积分 */
  costCredits: number;
  /** 提交状态(true 时 taskId 已可轮询) */
  success: boolean;
}

/** GET /api/image/task/[id] 响应 */
export interface ImageTaskStatusResponse {
  status: "pending" | "processing" | "completed" | "failed";
  /** 候选图 R2 URL 列表(完成时存在) */
  candidates: string[];
  /** 失败原因 */
  errorMessage?: string;
  /** 处理耗时 ms */
  durationMs?: number;
  /** 完成时间 ISO */
  finishedAt?: string;
}

/** GET /api/image-gen/prompt-templates 响应(登录态) */
export interface PromptTemplatesResponse {
  /** 产品线列表 */
  productLines: Array<{
    id: string;
    name: string;
    handle: string;
    cover: string;
    description: string;
  }>;
  /** 模板(产品效果)列表 */
  templates: Array<{
    id: string;
    name: string;
    productTypeCode: string;
    productLineId: string;
    outputMode: "grid" | "separate";
    candidateCount: number;
    allowedSizes: number[];
    allowedAccessories: string[];
    cover: string;
    costCredits: number;
    tags: string[];
    status: "active" | "draft" | "archived";
  }>;
}

/** GET /api/image-gen/photos/list 响应(登录态) */
export interface PhotosListResponse {
  photos: Array<{
    id: string;
    url: string;
    thumbnailUrl: string | null;
    source: "upload" | "generation";
    width: number | null;
    height: number | null;
    createdAt: string;
  }>;
  nextCursor: string | null;
}

// ============================================================================
// 4. 订单预览流(/p/[token] 公开流,token 即凭证)
// ============================================================================

/** 订单状态机(与 promptOrder.status + previewShare.status 共享) */
export type OrderStatus =
  | "PENDING"
  | "UPLOADED"
  | "GENERATING"
  | "COMPLETED"
  | "SELECTED"
  | "CONFIRMED"
  | "CANCELLED"
  | "FAILED";

/** GET /api/orders/[token] 响应 */
export interface OrderDetailResponse {
  token: string;
  status: OrderStatus;
  productTypeCode: string;
  uploadedImageCount: number;
  candidateGroups: number;
  selections: Record<string, number>;
  hasUploadedImage: boolean;
  errorMessage: string | null;
  uploadedAt: string | null;
  generatedAt: string | null;
  selectedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  /** 客户元数据(可选,代理商 demo 流写) */
  customerNote?: string | null;
  /** 联系方式(预览流填邮箱/手机号) */
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** 候选图 URL 列表(完成时存在,免 token 二次拉取) */
  candidates?: string[];
  /** 参考图 URL 列表 */
  uploadedImages?: string[];
}

/** GET /api/orders/[token]/status 响应(轻量版,不返 candidates 数组) */
export interface OrderStatusResponse {
  status: OrderStatus;
  updatedAt: string;
  errorMessage: string | null;
}

/** GET /api/orders/[token]/poll 响应(POST 也走同一 handler) */
export interface OrderPollResponse {
  status: OrderStatus;
  candidateGroups: number;
  uploadedImageCount: number;
  selections: Record<string, number>;
  hasUploadedImage: boolean;
  errorMessage: string | null;
  uploadedAt: string | null;
  generatedAt: string | null;
  selectedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
}

/** 定制规格(用于 /configure 提交) */
export interface OrderSpecRequest {
  /** 产品尺寸 cm */
  sizeCm: number;
  /** 配件 code(leather / pvc / bracket / magnet / metal / stand / n_a) */
  accessoryCode: string;
  /** 数量 1-N */
  quantity: number;
  /** 刻字(可选,≤30 字) */
  engraving?: string;
  /** 皮革颜色(可选) */
  leatherColor?: string;
  /** 是否外露(PVC 场景) */
  exposed?: boolean;
  /** 备注(可选) */
  remark?: string;
  /** 订单来源平台(LB 徽章订单专用) */
  platform?: string;
  /** 平台订单号(代理商对账用) */
  platformOrderNo?: string;
}

/** POST /api/orders/[token]/configure 响应 */
export interface OrderConfigureResponse {
  success: boolean;
  spec: OrderSpecRequest;
}

/** POST /api/orders/[token]/upload 响应(formData 直传) */
export interface OrderUploadResponse {
  url: string;
}

/** POST /api/orders/[token]/candidates/[imageIdx]/[candIdx] 响应 */
export interface OrderSelectResponse {
  success: boolean;
  selections: Record<string, number>;
  selectedAt: string;
}

/** POST /api/orders/[token]/regenerate 响应 */
export interface OrderRegenerateResponse {
  success: boolean;
  costCredits: number;
  remainingRegenerations: number;
}

/** GET /api/orders/[token]/history 响应 */
export interface OrderHistoryResponse {
  history: Array<{
    id: string;
    snapshotAt: string;
    candidates: string[];
    selections: Record<string, number>;
  }>;
}

/** POST /api/orders/[token]/regenerate 响应 */
export interface OrderRegenerateResponse {
  success: boolean;
  costCredits: number;
  remainingRegenerations: number;
}

/** GET /api/orders/[token]/history 响应 */
export interface OrderHistoryResponse {
  history: Array<{
    id: string;
    snapshotAt: string;
    candidates: string[];
    selections: Record<string, number>;
  }>;
}

/** POST /api/orders/[token]/history/[id]/restore 响应 */
export interface OrderHistoryRestoreResponse {
  success: boolean;
  restoredAt: string;
}

/** POST /api/orders/[token]/cancel 响应 */
export interface OrderCancelResponse {
  success: boolean;
  cancelledAt: string;
  /** 是否已退积分 */
  refundedCredits: boolean;
}

/** POST /api/orders/[token]/guest-confirm 响应 */
export interface OrderGuestConfirmResponse {
  success: boolean;
  confirmedAt: string;
  /** 后续跟单号(代理商收到订单后回写) */
  orderNo?: string;
}

/** POST /api/orders/[token]/stop-generation 响应 */
export interface OrderStopResponse {
  success: boolean;
  status: OrderStatus;
}

/** POST /api/orders 请求(创建新订单;小程序可走预览流也走直接下单) */
export interface CreateOrderRequest {
  productTypeCode: string;
  spec: OrderSpecRequest;
  /** promptTemplate 模板 ID(可选,留空走默认) */
  promptTemplateId?: string;
  /** 客户标识(浏览器匿名时为 null,小程序传 user.id) */
  userId?: string | null;
  /** 渠道标识(miniprogram) */
  channel: "miniprogram" | "web" | "share";
}

export interface CreateOrderResponse {
  token: string;
  status: OrderStatus;
}

// ============================================================================
// 5. 图片代理(下载 / 缩略图)
// ============================================================================

/** GET /api/image-gen/thumbnail 入参(URL 参数) */
export interface ThumbnailQuery {
  url: string;
  /** 缩放宽度(px),默认 320 */
  width?: number | undefined;
  /** 输出格式,默认 webp */
  format?: "webp" | "jpeg" | "png" | undefined;
}

/** GET /api/image-gen/download 入参(URL 参数) */
export interface DownloadQuery {
  url: string;
  /** 下载文件名(可选,后端设置 Content-Disposition) */
  filename?: string | undefined;
}

// ============================================================================
// 6. SDK 内部状态
// ============================================================================

/** SDK 全局配置 */
export interface SdkConfig {
  /** API base URL,例:https://api.mooncoda.com */
  baseUrl: string;
  /** 当前 token(loginWithWechat 成功后 SDK 自动写入;也可手动 set) */
  token?: string | undefined;
  /** 默认 fetch 超时 ms,默认 30000 */
  timeoutMs?: number | undefined;
  /** 自定义 fetch 实现(Taro.request 包装) */
  fetch?: typeof fetch | undefined;
  /** 401 时的回调(SDK 内部不自动 refresh —— 跳回登录页由业务决定) */
  onUnauthorized?: (() => void) | undefined;
}
