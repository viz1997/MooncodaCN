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

/**
 * POST /api/public/upload-url 请求(2026-10-15 v1.3.0)
 *
 * 与 /api/orders/[token]/upload-url 同形态,但不绑订单,用于
 * 公共生图参考图直传 R2。mp → R2 一跳,跳过 BFF 4.5MB body
 * 限制 + Vercel 60s timeout。
 */
export interface PublicUploadUrlRequest {
  /** 文件 MIME,后端白名单校验(PNG/JPEG/WebP) */
  contentType: string;
  /** 字节数(可选;如果传了后端会卡 5MB cap,挡住"声明 2MB 实际 100MB"恶意) */
  size?: number;
  /** 文件扩展名(可选,默认从 contentType 推导) */
  ext?: string;
}

/** POST /api/public/upload-url 响应 */
export interface PublicUploadUrlResponse {
  /** R2 presigned PUT URL —— mp 用 wx.request/Taro.request PUT 这个 URL */
  uploadUrl: string;
  /** 上传成功后访问的永久 URL —— 喂给 submitGenerate.imageUrls */
  publicUrl: string;
  /** 后端生成的 R2 objectKey(用于日志对账) */
  objectKey: string;
  /** 必须在 PUT 时带的 header,后端签名时锁定了 Content-Type */
  headers: Record<string, string>;
  /** 业务层 cap(当前 5MB),mp 端做客户端预压缩 */
  maxBytes: number;
  /** URL 有效期(秒),默认 300 */
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
  /**
   * 模型 ID 锁定(默认 apimart_gpt_image,2026-10-XX 切换)
   * 不传服务端按 mask 推荐
   *
   * 2026-10-XX：apimart 拆 flare + sunburst 两条模型可选,显式指定可走 sunburst 高质档
   * - apimart_gpt_image           → apimart 上游 gpt-image-2.5-flare(速度/成本优先)
   * - apimart_gpt_image_sunburst  → apimart 上游 gpt-image-2.5-sunburst(质量优先,贵一档)
   * 注:apimart.ai 2026-10 弃用了 gpt-image-2.5-ext,现只列 flare + sunburst 两个子型号
   */
  model?:
    | "qwen"
    | "gpt_image_2"
    | "nano_banana2"
    | "apimart_gpt_image"
    | "apimart_gpt_image_sunburst";
  /** 模板 prompt 中的变量取值(模板定义的 form 字段);可选 */
  params?: Record<string, string>;
  /**
   * 2026-10-16 v1.5.0:视觉风格 ID(可选,从 listStyles() 拿)。
   * 例 "ai_qversion" / "ai_anime" / "ai_watercolor" / "ai_lineart" /
   * "ai_original"。
   *
   * 不传或传 "ai_original" → 等价于无风格,服务端不注入 prompt prefix;
   * 传有效 id → 服务端把对应风格 prompt 拼到模板 prompt 之前(用户
   * 自定义 prompt 仍追加在末尾)。无效 id 返 400 INVALID_STYLE。
   *
   * 计费:不影响 costCredits(风格仅 prompt 前缀,mp UI 自己用
   * styles[i].surchargeCents / 100 显示「+¥15」提示)。
   * 提示词内容(prompt 字段)是服务端 private,客户端拿不到 —— 也别尝试
   * 从本字段或任何 field 拼出来。
   */
  aiStyleId?: string;
}

/** POST /api/image-gen/submit 响应 */
export interface PublicGenerateResponse {
  /** 异步任务 ID,前端轮询 /api/image-gen/jobs/[jobId]/poll 用 */
  taskId: string;
  /** 已登录用户关联的内部 jobId(可选) */
  jobId?: string;
  /** 本次消费积分 */
  costCredits: number;
  /** 提交状态(true 时 taskId 已可轮询) */
  success: boolean;
}

/** POST /api/image-gen/jobs/[jobId]/poll 响应(SDK 端映射) */
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

/**
 * GET /api/public/prompt-templates 响应(2026-10-13 切到 public 鉴权)
 *
 * 字段命名对齐小程序 SDK 契约(不是 DB 原始字段):
 *   - productLineId → id / handle
 *   - coverUrl → cover
 *   - previewUrl → cover
 *   - price(cents) → costCredits
 *   - status(active/inactive)
 *
 * 历史变更:2026-10-13 之前叫 /api/image-gen/prompt-templates 且要 Bearer,
 *          现改到 /api/public/prompt-templates 走 x-api-key,响应 shape 同步对齐。
 */
export interface PromptTemplatesResponse {
  /** 产品线列表(按 sortOrder 升序;maskCount=0 的 productLine 已被服务端过滤) */
  productLines: Array<{
    id: string;
    name: string;
    /** 与 id 同值;保留字段供未来稳定 slug 演进(协议不变可演进) */
    handle: string;
    cover: string;
    description: string;
    /** 服务端排序(asc),前端可不读,按返回顺序展示即可 */
    sortOrder: number;
    /** 该产品线下,当前 API Key 白名单过滤后可见的 active 模板数 */
    maskCount: number;
  }>;
  /** 模板(产品效果)列表 */
  templates: Array<{
    /** 等同 maskId,提交生图时用 */
    id: string;
    name: string;
    productTypeCode: string | null;
    /** 多对多:一个模板可挂多个 productLine */
    productLineIds: string[];
    outputMode: "grid" | "separate";
    candidateCount: number;
    /** 单位 cm 的字符串数组;空 = 字典全量 */
    allowedSizes: string[];
    allowedAccessories: string[];
    cover: string;
    /** cents(整数,展示时 /100) */
    costCredits: number;
    status: "active" | "inactive";
    /**
     * 2026-10-16 v1.5.0:该模板自带的视觉样式选项(每条模板独立)。空数
     * 组 = 老模板未配 styles,mp 不渲染 chip。提交生图时 aiStyleId 必
     * 须命中当前选中模板 styles 之一。
     */
    styles: TemplateStyle[];
  }>;
}

/**
 * 模板视觉样式(2026-10-16 v1.5.0 新增,存在 templates[i].styles)
 *
 * 每个 promptTemplate 自带一组 TemplateStyle。用户选样式 = 选
 * TemplateStyle.id,提交后服务端用对应 TemplateStyle.prompt 替换模板
 * prompt 里的 `{{style}}` 占位符 —— 「替换关键提示词」语义。
 *
 * 字段挑选原则 —— 服务端 TemplateStyle 全字段为:
 *   id / name / nameEn / prompt / surchargeCents / outputSize /
 *   swatch / estimatedLatencySec
 *
 * SDK 端把 `prompt` 也暴露了(不同于早先设计的 private 隐藏),理由:
 * 替换语义需要 SDK 知道自己选的是哪个 prompt(虽然不展示给用户)。后续
 * 若 prompt 涉及商业秘密,可单独加 `promptPreview` 字段(管理员编辑过
 * 的简介)替换暴露,不要直接隐藏。
 *
 * Taro UI 用法:用 swatch 做 chip 配色,surchargeCents / 100 显示「+¥15」
 * 加价提示。
 */
export interface TemplateStyle {
  /** 模板内唯一,如 "ai_qversion" / "ai_anime" / "ai_watercolor" / "ai_lineart" / "ai_original" */
  id: string;
  /** 中文名,如 "Q 版萌系" */
  name: string;
  /** 英文名,如 "Q-Version" */
  nameEn: string;
  /**
   * 关键提示词 —— 服务端会用这个 prompt 替换模板 prompt 里的 `{{style}}`
   * 占位符(详见 submitGenerate.aiStyleId 注释)。
   */
  prompt: string;
  /** 加价(分);0 = 不加价,如 ai_original=0,ai_anime=2000。 */
  surchargeCents: number;
  /** 输出尺寸(server 端参考,目前所有样式都用 1024x1024) */
  outputSize: "1024x1024" | "1536x1024" | "1024x1536";
  /** UI swatch 颜色 hex,如 "#7A5A8C"。 */
  swatch: string;
  /** 预计耗时(秒);ai_original=0(直通) */
  estimatedLatencySec: number;
}

/**
 * GET /api/public/quota 响应
 *
 * 2026-10-13：mp 端从云函数迁 BFF 时 owner 之前指错路径(/api/credits/balance
 * 404),正确路径是 /api/public/quota。
 *
 * 语义:外部 API Key 的月调用配额,不是登录用户的 credits 余额。
 * - limit=0 → 无限配额(服务端 externalApiKey.monthlyQuota ≤ 0 视为无限)
 * - remaining=-1 → 无限配额的占位(mp 端 UI 可据此隐藏"剩余 N 次"提示)
 * - resetAt:下月 1 号 0:00 UTC 的 ISO 8601 字符串
 */
export interface QuotaResponse {
  keyName: string;
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
  resetAt: string;
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
// 4. 产品能力接口(/api/image-gen/products)—— 2026-10-18 v1.6.0 新增
// ============================================================================

/**
 * 配件维度
 * - material: 材质（皮/金属）
 * - protection: 保护（PVC 罩/玻璃罩）
 * - mount: 装配（支架/磁铁/底座）
 * - decor: 装饰（编织绳）
 */
export type AccessoryCategory = "material" | "protection" | "mount" | "decor";

/** 产品分类（与 mock-catalog STOREFRONT 概念对齐） */
export type ProductCategory =
  | "keychain"
  | "shape-keychain"
  | "magnet"
  | "frame"
  | "leather-badge"
  | "figure";

/** 配件变体（如 leather 棕色 / 编织绳红色 / 玻璃罩 4cm） */
export interface AccessoryVariantDef {
  /** 变体 code，模板内唯一，如 "leather_brown" / "rope_red" / "glass_4" */
  code: string;
  /** i18n 名称 */
  name: { zh: string; en: string };
  /** swatch hex（颜色类变体）；尺寸类变体为 null */
  swatch?: string | null;
  /** 加价（分）；0 = 不加价 */
  priceDeltaCents: number;
}

/** 配件定义 */
export interface AccessoryDef {
  /** 配件 code（leather / pvc / bracket / metal / magnet / stand / glass_cover / braided_rope） */
  code: string;
  /** i18n 名称 */
  name: { zh: string; en: string };
  /** 配件维度分类 */
  category: AccessoryCategory;
  /** 默认加价（分）；变体可覆盖 */
  priceDeltaCents: number;
  /** 该配件要求的产品能力（启用门控；未定义 = 无门控） */
  requiresCapability?:
    | "canEngrave"
    | "canLeatherColor"
    | "canPvcProtection"
    | "canLeatherExposed"
    | "canHaveRemarks"
    | "canPlatform"
    | null;
  /** 该配件的变体列表；空数组 = 无变体（如 magnet） */
  variants: AccessoryVariantDef[];
}

/** 产品能力位 */
export interface ProductCapabilities {
  canEngrave: boolean;
  canLeatherColor: boolean;
  canPvcProtection: boolean;
  canLeatherExposed: boolean;
  canHaveRemarks: boolean;
  canPlatform: boolean;
}

/** 产品尺寸档 */
export interface ProductSizeDef {
  /** 尺寸 code（cm 数字字符串，如 "4" / "6"） */
  code: string;
  /** i18n 标签 */
  label: { zh: string; en: string };
  /** 加价（分）；0 = 基准价 */
  priceDeltaCents: number;
}

/** 产品下的 AI 模板摘要（嵌套在 ProductCapability.templates[]） */
export interface ProductTemplateSummary {
  /** 等同 maskId（productEffect.id），喂给 submitGenerate.maskId */
  templateId: string;
  /** i18n 名称 */
  name: { zh: string; en: string };
  /** 封面图 URL */
  cover: string;
  /** 模板基础积分（cents）；ui 展示时 /100 */
  costCredits: number;
  /** 候选输出模式 */
  outputMode: "grid" | "separate";
  /** 单次生图候选数（1/2/4/9） */
  candidateCount: number;
  /** 该模板自带的视觉风格数组（来自 promptTemplate.styles） */
  visualStyles: TemplateStyle[];
  /** 该模板允许的配件子集（来自 productEffect.allowedAccessories）；空 = 全量 */
  allowedAccessories: string[];
}

/** 单个产品的完整能力定义（/api/image-gen/products 顶层数组元素） */
export interface ProductCapability {
  /** 产品码（R / A / P / RM / LB / M） */
  productTypeCode: string;
  /** 产品分类（与 mock-catalog 一致） */
  category: ProductCategory;
  /** i18n 显示名 */
  displayName: { zh: string; en: string };
  /** i18n 描述 */
  description: { zh: string; en: string };
  /** 产品封面图 URL */
  cover: string;
  /**
   * 产品基价（分）—— 来自 server 端 BASE_PRICE_CENTS 字典（R=1900 / A=2400 /
   * P=3900 / RM=4900 / LB=5900 / M=19900）。前端拼 totalPrice：
   *   basePriceCents
   *   + sizes[i].priceDeltaCents
   *   + accessories[k].variants[v].priceDeltaCents
   *   + visualStyles[j].surchargeCents（如果选了非默认风格）
   */
  basePriceCents: number;
  /** 该产品可选尺寸档 */
  sizes: ProductSizeDef[];
  /** 该产品聚合自 templates[].visualStyles 的去重集合（仅展示用） */
  visualStyles: TemplateStyle[];
  /** 该产品可选配件（含变体） */
  accessories: AccessoryDef[];
  /** 该产品能力位（catalog + 模板覆盖合并后） */
  capabilities: ProductCapabilities;
  /** 该产品可用的 AI 模板列表 */
  templates: ProductTemplateSummary[];
}

/** GET /api/image-gen/products 响应 */
export interface ProductListResponse {
  success: true;
  /** 当前 API key 作用域（无 key = null）；前端可据此灰掉白名单外的产品 */
  keyScope?: { keyName: string; allowedMasks: string[] } | null;
  /** 响应 locale（"zh" | "en"），便于客户端核对 */
  locale: "zh" | "en";
  products: ProductCapability[];
}

// ============================================================================
// 5. 订单预览流(/p/[token] 公开流,token 即凭证)
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
  /**
   * 外部 API Key(mk_pub_* 前缀,admin 给合作伙伴发的那种)。
   * 走 x-api-key header,用于 /api/public/** 系列端点。
   * 业务侧拿到 key 后调 setSdkApiKey() 写入。
   * 与 token(Bearer)并存:同时设置时服务端优先 x-api-key(配额走 key)。
   */
  apiKey?: string | undefined;
  /** 默认 fetch 超时 ms,默认 30000 */
  timeoutMs?: number | undefined;
  /** 自定义 fetch 实现(Taro.request 包装) */
  fetch?: typeof fetch | undefined;
  /** 401 时的回调(SDK 内部不自动 refresh —— 跳回登录页由业务决定) */
  onUnauthorized?: (() => void) | undefined;
}
