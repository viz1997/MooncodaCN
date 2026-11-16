/**
 * 案例图片引用的**服务端解析**
 *
 * ## 为什么图片不直接存地址
 *
 * `storefront_case.cover_url` 那一列装的是**外链** **或** **R2 对象键**,
 * 不是渲染用的最终地址。理由:
 *
 * - **换 CDN 域名不用改库** —— 域名写在 `R2_PUBLIC_BASE_URL` 里,改环境变量
 *   就够了;要是把最终地址烤进 DB,换一次域名要 UPDATE 每一行。
 * - **外链也得支持** —— 工作室可能直接把微信相册里的图贴进来(他们不一定
 *   每张都传到我们自己的桶)。
 *
 * ## 两条路
 *
 * | 引用 | 解析成 |
 * |---|---|
 * | `https://…` | 原样(外链不归我们管) |
 * | R2 对象键 | 配了公开域名 ⇒ `R2_PUBLIC_BASE_URL/<key>`;没配 ⇒ `/api/showcase/image?key=…`(签名跳转) |
 *
 * ⚠️ **没配 `R2_PUBLIC_BASE_URL` 时不能用 `getPublicUrl()` 的返回值** ——
 * 那会退化成 S3 API 地址(`https://<account>.r2.cloudflarestorage.com/…`),
 * 那个地址在浏览器里**打不开**(要签名),拿它当 `<img src>` 就是一个裂图。
 * 所以那时候走签名跳转路由。
 *
 * ## 这一层是**服务端专用**
 *
 * 它 import 了 `r2.ts`(那个文件读 `R2_*` 环境变量、还带 AWS SDK)⇒
 * 客户端组件不许 import 它。前台要拿地址,走服务端那一层(`showcase-catalog.ts`)
 * 已经解析好了。
 */

import { getPublicUrl, hasPublicBase } from "@/features/image-gen/lib/r2";

import { isExternalImageRef, normalizeImageRef } from "./case-apply";
import { SHOWCASE_OBJECT_PREFIX } from "./upload-key";

/**
 * 案例图片在桶里的**前缀**
 *
 * ⚠️ 对象键必须落在这个前缀下 —— 签名跳转路由(`/api/showcase/image`)
 * 会拿 `key` 去签一个下载 URL,**不限前缀就等于把整个桶变成公开下载站**。
 *
 * 前缀**只在 `upload-key.ts` 里定义一次** —— 生成(`buildShowcaseObjectKey`)
 * 和校验(这儿)必须用同一个字符串。
 */
export { SHOWCASE_OBJECT_PREFIX };

/**
 * 签名跳转路由 —— 没配公开域名时的兜底
 *
 * ⚠️ **不带 locale 前缀** —— API 路由住在 `src/app/api/**`,不在 `[locale]`
 * 底下;`proxy.ts` 对 `/api/**` 直接 `NextResponse.next()`,不走 intl 中间件。
 */
export const SHOWCASE_IMAGE_ROUTE = "/api/showcase/image";

/**
 * 这是不是一个**合法的案例对象键**
 *
 * 三个条件:落在这个前缀下 / 不含 `..` / 没有协议头。
 */
export function isShowcaseObjectKey(raw: string | null | undefined): boolean {
  const key = (raw ?? "").trim();
  if (!key) return false;
  if (!key.startsWith(SHOWCASE_OBJECT_PREFIX)) return false;
  if (key.includes("..")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(key)) return false;
  return true;
}

/**
 * 解析一个图片引用 → 给 `<img src>` 用的地址
 *
 * 解析不出来(引用非法 / 不是案例对象键)⇒ 返 `null` —— 调用方**不摆这一条**,
 * 而不是摆一个裂图。
 */
export function resolveShowcaseImageSrc(
  raw: string | null | undefined
): string | null {
  const ref = normalizeImageRef(raw);
  if (!ref) return null;

  // 外链 —— 原样用
  if (isExternalImageRef(ref)) return ref;

  // 对象键 —— 必须落在这个前缀下
  if (!isShowcaseObjectKey(ref)) return null;

  // 配了公开域名 ⇒ 直接给 CDN 地址(浏览器自己去拿,不用经过我们)
  if (hasPublicBase()) return getPublicUrl(ref);

  // 没配 ⇒ 签名跳转(那条路由签一个短时效的下载 URL 再 302)
  return `${SHOWCASE_IMAGE_ROUTE}?key=${encodeURIComponent(ref)}`;
}
