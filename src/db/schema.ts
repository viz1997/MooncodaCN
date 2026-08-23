import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  json,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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
 * 资产来源枚举（photo 表）
 *
 * - upload: 用户本地上传（createPhotoAction 写入）
 * - generation: 生图结果入库（saveGenerationResultsAsAssets 写入，
 *   2026-08-23 起由 generation-service.ts 在生图完成回调里自动落库）
 *
 * 之所以不另开"asset"表直接合并 imageJob.resultUrls —— 后者是生图任务的
 * 状态机权威来源，resultUrls JSON 数组是它的产物；photo 只是资产索引，
 * 拆表 + source 区分是最低耦合的方案。
 */
export const photoSourceEnum = pgEnum("photo_source", [
  "upload",
  "generation",
]);

/**
 * 画布内置渠道生成任务状态枚举
 *
 * Phase 4 起，`/api/canvas/generate` 对 image/audio 改异步 send + 轮询，
 * 任务状态持久化在本表里供前端 GET /api/canvas/poll/[jobId] 查。
 *
 * 状态机：
 *   pending → processing → completed
 *                    \    → failed
 *
 * - `pending`：路由已写 job 行、inngest.send 已发出，Inngest 函数还没接管
 * - `processing`：Inngest 函数已 step.run("generate")，正在调上游 + R2
 * - `completed`：items 已落库 + R2 永久 URL 已写入 result
 * - `failed`：上游失败，积分已 refund，error 字段已写入
 */
export const canvasRemoteJobStatusEnum = pgEnum("canvas_remote_job_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

/**
 * 画布内置渠道 capability 枚举
 *
 * 与 `CanvasCapability` 类型（src/features/canvas/services/canvas-credit-cost.ts）
 * 保持一致：image / video / audio / text。video 当前仍走 VIDEO_JOBS Map，本表预留；
 * text 在 route 层 400 拒绝，本表预留。
 */
export const canvasRemoteCapabilityEnum = pgEnum("canvas_remote_capability", [
  "image",
  "video",
  "audio",
  "text",
]);

// ============================================
// 照片表 (Photo)
// ============================================

/**
 * 产品效果状态枚举（保留：/admin/product-effects 与 productEffect 表未退役，作为 image-gen 工作台的旧数据源回退）
 */
export const productEffectStatusEnum = pgEnum("product_effect_status", [
  "active",
  "inactive",
]);

/**
 * 提示词场景枚举（保留：productEffect.scene 字段依赖）
 */
export const promptSceneEnum = pgEnum("prompt_scene", [
  "generate_2d",
  "generate_3d",
  "translate",
  "stylize",
  "enhance",
  "custom",
]);

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
  // 2026-08-23：资产统一为 photo 表，加 source 区分"本地上传"和"生图结果"
  source: photoSourceEnum("source").notNull().default("upload"),
  // source=generation 时关联的生图任务；onDelete: "set null" 防止 imageJob 误删连带删资产
  // 用 AnyPgColumn 打破 photo ↔ imageJob 的循环 FK 推导（Drizzle 官方推荐做法）
  imageJobId: text("image_job_id").references((): AnyPgColumn => imageJob.id, {
    onDelete: "set null",
  }),
  // 生图时的 prompt / model（source=upload 时为 null）
  prompt: text("prompt"),
  model: text("model"),
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
  photoId: text("photo_id").references((): AnyPgColumn => photo.id, {
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
 * Phase C 起 image-gen 工作台主数据源已切到 promptTemplate 表；本表保留作为
 * legacy —— /admin/product-effects 仍可访问，generateImageJob.imageJob.maskId
 * 列仍接受两种来源的 id。
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
 * 效果图历史快照触发原因枚举
 *
 * 标识这一轮快照是因为什么 destructive 写入而创建的：
 * - regenerate_single：单图"重新生成"前
 * - regenerate_all：批量重跑 / FAILED 一键重试前
 * - failed_reupload：FAILED 状态下重传图片前
 * - restore：用户主动"恢复历史版本"前（先归档当前再恢复）
 */
export const promptOrderHistoryTriggerEnum = pgEnum(
  "prompt_order_history_trigger",
  ["regenerate_single", "regenerate_all", "failed_reupload", "restore"]
);

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
  /**
   * 提示词变量定义（JSON）。
   * 支持模板里 {{key}} 占位符 —— 与 image-gen 工作台共用同一份 schema，
   * 让 image-gen 和 gpt-image 都消费同一张表，不再维护两份模板。
   */
  variables: json("variables")
    .$type<import("./image-gen-types").PromptVariable[]>()
    .notNull()
    .default([]),
  /**
   * 推荐生图模型 id（如 doubao / nano_banana2）。
   * image-gen 工作台选中模板时会锁定这个模型；为空时允许用户在 UI 里手动选。
   */
  model: text("model").default("doubao"),
  /**
   * 模板价格（分）。仅作展示用，单位元，0 = 免费。
   */
  price: integer("price").notNull().default(0),
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
 * @field uploadCount - 用户可上传的批次次数（默认 1）。每批最多 imagesPerUpload 张参考图，总容量 = uploadCount × imagesPerUpload
 * @field imagesPerUpload - 每批上传的原图参考图数量（1-3，默认 3）
 * @field regenerateLimit - 用户主动重新生成次数上限（默认 5；批量重跑 / FAILED 重试不计）
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
    /** 用户可上传的批次次数（默认 1）。总容量 = uploadCount × imagesPerUpload */
    uploadCount: integer("upload_count").notNull().default(1),
    /**
     * 每批上传的原图参考图数量（1-3，默认 3）。
     * 一次上传会话内用户最多塞 imagesPerUpload 张参考图，全部塞进去
     * 才算占满一批；总容量 = uploadCount × imagesPerUpload。
     */
    imagesPerUpload: integer("images_per_upload").notNull().default(3),
    /**
     * 用户主动"重新生成第 N 张"的次数上限。
     * 仅 imageIdx 传入的单图路径计数（trigger=regenerate_single）；
     * 批量重跑（regenerate_all / FAILED 重试）不消耗次数。
     * 实际已用次数 = promptOrderHistory 中 trigger='regenerate_single' 的行数。
     */
    regenerateLimit: integer("regenerate_limit").notNull().default(5),
    candidates: text("candidates"),
    selectedIndex: integer("selected_index"),
    selections: text("selections"),
    errorMessage: text("error_message"),
    // 2026-08-23：代理商业务（飞书 docx "链接生成管理系统"）—— promptOrder
    // 区分 ToC 店铺单 / ToB 代理商单。ToC 用 platform 字段标识淘宝/小红书/
    // 抖店；ToB 用 agentId 关联 agent 表。互斥：agentId 优先，platform 仅
    // 用于 ToC。isAgentOrder 视图层根据 agentId 是否 null 计算。
    //
    // 为什么不在 platform enum 加 'agent'：platform 语义是"订单从哪个分发
    // 渠道来"（外部渠道），代理商是内部角色，不是渠道。混在一起后期统计
    // "各平台来源订单数"会被污染。
    //
    // onDelete: "set null" —— 删代理商时保留历史订单，但 UI 显示"已删除代理"
    productTypeCode: text("product_type_code"),
    productSize: text("product_size"),
    accessoryCode: text("accessory_code"),
    agentId: text("agent_id").references((): AnyPgColumn => agent.id, {
      onDelete: "set null",
    }),
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
// 效果图历史快照表 (PromptOrderHistory)
// ============================================
/**
 * 效果图历史快照 —— 每次 destructive 写入前自动归档
 *
 * 用户在右栏点缩略图就能恢复那一轮的"原图 + 候选集 + 已选候选"。
 * 一次 destructive 写入 = 一条快照；round 每订单独立递增。
 *
 * @field id - 快照唯一标识符（nanoid）
 * @field orderId - 关联订单（级联删除）
 * @field round - 每订单递增 1..N；与 orderId 组成唯一索引
 * @field trigger - 触发原因（regenerate_single/regenerate_all/failed_reupload/restore）
 * @field imageIdx - 归档聚焦的原图索引（批量归档时取 0）
 * @field candidateIdx - 归档时该原图已选候选；恢复时一并选中
 * @field candidates - 不可变嵌套候选 URL 数组（与 promptOrder 同步语义）
 * @field selections - 不可变选择数组（可能为 null 表示从未选过）
 * @field uploadedImages - 不可变已上传原图 URL 数组
 * @field templateId - 当时使用的模板 id（兼容性检查用）
 * @field candidateCount - 当时每张原图的候选数（兼容性检查用）
 * @field imageCount - 当时已上传原图张数（兼容性检查用）
 * @field size - 当时使用的输出尺寸（兼容性检查用）
 * @field generatedAt - 当时的生成时间戳（用于 restore 时回填）
 * @field createdAt - 快照创建时间（默认 now）
 */
export const promptOrderHistory = pgTable(
  "prompt_order_history",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => promptOrder.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    trigger: promptOrderHistoryTriggerEnum("trigger").notNull(),
    imageIdx: integer("image_idx"),
    candidateIdx: integer("candidate_idx").notNull().default(0),
    candidates: text("candidates").notNull(),
    selections: text("selections"),
    uploadedImages: text("uploaded_images").notNull(),
    templateId: text("template_id").notNull(),
    candidateCount: integer("candidate_count").notNull(),
    imageCount: integer("image_count").notNull(),
    size: text("size").notNull(),
    generatedAt: timestamp("generated_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    orderRoundUnique: uniqueIndex("poh_order_round_unique").on(
      t.orderId,
      t.round
    ),
    orderCreatedAtIdx: index("poh_order_created_at_idx").on(
      t.orderId,
      t.createdAt
    ),
  })
);

export type PromptOrderHistory = typeof promptOrderHistory.$inferSelect;
export type NewPromptOrderHistory = typeof promptOrderHistory.$inferInsert;

/** 效果图历史快照触发原因类型 */
export type PromptOrderHistoryTrigger =
  (typeof promptOrderHistoryTriggerEnum.enumValues)[number];

// ============================================
// 代理商表 (Agent) —— 飞书 docx「链接生成管理系统」ToB 业务
// ============================================
//
// 代理商是 WJP 业务 ToB 端的"渠道运营方"，本身没有生产能力，纯做品牌 +
// 客服 + 渠道。订单从代理商侧发，工厂按订单全流程代工。
//
// 为什么不复用 user 表：代理商和终端消费者走两套 UI（代理商有自己的客户
// 上传入口 / 报价 / 发货流程）。user 表是终端消费者账号体系，硬塞代理
// 商进来要扩 user.role enum + 加权限中间件，得不偿失。新建独立 agent
// 表 + 与 user 完全解耦是最简方案。
//
// 字段：
// - id: 业务可读 ID（A001 / zhangsan 都行，nanoid 生成也行）
// - name: 代理商名称（管理端 / 链接生成管理后台显示）
// - contact / phone / email: 联系信息，订单链接分发用
// - isActive: 停用后不能再被新订单选择（已有订单不受影响）
// - remark: 内部备注
export const agent = pgTable("agent", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  contact: text("contact"),
  phone: text("phone"),
  email: text("email"),
  remark: text("remark"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Agent = typeof agent.$inferSelect;
export type NewAgent = typeof agent.$inferInsert;

// ============================================
// 画布内置渠道生成任务表 (CanvasRemoteJob)
// ============================================
//
// Phase 4 起 `/api/canvas/generate` 对 image/audio 走 Inngest send + 轮询，
// job 状态持久化在本表里。video 仍走 VIDEO_JOBS Map（向后兼容），
// 后续可统一迁过来。
//
// 设计要点：
// - payload 存完整 `CanvasRemoteGenerateInput`（含 references/mask data URL）
//   Inngest 函数直接拿 payload 调 generateOnServerSync，无需再回前端取
// - result 存 `{url, storageKey, mimeType, bytes}[]`，前端 poll 拿到后直接渲染
// - creditsConsumed + transactionId 由 Inngest 函数写回（与 generateOnServerSync
//   的 consumeCredits 返回值对齐），失败时由 service 内的 safeRefund 兜底，
//   本表只记"花出去了多少"用于审计
// - error 字段存失败原因（最多 1000 字符）
// - `providerJobId` 预留：video 若迁过来存 OpenAI `/v1/videos` 返的 id；当前 image
//   不用
// - `inngestEventId` 预留：用于 reconcile cron 排查"事件已发但函数没跑"的情况

export const canvasRemoteJob = pgTable(
  "canvas_remote_job",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    capability: canvasRemoteCapabilityEnum("capability").notNull(),
    mode: text("mode").notNull(), // "generation" | "edit" | "text"
    payload: json("payload").$type<unknown>().notNull(),
    status: canvasRemoteJobStatusEnum("status").notNull().default("pending"),
    result:
      json("result").$type<
        Array<{
          url: string;
          storageKey: string;
          mimeType: string;
          width?: number;
          height?: number;
          bytes: number;
        }>
      >(),
    error: text("error"),
    creditsConsumed: integer("credits_consumed"),
    transactionId: text("transaction_id"),
    providerJobId: text("provider_job_id"),
    inngestEventId: text("inngest_event_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("crj_user_created_idx").on(t.userId, t.createdAt),
    index("crj_status_idx").on(t.status),
  ]
);

export type CanvasRemoteJob = typeof canvasRemoteJob.$inferSelect;
export type NewCanvasRemoteJob = typeof canvasRemoteJob.$inferInsert;
export type CanvasRemoteJobStatus =
  (typeof canvasRemoteJobStatusEnum.enumValues)[number];
export type CanvasRemoteCapability =
  (typeof canvasRemoteCapabilityEnum.enumValues)[number];

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
  canvasRemoteJobs: many(canvasRemoteJob),
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

export const promptOrderRelations = relations(promptOrder, ({ one, many }) => ({
  template: one(promptTemplate, {
    fields: [promptOrder.templateId],
    references: [promptTemplate.id],
  }),
  history: many(promptOrderHistory),
  agent: one(agent, {
    fields: [promptOrder.agentId],
    references: [agent.id],
  }),
}));

export const agentRelations = relations(agent, ({ many }) => ({
  orders: many(promptOrder),
}));

export const promptOrderHistoryRelations = relations(
  promptOrderHistory,
  ({ one }) => ({
    order: one(promptOrder, {
      fields: [promptOrderHistory.orderId],
      references: [promptOrder.id],
    }),
  })
);

export const canvasRemoteJobRelations = relations(
  canvasRemoteJob,
  ({ one }) => ({
    user: one(user, {
      fields: [canvasRemoteJob.userId],
      references: [user.id],
    }),
  })
);
