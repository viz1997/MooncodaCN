/**
 * 产品线数据库访问层
 *
 * 2026-09-10：替代 MOCK_PRODUCT_LINES 前端 mock；与 productEffect 表通过
 * product_effect.product_line_ids JSON 列做应用层关联（无 DB FK）。
 *
 * 设计沿用 db-effects.ts 的 mapper + parseJsonStringArray 模式：
 * - spec / pricing 用 JSON 字符串列存（与 allowedSizes 等同形态）
 * - 空对象 / null 统一序列化为 DB null
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  type NewProductLineRow,
  type ProductLineRow,
  productLine,
} from "@/db/schema";

import type {
  ProductLine,
  ProductLinePricing,
  ProductLineSpec,
} from "./product-effect-types";

/**
 * 解析 JSON 字符串对象列；null/空字符串/解析失败 → null
 * 与 parseJsonStringArray 不同：这里返 Record<string, unknown> 而非 string[]
 */
function parseJsonObject(
  raw: string | null | undefined
): Record<string, unknown> | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 序列化 object 为 JSON 字符串；null/undefined/空对象 → null
 */
function serializeJsonObject(
  obj: Record<string, unknown> | null | undefined
): string | null {
  if (!obj || Object.keys(obj).length === 0) return null;
  return JSON.stringify(obj);
}

/**
 * DB 行映射为运行时 ProductLine
 */
function mapRowToProductLine(row: ProductLineRow): ProductLine {
  const spec = parseJsonObject(row.spec) ?? {};
  const pricing = parseJsonObject(row.pricing) ?? {};
  return {
    productLineId: row.productLineId,
    name: row.name,
    category: row.category,
    description: row.description ?? "",
    coverUrl: row.coverUrl ?? "",
    spec: spec as unknown as ProductLineSpec,
    pricing: pricing as unknown as ProductLinePricing,
    status: row.status,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 运行时 ProductLine 映射为 DB 插入对象
 */
function mapLineToRow(
  line: ProductLine
): Omit<ProductLineRow, "createdAt" | "updatedAt"> {
  return {
    productLineId: line.productLineId,
    name: line.name,
    category: line.category,
    description: line.description,
    coverUrl: line.coverUrl,
    spec:
      serializeJsonObject(line.spec as unknown as Record<string, unknown>) ??
      "",
    pricing:
      serializeJsonObject(line.pricing as unknown as Record<string, unknown>) ??
      "",
    status: line.status,
    sortOrder: line.sortOrder,
  };
}

/**
 * 获取所有产品线（按 sortOrder 升序）
 */
export async function getLinesFromDb(): Promise<ProductLine[]> {
  const rows = await db.query.productLine.findMany({
    orderBy: [productLine.sortOrder, productLine.productLineId],
  });
  return rows.map(mapRowToProductLine);
}

/**
 * 获取所有上架产品线（active）
 */
export async function getActiveLinesFromDb(): Promise<ProductLine[]> {
  const all = await getLinesFromDb();
  return all.filter((l) => l.status === "active");
}

/**
 * 根据 productLineId 查找
 */
export async function findLineInDb(
  productLineId: string
): Promise<ProductLine | undefined> {
  const row = await db.query.productLine.findFirst({
    where: eq(productLine.productLineId, productLineId),
  });
  return row ? mapRowToProductLine(row) : undefined;
}

/**
 * 新增产品线（幂等：冲突时跳过）
 */
export async function createLineInDb(line: ProductLine): Promise<ProductLine> {
  const now = new Date();
  await db
    .insert(productLine)
    .values({
      ...mapLineToRow(line),
      createdAt: now,
      updatedAt: now,
    } satisfies NewProductLineRow)
    .onConflictDoNothing({ target: productLine.productLineId });

  const existing = await findLineInDb(line.productLineId);
  if (existing) return existing;
  throw new Error(`创建/查询产品线 ${line.productLineId} 失败`);
}

/**
 * 更新产品线
 */
export async function updateLineInDb(
  productLineId: string,
  updates: Partial<ProductLine>
): Promise<ProductLine | undefined> {
  const existing = await findLineInDb(productLineId);
  if (!existing) return undefined;

  const updateData: Partial<ProductLineRow> = {
    updatedAt: new Date(),
  };
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.category !== undefined) updateData.category = updates.category;
  if (updates.description !== undefined)
    updateData.description = updates.description;
  if (updates.coverUrl !== undefined) updateData.coverUrl = updates.coverUrl;
  if (updates.spec !== undefined) {
    updateData.spec =
      serializeJsonObject(updates.spec as unknown as Record<string, unknown>) ??
      "";
  }
  if (updates.pricing !== undefined) {
    updateData.pricing =
      serializeJsonObject(
        updates.pricing as unknown as Record<string, unknown>
      ) ?? "";
  }
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.sortOrder !== undefined) updateData.sortOrder = updates.sortOrder;

  await db
    .update(productLine)
    .set(updateData)
    .where(eq(productLine.productLineId, productLineId));

  return findLineInDb(productLineId);
}

/**
 * 删除产品线
 */
export async function deleteLineInDb(productLineId: string): Promise<boolean> {
  const result = await db
    .delete(productLine)
    .where(eq(productLine.productLineId, productLineId))
    .returning();
  return result.length > 0;
}
