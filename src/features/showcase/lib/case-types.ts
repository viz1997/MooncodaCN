/**
 * 真实案例的**纯类型** —— 零 import
 *
 * ## 为什么单独一个文件
 *
 * 这一层**不碰数据库、不碰 R2、不碰 i18n** ⇒ 能进 vitest 的 `unit` project
 * (只有 `src/test/` 底下 `pure/` 那一个 project 会跑它),单测可以直接拿手
 * 写的数据喂纯函数,不用起数据库。
 *
 * 同样的道理,`admin/types.ts` 也是纯文件 —— 类型**不能**放在
 * `"use server"` 文件里(Turbopack 会把它注册成 server action,运行时
 * `ReferenceError` → 整页 500)。
 *
 * ## 一份数据,三种形状
 *
 * | 形状 | 谁用 | 说明 |
 * |---|---|---|
 * | `ShowcaseCaseRecord` | 服务端读库 | DB 那一行 |
 * | `ShowcaseCase` | 前台摆 | 图片**已经解析成能用的地址** |
 * | `ShowcaseCaseInput` | 后台写 | 存进去的那些字段 |
 */

/** 前台的语言 —— 只两种 */
export type ShowcaseLocale = "zh" | "en";

/**
 * DB 那一行 —— **结构化的**,不是 `StorefrontCaseRow`
 *
 * 那个类型住在 `@/db/schema`(它 import `drizzle-orm`),把它拖进来这个文件
 * 就进不了 `unit` project 了。`StorefrontCaseRow` 本身**结构上兼容**这个
 * 入参。
 */
export interface ShowcaseCaseRecord {
  id: string;
  title: string;
  titleEn: string | null;
  description: string | null;
  descriptionEn: string | null;
  /** 外链或 R2 对象键 —— **不是**渲染用的地址 */
  coverUrl: string;
  beforeImageUrl: string | null;
  authorName: string;
  productTypeCode: string | null;
  productHandle: string | null;
  likes: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 前台摆的一条 —— 图片**已经解析成能用的地址**
 *
 * `coverSrc` 是给 `<img src>` 的;`beforeSrc` 没有原图时是 `null`
 * (前台就不摆 before/after 翻转指示)。
 */
export interface ShowcaseCase {
  id: string;
  /** 标题(按语言挑好的) */
  title: string;
  /** 一句话说明(按语言挑好的);空串 = 不摆那行字 */
  description: string;
  /** 作者名(顾客昵称 / 「工作室实拍」) */
  authorName: string;
  /** 商品型号 —— 案例角上的小徽标;null = 不摆徽标 */
  productTypeCode: string | null;
  /** 关联商品 handle —— 点了能跳到那件商品;null = 不跳 */
  productHandle: string | null;
  /** 点赞数 —— 0 = 不显示 */
  likes: number;
  /** 成品图地址 */
  coverSrc: string;
  /** 原图地址 —— null = 没有 before/after 翻转 */
  beforeSrc: string | null;
}

/** 后台写操作的入参 —— 存进去的那些字段 */
export interface ShowcaseCaseInput {
  /** 有 id = 改这一行;null = 新增 */
  id: string | null;
  title: string;
  titleEn: string | null;
  description: string | null;
  descriptionEn: string | null;
  /** 外链或 R2 对象键 */
  coverUrl: string;
  beforeImageUrl: string | null;
  authorName: string;
  productTypeCode: string | null;
  productHandle: string | null;
  likes: number;
  sortOrder: number;
  isActive: boolean;
}
