/**
 * 商品目录字典 —— 尺寸 / 配件 / 配件变体
 *
 * ## 为什么要有这一层(2026-11-14)
 *
 * 这三样东西原先**只存在于代码常量**里:
 *
 * - `PRODUCT_TYPES[].sizes` —— 每个型号有哪几档尺寸
 * - `ACCESSORY_META` / `ACCESSORIES` —— 配件叫什么、属于哪一类
 * - `PRODUCT_TYPES[].accessories` —— 哪个型号能配哪些配件
 * - `PRODUCT_ACCESSORY_VARIANTS` —— 配件有哪些变体、各自加多少钱
 *
 * 后台改不了 ⇒ 工作室问「为什么商品 sku 无法设置以及价格」,答案是:
 * 尺寸加价只能**按位置**算出来(`idx * 500`),而且这个算式散在**四个地方**。
 *
 * ⇒ **在尺寸数组中间插一档,后面每一档的价会静默全变**,
 * 而且商城显示的加价跟 SKU 表里真实的价会对不上。
 *
 * 本模块把「字典」抽成一个**纯数据**的形状,让:
 *
 * - 后台能改(改完落 DB);
 * - 四个应用点**共用同一份**查法(`sizeDeltaCentsFor`)。
 *
 * ## 三条铁律
 *
 * 1. **兜底必须跟今天的代码路径逐字节相同** ——
 *    `buildCatalogDictionaryFromCodeConstants()` 是「DB 没播种 / 读失败」时的
 *    兜底。它产出的尺寸加价必须跟今天四处各算一遍的 `idx * 500` **一模一样**。
 * 2. **尺寸加价是显式的,不靠下标** ——
 *    DB 里有行 ⇒ 加价就是那一行的 `priceDeltaCents`,后面几档**不许**跟着挪。
 * 3. **找不到 = 找不到,不是 0** ——
 *    `sizeDeltaCentsFor()` 返 `null` 表示「这个尺寸不在字典里」。
 *    调用方要**跳过**那一行,**不许**当成 0(当成 0 = 静默改错价)。
 *
 * ## 合并规则(逐层兜底,不是整份兜底)
 *
 * | 层 | 粒度 | DB 有行时 | DB 没行时 |
 * |---|---|---|---|
 * | 尺寸 | **逐型号** | 该型号的尺寸**全部**由 DB 说了算(含停用) | 走代码常量兜底 |
 * | 配件(全局) | **逐 code** | DB 那行赢(`isActive=false` ⇒ **这个配件整个没了**) | 走兜底 |
 * | 型号↔配件 | **逐(型号,配件)** | DB 那行赢(`isActive=false` ⇒ 这个型号不再配它) | 走兜底 |
 * | 配件变体 | **逐(型号,配件)** | DB 那几行赢(`isActive=false` ⇒ 那几个变体没了) | 走兜底 |
 *
 * ⚠️ **配件选项 / 变体为什么是「逐(型号,配件)」而不是「逐型号」** ——
 * 按型号兜底的话,给 R 加一个新配件就会把 R 原来的皮套 / 编织绳**一起抹掉**。
 * 按(型号,配件)兜底,加一个新配件只影响那一个新配件。
 *
 * ⚠️ **后台的「删除」必须是「停用」(`isActive=false`),不是硬删** ——
 * 硬删之后这一行「DB 没行」⇒ 兜底把它**原样复活** ⇒ 工作室点「删除」,
 * 刷新一下它又回来了。
 *
 * 本模块**不碰 DB** —— DB 那条腿在 `catalog-dictionary-store.ts`。
 */

import type { AccessoryCategory } from "@/db/image-gen-types";
import {
  ACCESSORIES,
  ACCESSORY_META,
  type AccessoryMeta,
  PRODUCT_TYPES,
} from "@/features/gpt-image/lib/product-catalog";
import { PRODUCT_ACCESSORY_VARIANTS } from "@/features/gpt-image/lib/product-accessory-variants";

/**
 * 尺寸加价的默认档位(分)—— **兜底**用。
 *
 * ⚠️ 这个常量原先住在 `product-variant-sku.ts`,但那边要 import 本模块
 * (尺寸加价改从字典取)⇒ 循环依赖 ⇒ 常量搬到这儿,那边**再导出**一份。
 *
 * ⚠️ 它**只是兜底**。DB 里每一档尺寸都有自己的**显式**加价,
 * 真实生效的是那一行,不是这个常量。
 */
export const SIZE_STEP_CENTS = 500;

/* ========================================================================== */
/*  错误                                                                       */
/* ========================================================================== */

/**
 * 「这条错是给工作室看的」—— 带着原话回去
 *
 * next-safe-action 的 `handleServerError` 在**生产环境**会把没标记的异常
 * 统一糊成「服务器错误，请稍后重试」⇒ 「这个型号还没配尺寸,先去配尺寸」
 * 这种**操作指引**必须带着标记回去,否则工作室只看到一句废话。
 *
 * ⚠️ 核心层(`src/lib/safe-action.ts`)靠**这个标记属性**认它,而不是
 * `instanceof` —— 核心层不该 import 某个 feature 的错误类。
 *
 * ⚠️ 本模块是**纯模块**(能进 vitest `unit` project)⇒ 错误类住在这儿,
 * 单测能直接 import;`db-products.ts` 那种 import `@/db` 的模块里就够不着了。
 */
export class CatalogDictionaryUserError extends Error {
  /** 「这条错是给用户看的」—— 见文件头的说明 */
  readonly userFacing = true;

  constructor(message: string) {
    super(message);
    this.name = "CatalogDictionaryUserError";
    // `extends Error` 在 ES5 降级后 prototype 会断 —— 显式接回去
    Object.setPrototypeOf(this, CatalogDictionaryUserError.prototype);
  }
}

/* ========================================================================== */
/*  字典的形状                                                                 */
/* ========================================================================== */

/** 一个尺寸档 */
export interface CatalogSizeDef {
  /** 尺寸码(今天就是 `"4"` / `"6"` / `"11"` 这种字符串) */
  code: string;
  /** **显式**加价(分)—— 不靠下标算 */
  priceDeltaCents: number;
  /** 展示顺序(也是加价的默认来源,但一旦有 DB 行就以 DB 为准) */
  sortOrder: number;
}

/** 一个配件(全局字典) */
export interface CatalogAccessoryDef {
  code: string;
  /** 中文名 */
  name: string;
  /** 英文名 */
  nameEn: string;
  category: AccessoryCategory;
  sortOrder: number;
}

/** 「某个型号能配某个配件」这一条 */
export interface CatalogAccessoryOptionDef {
  accessoryCode: string;
  sortOrder: number;
}

/** 一个配件变体 */
export interface CatalogAccessoryVariantDef {
  productTypeCode: string;
  accessoryCode: string;
  variantCode: string;
  name: string;
  nameEn: string;
  /** UI 渲染色卡用的 CSS 颜色;不进 DB 的旧字段(今天只存在于代码常量) */
  swatch: string | null;
  priceDeltaCents: number;
  sortOrder: number;
  /** 适用的主体尺寸(cm);空数组 = 通用 */
  appliesToSizesCm: readonly number[];
}

/** 整份字典 */
export interface CatalogDictionary {
  /**
   * 型号的**规范顺序**。
   *
   * ⚠️ 为什么要显式记一笔 —— `buildAllVariantSeeds` 按型号顺序给 SKU 排
   * `sortOrder`。今天的顺序是 `PRODUCT_TYPES` 的顺序(R / A / P / RM / LB / M),
   * **不是字母序**(字母序是 A / LB / M / P / R / RM)⇒ 换了顺序,所有 SKU 的
   * `sortOrder` 都会变。
   */
  typeOrder: readonly string[];
  /** 型号 → 尺寸档 */
  sizesByType: ReadonlyMap<string, readonly CatalogSizeDef[]>;
  /** 配件 code → 配件(全局,不分型号) */
  accessories: ReadonlyMap<string, CatalogAccessoryDef>;
  /** 型号 → 「能配哪些配件」 */
  accessoryOptionsByType: ReadonlyMap<
    string,
    readonly CatalogAccessoryOptionDef[]
  >;
  /** 型号 → 配件变体(跨该型号的所有配件) */
  variantsByType: ReadonlyMap<
    string,
    readonly CatalogAccessoryVariantDef[]
  >;
}

/* ========================================================================== */
/*  DB 行的形状(合并的输入)                                                    */
/* ========================================================================== */

/** `product_size` 一行 */
export interface CatalogSizeRowLike {
  productTypeCode: string;
  sizeCode: string;
  priceDeltaCents: number;
  sortOrder: number;
  isActive: boolean;
}

/** `product_accessory` 一行 */
export interface CatalogAccessoryRowLike {
  code: string;
  name: string;
  nameEn: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
}

/** `product_accessory_option` 一行 */
export interface CatalogAccessoryOptionRowLike {
  productTypeCode: string;
  accessoryCode: string;
  sortOrder: number;
  isActive: boolean;
}

/** `product_accessory_variant` 一行 */
export interface CatalogAccessoryVariantRowLike {
  productTypeCode: string;
  accessoryCode: string;
  variantCode: string;
  name: string;
  nameEn: string;
  swatch: string | null;
  priceDeltaCents: number;
  sortOrder: number;
  /** 存成 JSON 数组字符串(`"[]"` / `"[4]"`)—— 读出来已经是数组 */
  appliesToSizesCm: readonly number[];
  isActive: boolean;
}

/** 一次 DB 读回来的四张表的行 */
export interface CatalogDictionaryDbRows {
  sizes: readonly CatalogSizeRowLike[];
  accessories: readonly CatalogAccessoryRowLike[];
  accessoryOptions: readonly CatalogAccessoryOptionRowLike[];
  variants: readonly CatalogAccessoryVariantRowLike[];
}

/* ========================================================================== */
/*  兜底:从代码常量生成                                                         */
/* ========================================================================== */

/** `ACCESSORY_META` 按字符串查(代码常量的 key 是字面量联合类型) */
function lookupAccessoryMeta(code: string): AccessoryMeta | null {
  const table = ACCESSORY_META as Readonly<
    Record<string, AccessoryMeta | undefined>
  >;
  return table[code] ?? null;
}

/**
 * 从**代码常量**生成一份字典 —— 这是**兜底**。
 *
 * ⚠️ **输出必须跟今天的代码路径逐字节相同** ——
 * 尺寸加价 = `idx * 500`(四处各算一遍的那个 500)。
 *
 * 这份兜底有两个用途:
 *
 * 1. DB 还没播种(`pnpm seed:catalog-dictionary` 没跑)⇒ 行为一个字节都不变;
 * 2. DB 读失败 ⇒ 整份退回这份,商城照常显示。
 */
export function buildCatalogDictionaryFromCodeConstants(): CatalogDictionary {
  const typeOrder: string[] = [];
  const sizesByType = new Map<string, readonly CatalogSizeDef[]>();
  const accessoryOptionsByType = new Map<
    string,
    readonly CatalogAccessoryOptionDef[]
  >();

  for (const type of PRODUCT_TYPES) {
    typeOrder.push(type.code);
    sizesByType.set(
      type.code,
      type.sizes.map((sizeCode, idx) => ({
        code: sizeCode,
        // ⚠️ 这就是今天那四处各算一遍的 `idx * 500` —— 兜底必须一模一样
        priceDeltaCents: idx * SIZE_STEP_CENTS,
        // 10 / 20 / 30…… 留出中间插入的余地(后台插一档不用重排)
        sortOrder: (idx + 1) * 10,
      }))
    );
    accessoryOptionsByType.set(
      type.code,
      type.accessories.map((accessoryCode, idx) => ({
        accessoryCode,
        sortOrder: (idx + 1) * 10,
      }))
    );
  }

  const accessories = new Map<string, CatalogAccessoryDef>();
  ACCESSORIES.forEach((accessory, idx) => {
    const meta = lookupAccessoryMeta(accessory.code);
    accessories.set(accessory.code, {
      code: accessory.code,
      // 兜底名跟 `mock-catalog.ts` 的 `meta?.name.zh ?? accCode` 一个口径
      name: meta?.name.zh ?? accessory.code,
      nameEn: meta?.name.en ?? accessory.code,
      // 兜底分类跟 `product-capability.ts` 的 `?? "decor"` 一个口径
      category: meta?.category ?? "decor",
      sortOrder: (idx + 1) * 10,
    });
  });

  // ⚠️ 这里的局部 map 是**可变**的(要 push)—— 对外那一层
  // `CatalogDictionary.variantsByType` 是 ReadonlyMap。
  const variantsByType = new Map<string, CatalogAccessoryVariantDef[]>();
  for (const variant of PRODUCT_ACCESSORY_VARIANTS) {
    const list = variantsByType.get(variant.productTypeCode) ?? [];
    list.push({
      productTypeCode: variant.productTypeCode,
      accessoryCode: variant.accessoryCode,
      variantCode: variant.variantCode,
      name: variant.name,
      nameEn: variant.nameEn,
      swatch: variant.swatch,
      priceDeltaCents: variant.priceDeltaCents,
      sortOrder: variant.sortOrder,
      appliesToSizesCm: [...variant.appliesToSizesCm],
    });
    variantsByType.set(variant.productTypeCode, list);
  }

  return {
    typeOrder,
    sizesByType,
    accessories,
    accessoryOptionsByType,
    variantsByType,
  };
}

/* ========================================================================== */
/*  合并:DB 行 × 兜底                                                           */
/* ========================================================================== */

/** 分类归一化 —— 认不出来的值退回 `decor`(跟兜底一个口径) */
export function normalizeAccessoryCategory(
  value: string | null | undefined
): AccessoryCategory {
  if (
    value === "material" ||
    value === "protection" ||
    value === "mount" ||
    value === "decor"
  ) {
    return value;
  }
  return "decor";
}

function toSizeDef(row: CatalogSizeRowLike): CatalogSizeDef {
  return {
    code: row.sizeCode,
    priceDeltaCents: row.priceDeltaCents,
    sortOrder: row.sortOrder,
  };
}

function toVariantDef(
  row: CatalogAccessoryVariantRowLike
): CatalogAccessoryVariantDef {
  return {
    productTypeCode: row.productTypeCode,
    accessoryCode: row.accessoryCode,
    variantCode: row.variantCode,
    name: row.name,
    nameEn: row.nameEn,
    swatch: row.swatch,
    priceDeltaCents: row.priceDeltaCents,
    sortOrder: row.sortOrder,
    appliesToSizesCm: [...row.appliesToSizesCm],
  };
}

/** 按 `sortOrder` 排,同值按 code 排(顺序稳定) */
function bySortOrderThenCode(
  a: { sortOrder: number; code: string },
  b: { sortOrder: number; code: string }
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.code.localeCompare(b.code);
}

/** 型号顺序 = 兜底的顺序 + DB 里新出现的型号(按第一次出现的顺序接在后面) */
function mergeTypeOrder(
  rows: CatalogDictionaryDbRows,
  fallback: CatalogDictionary
): string[] {
  const out = [...fallback.typeOrder];
  const seen = new Set(out);
  const push = (code: string) => {
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  };
  for (const row of rows.sizes) push(row.productTypeCode);
  for (const row of rows.accessoryOptions) push(row.productTypeCode);
  for (const row of rows.variants) push(row.productTypeCode);
  return out;
}

/** 配件(全局)—— 逐 code:DB 那行赢,`isActive=false` ⇒ 这个配件整个没了 */
function mergeAccessories(
  rows: readonly CatalogAccessoryRowLike[],
  fallback: ReadonlyMap<string, CatalogAccessoryDef>
): Map<string, CatalogAccessoryDef> {
  const merged = new Map<string, CatalogAccessoryDef>();
  // 兜底里有的、DB 没管的 ⇒ 先摆上
  for (const [code, def] of fallback) merged.set(code, def);
  // DB 管的赢
  for (const row of rows) {
    if (!row.isActive) {
      merged.delete(row.code);
      continue;
    }
    merged.set(row.code, {
      code: row.code,
      name: row.name,
      nameEn: row.nameEn,
      category: normalizeAccessoryCategory(row.category),
      sortOrder: row.sortOrder,
    });
  }
  // 按 sortOrder 重排一遍(后台拖动排序才看得见)
  const sorted = [...merged.values()].sort(bySortOrderThenCode);
  const out = new Map<string, CatalogAccessoryDef>();
  for (const def of sorted) out.set(def.code, def);
  return out;
}

/**
 * 「型号 ↔ 配件」—— 逐(型号,配件)。
 *
 * ⚠️ 停用 = **这个型号不再配这个配件**(不是「这个配件没了」——
 * 那个是配件字典那一层管的)。
 */
function mergeAccessoryOptions(
  rows: readonly CatalogAccessoryOptionRowLike[],
  fallback: CatalogDictionary,
  accessories: ReadonlyMap<string, CatalogAccessoryDef>,
  typeOrder: readonly string[]
): Map<string, readonly CatalogAccessoryOptionDef[]> {
  const byType = new Map<string, Map<string, CatalogAccessoryOptionRowLike>>();
  for (const row of rows) {
    const bucket = byType.get(row.productTypeCode) ?? new Map();
    bucket.set(row.accessoryCode, row);
    byType.set(row.productTypeCode, bucket);
  }

  const out = new Map<string, readonly CatalogAccessoryOptionDef[]>();
  for (const typeCode of typeOrder) {
    const dbBucket = byType.get(typeCode);
    const fbList = fallback.accessoryOptionsByType.get(typeCode) ?? [];
    const fbMap = new Map(fbList.map((o) => [o.accessoryCode, o]));

    // 顺序:兜底里的配件顺序在前,DB 新增的接在后面
    const codes = [...fbMap.keys()];
    if (dbBucket) {
      for (const code of dbBucket.keys()) {
        if (!fbMap.has(code)) codes.push(code);
      }
    }

    const defs: CatalogAccessoryOptionDef[] = [];
    for (const code of codes) {
      const dbRow = dbBucket?.get(code);
      if (dbRow) {
        if (!dbRow.isActive) continue; // 停用 = 这个型号不再配它
        defs.push({ accessoryCode: code, sortOrder: dbRow.sortOrder });
        continue;
      }
      const fb = fbMap.get(code);
      if (!fb) continue;
      defs.push({ accessoryCode: code, sortOrder: fb.sortOrder });
    }

    // 配件字典里没有的 ⇒ 不摆(那个配件被停用了)
    out.set(
      typeCode,
      defs.filter((d) => accessories.has(d.accessoryCode))
    );
  }
  return out;
}

/**
 * 配件变体 —— 逐(型号,配件),**组内再逐变体码**。
 *
 * ⚠️ 为什么不是「逐型号」—— 按型号兜底的话,给 R 加一个新变体就会把 R 原来的
 * 皮套 5 色 / 编织绳 8 色**一起抹掉**。
 *
 * ⚠️ 为什么组内还要再逐变体码 —— 「整组 DB 赢」有个更隐蔽的坑:后台加
 * **一个**变体(给 R 的皮套加一个「墨绿」)⇒ 这一组在 DB 里就有行了 ⇒
 * 兜底那 5 色**整个消失**,商城上那个配件只剩 1 个选项,**而且不报错**。
 * ⇒ 组内改成**逐变体码**合并:同码就地替换(停用 = 拿掉那一码),
 * 新码接在后面。
 */
function mergeVariants(
  rows: readonly CatalogAccessoryVariantRowLike[],
  fallback: CatalogDictionary,
  typeOrder: readonly string[]
): Map<string, readonly CatalogAccessoryVariantDef[]> {
  const byTypeAccessory = new Map<
    string,
    CatalogAccessoryVariantRowLike[]
  >();
  for (const row of rows) {
    const key = `${row.productTypeCode}::${row.accessoryCode}`;
    const list = byTypeAccessory.get(key) ?? [];
    list.push(row);
    byTypeAccessory.set(key, list);
  }

  const out = new Map<string, readonly CatalogAccessoryVariantDef[]>();
  for (const typeCode of typeOrder) {
    const fbList = fallback.variantsByType.get(typeCode) ?? [];
    const dbRowsForType = rows.filter(
      (r) => r.productTypeCode === typeCode
    );

    // DB 一个变体都没有 ⇒ 整份用兜底(逐字节相同)
    if (dbRowsForType.length === 0) {
      out.set(typeCode, fbList);
      continue;
    }

    // 配件顺序:兜底的在前,DB 新增的接在后面
    const accCodes: string[] = [];
    for (const variant of fbList) {
      if (!accCodes.includes(variant.accessoryCode)) {
        accCodes.push(variant.accessoryCode);
      }
    }
    for (const row of dbRowsForType) {
      if (!accCodes.includes(row.accessoryCode)) accCodes.push(row.accessoryCode);
    }

    const defs: CatalogAccessoryVariantDef[] = [];
    for (const accCode of accCodes) {
      const dbRows = byTypeAccessory.get(`${typeCode}::${accCode}`) ?? [];
      const fbGroup = fbList.filter((v) => v.accessoryCode === accCode);

      // ⚠ **逐变体码合并**,不是「整组 DB 赢」
      //
      // 整组替换有个致命的坑:后台加**一个**变体(比如给 R 的皮套加一个
      // 「墨绿」)⇒ 这一组在 DB 里就有行了 ⇒ 兜底那 5 色**整个消失**,
      // 商城上那个配件只剩 1 个选项 —— 而且**不报错**。
      //
      // 逐变体码合并:同码的**就地替换**(停用 = 那一码消失),
      // 新的变体码**接在后面**。
      const group: CatalogAccessoryVariantDef[] = [...fbGroup];
      for (const row of dbRows) {
        const idx = group.findIndex((d) => d.variantCode === row.variantCode);
        if (!row.isActive) {
          // 停用 = 那个变体没了(整组里只拿掉这一码)
          if (idx >= 0) group.splice(idx, 1);
          continue;
        }
        const def = toVariantDef(row);
        if (idx >= 0) group[idx] = def; // 同码 ⇒ 就地替换(位置不变)
        else group.push(def); // 新码 ⇒ 接在后面
      }
      defs.push(...group);
    }
    out.set(typeCode, defs);
  }
  return out;
}

/**
 * 把 DB 的行和兜底**合并**成一份字典。
 *
 * 逐层兜底(不是整份兜底)—— 见文件头那张表。
 */
export function mergeCatalogDictionary(
  rows: CatalogDictionaryDbRows,
  fallback: CatalogDictionary
): CatalogDictionary {
  const accessories = mergeAccessories(rows.accessories, fallback.accessories);
  const typeOrder = mergeTypeOrder(rows, fallback);

  // 尺寸 —— **逐型号**:DB 里这个型号有行 ⇒ 这个型号的尺寸全由 DB 说了算
  const sizeRowsByType = new Map<string, CatalogSizeRowLike[]>();
  for (const row of rows.sizes) {
    const list = sizeRowsByType.get(row.productTypeCode) ?? [];
    list.push(row);
    sizeRowsByType.set(row.productTypeCode, list);
  }
  const sizesByType = new Map<string, readonly CatalogSizeDef[]>();
  for (const typeCode of typeOrder) {
    const dbRows = sizeRowsByType.get(typeCode);
    if (dbRows && dbRows.length > 0) {
      sizesByType.set(
        typeCode,
        dbRows
          .filter((row) => row.isActive)
          .map(toSizeDef)
          .sort(bySortOrderThenCode)
      );
      continue;
    }
    const fb = fallback.sizesByType.get(typeCode);
    if (fb) sizesByType.set(typeCode, fb);
  }

  return {
    typeOrder,
    sizesByType,
    accessories,
    accessoryOptionsByType: mergeAccessoryOptions(
      rows.accessoryOptions,
      fallback,
      accessories,
      typeOrder
    ),
    variantsByType: mergeVariants(rows.variants, fallback, typeOrder),
  };
}

/* ========================================================================== */
/*  查法(四个应用点共用这一份)                                                 */
/* ========================================================================== */

/**
 * 某型号某档尺寸的**显式**加价(分)。
 *
 * - 找得到 ⇒ 那一档自己的加价(DB 里是什么就是什么)
 * - 找不到 ⇒ **`null`**,**不是 0**
 *
 * ⚠️ 调用方拿到 `null` 一定要**跳过**那一行,不许当成 0 ——
 * 当成 0 = 静默把某一档的价算错(钱少了/多了都不报错)。
 */
export function sizeDeltaCentsFor(
  dictionary: CatalogDictionary,
  typeCode: string,
  sizeCode: string
): number | null {
  const sizes = dictionary.sizesByType.get(typeCode);
  if (!sizes) return null;
  for (const size of sizes) {
    if (size.code === sizeCode) return size.priceDeltaCents;
  }
  return null;
}

/** 某型号有哪几档尺寸(按字典顺序) */
export function sizeCodesForType(
  dictionary: CatalogDictionary,
  typeCode: string
): readonly string[] {
  return (dictionary.sizesByType.get(typeCode) ?? []).map((size) => size.code);
}

/** 某型号能配哪些配件(按字典顺序) */
export function accessoryCodesForType(
  dictionary: CatalogDictionary,
  typeCode: string
): readonly string[] {
  return (dictionary.accessoryOptionsByType.get(typeCode) ?? []).map(
    (option) => option.accessoryCode
  );
}

/** 某型号某档尺寸的完整定义 */
export function sizeDefFor(
  dictionary: CatalogDictionary,
  typeCode: string,
  sizeCode: string
): CatalogSizeDef | null {
  const sizes = dictionary.sizesByType.get(typeCode) ?? [];
  for (const size of sizes) {
    if (size.code === sizeCode) return size;
  }
  return null;
}

/** 某个配件(全局) */
export function accessoryDef(
  dictionary: CatalogDictionary,
  accessoryCode: string
): CatalogAccessoryDef | null {
  return dictionary.accessories.get(accessoryCode) ?? null;
}

/** 某型号某配件的变体 */
export function accessoryVariantsFor(
  dictionary: CatalogDictionary,
  typeCode: string,
  accessoryCode: string
): readonly CatalogAccessoryVariantDef[] {
  return (dictionary.variantsByType.get(typeCode) ?? []).filter(
    (variant) => variant.accessoryCode === accessoryCode
  );
}

/** 某一个具体的变体 */
export function accessoryVariantDef(
  dictionary: CatalogDictionary,
  typeCode: string,
  accessoryCode: string,
  variantCode: string
): CatalogAccessoryVariantDef | null {
  for (const variant of dictionary.variantsByType.get(typeCode) ?? []) {
    if (
      variant.accessoryCode === accessoryCode &&
      variant.variantCode === variantCode
    ) {
      return variant;
    }
  }
  return null;
}

/** 字典里的型号(code 常量里的 + DB 里新加的) */
export function typeCodes(
  dictionary: CatalogDictionary
): readonly string[] {
  return dictionary.typeOrder;
}
