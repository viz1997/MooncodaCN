/**
 * 产品效果数据库访问层
 *
 * 将运行时 ProductEffect 类型与 product_effect 表做映射
 */

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { type ProductEffectRow, productEffect } from "@/db/schema";

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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
  };
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
