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
}) {
  const token = generateOrderToken();

  // 订单号唯一性 + 模板存在性检查并行（两次独立查询，无依赖）
  const [exists, template] = await Promise.all([
    db.query.promptOrder.findFirst({
      where: eq(promptOrder.orderNo, input.orderNo),
      columns: { id: true },
    }),
    db.query.promptTemplate.findFirst({
      where: eq(promptTemplate.id, input.templateId),
      columns: {
        id: true,
        isActive: true,
        name: true,
        description: true,
        coverUrl: true,
        candidateCount: true,
      },
    }),
  ]);
  if (exists) throw new Error("订单号已存在");
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
}) {
  // 显式 LEFT JOIN 一次往返，比 query.findMany({with:{template:true}}) 的
  // 关系查询少一次网络往返（关系查询在 Drizzle 里会拆成 2 条串行 SQL）。
  const conditions: SQL[] = [];
  const status = filters.status;
  const templateId = filters.templateId;
  if (status) conditions.push(eq(promptOrder.status, status));
  if (templateId) conditions.push(eq(promptOrder.templateId, templateId));
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
