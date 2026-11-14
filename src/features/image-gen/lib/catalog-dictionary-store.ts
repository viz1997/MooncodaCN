/**
 * 商品目录字典的**数据库读取** —— 服务端专用
 *
 * ## 为什么要有这个文件
 *
 * 尺寸 / 配件 / 配件变体原先只存在于**代码常量**里
 * (`PRODUCT_TYPES` / `ACCESSORY_META` / `PRODUCT_ACCESSORY_VARIANTS`)。
 * 后台改不了 ⇒ 工作室问「为什么商品 sku 无法设置以及价格」。
 *
 * 这个文件把字典从 DB 读出来,跟**代码常量兜底**合并,交给四个应用点。
 * 纯函数那一半在 `catalog-dictionary.ts`(合并规则 / 查法)。
 *
 * ## ⚠️ 这个模块会让页面变成动态渲染
 *
 * 尺寸加价以前是**构建期算出来**的(`idx * 500`)。现在它从 DB 来 ——
 * 不告诉 Next「这一页不能静态」,加价就会在构建时烤进 HTML,后台改了不生效
 * (**2026-11-08 踩过一次**,症状一模一样,只是换了个原因)。
 *
 * `await connection()` 就是那句「别静态」—— 一处就够,不用给每个页面加
 * `force-dynamic`(那会让整个营销站永远动态,动静太大)。
 *
 * ## DB 读失败怎么办
 *
 * **整份退回代码常量兜底** + 记一条 error 日志。
 *
 * - 读失败 ⇒ 尺寸加价回到 `idx * 500`,配件加价回到代码常量 ⇒ **行为跟今天
 *   一个字节都不变**(只是后台改的加价暂时不生效)。
 * - **绝不影响下单** —— 跟价源一个口径:展示侧降级,结算侧另有硬闸。
 *
 * ## ⚠️ 客户端组件不许 import 这个文件
 *
 * 它 import `@/db` ⇒ 进浏览器会炸。客户端要字典 ⇒ 由服务端父组件当
 * **props** 传下去(跟 `price-source.ts` 一个套路)。
 */

import { connection } from "next/server";
import { cache } from "react";

import { db } from "@/db";
import {
  productAccessory,
  productAccessoryOption,
  productAccessoryVariant,
  productSize,
} from "@/db/schema";
import { describeDbError } from "@/features/shared/lib/db-error";

import {
  type CatalogDictionary,
  type CatalogDictionaryDbRows,
  buildCatalogDictionaryFromCodeConstants,
  mergeCatalogDictionary,
} from "./catalog-dictionary";
import {
  type CatalogDictionaryView,
  toCatalogDictionaryView,
} from "./catalog-dictionary-view";

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * `applies_to_sizes_cm` 存的是 JSON 数组字符串(`"[]"` / `"[4]"`)
 *
 * ⚠️ 解析失败**不能抛** —— 一个手滑写坏的值不该让整份字典读不出来
 * (那会让后台改的加价全部失效)。解析不出来 ⇒ 当作「通用」(空数组),
 * 并记一条日志。
 */
function parseAppliesToSizesCm(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value)
    );
  } catch {
    console.warn(
      `[catalog] applies_to_sizes_cm 不是合法 JSON(${raw})—— 当作「通用尺寸」`
    );
    return [];
  }
}

/**
 * 一次 DB 读 —— **请求内只查一次**
 *
 * `cache()` 用 React 的(跟 `price-source.ts` / `pricing-store.ts` 一个套路)。
 * 跨请求不缓存 —— 后台改完字典要**立刻**生效。
 *
 * ⚠️ **`cache()` 是请求级的** —— 同一个请求里读第二次还是**第一次那份**。
 * 后台「改完字典 → 顺带重算 SKU 价」那条路必须读**新鲜的**(见
 * `getCatalogDictionaryFresh()`),否则会拿**改之前**的加价去重算。
 */
const readDictionaryRows = cache(fetchDictionaryRows);

/**
 * 真正查库的那一段 —— **不缓存**
 *
 * 拆成两层:`readDictionaryRows`(`cache()` 包着)= 请求内只查一次;
 * 这一层 = 不缓存,给「刚写完库要立刻读到新值」的那条路用。
 */
async function fetchDictionaryRows(): Promise<CatalogDictionaryDbRows> {
  const [sizeRows, accessoryRows, optionRows, variantRows] = await Promise.all([
    db
      .select({
        productTypeCode: productSize.productTypeCode,
        sizeCode: productSize.sizeCode,
        priceDeltaCents: productSize.priceDeltaCents,
        sortOrder: productSize.sortOrder,
        isActive: productSize.isActive,
      })
      .from(productSize),
    db
      .select({
        code: productAccessory.code,
        name: productAccessory.name,
        nameEn: productAccessory.nameEn,
        category: productAccessory.category,
        sortOrder: productAccessory.sortOrder,
        isActive: productAccessory.isActive,
      })
      .from(productAccessory),
    db
      .select({
        productTypeCode: productAccessoryOption.productTypeCode,
        accessoryCode: productAccessoryOption.accessoryCode,
        sortOrder: productAccessoryOption.sortOrder,
        isActive: productAccessoryOption.isActive,
      })
      .from(productAccessoryOption),
    db
      .select({
        productTypeCode: productAccessoryVariant.productTypeCode,
        accessoryCode: productAccessoryVariant.accessoryCode,
        variantCode: productAccessoryVariant.variantCode,
        name: productAccessoryVariant.name,
        nameEn: productAccessoryVariant.nameEn,
        swatch: productAccessoryVariant.swatch,
        priceDeltaCents: productAccessoryVariant.priceDeltaCents,
        sortOrder: productAccessoryVariant.sortOrder,
        appliesToSizesCm: productAccessoryVariant.appliesToSizesCm,
        isActive: productAccessoryVariant.isActive,
      })
      .from(productAccessoryVariant),
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
 * 「这一页不能静态渲染」—— **只在这一处说**
 *
 * `await connection()` 放在 `cache()` **外面** —— React 的 `cache()` 会把
 * 抛出来的值也缓存,放在里面的话动态渲染的信号会被缓存住。
 *
 * ## 为什么容忍「不在请求作用域里」
 *
 * `connection()` 在**没有任何请求作用域**时(脚本 / 单测直接调了它)是**抛错**
 * 的(`E251`)。那种场景下本来就不存在「构建期预渲染」这回事 ⇒ 继续往下走,
 * 别把调用方炸了。
 *
 * **构建期预渲染时它抛的是别的错**(`StaticGenBailoutError` / 挂起 promise)——
 * 那两个**必须往外抛**,它们就是「这一页别静态」的信号。
 */
async function optOutOfStaticRendering(): Promise<void> {
  try {
    await connection();
  } catch (error) {
    const code = (error as { __NEXT_ERROR_CODE?: unknown } | null)
      ?.__NEXT_ERROR_CODE;
    if (code !== "E251") throw error;
    console.warn(
      "[catalog] connection() 报 E251(不在请求作用域里)—— 继续读字典。" +
        "若这是构建期输出的,请检查这一页是不是被静态预渲染了" +
        "(尺寸加价会被烤进 HTML,后台改加价就不生效)。"
    );
  }
}

/**
 * 拿一份**完整的**商品目录字典 —— **调用它就意味着这一页不能静态渲染**
 *
 * 拿不到就**退回代码常量兜底**(整份退回,不是半份)⇒ 行为跟今天一模一样。
 *
 * ⚠️ **绝不抛** —— 字典读不出来不该让整个页面 500。
 */
export async function getCatalogDictionary(): Promise<CatalogDictionary> {
  await optOutOfStaticRendering();

  const fallback = buildCatalogDictionaryFromCodeConstants();
  try {
    const rows = await readDictionaryRows();
    return mergeCatalogDictionary(rows, fallback);
  } catch (error) {
    const info = describeDbError(error);
    console.error(
      "[catalog] 读商品目录字典失败,整份退回代码常量兜底:",
      info.message || error
    );
    return fallback;
  }
}

/**
 * 字典的**兜底** —— 不碰 DB 的那一份
 *
 * 给「拿不到字典」的地方用(比如纯函数测试、脚本)。
 */
export function getFallbackCatalogDictionary(): CatalogDictionary {
  return buildCatalogDictionaryFromCodeConstants();
}

/**
 * 拿一份**刚写完就能读到新值**的字典 —— **不缓存**
 *
 * ## 为什么需要它
 *
 * React 的 `cache()` 是**请求级**的:同一个请求里第一次读到什么,后面
 * 再读就是什么。
 *
 * 后台那条路正好踩这个坑:
 *
 * ```
 * 改尺寸加价 → 写库 → 顺带重算这个型号的 SKU 价
 *                              ↑ 这一步要读字典
 * ```
 *
 * 如果这一步读的是 `getCatalogDictionary()`,拿到的是**改之前**的加价 ⇒
 * **用旧价重算** ⇒ 改了加价,SKU 的绝对价还是老的 ⇒ 工作室看着像没生效。
 *
 * ⇒ 这条路用 `getCatalogDictionaryFresh()`(**不缓存**)。
 *
 * ⚠️ 兜底口径跟 `getCatalogDictionary()` **完全一致**(读失败就退回代码常量)
 * —— 两个函数只有「缓不缓存」这一个区别。
 */
export async function getCatalogDictionaryFresh(): Promise<CatalogDictionary> {
  await optOutOfStaticRendering();

  const fallback = buildCatalogDictionaryFromCodeConstants();
  try {
    const rows = await fetchDictionaryRows();
    return mergeCatalogDictionary(rows, fallback);
  } catch (error) {
    const info = describeDbError(error);
    console.error(
      "[catalog] 读商品目录字典失败(未缓存),整份退回代码常量兜底:",
      info.message || error
    );
    return fallback;
  }
}

/**
 * 拿一份**可序列化**的目录字典视图 —— 给客户端组件当 props 用
 *
 * `CatalogDictionary` 里装的是 `ReadonlyMap` ⇒ **过不了 RSC → client 的
 * props 边界** ⇒ 这里摊成纯数组。
 *
 * 兜底口径跟 `getCatalogDictionary()` **完全一致**(读失败就退回代码常量)
 * ⇒ 后台表单看到的清单,跟服务端算价用的清单是**同一份**。
 */
export async function getCatalogDictionaryView(): Promise<CatalogDictionaryView> {
  const dictionary = await getCatalogDictionary();
  return toCatalogDictionaryView(dictionary);
}
