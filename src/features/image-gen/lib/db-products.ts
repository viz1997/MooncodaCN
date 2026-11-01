/**
 * 商品目录数据库访问层
 *
 * 2026-10-21 新增：product + product_variant 两张表的 CRUD，
 * 供 /admin/products 后台使用。风格照 db-lines.ts —— mapper 把 DB 行转成
 * 运行时对象（时间戳转 ISO 字符串，方便过 next-safe-action 的 JSON 序列化）。
 *
 * 注意：本模块只管「商品资料 + SKU 价」。尺寸清单 / 配件清单仍是
 * product-catalog.ts 的 PRODUCT_TYPES 常量（见 CLAUDE.md 范围说明），
 * 所以 createProduct 的 code 必须落在字典里，否则对外接口不会返回它 ——
 * 写入前用 getProductType 校验。
 */

import { asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import type {
  NewProductRow,
  NewProductVariantRow,
  ProductRow,
  ProductVariantRow,
} from "@/db/schema";
import { product, productAccessoryVariant, productVariant } from "@/db/schema";
import { getProductType } from "@/features/gpt-image/lib/product-catalog";

import { buildAllVariantSeeds } from "./product-variant-sku";

/* -------------------------------------------------------------------------- */
/*  运行时类型（时间戳转 ISO，给 client component / server action 用）          */
/* -------------------------------------------------------------------------- */

export interface AdminProduct {
  code: string;
  name: string;
  nameEn: string;
  category: string;
  description: string;
  coverUrl: string;
  basePriceCents: number;
  leadTimeDays: number;
  accent: string;
  status: "active" | "inactive";
  sortOrder: number;
  /** 该商品在 product_accessory_variant 里的行数（admin 侧展示用） */
  accessoryVariantCount: number;
  /** 在售 SKU 数 */
  activeSkuCount: number;
  /** SKU 总数（含已下架） */
  totalSkuCount: number;
  /** 价格区间（分）；无 SKU 时 null。用于列表页「¥19 ~ ¥128」 */
  priceRangeCents: { min: number; max: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductVariant {
  id: string;
  productCode: string;
  sku: string;
  sizeCode: string;
  accessoryCode: string;
  variantCode: string;
  priceCents: number;
  isActive: boolean;
  sortOrder: number;
  /** 中文可读标签，如 "6cm · 棕色皮革"；admin 列表直接显示，省得前端拼 */
  label: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/*  Mapper                                                                     */
/* -------------------------------------------------------------------------- */

function mapProductRow(
  row: ProductRow,
  stats: { accessoryVariantCount: number; variants: ProductVariantRow[] }
): AdminProduct {
  const prices = stats.variants.map((v) => v.priceCents);
  return {
    code: row.code,
    name: row.name,
    nameEn: row.nameEn,
    category: row.category,
    description: row.description,
    coverUrl: row.coverUrl,
    basePriceCents: row.basePriceCents,
    leadTimeDays: row.leadTimeDays,
    accent: row.accent,
    status: row.status,
    sortOrder: row.sortOrder,
    accessoryVariantCount: stats.accessoryVariantCount,
    totalSkuCount: stats.variants.length,
    activeSkuCount: stats.variants.filter((v) => v.isActive).length,
    priceRangeCents:
      prices.length > 0
        ? { min: Math.min(...prices), max: Math.max(...prices) }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 变体行的可读标签：优先用 product_accessory_variant 的中文名 */
function variantLabel(
  row: ProductVariantRow,
  accessoryNames: Map<string, string>,
  sizeUnit: string
): string {
  const parts: string[] = [];
  if (row.sizeCode && row.sizeCode !== "N-A") {
    parts.push(`${row.sizeCode}${sizeUnit}`);
  }
  if (row.accessoryCode && row.accessoryCode !== "N-A") {
    const accName = accessoryNames.get(row.variantCode);
    parts.push(accName ?? row.accessoryCode);
  }
  return parts.join(" · ") || "默认";
}

function mapVariantRow(
  row: ProductVariantRow,
  accessoryNames: Map<string, string>,
  sizeUnit: string
): AdminProductVariant {
  return {
    id: row.id,
    productCode: row.productCode,
    sku: row.sku,
    sizeCode: row.sizeCode,
    accessoryCode: row.accessoryCode,
    variantCode: row.variantCode,
    priceCents: row.priceCents,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    label: variantLabel(row, accessoryNames, sizeUnit),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 取 product_accessory_variant 的 variantCode → 中文名映射。
 * 变体的 label 要说人话（「棕色皮革」而不是「leather_brown」）。
 */
async function getAccessoryVariantNames(): Promise<Map<string, string>> {
  const rows = await db
    .select({
      variantCode: productAccessoryVariant.variantCode,
      name: productAccessoryVariant.name,
    })
    .from(productAccessoryVariant);
  return new Map(rows.map((r) => [r.variantCode, r.name]));
}

/* -------------------------------------------------------------------------- */
/*  查询                                                                       */
/* -------------------------------------------------------------------------- */

/** 商品列表（含 SKU / 配件变体的统计），按 sortOrder → code 升序 */
export async function getProductsFromDb(): Promise<AdminProduct[]> {
  const [rows, variants, accessoryVariantRows] = await Promise.all([
    db.query.product.findMany({
      orderBy: [asc(product.sortOrder), asc(product.code)],
    }),
    db.select().from(productVariant),
    db
      .select({ productTypeCode: productAccessoryVariant.productTypeCode })
      .from(productAccessoryVariant),
  ]);

  const variantsByCode = new Map<string, ProductVariantRow[]>();
  for (const v of variants) {
    const arr = variantsByCode.get(v.productCode) ?? [];
    arr.push(v);
    variantsByCode.set(v.productCode, arr);
  }

  const accCountByCode = new Map<string, number>();
  for (const r of accessoryVariantRows) {
    accCountByCode.set(
      r.productTypeCode,
      (accCountByCode.get(r.productTypeCode) ?? 0) + 1
    );
  }

  return rows.map((row) =>
    mapProductRow(row, {
      accessoryVariantCount: accCountByCode.get(row.code) ?? 0,
      variants: variantsByCode.get(row.code) ?? [],
    })
  );
}

/** 单个商品；查不到返 undefined */
export async function findProductInDb(
  code: string
): Promise<AdminProduct | undefined> {
  const row = await db.query.product.findFirst({
    where: eq(product.code, code),
  });
  if (!row) return undefined;

  const [variants, accessoryVariantRows] = await Promise.all([
    db
      .select()
      .from(productVariant)
      .where(eq(productVariant.productCode, code)),
    db
      .select({ id: productAccessoryVariant.id })
      .from(productAccessoryVariant)
      .where(eq(productAccessoryVariant.productTypeCode, code)),
  ]);

  return mapProductRow(row, {
    accessoryVariantCount: accessoryVariantRows.length,
    variants,
  });
}

/** 某商品的 SKU 行（含已下架），按 sortOrder → sku 升序 */
export async function getVariantsFromDb(
  productCode: string
): Promise<AdminProductVariant[]> {
  const [rows, names] = await Promise.all([
    db
      .select()
      .from(productVariant)
      .where(eq(productVariant.productCode, productCode))
      .orderBy(asc(productVariant.sortOrder), asc(productVariant.sku)),
    getAccessoryVariantNames(),
  ]);
  const unit = getProductType(productCode)?.unit ?? "";
  return rows.map((r) => mapVariantRow(r, names, unit));
}

/** 全部商品的 SKU 行（admin 全局搜索 / 导出用） */
export async function getAllVariantsFromDb(): Promise<AdminProductVariant[]> {
  const [rows, names] = await Promise.all([
    db.select().from(productVariant).orderBy(asc(productVariant.sku)),
    getAccessoryVariantNames(),
  ]);
  return rows.map((r) =>
    mapVariantRow(r, names, getProductType(r.productCode)?.unit ?? "")
  );
}

/* -------------------------------------------------------------------------- */
/*  写入                                                                       */
/* -------------------------------------------------------------------------- */

/** 可编辑字段（admin 表单能改的） */
export interface ProductInput {
  code: string;
  name: string;
  // 可选字段显式带 `| undefined` —— 调用方是 zod 推断出来的 partial，
  // exactOptionalPropertyTypes 下不接受「属性存在但值为 undefined」。
  nameEn?: string | undefined;
  category?: string | undefined;
  description?: string | undefined;
  coverUrl?: string | undefined;
  basePriceCents?: number | undefined;
  leadTimeDays?: number | undefined;
  accent?: string | undefined;
  status?: "active" | "inactive" | undefined;
  sortOrder?: number | undefined;
}

/** 新建商品；code 已存在则返回 undefined（调用方决定是否 upsert） */
export async function createProductInDb(
  input: ProductInput
): Promise<AdminProduct | undefined> {
  if (!getProductType(input.code)) {
    throw new Error(
      `未知的产品码 ${input.code}：product-catalog.ts 的 PRODUCT_TYPES 里没有它，新增新型号需要改代码`
    );
  }
  const now = new Date();
  const row: NewProductRow = {
    code: input.code,
    name: input.name,
    nameEn: input.nameEn ?? "",
    category: input.category ?? "keychain",
    description: input.description ?? "",
    coverUrl: input.coverUrl ?? "",
    basePriceCents: input.basePriceCents ?? 0,
    leadTimeDays: input.leadTimeDays ?? 7,
    accent: input.accent ?? "",
    status: input.status ?? "active",
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  await db
    .insert(product)
    .values(row)
    .onConflictDoNothing({ target: product.code });
  return findProductInDb(input.code);
}

/** 更新商品资料；只覆盖显式传入的字段（undefined = 不动） */
/**
 * 商品可改字段 —— `ProductInput` 去掉主键 code。
 *
 * 不用 `Omit<ProductInput, "code">`：omitted 之后再套 Partial，
 * exactOptionalPropertyTypes 会把「属性在但值为 undefined」判成不合法。
 * 这里每项显式带 `| undefined`，兼容 zod `.partial()` 的推断。
 */
export type ProductUpdates = {
  [K in Exclude<keyof ProductInput, "code">]?: ProductInput[K] | undefined;
};

export async function updateProductInDb(
  code: string,
  updates: ProductUpdates
): Promise<AdminProduct | undefined> {
  const existing = await db.query.product.findFirst({
    where: eq(product.code, code),
  });
  if (!existing) return undefined;

  const data: Partial<ProductRow> = { updatedAt: new Date() };
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.nameEn !== undefined) data.nameEn = updates.nameEn;
  if (updates.category !== undefined) data.category = updates.category;
  if (updates.description !== undefined) data.description = updates.description;
  if (updates.coverUrl !== undefined) data.coverUrl = updates.coverUrl;
  if (updates.basePriceCents !== undefined)
    data.basePriceCents = updates.basePriceCents;
  if (updates.leadTimeDays !== undefined)
    data.leadTimeDays = updates.leadTimeDays;
  if (updates.accent !== undefined) data.accent = updates.accent;
  if (updates.status !== undefined) data.status = updates.status;
  if (updates.sortOrder !== undefined) data.sortOrder = updates.sortOrder;

  await db.update(product).set(data).where(eq(product.code, code));
  return findProductInDb(code);
}

/**
 * 删除商品 + 其全部 SKU 行。
 *
 * 没有 DB FK，所以变体行必须显式删 —— 留着会让 /admin/products/[code] 的
 * 变体查询在商品重建后串到新商品上。
 */
export async function deleteProductInDb(code: string): Promise<boolean> {
  await db.delete(productVariant).where(eq(productVariant.productCode, code));
  const result = await db
    .delete(product)
    .where(eq(product.code, code))
    .returning();
  return result.length > 0;
}

/** 单个 SKU 改价 / 上下架 */
export async function updateVariantInDb(
  id: string,
  updates: { priceCents?: number; isActive?: boolean }
): Promise<boolean> {
  const data: Partial<ProductVariantRow> = { updatedAt: new Date() };
  if (updates.priceCents !== undefined) data.priceCents = updates.priceCents;
  if (updates.isActive !== undefined) data.isActive = updates.isActive;
  const result = await db
    .update(productVariant)
    .set(data)
    .where(eq(productVariant.id, id))
    .returning();
  return result.length > 0;
}

/**
 * 批量改价 + 上下架。
 *
 * 一行一变体的 UPDATE 在 Neon 上往返太多，按「同一组 (priceCents,
 * isActive) 值」合并成一条 SQL —— 运营从列表页勾几行改价时通常值都不同，
 * 所以退化成 N 条也是对的，只是别让常见情况（整页只改上下架 / 只改一个价）
 * 变成上百条。priceCents / isActive 为 undefined 的字段不覆盖。
 */
export async function bulkUpdateVariantsInDb(
  updates: Array<{
    id: string;
    // 显式带 `| undefined`：调用方来自 zod 推断，可选字段天然含 undefined，
    // 而 exactOptionalPropertyTypes 下 `priceCents?: number` 不接受它。
    priceCents?: number | undefined;
    isActive?: boolean | undefined;
  }>
): Promise<number> {
  const actionable = updates.filter(
    (u) => u.priceCents !== undefined || u.isActive !== undefined
  );
  if (actionable.length === 0) return 0;

  const groups = new Map<
    string,
    {
      ids: string[];
      priceCents: number | undefined;
      isActive: boolean | undefined;
    }
  >();
  for (const u of actionable) {
    const key = `${u.priceCents ?? "x"}:${u.isActive ?? "x"}`;
    const g = groups.get(key) ?? {
      ids: [],
      priceCents: u.priceCents,
      isActive: u.isActive,
    };
    g.ids.push(u.id);
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    const set: Partial<ProductVariantRow> = { updatedAt: new Date() };
    if (g.priceCents !== undefined) set.priceCents = g.priceCents;
    if (g.isActive !== undefined) set.isActive = g.isActive;
    await db
      .update(productVariant)
      .set(set)
      .where(inArray(productVariant.id, g.ids));
  }
  return actionable.length;
}

/**
 * 按当前字典重新生成某商品的 SKU 行（幂等）。
 *
 * 只 INSERT 不 UPDATE —— 运营改过的价不能被「重新生成」冲掉。已有 SKU
 * 的行会因 product_variant_uniq_idx 冲突被跳过，运营想回到字典价得自己
 * 去后台逐条改，或者手动清表重跑 seed 脚本。
 *
 * @returns 新增行数
 */
export async function generateVariantsForProductInDb(
  code: string
): Promise<number> {
  const productType = getProductType(code);
  if (!productType) throw new Error(`未知的产品码 ${code}`);

  const [productRow, accessoryRows] = await Promise.all([
    db.query.product.findFirst({ where: eq(product.code, code) }),
    db
      .select()
      .from(productAccessoryVariant)
      .where(eq(productAccessoryVariant.productTypeCode, code)),
  ]);
  if (!productRow) throw new Error(`商品 ${code} 不存在`);

  const seeds = buildAllVariantSeeds({
    basePrices: { [code]: productRow.basePriceCents },
    accessoryVariants: accessoryRows.map((r) => ({
      productTypeCode: r.productTypeCode,
      accessoryCode: r.accessoryCode,
      variantCode: r.variantCode,
      priceDeltaCents: r.priceDeltaCents,
      sortOrder: r.sortOrder,
    })),
    // 只生成这一个产品
    productTypes: [productType],
  });

  const rows: NewProductVariantRow[] = seeds.map((s) => ({
    ...s,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  if (rows.length === 0) return 0;

  await db.insert(productVariant).values(rows).onConflictDoNothing();
  return rows.length;
}
