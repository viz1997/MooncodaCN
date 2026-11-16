/**
 * 真实案例的**数据库读写** —— 服务端专用
 *
 * 纯逻辑那一半在 `case-apply.ts`(零 import,能进 unit project 跑单测);
 * 图片解析那一半在 `case-image.ts`(服务端专用,它 import 了 R2 那套)。
 * 这里只跟数据库打交道。
 *
 * ## 读失败**抛出去**
 *
 * 跟 `coupon-store.ts` 相反 —— 那边读失败返 null(下单链路不能炸),这边
 * **后台要看见真话**:
 *
 * - 迁移脚本没跑 ⇒ 表不存在 ⇒ 读会抛 ⇒ 上层翻译成 `MIGRATION_MISSING`,
 *   界面说「迁移脚本没跑」,不是一句「保存失败」。
 * - 前台那一侧(`showcase-catalog.ts`)**自己 catch**,读不到就当「没有案例」
 *   ⇒ 前台降级,不崩。
 *
 * ## 下架,不是删
 *
 * R2 桶策略锁着对象(删不掉),案例也一样:下架一行(`is_active = false`),
 * 那一行还在库里,随时能重新上架。
 */

import { asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import { storefrontCase } from "@/db/schema";
import type { ShowcaseCaseInput, ShowcaseCaseRecord } from "./case-types";

/** DB 那一行 → 纯类型那一层用的形状 */
function toRecord(row: typeof storefrontCase.$inferSelect): ShowcaseCaseRecord {
  return {
    id: row.id,
    title: row.title,
    titleEn: row.titleEn,
    description: row.description,
    descriptionEn: row.descriptionEn,
    coverUrl: row.coverUrl,
    beforeImageUrl: row.beforeImageUrl,
    authorName: row.authorName,
    productTypeCode: row.productTypeCode,
    productHandle: row.productHandle,
    likes: row.likes,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 读案例列表
 *
 * - 前台(`includeInactive = false`)⇒ 只读上架的;
 * - 后台(`includeInactive = true`)⇒ 全部,停用的也返回(后台要能重新上架)。
 *
 * ⚠️ **排序在这里只按 `sortOrder`** —— 完整的排序口径(`sortOrder` →
 * `likes` → `createdAt`)在纯函数 `case-apply.ts` 的 `sortShowcaseRecords()`
 * 里,前台投影时统一做。两处各排一次迟早漂。
 */
export async function listShowcaseCases(opts?: {
  includeInactive?: boolean;
}): Promise<ShowcaseCaseRecord[]> {
  const includeInactive = opts?.includeInactive ?? false;
  const rows = await db
    .select()
    .from(storefrontCase)
    .where(includeInactive ? undefined : eq(storefrontCase.isActive, true))
    .orderBy(asc(storefrontCase.sortOrder), desc(storefrontCase.likes));

  return rows.map(toRecord);
}

/** 按 id 读一条 —— 找不到就是 null */
export async function getShowcaseCaseById(
  id: string
): Promise<ShowcaseCaseRecord | null> {
  const rows = await db
    .select()
    .from(storefrontCase)
    .where(eq(storefrontCase.id, id))
    .limit(1);
  const row = rows[0];
  return row ? toRecord(row) : null;
}

/**
 * 后台保存(新增 / 修改)
 *
 * - 有 `id` ⇒ 改那一行;没有 ⇒ 新增一行(`nanoid()` 造 id)。
 * - `updated_at` **显式写** —— 这个仓库的 schema 里**没有** `$onUpdate`
 *   (Drizzle 的 `$onUpdate` 只在应用层写,绕过它做 UPDATE 就不会更新)。
 */
export async function saveShowcaseCase(
  input: ShowcaseCaseInput
): Promise<ShowcaseCaseRecord> {
  const payload = {
    title: input.title.trim(),
    titleEn: input.titleEn?.trim() || null,
    description: input.description?.trim() || null,
    descriptionEn: input.descriptionEn?.trim() || null,
    coverUrl: input.coverUrl.trim(),
    beforeImageUrl: input.beforeImageUrl?.trim() || null,
    authorName: input.authorName.trim(),
    productTypeCode: input.productTypeCode?.trim() || null,
    productHandle: input.productHandle?.trim() || null,
    likes: Math.max(0, Math.floor(input.likes)),
    sortOrder: Math.floor(input.sortOrder),
    isActive: input.isActive,
    updatedAt: new Date(),
  };

  if (input.id) {
    const rows = await db
      .update(storefrontCase)
      .set(payload)
      .where(eq(storefrontCase.id, input.id))
      .returning();
    const row = rows[0];
    if (!row) throw new Error("更新案例失败:找不到这一行");
    return toRecord(row);
  }

  const rows = await db
    .insert(storefrontCase)
    .values({ id: nanoid(), ...payload })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("新增案例失败:没有返回行");
  return toRecord(row);
}

/**
 * 上架 / 下架
 *
 * **不删** —— R2 桶策略锁着对象(删不掉),案例也一样。
 */
export async function setShowcaseCaseActive(
  id: string,
  isActive: boolean
): Promise<void> {
  await db
    .update(storefrontCase)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(storefrontCase.id, id));
}
