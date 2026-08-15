/**
 * GPT-Image 业务服务层
 *
 * 供 Server Actions 与 Route Handler 共用。避免在两者之间重复业务逻辑。
 */

import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import type { PromptOrderPlatform, PromptOrderStatus } from "@/db/schema";
import { promptOrder, promptTemplate } from "@/db/schema";
import { generateOrderToken } from "./generation-service";
import {
  countCandidateGroups,
  countSelections,
  countUploadedImages,
  parseCandidates,
  parseSelections,
  parseUploadedImages,
} from "./order-helpers";

// ============================================
// 模板服务
// ============================================

export async function listTemplatesWithCounts() {
  const templates = await db.query.promptTemplate.findMany({
    orderBy: [desc(promptTemplate.createdAt)],
  });

  const counts = await db
    .select({
      templateId: promptOrder.templateId,
      n: sql<number>`count(*)::int`,
    })
    .from(promptOrder)
    .groupBy(promptOrder.templateId);

  const countMap = new Map(counts.map((c) => [c.templateId, c.n]));

  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    prompt: t.prompt,
    size: t.size,
    candidateCount: t.candidateCount,
    coverUrl: t.coverUrl,
    isActive: t.isActive,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    orderCount: countMap.get(t.id) ?? 0,
  }));
}

/**
 * 列出所有 active 模板的最小字段（id/name/description/size/candidateCount/coverUrl/isActive）。
 * 给任何登录用户调用（创建订单时填充模板下拉），**不返回 prompt**——提示词对用户隐藏。
 * 列表本身不带 orderCount，避免把全表的订单计数暴露给普通用户。
 */
export async function listActiveTemplatesForOrderCreate() {
  const rows = await db
    .select({
      id: promptTemplate.id,
      name: promptTemplate.name,
      description: promptTemplate.description,
      size: promptTemplate.size,
      candidateCount: promptTemplate.candidateCount,
      coverUrl: promptTemplate.coverUrl,
      isActive: promptTemplate.isActive,
      createdAt: promptTemplate.createdAt,
      updatedAt: promptTemplate.updatedAt,
    })
    .from(promptTemplate)
    .where(eq(promptTemplate.isActive, true))
    .orderBy(desc(promptTemplate.createdAt));

  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    size: t.size,
    candidateCount: t.candidateCount,
    coverUrl: t.coverUrl,
    isActive: t.isActive,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));
}

export async function createTemplate(input: {
  name: string;
  description: string;
  prompt: string;
  size: string;
  candidateCount: number;
  coverUrl: string | null;
  isActive: boolean;
}) {
  const [created] = await db
    .insert(promptTemplate)
    .values({
      id: nanoid(),
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      size: input.size,
      candidateCount: input.candidateCount,
      coverUrl: input.coverUrl,
      isActive: input.isActive,
    })
    .returning();

  if (!created) throw new Error("创建模板失败");
  return created;
}

export async function updateTemplate(
  id: string,
  data: Partial<{
    name: string | undefined;
    description: string | undefined;
    prompt: string | undefined;
    size: string | undefined;
    candidateCount: number | undefined;
    coverUrl: string | null | undefined;
    isActive: boolean | undefined;
  }>
) {
  if (Object.keys(data).length === 0) throw new Error("无字段需要更新");
  const [updated] = await db
    .update(promptTemplate)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(promptTemplate.id, id))
    .returning();
  if (!updated) throw new Error("模板不存在或更新失败");
  return updated;
}

export async function toggleTemplateActive(id: string, isActive: boolean) {
  const [updated] = await db
    .update(promptTemplate)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(promptTemplate.id, id))
    .returning();
  if (!updated) throw new Error("模板不存在");
  return updated;
}

export async function deleteTemplate(id: string) {
  const used = await db.query.promptOrder.findFirst({
    where: eq(promptOrder.templateId, id),
    columns: { id: true },
  });
  if (used) throw new Error("该模板还有关联订单，无法删除");

  const [deleted] = await db
    .delete(promptTemplate)
    .where(eq(promptTemplate.id, id))
    .returning();
  if (!deleted) throw new Error("模板不存在或删除失败");
  return deleted;
}

// ============================================
// 订单服务
// ============================================

export async function createOrder(input: {
  orderNo: string;
  templateId: string;
  recipientName?: string | undefined;
  platform?: string | undefined;
  uploadCount: number;
  imagesPerUpload: number;
  regenerateLimit: number;
  /** 创建者用户 ID（由路由层从 session 注入） */
  createdBy?: string | undefined;
  /**
   * 替换已有订单 —— 复用其 id/token/状态/上传内容等生命周期数据，
   * 只覆盖 orderNo / recipientName / platform / uploadCount / imagesPerUpload / regenerateLimit。
   * 传 null/undefined 表示创建新订单。
   */
  replaceOrderId?: string | undefined;
}) {
  // 替换分支：用 updateOrder 同样的"业务字段"语义，只是不改 createdBy/templateId
  if (input.replaceOrderId) {
    return await updateOrder({
      id: input.replaceOrderId,
      orderNo: input.orderNo,
      recipientName: input.recipientName ?? "",
      platform: (input.platform as string | null) ?? null,
      uploadCount: input.uploadCount,
      imagesPerUpload: input.imagesPerUpload,
      regenerateLimit: input.regenerateLimit,
    });
  }

  const token = generateOrderToken();

  // 仅校验模板存在性；orderNo 不再做唯一性约束（同一用户可能复用）
  const template = await db.query.promptTemplate.findFirst({
    where: eq(promptTemplate.id, input.templateId),
    columns: {
      id: true,
      isActive: true,
      name: true,
      description: true,
      coverUrl: true,
      candidateCount: true,
    },
  });
  if (!template) throw new Error("模板不存在");

  const [created] = await db
    .insert(promptOrder)
    .values({
      id: nanoid(),
      orderNo: input.orderNo,
      templateId: input.templateId,
      recipientName: input.recipientName ?? "",
      platform: (input.platform as PromptOrderPlatform | undefined) ?? null,
      token,
      status: "PENDING",
      uploadCount: input.uploadCount,
      imagesPerUpload: input.imagesPerUpload,
      regenerateLimit: input.regenerateLimit,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  if (!created) throw new Error("创建订单失败");

  // 返回 OrderView 形态（含 template），客户端可直接乐观插入列表
  return {
    id: created.id,
    orderNo: created.orderNo,
    templateId: created.templateId,
    recipientName: created.recipientName,
    token: created.token,
    platform: (created.platform ?? null) as PromptOrderPlatform | null,
    status: created.status,
    uploadCount: created.uploadCount,
    imagesPerUpload: created.imagesPerUpload,
    regenerateLimit: created.regenerateLimit,
    selectedIndex: created.selectedIndex,
    errorMessage: created.errorMessage,
    uploadedAt: created.uploadedAt?.toISOString() ?? null,
    generatedAt: created.generatedAt?.toISOString() ?? null,
    selectedAt: created.selectedAt?.toISOString() ?? null,
    cancelledAt: created.cancelledAt?.toISOString() ?? null,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    hasUploadedImage: false,
    uploadedImageCount: 0,
    candidateCount: 0,
    candidateGroups: 0,
    selections: null,
    selectionCount: 0,
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      coverUrl: template.coverUrl,
      candidateCount: template.candidateCount,
    },
  };
}

export async function listOrders(filters: {
  status?: PromptOrderStatus | undefined;
  templateId?: string | undefined;
  /**
   * 限定只查某个用户创建的订单。
   * 管理员可传 skipCreatorFilter=true 跳过此限制查看全部订单。
   */
  createdBy?: string | undefined;
  /** 管理员特权：true 时忽略 createdBy 过滤 */
  skipCreatorFilter?: boolean | undefined;
}) {
  // 显式 LEFT JOIN 一次往返，比 query.findMany({with:{template:true}}) 的
  // 关系查询少一次网络往返（关系查询在 Drizzle 里会拆成 2 条串行 SQL）。
  const conditions: SQL[] = [];
  const status = filters.status;
  const templateId = filters.templateId;
  if (status) conditions.push(eq(promptOrder.status, status));
  if (templateId) conditions.push(eq(promptOrder.templateId, templateId));
  // 非管理员必须按 createdBy 过滤；管理员显式传 skipCreatorFilter=true 才放行
  if (!filters.skipCreatorFilter && filters.createdBy) {
    conditions.push(eq(promptOrder.createdBy, filters.createdBy));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      // 订单字段
      id: promptOrder.id,
      orderNo: promptOrder.orderNo,
      templateId: promptOrder.templateId,
      recipientName: promptOrder.recipientName,
      platform: promptOrder.platform,
      token: promptOrder.token,
      status: promptOrder.status,
      uploadCount: promptOrder.uploadCount,
      imagesPerUpload: promptOrder.imagesPerUpload,
      regenerateLimit: promptOrder.regenerateLimit,
      uploadedImages: promptOrder.uploadedImages,
      candidates: promptOrder.candidates,
      selectedIndex: promptOrder.selectedIndex,
      selections: promptOrder.selections,
      errorMessage: promptOrder.errorMessage,
      uploadedAt: promptOrder.uploadedAt,
      generatedAt: promptOrder.generatedAt,
      selectedAt: promptOrder.selectedAt,
      cancelledAt: promptOrder.cancelledAt,
      createdAt: promptOrder.createdAt,
      updatedAt: promptOrder.updatedAt,
      // 模板字段（LEFT JOIN，可能为 null）
      tId: promptTemplate.id,
      tName: promptTemplate.name,
      tDescription: promptTemplate.description,
      tCoverUrl: promptTemplate.coverUrl,
      tCandidateCount: promptTemplate.candidateCount,
    })
    .from(promptOrder)
    .leftJoin(promptTemplate, eq(promptOrder.templateId, promptTemplate.id))
    .where(where ?? sql`true`)
    .orderBy(desc(promptOrder.createdAt))
    .limit(100);

  return rows.map((o) => {
    const uploaded = parseUploadedImages(o.uploadedImages);
    const candidates = parseCandidates(o.candidates);
    const selections = parseSelections(o.selections);
    return {
      id: o.id,
      orderNo: o.orderNo,
      templateId: o.templateId,
      recipientName: o.recipientName,
      platform: (o.platform ?? null) as PromptOrderPlatform | null,
      token: o.token,
      status: o.status,
      uploadCount: o.uploadCount,
      imagesPerUpload: o.imagesPerUpload,
      regenerateLimit: o.regenerateLimit,
      selectedIndex: o.selectedIndex,
      errorMessage: o.errorMessage,
      uploadedAt: o.uploadedAt?.toISOString() ?? null,
      generatedAt: o.generatedAt?.toISOString() ?? null,
      selectedAt: o.selectedAt?.toISOString() ?? null,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      hasUploadedImage: uploaded.length > 0,
      uploadedImageCount: countUploadedImages(uploaded),
      candidateCount: countCandidateGroups(candidates),
      selections,
      selectionCount: countSelections(selections),
      template: {
        id: o.tId ?? o.templateId,
        name: o.tName ?? "（模板已删除）",
        description: o.tDescription ?? "",
        coverUrl: o.tCoverUrl,
        candidateCount: o.tCandidateCount ?? 4,
      },
    };
  });
}

export async function deleteOrderById(id: string) {
  const [deleted] = await db
    .delete(promptOrder)
    .where(eq(promptOrder.id, id))
    .returning();
  if (!deleted) throw new Error("订单不存在");
  return deleted;
}

/**
 * 检测"同一创建者"的同 orderNo 冲突。
 *
 * 不强制 DB 唯一约束，但同一用户不应有重复订单号 —— 否则用户自己也分不清
 * 哪个链接给哪个收件人。返回最小信息供前端做"覆盖/取消"提示。
 */
export async function findOrderByOrderNoForCreator(
  orderNo: string,
  creatorId: string
): Promise<{
  id: string;
  orderNo: string;
  recipientName: string;
  templateName: string;
  createdAt: string;
} | null> {
  const rows = await db
    .select({
      id: promptOrder.id,
      orderNo: promptOrder.orderNo,
      recipientName: promptOrder.recipientName,
      createdAt: promptOrder.createdAt,
      tName: promptTemplate.name,
    })
    .from(promptOrder)
    .leftJoin(promptTemplate, eq(promptOrder.templateId, promptTemplate.id))
    .where(
      and(
        eq(promptOrder.orderNo, orderNo),
        eq(promptOrder.createdBy, creatorId)
      )
    )
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return {
    id: r.id,
    orderNo: r.orderNo,
    recipientName: r.recipientName,
    templateName: r.tName ?? "（模板已删除）",
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * 编辑订单 —— 仅允许修改业务字段（orderNo / recipientName / platform / uploadCount / imagesPerUpload）。
 * 模板、token、状态、已上传图片均锁定，订单生命周期数据不能被覆盖。
 *
 * 返回最新的 OrderView（与 listOrders 同形），便于客户端乐观更新。
 */
export async function updateOrder(input: {
  id: string;
  orderNo: string;
  recipientName: string;
  platform: string | null;
  uploadCount: number;
  imagesPerUpload: number;
  regenerateLimit: number;
}) {
  const [updated] = await db
    .update(promptOrder)
    .set({
      orderNo: input.orderNo,
      recipientName: input.recipientName,
      platform: (input.platform as PromptOrderPlatform | null) ?? null,
      uploadCount: input.uploadCount,
      imagesPerUpload: input.imagesPerUpload,
      regenerateLimit: input.regenerateLimit,
      updatedAt: new Date(),
    })
    .where(eq(promptOrder.id, input.id))
    .returning();
  if (!updated) throw new Error("订单不存在");

  // 重新拉模板信息，组装成 OrderView
  const template = await db.query.promptTemplate.findFirst({
    where: eq(promptTemplate.id, updated.templateId),
    columns: {
      id: true,
      name: true,
      description: true,
      coverUrl: true,
      candidateCount: true,
    },
  });

  const uploaded = parseUploadedImages(updated.uploadedImages);
  const candidates = parseCandidates(updated.candidates);
  const selections = parseSelections(updated.selections);

  return {
    id: updated.id,
    orderNo: updated.orderNo,
    templateId: updated.templateId,
    recipientName: updated.recipientName,
    platform: (updated.platform ?? null) as PromptOrderPlatform | null,
    token: updated.token,
    status: updated.status,
    uploadCount: updated.uploadCount,
    imagesPerUpload: updated.imagesPerUpload,
    regenerateLimit: updated.regenerateLimit,
    selectedIndex: updated.selectedIndex,
    errorMessage: updated.errorMessage,
    uploadedAt: updated.uploadedAt?.toISOString() ?? null,
    generatedAt: updated.generatedAt?.toISOString() ?? null,
    selectedAt: updated.selectedAt?.toISOString() ?? null,
    cancelledAt: updated.cancelledAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    hasUploadedImage: uploaded.length > 0,
    uploadedImageCount: countUploadedImages(uploaded),
    candidateCount: countCandidateGroups(candidates),
    candidateGroups: countCandidateGroups(candidates),
    selections,
    selectionCount: countSelections(selections),
    template: {
      id: template?.id ?? updated.templateId,
      name: template?.name ?? "（模板已删除）",
      description: template?.description ?? "",
      coverUrl: template?.coverUrl ?? null,
      candidateCount: template?.candidateCount ?? 4,
    },
  };
}
