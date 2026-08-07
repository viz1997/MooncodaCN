import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  json,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Better Auth 核心表 Schema
 *
 * 这些表是 Better Auth 认证系统所必需的核心表结构
 * 参考: https://www.better-auth.com/docs/concepts/database
 */

// ============================================
// 用户角色枚举
// ============================================

/**
 * 用户角色枚举
 */
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

// ============================================
// 用户表 (User)
// ============================================
/**
 * 用户表 - 存储用户基本信息
 *
 * @field id - 用户唯一标识符
 * @field name - 用户显示名称
 * @field email - 用户邮箱 (唯一)
 * @field emailVerified - 邮箱是否已验证
 * @field image - 用户头像 URL
 * @field role - 用户角色 (user/admin)
 * @field banned - 是否被封禁
 * @field bannedReason - 封禁原因
 * @field needsVerification - 是否需要邮箱验证（管理员手动创建时指定；无密码账户必须为 true）
 * @field customerId - 支付提供商客户 ID (Creem)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: userRoleEnum("role").notNull().default("user"),
  banned: boolean("banned").notNull().default(false),
  bannedReason: text("banned_reason"),
  needsVerification: boolean("needs_verification").notNull().default(false),
  customerId: text("customer_id").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 会话表 (Session)
// ============================================
/**
 * 会话表 - 存储用户登录会话
 *
 * @field id - 会话唯一标识符
 * @field expiresAt - 会话过期时间
 * @field token - 会话令牌 (用于验证)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 * @field ipAddress - 登录 IP 地址
 * @field userAgent - 用户代理 (浏览器信息)
 * @field userId - 关联的用户 ID
 */
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// ============================================
// 账户表 (Account)
// ============================================
/**
 * 账户表 - 存储 OAuth 提供商关联信息
 *
 * 当用户使用 GitHub、Google 等第三方登录时，
 * 此表存储该提供商的账户信息
 *
 * @field id - 账户唯一标识符
 * @field accountId - 提供商返回的账户 ID
 * @field providerId - 提供商标识符 (如 "github", "google")
 * @field userId - 关联的用户 ID
 * @field accessToken - 访问令牌
 * @field refreshToken - 刷新令牌
 * @field idToken - ID 令牌 (OpenID Connect)
 * @field accessTokenExpiresAt - 访问令牌过期时间
 * @field refreshTokenExpiresAt - 刷新令牌过期时间
 * @field scope - 授权范围
 * @field password - 密码哈希 (用于邮箱密码登录)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 验证表 (Verification)
// ============================================
/**
 * 验证表 - 存储邮箱验证和密码重置令牌
 *
 * @field id - 验证记录唯一标识符
 * @field identifier - 标识符 (通常是邮箱地址)
 * @field value - 验证值/令牌
 * @field expiresAt - 过期时间
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 订阅表 (Subscription)
// ============================================
/**
 * 订阅表 - 存储用户的订阅信息
 *
 * @field id - 订阅记录唯一标识符
 * @field userId - 关联的用户 ID
 * @field subscriptionId - 支付提供商订阅 ID (唯一)
 * @field priceId - 支付提供商价格/产品 ID
 * @field status - 订阅状态 (active, canceled, past_due, etc.)
 * @field currentPeriodStart - 当前计费周期开始时间
 * @field currentPeriodEnd - 当前计费周期结束时间
 * @field cancelAtPeriodEnd - 是否在周期结束时取消
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const subscription = pgTable("subscription", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  subscriptionId: text("subscription_id").notNull().unique(),
  priceId: text("price_id").notNull(),
  status: text("status").notNull().default("incomplete"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 类型导出
// ============================================
/**
 * 从 Schema 推断的类型
 * 用于在应用中保持类型安全
 */
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;

export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;

export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;

export type Subscription = typeof subscription.$inferSelect;
export type NewSubscription = typeof subscription.$inferInsert;

// ============================================
// 积分系统枚举
// ============================================

/**
 * 积分账户状态枚举
 */
export const creditsBalanceStatusEnum = pgEnum("credits_balance_status", [
  "active",
  "frozen",
]);

/**
 * 积分批次状态枚举
 */
export const creditsBatchStatusEnum = pgEnum("credits_batch_status", [
  "active",
  "consumed",
  "expired",
]);

/**
 * 积分批次来源类型枚举
 */
export const creditsBatchSourceEnum = pgEnum("credits_batch_source", [
  "purchase",
  "subscription",
  "bonus",
  "refund",
]);

/**
 * 积分交易类型枚举
 */
export const creditsTransactionTypeEnum = pgEnum("credits_transaction_type", [
  "purchase",
  "consumption",
  "monthly_grant",
  "registration_bonus",
  "admin_grant",
  "expiration",
  "refund",
]);

// ============================================
// 积分余额表 (Credits Balances)
// ============================================
/**
 * 积分余额表 - 存储用户的积分账户信息
 *
 * 采用预计算余额模式，避免每次查询都需要聚合计算
 *
 * @field id - 记录唯一标识符
 * @field userId - 关联的用户 ID（唯一）
 * @field balance - 当前可用积分余额
 * @field totalEarned - 累计获得积分
 * @field totalSpent - 累计消费积分
 * @field status - 账户状态（active/frozen）
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const creditsBalance = pgTable("credits_balance", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0),
  totalEarned: integer("total_earned").notNull().default(0),
  totalSpent: integer("total_spent").notNull().default(0),
  status: creditsBalanceStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 积分批次表 (Credits Batches)
// ============================================
/**
 * 积分批次表 - 积分库存管理
 *
 * 每次获得积分都会创建一个批次记录
 * 用于实现 FIFO (先进先出) 过期机制
 *
 * @field id - 批次唯一标识符
 * @field userId - 关联的用户 ID
 * @field amount - 原始积分数量
 * @field remaining - 剩余积分数量
 * @field issuedAt - 发放时间
 * @field expiresAt - 过期时间（可为空，表示永不过期）
 * @field status - 批次状态（active/consumed/expired）
 * @field sourceType - 来源类型（purchase/subscription/bonus/refund）
 * @field sourceRef - 来源引用（如订单ID、订阅ID等）
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const creditsBatch = pgTable("credits_batch", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  remaining: integer("remaining").notNull(),
  issuedAt: timestamp("issued_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  status: creditsBatchStatusEnum("status").notNull().default("active"),
  sourceType: creditsBatchSourceEnum("source_type").notNull(),
  sourceRef: text("source_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 积分交易表 (Credits Transactions)
// ============================================
/**
 * 积分交易表 - 双重记账账本
 *
 * 记录所有积分变动，采用借贷记账法
 * 每笔交易都有明确的借方(debit)和贷方(credit)账户
 *
 * @field id - 交易唯一标识符
 * @field userId - 关联的用户 ID
 * @field type - 交易类型
 * @field amount - 交易积分数量（始终为正数）
 * @field debitAccount - 借方账户（资金来源）
 * @field creditAccount - 贷方账户（资金去向）
 * @field description - 交易描述
 * @field metadata - 扩展元数据（JSON）
 * @field createdAt - 创建时间
 */
export const creditsTransaction = pgTable("credits_transaction", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: creditsTransactionTypeEnum("type").notNull(),
  amount: integer("amount").notNull(),
  debitAccount: text("debit_account").notNull(),
  creditAccount: text("credit_account").notNull(),
  description: text("description"),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================
// 积分系统类型导出
// ============================================

export type CreditsBalance = typeof creditsBalance.$inferSelect;
export type NewCreditsBalance = typeof creditsBalance.$inferInsert;

export type CreditsBatch = typeof creditsBatch.$inferSelect;
export type NewCreditsBatch = typeof creditsBatch.$inferInsert;

export type CreditsTransaction = typeof creditsTransaction.$inferSelect;
export type NewCreditsTransaction = typeof creditsTransaction.$inferInsert;

/** 积分账户状态类型 */
export type CreditsBalanceStatus =
  (typeof creditsBalanceStatusEnum.enumValues)[number];

/** 积分批次状态类型 */
export type CreditsBatchStatus =
  (typeof creditsBatchStatusEnum.enumValues)[number];

/** 积分批次来源类型 */
export type CreditsBatchSource =
  (typeof creditsBatchSourceEnum.enumValues)[number];

/** 积分交易类型 */
export type CreditsTransactionType =
  (typeof creditsTransactionTypeEnum.enumValues)[number];

// ============================================
// Newsletter 订阅表
// ============================================
/**
 * Newsletter 订阅者表 - 存储邮件订阅信息
 *
 * @field id - 记录唯一标识符
 * @field email - 订阅者邮箱 (唯一)
 * @field isSubscribed - 是否订阅中 (用于取消订阅而不删除记录)
 * @field subscribedAt - 订阅时间
 * @field unsubscribedAt - 取消订阅时间 (可为空)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const newsletterSubscriber = pgTable("newsletter_subscriber", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  isSubscribed: boolean("is_subscribed").notNull().default(true),
  subscribedAt: timestamp("subscribed_at").notNull().defaultNow(),
  unsubscribedAt: timestamp("unsubscribed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// Newsletter 类型导出
// ============================================

export type NewsletterSubscriber = typeof newsletterSubscriber.$inferSelect;
export type NewNewsletterSubscriber = typeof newsletterSubscriber.$inferInsert;

// ============================================
// 工单系统枚举
// ============================================

/**
 * 工单类别枚举
 */
export const ticketCategoryEnum = pgEnum("ticket_category", [
  "billing",
  "technical",
  "bug",
  "feature",
  "other",
]);

/**
 * 工单优先级枚举
 */
export const ticketPriorityEnum = pgEnum("ticket_priority", [
  "low",
  "medium",
  "high",
]);

/**
 * 工单状态枚举
 */
export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "in_progress",
  "resolved",
  "closed",
]);

// ============================================
// 工单表 (Tickets)
// ============================================
/**
 * 工单表 - 存储用户支持工单
 *
 * @field id - 工单唯一标识符
 * @field userId - 创建工单的用户 ID
 * @field subject - 工单主题
 * @field category - 工单类别 (billing/technical/bug/feature/other)
 * @field priority - 优先级 (low/medium/high)
 * @field status - 状态 (open/in_progress/resolved/closed)
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const ticket = pgTable("ticket", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  category: ticketCategoryEnum("category").notNull().default("other"),
  priority: ticketPriorityEnum("priority").notNull().default("medium"),
  status: ticketStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 工单消息表 (Ticket Messages)
// ============================================
/**
 * 工单消息表 - 存储工单对话记录
 *
 * @field id - 消息唯一标识符
 * @field ticketId - 关联的工单 ID
 * @field userId - 发送者用户 ID
 * @field content - 消息内容
 * @field isAdminResponse - 是否为管理员回复 (用于 UI 样式区分)
 * @field createdAt - 创建时间
 */
export const ticketMessage = pgTable("ticket_message", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id")
    .notNull()
    .references(() => ticket.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  isAdminResponse: boolean("is_admin_response").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================
// 工单系统类型导出
// ============================================

export type Ticket = typeof ticket.$inferSelect;
export type NewTicket = typeof ticket.$inferInsert;

export type TicketMessage = typeof ticketMessage.$inferSelect;
export type NewTicketMessage = typeof ticketMessage.$inferInsert;

/** 用户角色类型 */
export type UserRole = (typeof userRoleEnum.enumValues)[number];

/** 工单类别类型 */
export type TicketCategory = (typeof ticketCategoryEnum.enumValues)[number];

/** 工单优先级类型 */
export type TicketPriority = (typeof ticketPriorityEnum.enumValues)[number];

/** 工单状态类型 */
export type TicketStatus = (typeof ticketStatusEnum.enumValues)[number];

// ============================================
// 生图系统枚举
// ============================================

/**
 * 生图任务状态枚举
 */
export const imageJobStatusEnum = pgEnum("image_job_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

/**
 * 生图生成模式枚举
 */
export const generationModeEnum = pgEnum("generation_mode", [
  "text_to_image",
  "image_to_image",
  "image_editing",
  "inpainting",
  "upscaling",
]);

/**
 * 产品效果状态枚举
 */
export const productEffectStatusEnum = pgEnum("product_effect_status", [
  "active",
  "inactive",
]);

/**
 * 提示词场景枚举
 */
export const promptSceneEnum = pgEnum("prompt_scene", [
  "generate_2d",
  "generate_3d",
  "translate",
  "stylize",
  "enhance",
  "custom",
]);

// ============================================
// 照片表 (Photo)
// ============================================
/**
 * 照片表 - 用户上传的参考图
 *
 * @field id - 照片唯一标识符
 * @field userId - 关联的用户 ID
 * @field fileName - 原始文件名
 * @field fileUrl - 文件公共访问 URL
 * @field thumbnailUrl - 缩略图 URL
 * @field md5 - 文件 MD5（去重）
 * @field width - 宽度
 * @field height - 高度
 * @field format - 图片格式
 * @field fileSize - 文件大小（字节）
 * @field createdAt - 创建时间
 */
export const photo = pgTable("photo", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  md5: text("md5"),
  width: integer("width"),
  height: integer("height"),
  format: text("format"),
  fileSize: integer("file_size"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================
// 生图任务表 (ImageJob)
// ============================================
/**
 * 生图任务表 - 持久化生图任务与历史
 *
 * 记录每次生图请求的输入参数、状态、结果与计费
 *
 * @field id - 任务唯标识符
 * @field userId - 关联的用户 ID
 * @field photoId - 关联的参考照片 ID（可空，纯文生图时为空）
 * @field maskId - 关联的产品效果 ID（可空，自定义提示词时为空）
 * @field model - 生图模型 id（doubao/flux1 等）
 * @field mode - 生成模式
 * @field prompt - 实际发送给模型的提示词（已渲染变量）
 * @field negativePrompt - 反向提示词
 * @field imageUrl - 输入参考图 URL
 * @field size - 输出尺寸
 * @field batchSize - 生成数量
 * @field seed - 随机种子
 * @field guidanceScale - 引导系数
 * @field numInferenceSteps - 推理步数
 * @field status - 任务状态
 * @field resultUrls - 生成结果图 URL 数组（JSON）
 * @field revisedPrompt - 模型重写的提示词（DALL-E 3 特性）
 * @field errorMsg - 失败原因
 * @field generateDuration - 生成耗时（ms）
 * @field cost - 生成成本
 * @field currency - 成本币种
 * @field creditsConsumed - 本次消耗的积分
 * @field taskId - 异步任务 id（异步模型用）
 * @field createdAt - 创建时间
 * @field completedAt - 完成时间
 */
export const imageJob = pgTable("image_job", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  photoId: text("photo_id").references(() => photo.id, {
    onDelete: "set null",
  }),
  maskId: text("mask_id"),
  model: text("model").notNull(),
  mode: generationModeEnum("mode").notNull(),
  prompt: text("prompt").notNull(),
  negativePrompt: text("negative_prompt"),
  imageUrl: text("image_url"),
  size: text("size").notNull().default("1024x1024"),
  batchSize: integer("batch_size").notNull().default(1),
  seed: integer("seed"),
  guidanceScale: integer("guidance_scale"),
  numInferenceSteps: integer("num_inference_steps"),
  status: imageJobStatusEnum("status").notNull().default("pending"),
  resultUrls: json("result_urls").$type<string[]>().notNull().default([]),
  revisedPrompt: text("revised_prompt"),
  errorMsg: text("error_msg"),
  generateDuration: integer("generate_duration"),
  cost: integer("cost"),
  currency: text("currency"),
  creditsConsumed: integer("credits_consumed"),
  taskId: text("task_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

// ============================================
// 产品效果表 (ProductEffect)
// ============================================
/**
 * 产品效果表 - AI 效果模版（提示词 + 变量 + 关联生图模型）
 *
 * @field id - 效果唯一标识符（maskId，如 MASK_001）
 * @field name - 效果名称
 * @field category - 分类
 * @field description - 描述
 * @field previewUrl - 预览图 URL
 * @field prompt - 提示词（支持 {{变量}} 占位符）
 * @field variables - 提示词变量定义（JSON）
 * @field model - 推荐生图模型 id
 * @field config - 配置（风格/颜色/材质，JSON）
 * @field price - 价格
 * @field status - 状态
 * @field author - 创建者
 * @field createdAt - 创建时间
 * @field updatedAt - 更新时间
 */
export const productEffect = pgTable("product_effect", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull().default("其他"),
  description: text("description").notNull().default(""),
  previewUrl: text("preview_url").notNull(),
  prompt: text("prompt").notNull(),
  variables: json("variables")
    .$type<import("./image-gen-types").PromptVariable[]>()
    .notNull()
    .default([]),
  model: text("model").notNull().default("doubao"),
  config: json("config")
    .$type<{
      style: string;
      color?: string;
      material?: string;
    }>()
    .notNull()
    .default({ style: "custom" }),
  scene: promptSceneEnum("scene").notNull().default("generate_2d"),
  versions: json("versions")
    .$type<import("./image-gen-types").PromptVersion[]>()
    .notNull()
    .default([]),
  price: integer("price").notNull().default(0),
  status: productEffectStatusEnum("status").notNull().default("active"),
  usageCount: integer("usage_count").notNull().default(0),
  successRate: integer("success_rate").notNull().default(0),
  avgDuration: integer("avg_duration").notNull().default(0),
  author: text("author").notNull().default("admin"),
  productLineIds: json("product_line_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 生图系统类型导出
// ============================================

export type Photo = typeof photo.$inferSelect;
export type NewPhoto = typeof photo.$inferInsert;

export type ImageJob = typeof imageJob.$inferSelect;
export type NewImageJob = typeof imageJob.$inferInsert;

export type ProductEffectRow = typeof productEffect.$inferSelect;
export type NewProductEffectRow = typeof productEffect.$inferInsert;

/** 生图任务状态类型 */
export type ImageJobStatus = (typeof imageJobStatusEnum.enumValues)[number];

/** 生图生成模式类型 */
export type GenerationMode = (typeof generationModeEnum.enumValues)[number];

/** 产品效果状态类型 */
export type ProductEffectStatus =
  (typeof productEffectStatusEnum.enumValues)[number];

/** 提示词场景类型 */
export type PromptScene = (typeof promptSceneEnum.enumValues)[number];

// ============================================
// GPT-Image-2 提示词生图业务
// ============================================

/**
 * 提示词订单状态枚举
 *
 * 状态机：PENDING → GENERATING → CANDIDATES_READY → (SELECTED | CANCELLED | FAILED)
 * 允许从 CANDIDATES_READY / FAILED 重新追加原图回到 GENERATING（增量追加）
 */
export const promptOrderStatusEnum = pgEnum("prompt_order_status", [
  "PENDING",
  "GENERATING",
  "CANDIDATES_READY",
  "SELECTED",
  "CANCELLED",
  "FAILED",
]);

/**
 * 订单来源平台枚举
 *
 * 标识订单从哪个渠道分发（淘宝 / 抖音 / 小红书 / 红人 / 合作方），
 * 留空表示内部 / 未指定。
 */
export const promptOrderPlatformEnum = pgEnum("prompt_order_platform", [
  "taobao", // 淘宝
  "douyin", // 抖音
  "xiaohongshu", // 小红书
  "kol", // 红人
  "partner", // 合作方
]);

export type PromptOrderPlatform =
  (typeof promptOrderPlatformEnum.enumValues)[number];

// ============================================
// 提示词模板表 (PromptTemplate)
// ============================================
/**
 * 提示词模板 - 每条模板对应一种生图场景，prompt 对用户端隐藏
 *
 * @field id - 模板唯一标识符
 * @field name - 模板名称（管理端可见）
 * @field description - 模板描述（用户端可见，不含提示词内容）
 * @field prompt - 隐藏的提示词内容（用户端不展示）
 * @field size - 默认图片尺寸（WxH 字符串）
 * @field candidateCount - 单次生图候选数（1/2/4/9）
 * @field coverUrl - 模板封面图
 * @field isActive - 是否启用（停用后不能创建新订单）
 */
export const promptTemplate = pgTable("prompt_template", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  prompt: text("prompt").notNull(),
  size: text("size").notNull().default("1024x1024"),
  candidateCount: integer("candidate_count").notNull().default(4),
  coverUrl: text("cover_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============================================
// 提示词订单表 (PromptOrder)
// ============================================
/**
 * 提示词订单 - 关联模板与指定用户，通过 token 公开访问
 *
 * @field id - 订单唯一标识符
 * @field orderNo - 业务唯一订单号
 * @field templateId - 关联模板
 * @field recipientName - 接收用户标识（仅展示用，非登录用户）
 * @field token - 访问令牌（防止 orderNo 被枚举；32 字符 hex）
 * @field status - 当前状态
 * @field uploadedImages - 已上传原图（dataUrl 字符串数组，JSON）
 * @field uploadCount - 用户需要上传的图片数量（1-50）
 * @field candidates - 效果图（嵌套数组 [[b64,...],[b64,...]]，外层索引 = 原图索引）
 * @field selectedIndex - 兼容字段（旧模型：取 selections[0]）
 * @field selections - 每张原图的候选选择（长度 = uploadedImages.length，未选为 null）
 * @field errorMessage - 失败原因
 */
export const promptOrder = pgTable(
  "prompt_order",
  {
    id: text("id").primaryKey(),
    orderNo: text("order_no").notNull(),
    templateId: text("template_id")
      .notNull()
      .references(() => promptTemplate.id, { onDelete: "restrict" }),
    // 接收用户标识，可空（创建订单时选填）。旧记录可能为空字符串。
    recipientName: text("recipient_name").notNull().default(""),
    // 订单来源平台（选填），null = 未指定
    platform: promptOrderPlatformEnum("platform"),
    token: text("token").notNull().unique(),
    status: promptOrderStatusEnum("status").notNull().default("PENDING"),
    uploadedImages: text("uploaded_images"),
    uploadCount: integer("upload_count").notNull().default(1),
    candidates: text("candidates"),
    selectedIndex: integer("selected_index"),
    selections: text("selections"),
    errorMessage: text("error_message"),
    /**
     * 本轮生图的 Lingting 任务态（JSON，见 features/gpt-image/lib/generation-task.ts）。
     * null = 无进行中任务。服务端只做 submit 拿 task_id 存这里，
     * 轮询由前端调 /api/orders/[token]/poll 驱动（Serverless 无长时后台）。
     */
    generationTask: text("generation_task"),
    uploadedAt: timestamp("uploaded_at"),
    generatedAt: timestamp("generated_at"),
    selectedAt: timestamp("selected_at"),
    cancelledAt: timestamp("cancelled_at"),
    /**
     * 订单创建者 —— 关联 user.id。
     * 可空：迁移前的老订单没有归属记录，创建时由服务端从 session 写入。
     * 列表接口按 createdBy 过滤，每个登录用户只能看到自己创建的订单。
     */
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    templateIdx: index("prompt_order_template_idx").on(t.templateId),
    statusIdx: index("prompt_order_status_idx").on(t.status),
    createdByIdx: index("prompt_order_created_by_idx").on(t.createdBy),
  })
);

// ============================================
// GPT-Image 业务类型导出
// ============================================

export type PromptTemplate = typeof promptTemplate.$inferSelect;
export type NewPromptTemplate = typeof promptTemplate.$inferInsert;

export type PromptOrder = typeof promptOrder.$inferSelect;
export type NewPromptOrder = typeof promptOrder.$inferInsert;

/** 提示词订单状态类型 */
export type PromptOrderStatus =
  (typeof promptOrderStatusEnum.enumValues)[number];

// ============================================
// Better Auth 关联关系（启用 experimental.joins 后必填）
// ============================================
//
// 这些 relations 让 Better Auth 的 drizzle 适配器走
// db.query.<model>.findFirst({ with: ... }) 路径，
// 否则 findSession 等带 join 的查询会走"fallback join"二次查询，
// 并把内部失败吞成日志噪音（Failed to query fallback join for model user）。

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  subscriptions: many(subscription),
  creditsBalances: many(creditsBalance),
  creditsBatches: many(creditsBatch),
  creditsTransactions: many(creditsTransaction),
  photos: many(photo),
  imageJobs: many(imageJob),
  tickets: many(ticket),
  ticketMessages: many(ticketMessage),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

// verification 表没有 userId 外键；保留空 relations 让 Drizzle
// 把 verification 注册到 db.query，避免 experimental.joins 报错。
export const verificationRelations = relations(verification, () => ({}));

// ============================================
// GPT-Image 业务关联关系（用于 db.query 嵌套 with）
// ============================================

export const promptTemplateRelations = relations(
  promptTemplate,
  ({ many }) => ({
    orders: many(promptOrder),
  })
);

export const promptOrderRelations = relations(promptOrder, ({ one }) => ({
  template: one(promptTemplate, {
    fields: [promptOrder.templateId],
    references: [promptTemplate.id],
  }),
}));
