/**
 * 测试数据工厂 (Fixtures)
 *
 * 提供创建测试数据的工厂函数
 */

import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { testDb } from "./db";

// ============================================
// ID 生成
// ============================================

/**
 * 生成唯一的测试 ID
 *
 * 使用时间戳 + 随机数确保唯一性，避免并行测试时的冲突
 */
export function generateTestId(prefix = "test"): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

// ============================================
// 用户工厂
// ============================================

export interface CreateTestUserOptions {
  id?: string;
  name?: string;
  email?: string;
  emailVerified?: boolean;
  role?: "user" | "admin";
  banned?: boolean;
}

/**
 * 创建测试用户
 */
export async function createTestUser(
  options: CreateTestUserOptions = {}
): Promise<schema.User> {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const id = options.id ?? `test_user_${timestamp}_${random}`;

  const userData: schema.NewUser = {
    id,
    name: options.name ?? `Test User ${timestamp}`,
    email: options.email ?? `test_${timestamp}_${random}@test.local`,
    emailVerified: options.emailVerified ?? true,
    role: options.role ?? "user",
    banned: options.banned ?? false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const [user] = await testDb.insert(schema.user).values(userData).returning();

  if (!user) {
    throw new Error("创建测试用户失败");
  }

  return user;
}

/**
 * 批量创建测试用户
 */
export async function createTestUsers(
  count: number,
  options: Omit<CreateTestUserOptions, "id" | "email"> = {}
): Promise<schema.User[]> {
  const users: schema.User[] = [];

  for (let i = 0; i < count; i++) {
    const userOptions: CreateTestUserOptions = { ...options };
    if (options.name) {
      userOptions.name = `${options.name} ${i + 1}`;
    }
    const user = await createTestUser(userOptions);
    users.push(user);
  }

  return users;
}

// ============================================
// 积分工厂
// ============================================

export interface CreateCreditsBatchOptions {
  userId: string;
  amount?: number;
  remaining?: number;
  sourceType?: schema.CreditsBatchSource;
  status?: schema.CreditsBatchStatus;
  expiresAt?: Date | null;
  sourceRef?: string;
}

/**
 * 直接创建积分批次（绕过业务逻辑，用于测试特定场景）
 */
export async function createTestCreditsBatch(
  options: CreateCreditsBatchOptions
): Promise<schema.CreditsBatch> {
  const id = generateTestId("test_batch");
  const amount = options.amount ?? 100;

  const batchData: schema.NewCreditsBatch = {
    id,
    userId: options.userId,
    amount,
    remaining: options.remaining ?? amount,
    issuedAt: new Date(),
    expiresAt: options.expiresAt ?? null,
    status: options.status ?? "active",
    sourceType: options.sourceType ?? "bonus",
    sourceRef: options.sourceRef,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const [batch] = await testDb
    .insert(schema.creditsBatch)
    .values(batchData)
    .returning();

  if (!batch) {
    throw new Error("创建测试积分批次失败");
  }

  return batch;
}

export interface CreateCreditsBalanceOptions {
  userId: string;
  balance?: number;
  totalEarned?: number;
  totalSpent?: number;
  status?: schema.CreditsBalanceStatus;
}

/**
 * 直接创建积分账户（绕过业务逻辑，用于测试特定场景）
 */
export async function createTestCreditsBalance(
  options: CreateCreditsBalanceOptions
): Promise<schema.CreditsBalance> {
  const id = generateTestId("test_balance");

  const balanceData: schema.NewCreditsBalance = {
    id,
    userId: options.userId,
    balance: options.balance ?? 0,
    totalEarned: options.totalEarned ?? 0,
    totalSpent: options.totalSpent ?? 0,
    status: options.status ?? "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const [balance] = await testDb
    .insert(schema.creditsBalance)
    .values(balanceData)
    .returning();

  if (!balance) {
    throw new Error("创建测试积分账户失败");
  }

  return balance;
}

// ============================================
// 复合工厂
// ============================================

export interface CreateUserWithCreditsOptions extends CreateTestUserOptions {
  initialCredits?: number;
  creditBatches?: Array<{
    amount: number;
    expiresAt?: Date | null;
  }>;
}

/**
 * 创建带有积分的测试用户
 */
export async function createTestUserWithCredits(
  options: CreateUserWithCreditsOptions = {}
): Promise<{
  user: schema.User;
  balance: schema.CreditsBalance;
  batches: schema.CreditsBatch[];
}> {
  const user = await createTestUser(options);

  const batches: schema.CreditsBatch[] = [];
  let totalCredits = 0;

  if (options.creditBatches) {
    for (const batchConfig of options.creditBatches) {
      const batchOptions: CreateCreditsBatchOptions = {
        userId: user.id,
        amount: batchConfig.amount,
      };
      if (batchConfig.expiresAt !== undefined) {
        batchOptions.expiresAt = batchConfig.expiresAt;
      }
      const batch = await createTestCreditsBatch(batchOptions);
      batches.push(batch);
      totalCredits += batchConfig.amount;
    }
  } else if (options.initialCredits) {
    const batch = await createTestCreditsBatch({
      userId: user.id,
      amount: options.initialCredits,
    });
    batches.push(batch);
    totalCredits = options.initialCredits;
  }

  const balance = await createTestCreditsBalance({
    userId: user.id,
    balance: totalCredits,
    totalEarned: totalCredits,
  });

  return { user, balance, batches };
}

// ============================================
// 时间工具
// ============================================

/**
 * 创建过去的日期
 */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * 创建未来的日期
 */
export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * 创建过期的日期（1天前）
 */
export function expiredDate(): Date {
  return daysAgo(1);
}

/**
 * 创建即将过期的日期（1天后）
 */
export function soonExpiringDate(): Date {
  return daysFromNow(1);
}

// ============================================
// 工单工厂
// ============================================

export interface CreateTestTicketOptions {
  userId: string;
  subject?: string;
  category?: schema.TicketCategory;
  priority?: schema.TicketPriority;
  status?: schema.TicketStatus;
}

/**
 * 创建测试工单
 */
export async function createTestTicket(
  options: CreateTestTicketOptions
): Promise<schema.Ticket> {
  const id = generateTestId("test_ticket");

  const ticketData: schema.NewTicket = {
    id,
    userId: options.userId,
    subject: options.subject ?? `Test Ticket ${Date.now()}`,
    category: options.category ?? "other",
    priority: options.priority ?? "medium",
    status: options.status ?? "open",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const [ticket] = await testDb
    .insert(schema.ticket)
    .values(ticketData)
    .returning();

  if (!ticket) {
    throw new Error("创建测试工单失败");
  }

  return ticket;
}

export interface CreateTestTicketMessageOptions {
  ticketId: string;
  userId: string;
  content?: string;
  isAdminResponse?: boolean;
}

/**
 * 创建测试工单消息
 */
export async function createTestTicketMessage(
  options: CreateTestTicketMessageOptions
): Promise<schema.TicketMessage> {
  const id = generateTestId("test_message");

  const messageData: schema.NewTicketMessage = {
    id,
    ticketId: options.ticketId,
    userId: options.userId,
    content: options.content ?? `Test message ${Date.now()}`,
    isAdminResponse: options.isAdminResponse ?? false,
    createdAt: new Date(),
  };

  const [message] = await testDb
    .insert(schema.ticketMessage)
    .values(messageData)
    .returning();

  if (!message) {
    throw new Error("创建测试工单消息失败");
  }

  return message;
}

export interface CreateTestTicketWithMessageOptions
  extends CreateTestTicketOptions {
  message?: string;
}

/**
 * 创建带初始消息的测试工单
 */
export async function createTestTicketWithMessage(
  options: CreateTestTicketWithMessageOptions
): Promise<{
  ticket: schema.Ticket;
  message: schema.TicketMessage;
}> {
  const ticket = await createTestTicket(options);

  const message = await createTestTicketMessage({
    ticketId: ticket.id,
    userId: options.userId,
    content: options.message ?? "Initial test message",
    isAdminResponse: false,
  });

  return { ticket, message };
}

// ============================================
// 订阅工厂
// ============================================

export interface CreateTestSubscriptionOptions {
  userId: string;
  subscriptionId?: string;
  priceId?: string;
  status?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}

/**
 * 创建测试订阅
 */
export async function createTestSubscription(
  options: CreateTestSubscriptionOptions
): Promise<schema.Subscription> {
  const id = generateTestId("test_sub");
  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const subscriptionData: schema.NewSubscription = {
    id,
    userId: options.userId,
    subscriptionId: options.subscriptionId ?? generateTestId("sub_test"),
    priceId: options.priceId ?? "price_test_monthly",
    status: options.status ?? "active",
    currentPeriodStart: options.currentPeriodStart ?? now,
    currentPeriodEnd: options.currentPeriodEnd ?? thirtyDaysLater,
    cancelAtPeriodEnd: options.cancelAtPeriodEnd ?? false,
    createdAt: now,
    updatedAt: now,
  };

  const [sub] = await testDb
    .insert(schema.subscription)
    .values(subscriptionData)
    .returning();

  if (!sub) {
    throw new Error("创建测试订阅失败");
  }

  return sub;
}

// ============================================
// 生图业务工厂
// ============================================

export interface CreateTestPhotoOptions {
  userId: string;
  fileName?: string;
  fileUrl?: string;
  thumbnailUrl?: string;
  md5?: string;
  width?: number;
  height?: number;
  format?: string;
  fileSize?: number;
}

/**
 * 创建测试照片
 */
export async function createTestPhoto(
  options: CreateTestPhotoOptions
): Promise<schema.Photo> {
  const id = generateTestId("test_photo");
  const now = new Date();

  const photoData: schema.NewPhoto = {
    id,
    userId: options.userId,
    fileName: options.fileName ?? `test_${Date.now()}.jpg`,
    fileUrl: options.fileUrl ?? `https://picsum.photos/seed/${id}/400/400`,
    thumbnailUrl: options.thumbnailUrl ?? null,
    md5: options.md5 ?? null,
    width: options.width ?? null,
    height: options.height ?? null,
    format: options.format ?? "jpg",
    fileSize: options.fileSize ?? null,
    createdAt: now,
  };

  const [row] = await testDb.insert(schema.photo).values(photoData).returning();
  if (!row) {
    throw new Error("创建测试照片失败");
  }

  return row;
}

export interface CreateTestProductEffectOptions {
  id?: string;
  name?: string;
  category?: string;
  description?: string;
  previewUrl?: string;
  prompt?: string;
  variables?: schema.ProductEffectRow["variables"];
  model?: string;
  config?: schema.ProductEffectRow["config"];
  scene?: schema.PromptScene;
  versions?: schema.ProductEffectRow["versions"];
  price?: number;
  status?: schema.ProductEffectStatus;
  usageCount?: number;
  successRate?: number;
  avgDuration?: number;
  author?: string;
  productLineIds?: schema.ProductEffectRow["productLineIds"];
}

/**
 * 创建测试产品效果
 */
export async function createTestProductEffect(
  options: CreateTestProductEffectOptions = {}
): Promise<schema.ProductEffectRow> {
  const id = options.id ?? generateTestId("test_mask");
  const now = new Date();

  const effectData: schema.NewProductEffectRow = {
    id,
    name: options.name ?? `Test Effect ${id}`,
    category: options.category ?? "测试",
    description: options.description ?? "测试效果",
    previewUrl:
      options.previewUrl ?? `https://picsum.photos/seed/${id}/400/400`,
    prompt: options.prompt ?? "A test prompt",
    variables: options.variables ?? [],
    model: options.model ?? "doubao",
    config: options.config ?? { style: "custom" },
    scene: options.scene ?? "generate_2d",
    versions: options.versions ?? [],
    price: options.price ?? 0,
    status: options.status ?? "active",
    usageCount: options.usageCount ?? 0,
    successRate: options.successRate ?? 0,
    avgDuration: options.avgDuration ?? 0,
    author: options.author ?? "admin",
    productLineIds: options.productLineIds ?? [],
    createdAt: now,
    updatedAt: now,
  };

  const [row] = await testDb
    .insert(schema.productEffect)
    .values(effectData)
    .returning();

  if (!row) {
    throw new Error("创建测试产品效果失败");
  }

  return row;
}

export interface CreateTestImageJobOptions {
  userId: string;
  photoId?: string;
  maskId?: string;
  model?: string;
  mode?: schema.GenerationMode;
  prompt?: string;
  status?: schema.ImageJobStatus;
  resultUrls?: string[];
  creditsConsumed?: number;
  taskId?: string;
}

/**
 * 创建测试生图任务
 */
export async function createTestImageJob(
  options: CreateTestImageJobOptions
): Promise<schema.ImageJob> {
  const id = generateTestId("test_job");
  const now = new Date();

  const jobData: schema.NewImageJob = {
    id,
    userId: options.userId,
    photoId: options.photoId ?? null,
    maskId: options.maskId ?? null,
    model: options.model ?? "doubao",
    mode: options.mode ?? "text_to_image",
    prompt: options.prompt ?? "A test prompt",
    negativePrompt: null,
    imageUrl: null,
    size: "1024x1024",
    batchSize: 1,
    seed: null,
    guidanceScale: null,
    numInferenceSteps: null,
    status: options.status ?? "completed",
    resultUrls: options.resultUrls ?? [],
    revisedPrompt: null,
    errorMsg: null,
    generateDuration: null,
    cost: null,
    currency: null,
    creditsConsumed: options.creditsConsumed ?? null,
    taskId: options.taskId ?? null,
    createdAt: now,
    completedAt: options.status === "completed" ? now : null,
  };

  const [row] = await testDb
    .insert(schema.imageJob)
    .values(jobData)
    .returning();
  if (!row) {
    throw new Error("创建测试生图任务失败");
  }

  return row;
}

// 测试清理辅助：删除用户相关的生图测试数据
export async function cleanupUserImageGenData(userId: string): Promise<void> {
  await testDb
    .delete(schema.imageJob)
    .where(eq(schema.imageJob.userId, userId));
  await testDb.delete(schema.photo).where(eq(schema.photo.userId, userId));
}
