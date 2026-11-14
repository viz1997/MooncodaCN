/**
 * 目录字典 → 规格校验 —— **纯函数**(零 DB 依赖)
 *
 * ## 这个文件为什么单独存在
 *
 * `product-catalog.ts` 里的 `validateProductSpec()` 判「这个尺寸 / 配件是不是
 * 这个型号的」时,读的是**代码常量**(`PRODUCT_TYPES[].sizes / .accessories`)。
 *
 * ⇒ **后台新加的尺寸会被服务端判成非法** —— 「后台能配 ≠ 服务端认」。
 * 这正是 2026-11-14 那条最容易被漏掉的路。
 *
 * ## 为什么不去改 `product-catalog.ts`
 *
 * 三个理由,每一个都是硬的:
 *
 * 1. **它是纯常量文件** —— 它的唯一 import 是 `import type { … }`
 *    ⇒ 任何客户端组件都能 import 它。改成「读字典」就得让它依赖 DB,
 *    整个客户端 bundle 会被拖垮。
 * 2. **循环 import** —— `catalog-dictionary.ts` 在**运行期** import
 *    `product-catalog.ts`(兜底那一份是从代码常量生成的)。
 *    `product-catalog.ts` 再运行期 import `catalog-dictionary.ts` ⇒ 环。
 * 3. **同步的校验层读不了 DB** —— zod 的 `superRefine` 是**同步**的,
 *    没法在那一层 `await` 一个 DB 查询。
 *
 * ⇒ 校验逻辑**复制**到这一份纯模块里,字典**当参数传进来**。
 * `product-catalog.ts` **一个字都不动**(那份继续当「字典读不到时的兜底口径」)。
 *
 * ## 错误消息逐字对齐 `validateProductSpec`
 *
 * 两份实现的消息**一模一样** ⇒ 换了数据源之后,用户看到的报错还是那句话,
 * 不会突然冒出另一种说法。
 */

import type { CatalogDictionary } from "./catalog-dictionary";
import {
  accessoryCodesForType,
  sizeCodesForType,
  typeCodes,
} from "./catalog-dictionary";

/* -------------------------------------------------------------------------- */
/*  错误                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 规格校验失败的**稳定码**
 *
 * ⚠️ 码是给程序看的(`catch` 之后按码分流),消息是给人看的。
 * 两者**分开**:文案改了不该让程序崩掉。
 */
export type CatalogSpecErrorCode =
  /** 只给了尺寸 / 配件,没给型号 */
  | "TYPE_REQUIRED"
  /** 型号不认识(字典里没有) */
  | "UNKNOWN_TYPE"
  /** 尺寸不在该型号的尺寸档里 */
  | "SIZE_NOT_SUPPORTED"
  /** 配件不在该型号能配的清单里 */
  | "ACCESSORY_NOT_SUPPORTED";

/**
 * 规格校验失败 —— **带稳定码**的 Error
 *
 * 为什么要自己一个类:HTTP 层要按「这是**参数错**(400)」还是「这是**服务端
 * 炸了**(500)」分流。裸 `Error` 分不出来。
 *
 * ⚠️ `instanceof` 靠 `extends Error` + `Object.setPrototypeOf` ——
 * `tsconfig.json` 的 `target` 是 ES2022,类不会被降级编译 ⇒ `instanceof` 可靠。
 */
export class CatalogSpecValidationError extends Error {
  /** 稳定码 —— `catch` 之后按它分流 */
  readonly code: CatalogSpecErrorCode;

  /**
   * 「这条错是给用户看的」—— **给核心层的一个约定标记**
   *
   * next-safe-action 的 `handleServerError` 在生产环境会把异常统一糊成
   * 「服务器错误，请稍后重试」。规格不合法是**用户填错了**(选了一个
   * 不存在的尺寸),不是服务端炸了 ⇒ 这条错必须带着原话回去。
   *
   * ⚠️ 核心层(`src/lib/safe-action.ts`)靠**这个标记属性**认它,而不是
   * `instanceof` —— 核心层不该 import 某个 feature 的错误类。
   * 别的错**没有**这个标记 ⇒ 照旧被糊掉(不漏内部报错)。
   */
  readonly userFacing = true;

  constructor(code: CatalogSpecErrorCode, message: string) {
    super(message);
    this.name = "CatalogSpecValidationError";
    this.code = code;
    // `extends Error` 在 ES5 降级后 prototype 会断 —— 显式接回去,
    // 免得哪天真把 target 改成 ES5 时 `instanceof` 静默失效
    Object.setPrototypeOf(this, CatalogSpecValidationError.prototype);
  }
}

/* -------------------------------------------------------------------------- */
/*  校验                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 按**目录字典**校验「型号 + 尺寸 + 配件」这个组合
 *
 * 跟 `validateProductSpec()` 的口径**逐条相同**,只是数据源从代码常量换成
 * 字典:
 *
 * | 情况 | 码 | 消息 |
 * |---|---|---|
 * | 型号没给,但给了尺寸 / 配件 | `TYPE_REQUIRED` | 未选择产品型号时，不能指定尺寸或配件 |
 * | 型号不认识 | `UNKNOWN_TYPE` | 未知的产品型号：{code} |
 * | 尺寸不在该型号的档里 | `SIZE_NOT_SUPPORTED` | 产品型号 {type} 不支持尺寸 {size}cm（可选：…cm） |
 * | 配件不在该型号的清单里 | `ACCESSORY_NOT_SUPPORTED` | 产品型号 {type} 不支持配件 {acc}（可选：…） |
 *
 * @param dictionary 合并后的字典(DB 行 × 代码常量兜底)
 * @param productTypeCode 型号 code
 * @param productSize 尺寸码(不是厘米数)
 * @param accessoryCode 配件 code
 * @throws {CatalogSpecValidationError} 组合不合法
 */
export function validateProductSpecWithDictionary(
  dictionary: CatalogDictionary,
  productTypeCode: string | null | undefined,
  productSize: string | null | undefined,
  accessoryCode: string | null | undefined
): void {
  // 型号未指定 → 整套必须 null(避免只写 size 不写 type 这种脏数据)
  if (!productTypeCode) {
    if (productSize || accessoryCode) {
      throw new CatalogSpecValidationError(
        "TYPE_REQUIRED",
        "未选择产品型号时，不能指定尺寸或配件"
      );
    }
    return;
  }

  // 型号指定了但字典里没有 → 字典过期或输入拼错
  if (!typeCodes(dictionary).includes(productTypeCode)) {
    throw new CatalogSpecValidationError(
      "UNKNOWN_TYPE",
      `未知的产品型号：${productTypeCode}`
    );
  }

  // 尺寸必须在该型号的 sizes 列表里
  if (productSize) {
    const sizes = sizeCodesForType(dictionary, productTypeCode);
    if (!sizes.includes(productSize)) {
      throw new CatalogSpecValidationError(
        "SIZE_NOT_SUPPORTED",
        `产品型号 ${productTypeCode} 不支持尺寸 ${productSize}cm（可选：${sizes.join("/")}cm）`
      );
    }
  }

  // 配件必须在该型号的 accessories 列表里
  if (accessoryCode) {
    const accessories = accessoryCodesForType(dictionary, productTypeCode);
    if (!accessories.includes(accessoryCode)) {
      throw new CatalogSpecValidationError(
        "ACCESSORY_NOT_SUPPORTED",
        `产品型号 ${productTypeCode} 不支持配件 ${accessoryCode}（可选：${accessories.join("/") || "无"}）`
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  默认值                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 某型号的**默认尺寸**(字典里第一档)
 *
 * 跟代码常量那边 `type.sizes[0]` 一个口径 —— 只是数据源换了。
 */
export function defaultSizeForType(
  dictionary: CatalogDictionary,
  typeCode: string | null | undefined
): string | null {
  if (!typeCode) return null;
  return sizeCodesForType(dictionary, typeCode)[0] ?? null;
}

/**
 * 某型号的**默认配件**(字典里第一个)
 *
 * 跟代码常量那边 `type.accessories[0]` 一个口径。
 */
export function defaultAccessoryForType(
  dictionary: CatalogDictionary,
  typeCode: string | null | undefined
): string | null {
  if (!typeCode) return null;
  return accessoryCodesForType(dictionary, typeCode)[0] ?? null;
}
