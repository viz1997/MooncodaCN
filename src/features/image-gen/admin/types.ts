/**
 * 后台商品目录字典的**视图模型 + 错误码**
 *
 * ## 为什么单独一个文件
 *
 * 类型**不能**放在 `"use server"` 文件里 —— Turbopack 会把那个文件里的
 * 每一个 export 都注册成 server action,类型 re-export 会注册出一个不存在的
 * action,运行时 `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * 所以 `actions.ts` 只导出 async 函数,类型全在这个纯文件里。
 *
 * 这个文件**零 import**(除了类型)—— 能进 vitest `unit` project 跑单测。
 *
 * ## 「删除」= 停用,不是硬删
 *
 * 后台那颗「删除」按钮落的是 `isActive = false`,**不是** `DELETE`。
 *
 * 原因在字典的**兜底规则**里:某个型号在 `product_size` 里**没有行** ⇒ 那个
 * 型号的尺寸**退回代码常量兜底**。硬删之后那一行「没了」⇒ 兜底把它**原样
 * 复活** ⇒ 工作室点了「删除」,尺寸又回来了。
 *
 * ⇒ **停用**才是「删掉」。
 */

/* -------------------------------------------------------------------------- */
/*  错误码                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 后台字典的错误码
 *
 * - **不 throw** —— throw 会被 next-safe-action 糊成「服务器错误」,工作室
 *   根本不知道是哪儿错了(是表还没建?是尺寸码重了?是变体码撞了?)。
 * - 每个码都要有一句人话(见 `CATALOG_ERROR_TEXT_KEYS`)。
 */
export type AdminCatalogErrorCode =
  /** 入参不合法(空尺寸码 / 负加价 / 尺寸码不是数字 …) */
  | "INVALID_INPUT"
  /** 这个型号在 `product` 表里没有(后台页面挂着它改字典,型号却没了) */
  | "PRODUCT_NOT_FOUND"
  /** 尺寸行不存在(要改 / 要停用的那一档查不到) */
  | "SIZE_NOT_FOUND"
  /** 配件不存在(`product_accessory` 里没有这一行) */
  | "ACCESSORY_NOT_FOUND"
  /** 配件变体不存在 */
  | "VARIANT_NOT_FOUND"
  /** 同一个型号下这个尺寸码已经有了 */
  | "SIZE_CODE_DUPLICATED"
  /**
   * `variantCode` **全局**撞了
   *
   * 商城是拿 `acc_${variantCode}` 当键的(`price-source.ts` / `mock-catalog.ts`)
   * ⇒ 同一个 `variantCode` 出现在两个地方,加价就变成「取到哪个算哪个」。
   */
  | "VARIANT_CODE_DUPLICATED"
  /** 表还没建(迁移脚本没跑) */
  | "MIGRATION_MISSING"
  /** 读库失败(不是写)—— 读失败不该跟写失败一个说法 */
  | "READ_FAILED"
  /** 写库失败 */
  | "SAVE_FAILED";

/**
 * 错误码 → i18n 键
 *
 * **一张表,一个来源** —— 界面按 code 查文案,不许在组件里写
 * `code === "SIZE_CODE_DUPLICATED" ? "..." : ...` 这种 if-else:多一个码就多
 * 一处要改的地方,漏一处那个码就显示成原始的英文常量。
 *
 * 键是**相对 `AdminCatalog` 命名空间**的(不含前缀)。
 */
export const CATALOG_ERROR_TEXT_KEYS: Record<AdminCatalogErrorCode, string> = {
  INVALID_INPUT: "errors.INVALID_INPUT",
  PRODUCT_NOT_FOUND: "errors.PRODUCT_NOT_FOUND",
  SIZE_NOT_FOUND: "errors.SIZE_NOT_FOUND",
  ACCESSORY_NOT_FOUND: "errors.ACCESSORY_NOT_FOUND",
  VARIANT_NOT_FOUND: "errors.VARIANT_NOT_FOUND",
  SIZE_CODE_DUPLICATED: "errors.SIZE_CODE_DUPLICATED",
  VARIANT_CODE_DUPLICATED: "errors.VARIANT_CODE_DUPLICATED",
  MIGRATION_MISSING: "errors.MIGRATION_MISSING",
  READ_FAILED: "errors.READ_FAILED",
  SAVE_FAILED: "errors.SAVE_FAILED",
};

/* -------------------------------------------------------------------------- */
/*  视图模型                                                                   */
/* -------------------------------------------------------------------------- */

/** 一档尺寸 */
export interface AdminCatalogSize {
  id: string;
  productTypeCode: string;
  sizeCode: string;
  /** 显式加价(分)—— 不靠下标算 */
  priceDeltaCents: number;
  sortOrder: number;
  isActive: boolean;
}

/** 一个配件(全局字典) */
export interface AdminCatalogAccessory {
  code: string;
  name: string;
  nameEn: string;
  /** material / protection / mount / decor */
  category: string;
  sortOrder: number;
  isActive: boolean;
}

/** 「这个型号能配这个配件」 */
export interface AdminCatalogAccessoryOption {
  id: string;
  productTypeCode: string;
  accessoryCode: string;
  sortOrder: number;
  isActive: boolean;
}

/** 一个配件变体(带加价 / 适用尺寸) */
export interface AdminCatalogAccessoryVariant {
  id: string;
  productTypeCode: string;
  accessoryCode: string;
  variantCode: string;
  name: string;
  nameEn: string;
  swatch: string | null;
  priceDeltaCents: number;
  /** 适用尺寸(cm)—— 空数组 = 全部适用 */
  appliesToSizesCm: number[];
  sortOrder: number;
  isActive: boolean;
}

/**
 * 读字典的结果
 *
 * **表不存在也是一个结果**,不是异常 —— 迁移脚本没跑的时候,后台要显示
 * 「先跑 `pnpm migrate:apply-catalog-dictionary`」,而不是甩一个 500。
 */
export type AdminCatalogListResult =
  | {
      ok: true;
      /** 该型号的尺寸档 */
      sizes: AdminCatalogSize[];
      /** 全局配件字典 */
      accessories: AdminCatalogAccessory[];
      /** 该型号能配哪些配件 */
      accessoryOptions: AdminCatalogAccessoryOption[];
      /** 该型号的配件变体 */
      variants: AdminCatalogAccessoryVariant[];
    }
  | { ok: false; code: AdminCatalogErrorCode };

/**
 * 写操作的统一返回
 *
 * - `changed` —— 真的改了吗(值一样 ⇒ 不写库,`updatedAt` 不抖)
 * - `recomputedSkus` —— 顺带重算了几条 SKU 的绝对价
 */
export type AdminCatalogWriteResult =
  | { ok: true; changed: boolean; recomputedSkus?: number }
  | { ok: false; code: AdminCatalogErrorCode };
