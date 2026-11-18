/**
 * 「淘宝链接」后台的**视图模型**
 *
 * ## 为什么单独一个文件
 *
 * 类型**不能**放在 `"use server"` 文件里 —— Turbopack 会把那个文件里的
 * 每一个 export 都注册成 server action,类型 re-export 会注册出一个不存在
 * 的 action,运行时 `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * ## 为什么零 DB 依赖
 *
 * `AdminTaobaoLinkSource` 是**结构化接口**(不是 `ProductTaobaoLinkRow`)——
 * 跟 `features/coupon/admin/types.ts` 一个套路 ⇒ 这个文件不 import `@/db`
 * ⇒ 能进 vitest 的 `unit` project 直接测。
 *
 * ## 一行 = 一件**设计**
 *
 * 商城卖的是 12 件设计(4 钥匙扣 + 4 手办 + 4 冰箱贴),不是 6 个型号 ——
 * 淘宝那边**每个设计一个链接** ⇒ 链接挂在 handle 上。
 * ⇒ 后台这一页列的是** designs **,每行一个,「配没配 / 编辑 / 启用停用」
 * 都在这一行上就地做(工作室的口径:配置界面在页面上直接处理,不开弹窗)。
 */

/**
 * 后台错误码 —— 界面按码查文案
 *
 * - `EMPTY` / `INVALID_URL` / `NOT_TAOBAO` / `NO_ITEM_ID` —— 链接本身不合格
 *   (跟 `taobao-link.ts` 的 `TaobaoUrlProblem` 一一对应)
 * - `DESIGN_NOT_FOUND` —— 填的 handle 不在商城目录里
 * - `LINK_NOT_FOUND` —— 要改 / 要停用的那一行找不到了
 * - `MIGRATION_MISSING` —— 迁移脚本还没跑(表不在)
 * - `SAVE_FAILED` —— 其它
 */
export type AdminTaobaoErrorCode =
  | "EMPTY"
  | "INVALID_URL"
  | "NOT_TAOBAO"
  | "NO_ITEM_ID"
  | "DESIGN_NOT_FOUND"
  | "LINK_NOT_FOUND"
  | "MIGRATION_MISSING"
  | "SAVE_FAILED";

/**
 * 错误码 → i18n key
 *
 * **一张表** —— 别写 if-else 链。缺一个 key,`/en` 的后台就会漏中文。
 */
export const TAOBAO_ERROR_TEXT_KEYS: Record<AdminTaobaoErrorCode, string> = {
  EMPTY: "errors.EMPTY",
  INVALID_URL: "errors.INVALID_URL",
  NOT_TAOBAO: "errors.NOT_TAOBAO",
  NO_ITEM_ID: "errors.NO_ITEM_ID",
  DESIGN_NOT_FOUND: "errors.DESIGN_NOT_FOUND",
  LINK_NOT_FOUND: "errors.LINK_NOT_FOUND",
  MIGRATION_MISSING: "errors.MIGRATION_MISSING",
  SAVE_FAILED: "errors.SAVE_FAILED",
};

/**
 * 商城里的一件设计 —— 后台这一页列的就是它们
 *
 * 字段跟 `StorefrontProduct` 对得上 ⇒ 可以直接把 `MOCK_PRODUCTS` 传进来。
 */
export interface TaobaoDesignRef {
  handle: string;
  title: string;
  titleEn: string;
  typeLabel: string;
  typeLabelEn: string;
  seriesName: string;
  seriesNameEn: string;
}

/**
 * 库里那一条链接(**可能压根没有** —— 没配过的设计在表里没有行)
 */
export interface AdminTaobaoLinkSource {
  productHandle: string;
  url: string;
  itemId: string | null;
  note: string | null;
  isActive: boolean;
  updatedAt: Date | null;
}

/**
 * 后台表格的一行
 *
 * **`hasLink` 跟 `url` 分开** —— 「没配过」和「配了但被停用」是两件事,
 * 界面要给两句不同的话。
 */
export interface AdminTaobaoLinkRow {
  /** 商城那件设计的 handle —— 跟 `storefront_order_item.product_handle` 同一个字符串 */
  productHandle: string;
  title: string;
  titleEn: string;
  typeLabel: string;
  typeLabelEn: string;
  seriesName: string;
  seriesNameEn: string;
  /** 配没配链接(表里有没有这一行) */
  hasLink: boolean;
  /** 淘宝链接 —— 没配是 null */
  url: string | null;
  /** 淘宝商品 id —— 抠不出来是 null */
  itemId: string | null;
  /** 工作室自己写的备注 */
  note: string | null;
  /** 启用中?没配过链接时是 false */
  isActive: boolean;
  /** 最后一次改的时间(ISO 字符串)—— 没配过是 null */
  updatedAt: string | null;
}

/**
 * 把「设计 + 库里那条链接」拼成表格的一行
 *
 * 纯函数 —— 不碰 DB、不碰网络 ⇒ 能进 unit project。
 */
export function toAdminTaobaoLinkRow(
  design: TaobaoDesignRef,
  link: AdminTaobaoLinkSource | null
): AdminTaobaoLinkRow {
  return {
    productHandle: design.handle,
    title: design.title,
    titleEn: design.titleEn,
    typeLabel: design.typeLabel,
    typeLabelEn: design.typeLabelEn,
    seriesName: design.seriesName,
    seriesNameEn: design.seriesNameEn,
    hasLink: Boolean(link),
    url: link?.url ?? null,
    itemId: link?.itemId ?? null,
    note: link?.note ?? null,
    isActive: link?.isActive ?? false,
    updatedAt: link?.updatedAt ? link.updatedAt.toISOString() : null,
  };
}

/**
 * 把 12 件设计 + 库里那些链接拼成完整的表格
 *
 * ⚠️ **只列商城目录里的设计** —— 表里有、设计没了的行(下架的设计)
 * **不列**。理由:后台这一页是「给哪件设计配链接」,摆一个买不到的设计
 * 在这儿只会让工作室以为还能配。
 */
export function buildTaobaoLinkRows(
  designs: readonly TaobaoDesignRef[],
  links: readonly AdminTaobaoLinkSource[]
): AdminTaobaoLinkRow[] {
  const byHandle = new Map<string, AdminTaobaoLinkSource>();
  for (const link of links) byHandle.set(link.productHandle, link);

  return designs.map((design) =>
    toAdminTaobaoLinkRow(design, byHandle.get(design.handle) ?? null)
  );
}

/** 列表 action 的返回 */
export type AdminTaobaoLinkListResult =
  | { ok: true; rows: AdminTaobaoLinkRow[] }
  | { ok: false; code: AdminTaobaoErrorCode };

/**
 * 写操作的返回
 *
 * **不 throw** —— throw 会被 next-safe-action 糊成「服务器错误」,工作室根本
 * 不知道是哪儿错了。跟 `features/coupon/admin/actions.ts` 同一个方言。
 */
export type AdminTaobaoLinkWriteResult =
  | { ok: true }
  | { ok: false; code: AdminTaobaoErrorCode };
