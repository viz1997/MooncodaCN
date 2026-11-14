/**
 * 商品目录的「后台配置」—— 纯类型
 *
 * ## 为什么要有这个类型
 *
 * 2026-11-08 那次把**价**接到了 DB(`price-source-types.ts`)。2026-11-14
 * 工作室要求把**目录本身**也接上 ——「电商产品获取后台配置管理好的产品」:
 * 后台 `/admin/products` 里把某个型号**下架**,商城就该看不到它;改了**名字**
 * / **排序**,商城就该跟着变。
 *
 * 这份类型说的是:**后台配置下来的那些东西**。
 *
 * ## 它跟 `PriceSource` 的关系
 *
 * 两份来源是**同一个 DB 读**里拿到的(`product` 表的两组列),但**口径不一样**:
 *
 * | | `PriceSource` | `CatalogSource`(本文件) |
 * |---|---|---|
 * | 键 | 型号 code | 型号 code |
 * | 值的粒度 | 价 | 上架状态 / 名字 / 排序 |
 * | 缺一行时 | 退回代码常量的价 | **当作上架**(回退代码默认) |
 * | 读失败时 | `degraded = true` | `degraded = true` |
 *
 * 两者**都不许加必填字段** —— `db-price.test.ts` 里的 `priceSourceWith()`
 * 手写了一个 `PriceSource` 字面量,加必填字段会当场编译不过。
 *
 * ## 为什么单独一个文件
 *
 * `price-source.ts` 要 import `@/db`(那是服务端的事)。这个文件是**纯类型**,
 * 客户端组件可以安全 `import type` —— 类型 import 在编译期就被抹掉,
 * 不会把 `@/db` 拖进任何客户端 bundle。
 */

/**
 * DB `product.status` 的取值
 *
 * ⚠️ **故意是 `string` 而不是 `"active" | "inactive"`** ——
 * Drizzle 的 `text(..., { enum })` 只在 TS 层收窄,**DB 里没有 CHECK 约束**
 * ⇒ 那一列可以是任意字符串。
 *
 * 判定口径见 `catalog-apply.ts` 的 `isCatalogTypeActive()`:
 * **只有 `status === "active"` 才上架**(跟小程序那条链路
 * `image-gen/lib/product-capability.ts` 一个口径 —— 它是
 * `status !== "active"` 就跳过)。
 */

/** DB 的一行 —— 只声明这个模块用得到的字段 */
export interface CatalogTypeRow {
  /** 型号 code(R / A / P / RM / LB / M)—— join key */
  readonly code: string;
  /** 型号名(中文) */
  readonly name: string;
  /** 型号名(英文) */
  readonly nameEn: string;
  /** 上架状态 —— 见上面那个说明 */
  readonly status: string;
  /** 数字越小越靠前(后台自己填) */
  readonly sortOrder: number;
  /** 强调色 */
  readonly accent: string;
}

/** 一个型号的后台配置 */
export interface CatalogTypeConfig {
  /** 型号 code */
  readonly code: string;
  /** 型号名(中文)—— **空 ⇒ 用代码常量**(`null` 表示「没配」) */
  readonly name: string | null;
  /** 型号名(英文)—— 同上 */
  readonly nameEn: string | null;
  /** 上架状态 —— 原样存,判定在 `isCatalogTypeActive()` */
  readonly status: string;
  /** 数字越小越靠前 */
  readonly sortOrder: number;
  /** 强调色 —— **空 ⇒ 用代码常量** */
  readonly accent: string | null;
}

/** 商品目录的「后台配置」快照 */
export interface CatalogSource {
  /**
   * 型号 code → 后台配置
   *
   * **稀疏的** —— DB 里有的型号才有键。**没有键 = 这个型号没被后台管过**
   * ⇒ 一切按代码常量走(上架、原序、原名)。
   */
  readonly types: ReadonlyMap<string, CatalogTypeConfig>;
  /**
   * DB **读失败**了 —— 这份配置可能不完整。
   *
   * 跟 `PriceSource.degraded` 一个口径:展示的地方可以降级,
   * **收钱的地方不许降级**(那一边看 `PriceSource`)。
   */
  readonly degraded: boolean;
  /** 读失败的原因(给日志 / 排查用);没失败是 null */
  readonly readError: string | null;
}
