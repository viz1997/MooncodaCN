/**
 * 真实案例的**纯函数** —— 零 import
 *
 * ## 为什么全在这一层
 *
 * 这一层**不碰数据库、不碰 R2、不碰 i18n** ⇒ 能进 vitest 的 `unit` project,
 * 单测直接喂手写的数据。跟仓库里 `catalog-apply.ts` / `coupon-calc.ts` 一个
 * 路子(那些文件也是「纯函数住在 `features/` 下的 `lib/` 里,连库那一半在
 * 另一个文件」)。
 *
 * ## 三件事
 *
 * 1. **挑文案** —— 中英两份,按 locale 挑一份;英文那份空 ⇒ 退回中文。
 * 2. **收拾图片引用** —— 一列里装的是「外链」**或**「R2 对象键」,这一层
 *    把它归一化,并**挡掉危险协议**。
 * 3. **排序 + 投影** —— DB 那一行 → 前台摆的那一条。
 */

import type {
  ShowcaseCase,
  ShowcaseCaseRecord,
  ShowcaseLocale,
} from "./case-types";

/* -------------------------------------------------------------------------- */
/*  文案                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 中英两份里挑一份
 *
 * **英文那份空 ⇒ 退回中文** —— 后台不填英文很常见(工作室先出中文版),
 * 前台不能因此在英文站上出现一个空标题。
 */
export function pickLocaleText(
  zh: string | null | undefined,
  en: string | null | undefined,
  locale: ShowcaseLocale
): string {
  const primary = locale === "en" ? en : zh;
  const fallback = locale === "en" ? zh : en;
  return (primary ?? "").trim() || (fallback ?? "").trim();
}

/* -------------------------------------------------------------------------- */
/*  图片引用                                                                    */
/* -------------------------------------------------------------------------- */

/** 外链的最大长度 —— 2000 字符够任何 CDN 地址 */
const MAX_IMAGE_REF_LENGTH = 2000;

/**
 * 这是不是一个**外链**
 *
 * 只认 `http://` / `https://` —— 别的协议(`javascript:` / `data:` /
 * `file:`)一律不认。
 */
export function isExternalImageRef(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /^https?:\/\//i.test(raw.trim());
}

/**
 * 归一化一个图片引用
 *
 * 接受两种东西:
 *
 * - **外链** —— `https://…`(工作室自己的 CDN / 微信相册);
 * - **R2 对象键** —— `showcases/2026-11-16/abc.webp`。
 *
 * 其它的一律**拒掉**(返 null):
 *
 * - `javascript:` / `data:` 这类协议 —— 这个值最后会进 `<img src>`,
 *   `javascript:` 在某些上下文里能执行脚本;
 * - 含 `..` 的键 —— 那是路径穿越,对象键里不该有;
 * - 超长的 —— 正常地址都短得很。
 */
export function normalizeImageRef(
  raw: string | null | undefined
): string | null {
  const ref = (raw ?? "").trim();
  if (!ref) return null;
  if (ref.length > MAX_IMAGE_REF_LENGTH) return null;
  if (isExternalImageRef(ref)) return ref;
  // 不是外链 ⇒ 只能是对象键
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return null; // javascript: / data: / file:
  if (ref.includes("..")) return null;
  return ref;
}

/* -------------------------------------------------------------------------- */
/*  排序                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 案例的顺序 —— **三档,都有确定的兜底**
 *
 * 1. `sortOrder` 小的在前(工作室在后台自己排的序);
 * 2. 同序 ⇒ **点赞多的在前**(沿用以前案例墙的老口径);
 * 3. 还同 ⇒ **新的在前**。
 *
 * ⚠️ 不能用 `Infinity` 当「没有排序值」—— 两个都没有的行一比就是
 * `Infinity - Infinity = NaN` ⇒ 比较函数返 `NaN` ⇒ 排序行为未定义。
 * 那一档落到 `likes` / `createdAt` 上,所以压根不需要那个哨兵值。
 */
export function sortShowcaseRecords(
  records: ShowcaseCaseRecord[]
): ShowcaseCaseRecord[] {
  return [...records].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.likes !== b.likes) return b.likes - a.likes;
    const aTime = a.createdAt.getTime();
    const bTime = b.createdAt.getTime();
    if (aTime !== bTime) return bTime - aTime;
    return a.id.localeCompare(b.id);
  });
}

/* -------------------------------------------------------------------------- */
/*  投影                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 把图片引用解析成能用的地址
 *
 * 服务端实现(`case-image.ts`)要么给 CDN 公开地址,要么给签名跳转路由;
 * 单测可以塞一个恒等函数。
 */
export type ShowcaseImageResolver = (ref: string) => string | null;

/**
 * DB 那一行 → 前台摆的那一条
 *
 * ## 图片解析失败怎么办
 *
 * `coverSrc` 解析不出来(引用被手改成非法值 / 对象不存在)⇒ **这一条不摆**,
 * 返 `null`。案例墙上一个空盒子比不摆更难看。
 *
 * `beforeSrc` 解析不出来 ⇒ 只当**没有原图**(返 null),成品照摆 ——
 * before/after 翻转是锦上添花,不是必需品。
 */
export function toShowcaseCase(
  record: ShowcaseCaseRecord,
  locale: ShowcaseLocale,
  resolveSrc: ShowcaseImageResolver
): ShowcaseCase | null {
  const coverRef = normalizeImageRef(record.coverUrl);
  if (!coverRef) return null;

  const coverSrc = resolveSrc(coverRef);
  if (!coverSrc) return null;

  const beforeRef = normalizeImageRef(record.beforeImageUrl);
  const beforeSrc = beforeRef ? resolveSrc(beforeRef) : null;

  return {
    id: record.id,
    title: pickLocaleText(record.title, record.titleEn, locale),
    description: pickLocaleText(
      record.description,
      record.descriptionEn,
      locale
    ),
    authorName: record.authorName.trim(),
    productTypeCode: record.productTypeCode,
    productHandle: record.productHandle,
    likes: Math.max(0, Math.floor(record.likes)),
    coverSrc,
    beforeSrc,
  };
}

/**
 * 一批记录 → 前台摆的那一批
 *
 * **顺序**:先按 `sortShowcaseRecords()` 排,再投影,再截前 `limit` 条。
 * 投影会把解析失败的条目剔掉 —— 所以**先排后截**,否则剔掉之后可能不足
 * `limit` 条(页面上那一格就空了一个位置)。
 */
export function toShowcaseCases(
  records: ShowcaseCaseRecord[],
  locale: ShowcaseLocale,
  resolveSrc: ShowcaseImageResolver,
  limit?: number
): ShowcaseCase[] {
  const sorted = sortShowcaseRecords(records);
  const out: ShowcaseCase[] = [];
  for (const record of sorted) {
    if (limit !== undefined && out.length >= limit) break;
    const projected = toShowcaseCase(record, locale, resolveSrc);
    if (projected) out.push(projected);
  }
  return out;
}
