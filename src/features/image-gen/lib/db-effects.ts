/**
 * 产品效果数据库访问层
 *
 * 将运行时 ProductEffect 类型与 product_effect 表做映射
 */

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { type ProductEffectRow, productEffect } from "@/db/schema";

import type { ProductCapabilities } from "@/features/gpt-image/lib/product-catalog";
import type { ProductEffect, PromptVariable } from "./product-effect-types";

/**
 * DB 行映射为运行时 ProductEffect
 */
function mapRowToProductEffect(row: ProductEffectRow): ProductEffect {
  return {
    maskId: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    previewUrl: row.previewUrl,
    prompt: row.prompt,
    variables: row.variables as PromptVariable[],
    model: row.model,
    config: row.config as ProductEffect["config"],
    scene: row.scene,
    versions: row.versions as ProductEffect["versions"],
    price: row.price,
    status: row.status,
    usageCount: row.usageCount,
    successRate: row.successRate,
    avgDuration: row.avgDuration,
    author: row.author,
    productLineIds: row.productLineIds as string[],
    // 2026-09-09：productTypeCode 列透传（schema 字段已加）
    productTypeCode: row.productTypeCode ?? null,
    // 2026-09-10：allowedSizes/allowedAccessories 列（JSON 字符串数组）
    allowedSizes: parseJsonStringArray(row.allowedSizes),
    allowedAccessories: parseJsonStringArray(row.allowedAccessories),
    // 2026-09-10：模板级 capability 覆盖 + 皮革色子集
    allowedCapabilities: parseJsonCapabilities(row.allowedCapabilities),
    allowedColors: parseJsonStringArray(row.allowedColors),
    // 2026-09-10：引用 prompt_template.id（生成时优先取 prompt_template.prompt）
    promptTemplateId: row.promptTemplateId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 解析 JSON 字符串数组列；null/空字符串/解析失败 → undefined
 */
function parseJsonStringArray(
  raw: string | null | undefined
): string[] | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 运行时 ProductEffect 映射为 DB 插入对象
 */
function mapProductEffectToRow(
  effect: ProductEffect
): Omit<ProductEffectRow, "createdAt" | "updatedAt"> {
  return {
    id: effect.maskId,
    name: effect.name,
    category: effect.category,
    description: effect.description,
    previewUrl: effect.previewUrl,
    prompt: effect.prompt,
    variables: effect.variables as ProductEffectRow["variables"],
    model: effect.model,
    config: effect.config as ProductEffectRow["config"],
    scene: effect.scene,
    versions: effect.versions as ProductEffectRow["versions"],
    price: effect.price,
    status: effect.status,
    usageCount: effect.usageCount,
    successRate: effect.successRate,
    avgDuration: effect.avgDuration,
    author: effect.author,
    productLineIds: effect.productLineIds as ProductEffectRow["productLineIds"],
    // 2026-09-09：productTypeCode 透传
    productTypeCode: effect.productTypeCode ?? null,
    // 2026-09-10：allowedSizes/allowedAccessories 序列化为 JSON 字符串
    allowedSizes: serializeJsonStringArray(effect.allowedSizes),
    allowedAccessories: serializeJsonStringArray(effect.allowedAccessories),
    // 2026-09-10：模板级 capability 覆盖 + 皮革色子集
    allowedCapabilities: serializeJsonCapabilities(effect.allowedCapabilities),
    allowedColors: serializeJsonStringArray(effect.allowedColors),
    // 2026-09-10：prompt_template_id 引用（应用层校验，不加 DB FK）
    promptTemplateId: effect.promptTemplateId ?? null,
  };
}

/**
 * 序列化 string[] 为 JSON 字符串；空数组/null/undefined → null
 */
function serializeJsonStringArray(
  arr: string[] | null | undefined
): string | null {
  if (!arr || arr.length === 0) return null;
  return JSON.stringify(arr);
}

/**
 * 解析 JSON 字符串对象 → Partial<ProductCapabilities>
 * 2026-09-10：admin 在 productEffect 表里存的模板级 capability 覆盖。
 * 只识别 4 个 LB flag key；其他 key 静默丢弃（防御性，schema 加了新字段也不会爆老数据）。
 */
function parseJsonCapabilities(
  raw: string | null | undefined
): Partial<ProductCapabilities> | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const obj = parsed as Record<string, unknown>;
    const out: Partial<ProductCapabilities> = {};
    if (typeof obj.canLeatherColor === "boolean") {
      out.canLeatherColor = obj.canLeatherColor;
    }
    if (typeof obj.canLeatherExposed === "boolean") {
      out.canLeatherExposed = obj.canLeatherExposed;
    }
    if (typeof obj.canPvcProtection === "boolean") {
      out.canPvcProtection = obj.canPvcProtection;
    }
    if (typeof obj.canHaveRemarks === "boolean") {
      out.canHaveRemarks = obj.canHaveRemarks;
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * 序列化 Partial<ProductCapabilities> 为 JSON 字符串；
 * null/undefined/空对象 → null（DB 列 null 等价于"继承 catalog 默认"）。
 */
function serializeJsonCapabilities(
  cap: Partial<ProductCapabilities> | null | undefined
): string | null {
  if (!cap) return null;
  const keys = Object.keys(cap) as Array<keyof ProductCapabilities>;
  if (keys.length === 0) return null;
  return JSON.stringify(cap);
}

/**
 * 获取所有产品效果
 */
export async function getEffectsFromDb(): Promise<ProductEffect[]> {
  const rows = await db.query.productEffect.findMany({
    orderBy: [productEffect.createdAt],
  });

  return rows.map(mapRowToProductEffect);
}

/**
 * 获取所有上架效果
 */
export async function getActiveEffectsFromDb(): Promise<ProductEffect[]> {
  const rows = await db.query.productEffect.findMany({
    where: eq(productEffect.status, "active"),
    orderBy: [productEffect.createdAt],
  });

  return rows.map(mapRowToProductEffect);
}

/**
 * 根据 maskId 查找效果
 */
export async function findEffectInDb(
  maskId: string
): Promise<ProductEffect | undefined> {
  const row = await db.query.productEffect.findFirst({
    where: eq(productEffect.id, maskId),
  });

  return row ? mapRowToProductEffect(row) : undefined;
}

/**
 * 新增效果（幂等：冲突时跳过）
 */
export async function createEffectInDb(
  effect: ProductEffect
): Promise<ProductEffect> {
  const now = new Date();

  await db
    .insert(productEffect)
    .values({
      ...mapProductEffectToRow(effect),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: productEffect.id });

  const existing = await findEffectInDb(effect.maskId);
  if (existing) return existing;

  throw new Error(`创建/查询效果 ${effect.maskId} 失败`);
}

/**
 * 更新效果
 */
export async function updateEffectInDb(
  maskId: string,
  updates: Partial<ProductEffect>
): Promise<ProductEffect | undefined> {
  const existing = await findEffectInDb(maskId);
  if (!existing) return undefined;

  const updateData: Partial<ProductEffectRow> = {
    updatedAt: new Date(),
  };

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.category !== undefined) updateData.category = updates.category;
  if (updates.description !== undefined)
    updateData.description = updates.description;
  if (updates.previewUrl !== undefined)
    updateData.previewUrl = updates.previewUrl;
  if (updates.prompt !== undefined) updateData.prompt = updates.prompt;
  if (updates.variables !== undefined)
    updateData.variables = updates.variables as ProductEffectRow["variables"];
  if (updates.model !== undefined) updateData.model = updates.model;
  if (updates.config !== undefined)
    updateData.config = updates.config as ProductEffectRow["config"];
  if (updates.scene !== undefined) updateData.scene = updates.scene;
  if (updates.versions !== undefined)
    updateData.versions = updates.versions as ProductEffectRow["versions"];
  if (updates.price !== undefined) updateData.price = updates.price;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.usageCount !== undefined)
    updateData.usageCount = updates.usageCount;
  if (updates.successRate !== undefined)
    updateData.successRate = updates.successRate;
  if (updates.avgDuration !== undefined)
    updateData.avgDuration = updates.avgDuration;
  if (updates.author !== undefined) updateData.author = updates.author;
  if (updates.productLineIds !== undefined)
    updateData.productLineIds =
      updates.productLineIds as ProductEffectRow["productLineIds"];
  if (updates.productTypeCode !== undefined)
    updateData.productTypeCode = updates.productTypeCode ?? null;
  if (updates.allowedSizes !== undefined)
    updateData.allowedSizes = serializeJsonStringArray(updates.allowedSizes);
  if (updates.allowedAccessories !== undefined)
    updateData.allowedAccessories = serializeJsonStringArray(
      updates.allowedAccessories
    );
  // 2026-09-10：模板级 capability 覆盖 + 皮革色子集
  if (updates.allowedCapabilities !== undefined) {
    updateData.allowedCapabilities = serializeJsonCapabilities(
      updates.allowedCapabilities
    );
  }
  if (updates.allowedColors !== undefined)
    updateData.allowedColors = serializeJsonStringArray(updates.allowedColors);
  // 2026-09-10：prompt_template_id 引用更新
  if (updates.promptTemplateId !== undefined)
    updateData.promptTemplateId = updates.promptTemplateId ?? null;

  await db
    .update(productEffect)
    .set(updateData)
    .where(eq(productEffect.id, maskId));

  return findEffectInDb(maskId);
}

/**
 * 原子更新效果使用统计
 *
 * 使用 SQL 表达式避免并发读-改-写竞争
 */
export async function updateEffectUsageStats(
  maskId: string,
  stats: { success: boolean; durationMs: number }
): Promise<void> {
  if (!maskId) return;

  const successScore = stats.success ? 100 : 0;
  await db
    .update(productEffect)
    .set({
      usageCount: sql`${productEffect.usageCount} + 1`,
      successRate: sql`(${productEffect.successRate} * ${productEffect.usageCount} + ${successScore}) / (${productEffect.usageCount} + 1)`,
      avgDuration: sql`(${productEffect.avgDuration} * ${productEffect.usageCount} + ${stats.durationMs}) / (${productEffect.usageCount} + 1)`,
      updatedAt: new Date(),
    })
    .where(eq(productEffect.id, maskId));
}

/**
 * 删除效果
 */
export async function deleteEffectInDb(maskId: string): Promise<boolean> {
  const result = await db
    .delete(productEffect)
    .where(eq(productEffect.id, maskId))
    .returning();

  return result.length > 0;
}
