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

export interface PriceSource {
  /** 产品码 → 基础价(分) */
  readonly basePriceCentsByTypeCode: BasePriceMap;
  /** 配件变体 id(`acc_leather_brown`)→ 加价(分) */
  readonly accessoryDeltaCentsByVariantId: AccessoryDeltaMap;
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
