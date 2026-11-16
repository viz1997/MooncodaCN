/**
 * 案例后台的**视图模型**
 *
 * ## 为什么单独一个文件
 *
 * 类型**不能**放在 `"use server"` 文件里 —— Turbopack 会把那个文件里的
 * 每一个 export 都注册成 server action,类型 re-export 会注册出一个不存在
 * 的 action,运行时 `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * 所以 `actions.ts` 只导出 async 函数,类型全在这个纯文件里。
 *
 * ## 入参是**结构化的**,不是 `ShowcaseCaseRecord`
 *
 * `ShowcaseCaseRecord` 住在 `@/features/showcase/lib/case-types`(它零 import,
 * 其实可以引)—— 但这里仍然用结构化的形状,理由跟 `coupon/admin/types.ts`
 * 一样:这个文件是**纯文件**,不跟任何具体实现绑死,单测能直接喂手写数据。
 */

/** 后台列表的一行 */
export type AdminShowcase = {
  id: string;
  /** 标题(中文) */
  title: string;
  /** 标题(英文)—— null = 英文站退回中文 */
  titleEn: string | null;
  /** 一句话说明(中文) */
  description: string | null;
  /** 一句话说明(英文) */
  descriptionEn: string | null;
  /** 成品图引用 —— **外链或 R2 对象键**,不是渲染用的地址 */
  coverUrl: string;
  /**
   * 成品图**能直接用的地址**(服务端解析好的)
   *
   * `coverUrl` 是「引用」(存进 DB 的那个),`coverSrc` 是「地址」(给 `<img src>` 的)。
   * 两者分开是因为:引用要能扛住 CDN 域名变更,地址不能。
   *
   * null = 这个引用解析不出来(不是外链、也不是合法的案例对象键)⇒ 界面不摆缩略图。
   */
  coverSrc: string | null;
  /** 原图引用 —— null = 没有 before/after 翻转 */
  beforeImageUrl: string | null;
  /** 原图能直接用的地址 —— null = 没有原图 / 解析不出来 */
  beforeSrc: string | null;
  /** 作者名(顾客昵称 / 「工作室实拍」) */
  authorName: string;
  /** 关联的型号 code —— null = 不摆型号徽标 */
  productTypeCode: string | null;
  /** 关联商品的 handle —— null = 点了不跳 */
  productHandle: string | null;
  /** 点赞数 —— 0 = 前台不显示 */
  likes: number;
  /** 排序值 —— 小的在前 */
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * 后台 action 的错误码
 *
 * **不 throw** —— throw 会被 next-safe-action 糊成「服务器错误」,工作室
 * 根本不知道是哪儿错了(表没建?引用的图片不合法?)。
 */
export type AdminShowcaseErrorCode =
  /** 改的这一行找不到了(可能被别人下架 / 删了) */
  | "CASE_NOT_FOUND"
  /** 入参不合法 —— 图片引用非法 / 标题为空 */
  | "INVALID_INPUT"
  /** 表还不存在 —— 迁移脚本没跑 */
  | "MIGRATION_MISSING"
  /** 其它失败 */
  | "SAVE_FAILED";

/** 写操作的统一返回 */
export type AdminShowcaseWriteResult =
  | { ok: true }
  | { ok: false; code: AdminShowcaseErrorCode };

/** 读列表的返回 —— 表还没建时是一个 code,不是一个空数组 */
export type AdminShowcaseListResult =
  | { ok: true; cases: AdminShowcase[] }
  | { ok: false; code: AdminShowcaseErrorCode };

/**
 * DB 行 → 后台列表的一行(入参)
 *
 * 结构上跟 `ShowcaseCaseRecord` **完全兼容** —— 传进去就行。
 */
export interface AdminShowcaseSource {
  id: string;
  title: string;
  titleEn: string | null;
  description: string | null;
  descriptionEn: string | null;
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
 * DB 行 → 后台列表的一行
 *
 * `resolved` 是**服务端解析好的图片地址** —— 解析那一层是服务端专用
 * (`case-image.ts` import 了 R2),客户端组件不能自己算。
 */
export function toAdminShowcase(
  source: AdminShowcaseSource,
  resolved?: { coverSrc?: string | null; beforeSrc?: string | null }
): AdminShowcase {
  return {
    id: source.id,
    title: source.title,
    titleEn: source.titleEn,
    description: source.description,
    descriptionEn: source.descriptionEn,
    coverUrl: source.coverUrl,
    coverSrc: resolved?.coverSrc ?? null,
    beforeImageUrl: source.beforeImageUrl,
    beforeSrc: resolved?.beforeSrc ?? null,
    authorName: source.authorName,
    productTypeCode: source.productTypeCode,
    productHandle: source.productHandle,
    likes: Math.max(0, Math.floor(source.likes)),
    sortOrder: Math.floor(source.sortOrder),
    isActive: source.isActive,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}
