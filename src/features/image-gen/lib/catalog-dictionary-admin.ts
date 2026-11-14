/**
 * 商品目录字典的**后台读写** —— 服务端专用
 *
 * ## 这个文件干什么
 *
 * `catalog-dictionary-store.ts` 是**只读**的(给算价 / 展示用),
 * 这个文件是**后台那一侧**的读写:
 *
 * - 读:把某个型号的尺寸 / 配件选项 / 配件变体读出来给后台表格摆
 * - 写:增删改尺寸档、配件、配件归属、配件变体
 *
 * ## 三条规矩
 *
 * 1. **「删除」= 停用(`isActive=false`),不是硬删** ——
 *    硬删之后那一行「DB 没行」⇒ 字典的兜底规则把它**原样复活**
 *    ⇒ 工作室点了「删除」,刷新一下它又回来了。
 * 2. **`variantCode` 必须全局唯一** —— 商城是拿 `acc_${variantCode}` 当键的
 *    (`price-source.ts` / `mock-catalog.ts`)⇒ 同一个 `variantCode` 出现在两个
 *    地方,加价就变成「取到哪个算哪个」。DB 的唯一索引只是
 *    `(productTypeCode, accessoryCode, variantCode)` ⇒ **全局那一层要在这里查**。
 * 3. **改加价 ⇒ 顺带重算 SKU 的绝对价** —— 尺寸加价 / 配件加价变了,
 *    对应型号的 SKU 绝对价要跟着变(`recomputeProductVariantPricesInDb`)。
 *
 * ## ⚠️ 客户端组件不许 import 这个文件
 *
 * 它 import `@/db` ⇒ 进浏览器会炸。
 */

import { and, asc, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import {
  product,
  productAccessory,
  productAccessoryOption,
  productAccessoryVariant,
  productSize,
} from "@/db/schema";

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/** 后台要摆的四块内容(某个型号) */
export interface AdminCatalogRows {
  /** 该型号的尺寸档(含停用的) */
  sizes: {
    id: string;
    productTypeCode: string;
    sizeCode: string;
    priceDeltaCents: number;
    sortOrder: number;
    isActive: boolean;
  }[];
  /** 全局配件字典(含停用的) */
  accessories: {
    code: string;
    name: string;
    nameEn: string;
    category: string;
    sortOrder: number;
    isActive: boolean;
  }[];
  /** 该型号的配件归属(含停用的) */
  accessoryOptions: {
    id: string;
    productTypeCode: string;
    accessoryCode: string;
    sortOrder: number;
    isActive: boolean;
  }[];
  /** 该型号的配件变体(含停用的) */
  variants: {
    id: string;
    productTypeCode: string;
    accessoryCode: string;
    variantCode: string;
    name: string;
    nameEn: string;
    swatch: string | null;
    priceDeltaCents: number;
    appliesToSizesCm: number[];
    sortOrder: number;
    isActive: boolean;
  }[];
}

/**
 * `applies_to_sizes_cm` 存的是 JSON 数组字符串(`"[]"` / `"[4]"`)
 *
 * 解析失败**不当成 0 尺寸** —— 当成「通用」(空数组)并记一条日志。
 * 一个手滑写坏的值不该让整份后台读不出来。
 */
function parseAppliesToSizesCm(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value)
    );
  } catch {
    console.warn(
      `[catalog-admin] applies_to_sizes_cm 不是合法 JSON(${raw})—— 当作「通用尺寸」`
    );
    return [];
  }
}

/**
 * 读某个型号的后台字典 —— 四块一起读
 *
 * ⚠️ **配件字典是全局的**(不分型号)⇒ 读全部;
 * 尺寸 / 归属 / 变体是**逐型号**的。
 */
export async function readAdminCatalogRows(
  productTypeCode: string
): Promise<AdminCatalogRows> {
  const [sizeRows, accessoryRows, optionRows, variantRows] = await Promise.all([
    db
      .select()
      .from(productSize)
      .where(eq(productSize.productTypeCode, productTypeCode))
      .orderBy(asc(productSize.sortOrder), asc(productSize.sizeCode)),
    db.select().from(productAccessory).orderBy(asc(productAccessory.sortOrder)),
    db
      .select()
      .from(productAccessoryOption)
      .where(eq(productAccessoryOption.productTypeCode, productTypeCode))
      .orderBy(
        asc(productAccessoryOption.sortOrder),
        asc(productAccessoryOption.accessoryCode)
      ),
    db
      .select()
      .from(productAccessoryVariant)
      .where(eq(productAccessoryVariant.productTypeCode, productTypeCode))
      .orderBy(
        asc(productAccessoryVariant.sortOrder),
        asc(productAccessoryVariant.accessoryCode),
        asc(productAccessoryVariant.variantCode)
      ),
  ]);

  return {
    sizes: sizeRows,
    accessories: accessoryRows,
    accessoryOptions: optionRows,
    variants: variantRows.map((row) => ({
      ...row,
      appliesToSizesCm: parseAppliesToSizesCm(row.appliesToSizesCm),
    })),
  };
}

/**
 * 这个型号在 `product` 表里存不存在
 *
 * 后台页面是挂在 `/admin/products/[code]` 下的 ⇒ 型号没了页面就该 404。
 * 但**改字典**这一步要有自己的判断(返 `PRODUCT_NOT_FOUND` 而不是 500)。
 */
export async function productExists(code: string): Promise<boolean> {
  const row = await db
    .select({ code: product.code })
    .from(product)
    .where(eq(product.code, code))
    .limit(1);
  return row.length > 0;
}

/**
 * 这个配件在 `product_accessory` 里存不存在
 *
 * 配件是**全局**的 ⇒ 跟型号无关。
 */
export async function accessoryExists(code: string): Promise<boolean> {
  const row = await db
    .select({ code: productAccessory.code })
    .from(productAccessory)
    .where(eq(productAccessory.code, code))
    .limit(1);
  return row.length > 0;
}

/**
 * 读**一个**配件变体行 —— 改之前要知道它属于哪个型号
 *
 * ⚠️ 改变体的时候**型号是不可改的**(它是这一行的归属)⇒ 后台提交上来的
 * `productTypeCode` 可能跟库里那一行对不上(手滑 / 恶意)⇒ 重算 SKU 价要按
 * **库里那一行**的型号来,不然就是「算了另一个型号」。
 */
export async function readAccessoryVariantRow(id: string): Promise<{
  id: string;
  productTypeCode: string;
  accessoryCode: string;
  variantCode: string;
  priceDeltaCents: number;
} | null> {
  const rows = await db
    .select({
      id: productAccessoryVariant.id,
      productTypeCode: productAccessoryVariant.productTypeCode,
      accessoryCode: productAccessoryVariant.accessoryCode,
      variantCode: productAccessoryVariant.variantCode,
      priceDeltaCents: productAccessoryVariant.priceDeltaCents,
    })
    .from(productAccessoryVariant)
    .where(eq(productAccessoryVariant.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 这个型号的基础价(分)—— 重算 SKU 价要它
 *
 * 型号不在 `product` 表里 ⇒ `null`(调用方自己决定怎么处理)。
 */
export async function readProductBasePriceCents(
  code: string
): Promise<number | null> {
  const row = await db
    .select({ basePriceCents: product.basePriceCents })
    .from(product)
    .where(eq(product.code, code))
    .limit(1);
  return row[0]?.basePriceCents ?? null;
}

/* -------------------------------------------------------------------------- */
/*  查:全局 variantCode 撞车                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 查 `variantCode` 在**别的(型号, 配件)**下有没有用过
 *
 * ⚠️ 商城是拿 `acc_${variantCode}` 当键的 ⇒ `variantCode` 撞车 = 加价取错。
 * DB 的唯一索引只管 `(productTypeCode, accessoryCode, variantCode)`,
 * 这一层**全局**的唯一性得在这里查。
 *
 * @param excludeRowId 正在改的那一行(id)—— 它自己不算撞车
 */
export async function findConflictingVariantCode(
  variantCode: string,
  productTypeCode: string,
  accessoryCode: string,
  excludeRowId?: string
): Promise<
  | { conflict: true; productTypeCode: string; accessoryCode: string }
  | { conflict: false }
> {
  const rows = await db
    .select({
      id: productAccessoryVariant.id,
      productTypeCode: productAccessoryVariant.productTypeCode,
      accessoryCode: productAccessoryVariant.accessoryCode,
    })
    .from(productAccessoryVariant)
    .where(eq(productAccessoryVariant.variantCode, variantCode));

  for (const row of rows) {
    if (excludeRowId && row.id === excludeRowId) continue;
    if (
      row.productTypeCode === productTypeCode &&
      row.accessoryCode === accessoryCode
    ) {
      // 同一个(型号, 配件)下 —— DB 的唯一索引管着,不是「全局撞车」
      continue;
    }
    return {
      conflict: true,
      productTypeCode: row.productTypeCode,
      accessoryCode: row.accessoryCode,
    };
  }
  return { conflict: false };
}

/* -------------------------------------------------------------------------- */
/*  写                                                                         */
/* -------------------------------------------------------------------------- */

/** 尺寸档 —— 新增或改一行 */
export interface UpsertSizeInput {
  productTypeCode: string;
  /**
   * 尺寸码 —— **自然键**
   *
   * ⚠️ 「新增」和「改」用**同一个字段**区分:这个型号下**还没有**这个尺寸码
   * ⇒ 新增;**已经有了** ⇒ 改那一行。
   *
   * (不用「空串 = 新增」那套 —— 空串不是一个合法的尺寸码,那种约定迟早
   * 被人当成「忘了填」传进来。)
   */
  sizeCode: string;
  priceDeltaCents: number;
  sortOrder: number;
  isActive: boolean;
}

/**
 * 写一档尺寸 —— 按 `(productTypeCode, sizeCode)` **upsert**
 *
 * - 这一档还不存在 ⇒ 新增
 * - 已经存在 ⇒ 改那一行
 */
export async function upsertProductSizeRow(
  input: UpsertSizeInput
): Promise<"created" | "updated"> {
  const now = new Date();
  const existing = await db
    .select({ id: productSize.id })
    .from(productSize)
    .where(
      and(
        eq(productSize.productTypeCode, input.productTypeCode),
        eq(productSize.sizeCode, input.sizeCode)
      )
    )
    .limit(1);
  const row = existing[0];

  if (!row) {
    await db.insert(productSize).values({
      id: nanoid(),
      productTypeCode: input.productTypeCode,
      sizeCode: input.sizeCode,
      priceDeltaCents: input.priceDeltaCents,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });
    return "created";
  }

  await db
    .update(productSize)
    .set({
      priceDeltaCents: input.priceDeltaCents,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      updatedAt: now,
    })
    .where(eq(productSize.id, row.id));
  return "updated";
}

/** 停用一档尺寸 —— **不是硬删**(见文件头第三条规矩) */
export async function deactivateProductSizeRow(
  productTypeCode: string,
  sizeCode: string
): Promise<boolean> {
  const rows = await db
    .update(productSize)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(productSize.productTypeCode, productTypeCode),
        eq(productSize.sizeCode, sizeCode)
      )
    )
    .returning({ id: productSize.id });
  return rows.length > 0;
}

/** 配件 —— 新增或改一行 */
export interface UpsertAccessoryInput {
  /**
   * 配件 code —— **自然键**(也是主键)
   *
   * 同尺寸那套:这个 code 还不存在 ⇒ 新增;存在 ⇒ 改那一行。
   */
  code: string;
  name: string;
  nameEn: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
}

/**
 * 写一个配件 —— 按 `code` **upsert**
 *
 * ⚠️ **配件是全局的** —— 改一个配件的名字/分类,所有型号都跟着变。
 */
export async function upsertProductAccessoryRow(
  input: UpsertAccessoryInput
): Promise<"created" | "updated"> {
  const now = new Date();
  const existing = await db
    .select({ code: productAccessory.code })
    .from(productAccessory)
    .where(eq(productAccessory.code, input.code))
    .limit(1);

  if (!existing[0]) {
    await db.insert(productAccessory).values({
      code: input.code,
      name: input.name,
      nameEn: input.nameEn,
      category: input.category,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });
    return "created";
  }

  await db
    .update(productAccessory)
    .set({
      name: input.name,
      nameEn: input.nameEn,
      category: input.category,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      updatedAt: now,
    })
    .where(eq(productAccessory.code, input.code));
  return "updated";
}

/**
 * 停用一个配件 —— **不是硬删**
 *
 * ⚠️ 配件字典那一层的语义是「`isActive=false` ⇒ **这个配件整个没了**」
 * (不是「还在但不可选」)⇒ 停用一个配件,所有型号都看不到它了。
 */
export async function deactivateProductAccessoryRow(
  code: string
): Promise<boolean> {
  const rows = await db
    .update(productAccessory)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(productAccessory.code, code))
    .returning({ code: productAccessory.code });
  return rows.length > 0;
}

/**
 * 「这个型号能配这个配件」—— 开 / 关
 *
 * `isActive = false` ⇒ 这个型号**不再配**它(不是「这个配件没了」——
 * 那个是配件字典那一层管的)。
 */
export async function setProductAccessoryOptionRow(input: {
  productTypeCode: string;
  accessoryCode: string;
  sortOrder: number;
  isActive: boolean;
}): Promise<"created" | "updated"> {
  const now = new Date();
  const existing = await db
    .select({ id: productAccessoryOption.id })
    .from(productAccessoryOption)
    .where(
      and(
        eq(productAccessoryOption.productTypeCode, input.productTypeCode),
        eq(productAccessoryOption.accessoryCode, input.accessoryCode)
      )
    )
    .limit(1);
  const row = existing[0];

  if (!row) {
    await db.insert(productAccessoryOption).values({
      id: nanoid(),
      productTypeCode: input.productTypeCode,
      accessoryCode: input.accessoryCode,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });
    return "created";
  }

  await db
    .update(productAccessoryOption)
    .set({
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      updatedAt: now,
    })
    .where(eq(productAccessoryOption.id, row.id));
  return "updated";
}

/** 配件变体 —— 新增或改一行 */
export interface UpsertAccessoryVariantInput {
  /** 变体行 id —— 空 = 新增,非空 = 改那一行 */
  id: string;
  productTypeCode: string;
  accessoryCode: string;
  variantCode: string;
  name: string;
  nameEn: string;
  swatch: string | null;
  priceDeltaCents: number;
  /** 适用尺寸(cm)—— 空数组 = 通用 */
  appliesToSizesCm: number[];
  sortOrder: number;
  isActive: boolean;
}

/** 写一个配件变体 */
export async function upsertProductAccessoryVariantRow(
  input: UpsertAccessoryVariantInput
): Promise<"created" | "updated" | "not_found"> {
  const now = new Date();
  const appliesToSizesCm = JSON.stringify(input.appliesToSizesCm);

  if (!input.id) {
    await db.insert(productAccessoryVariant).values({
      id: nanoid(),
      productTypeCode: input.productTypeCode,
      accessoryCode: input.accessoryCode,
      variantCode: input.variantCode,
      name: input.name,
      nameEn: input.nameEn,
      swatch: input.swatch,
      priceDeltaCents: input.priceDeltaCents,
      appliesToSizesCm,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });
    return "created";
  }

  const existing = await db
    .select({ id: productAccessoryVariant.id })
    .from(productAccessoryVariant)
    .where(eq(productAccessoryVariant.id, input.id))
    .limit(1);
  if (!existing[0]) return "not_found";

  await db
    .update(productAccessoryVariant)
    .set({
      accessoryCode: input.accessoryCode,
      variantCode: input.variantCode,
      name: input.name,
      nameEn: input.nameEn,
      swatch: input.swatch,
      priceDeltaCents: input.priceDeltaCents,
      appliesToSizesCm,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      updatedAt: now,
    })
    .where(eq(productAccessoryVariant.id, input.id));
  return "updated";
}

/** 停用一个配件变体 —— **不是硬删** */
export async function deactivateProductAccessoryVariantRow(
  id: string
): Promise<boolean> {
  const rows = await db
    .update(productAccessoryVariant)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(productAccessoryVariant.id, id))
    .returning({ id: productAccessoryVariant.id });
  return rows.length > 0;
}

/**
 * 找**别的型号**下用了同一个 `variantCode` 的配件变体
 *
 * 给「这个型号的变体列表」判断「能不能加这个配件」用 ——
 * 同一个 `variantCode` 在别的型号下已经存在 ⇒ 加进来会撞车。
 */
export async function findVariantCodeOwner(
  variantCode: string,
  productTypeCode: string
): Promise<{ productTypeCode: string; accessoryCode: string } | null> {
  const rows = await db
    .select({
      productTypeCode: productAccessoryVariant.productTypeCode,
      accessoryCode: productAccessoryVariant.accessoryCode,
    })
    .from(productAccessoryVariant)
    .where(
      and(
        eq(productAccessoryVariant.variantCode, variantCode),
        ne(productAccessoryVariant.productTypeCode, productTypeCode)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
