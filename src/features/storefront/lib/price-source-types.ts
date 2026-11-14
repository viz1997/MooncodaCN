/**
 * 价格源 —— 「这批价是从哪儿来的」的一份快照
 *
 * ## 为什么要有这个类型
 *
 * `calculatePricing()` 是**同步纯函数** —— 它不查库,所以它自己拿不到 DB 里
 * 的价。价从 DB 进到定价函数里靠的就是这个对象:**外面查好,当参数传进去**。
 *
 * 纯函数那一半(`pricing.ts`)因此**不 import `@/db`** —— 它还能进 unit
 * project 跑单测,客户端组件也能安全 import 它的类型。
 *
 * ## 里面装的是「DB 覆盖值」,不是「最终的价」
 *
 * 查不到就**没有那个键** —— 调用方 `??` 退回代码常量
 * (`BASE_PRICE_CENTS` / `PRODUCT_ACCESSORY_VARIANTS`)。
 *
 * 所以这两个 Map 是**稀疏的**:DB 里有的型号 / 变体才有键。
 *
 * ## 为什么单独一个文件
 *
 * `price-source.ts` 要 import `@/db`(那是服务端的事)。而 `pricing.ts`
 * 要用 `PriceSource` 这个**类型**。类型住在纯文件里,`pricing.ts` 就可以
 * 只 `import type` —— 类型 import 在编译期就被抹掉,不会把 `@/db` 拖进
 * 任何客户端 bundle。
 */

import type { AccessoryGroup, AccessoryVariant, Size } from "../types";

/** 产品码(R / A / P / RM / LB / M)→ 基础价(分) */
export type BasePriceMap = ReadonlyMap<string, number>;

/**
 * 配件变体 id → 加价(分)
 *
 * 键是 **`acc_${variantCode}`** —— 跟 `spec.accessoryVariantIds` 里那个
 * 字符串**一模一样**(`mock-catalog.ts` 的 `findAccessoryVariant` 就是这么
 * 拼的)。
 *
 * 不变式:`variantCode` **全局唯一** —— 一旦哪天同一个 `variantCode` 挂在
 * 两个型号下,这个 Map 就会「取到哪个算哪个」。
 */
export type AccessoryDeltaMap = ReadonlyMap<string, number>;

/* -------------------------------------------------------------------------- */
/*  目录字典(尺寸 / 配件)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 一个型号「能卖什么」—— 尺寸档 + 配件分组
 *
 * ⚠️ 这里的 `Size` / `AccessoryGroup` **就是商城自己的那套形状**
 * (`src/features/storefront/types.ts`)⇒ 目录字典覆盖上去之后,商城页面上
 * 渲染的、结算时算的,是**同一份数据**。
 */
export interface PriceCatalogType {
  /** 该型号的尺寸档(字典顺序) */
  readonly sizes: readonly Size[];
  /** 该型号的配件分组(字典顺序) */
  readonly accessoryGroups: readonly AccessoryGroup[];
}

/**
 * 整份目录字典 —— 型号 → 能卖什么
 *
 * ## 为什么要有它
 *
 * 尺寸 / 配件 / 加价以前住在**代码常量**里(`PRODUCT_TYPES` /
 * `PRODUCT_ACCESSORY_VARIANTS`),后台改不了。今天它们搬进 DB 了
 * (`catalog-dictionary.ts`),**显示的那条路**和**算钱的那条路**必须读
 * **同一份** —— 否则就会出现「页面显示 +¥5、结算按 +¥10 收」。
 *
 * ⇒ 这份目录进到 `PriceSource` 里,`pricing.ts` 跟
 * `storefront-catalog.ts` 都从这儿取。
 *
 * ## 那两张平铺的 Map 是干什么的
 *
 * - `sizesById` —— 按 `sizeId`(`size_R_4`)查。**跨型号**查,因为规格里
 *   传的就是 id,先按 id 找到、再判「适不适用于这个型号」。
 * - `variantsById` —— 按 `acc_${variantCode}` 查。不变式:`variantCode`
 *   **全局唯一**,所以这个键不会撞。
 */
export interface PriceCatalog {
  /** 型号 → 能卖什么 */
  readonly byType: ReadonlyMap<string, PriceCatalogType>;
  /** 尺寸 id(`size_R_4`)→ 尺寸(跨型号) */
  readonly sizesById: ReadonlyMap<string, Size>;
  /** 配件变体 id(`acc_leather_brown`)→ 变体(跨型号) */
  readonly variantsById: ReadonlyMap<string, AccessoryVariant>;
}

export interface PriceSource {
  /** 产品码 → 基础价(分) */
  readonly basePriceCentsByTypeCode: BasePriceMap;
  /** 配件变体 id(`acc_leather_brown`)→ 加价(分) */
  readonly accessoryDeltaCentsByVariantId: AccessoryDeltaMap;
  /**
   * 目录字典(DB 里的尺寸 / 配件 / 加价)。
   *
   * ⚠️ **可选** —— 不是所有构造 `PriceSource` 的地方都带得动它
   * (`db-price.test.ts` 里那个手写字面量就没有)。**没有它 ⇒ 退回代码常量**
   * (`mock-catalog.ts` 那套静态目录),行为跟改造前一样。
   *
   * ⚠️ **不许改成必填** —— 那会让所有手写 `PriceSource` 字面量的地方
   * 当场编译不过(见本文件上方的约定)。
   */
  readonly catalog?: PriceCatalog | null;
  /**
   * DB **读失败**了 —— 这份价可能不完整 / 不准。
   *
   * 展示的地方可以降级(显示代码常量的价,加一条日志);
   * **收钱的地方不许降级** —— 宁可下不了单,也不能按一个已经作废的价收钱。
   */
  readonly degraded: boolean;
  /** 读失败的原因(给日志 / 排查用);没失败是 null */
  readonly readError: string | null;
}
