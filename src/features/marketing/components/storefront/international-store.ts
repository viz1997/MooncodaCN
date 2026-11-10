/**
 * 海外独立站入口的可见性判定 —— **纯函数**(两个地方共用一份)
 *
 * ## 为什么单独抽一个文件
 *
 * 公告条(`international-store-bar.tsx`,server component)和导航按钮
 * (`wjp-store-header.tsx`,client component)都要判断「这条入口要不要出现」。
 * 两处各写一遍 `locale === "en" && url !== ""` 迟早会漂 —— 有一处忘了判,
 * 中文站上就冒出一条「请去境外店买」的条子。
 *
 * 抽成纯函数之后:
 *
 * - 判定逻辑**能进 `unit` project 跑单测**(不用起浏览器、不用连库)
 * - 两处共用**同一份**判断,不可能漂
 *
 * ## 判定口径
 *
 * 两个条件**都要**满足:
 *
 * 1. **英文站**(`locale === "en"`)—— 中文站的访客看到的境内价格、境内物流、
 *    境内客服就是给他准备的,挂一条「请去境外店」是添乱。
 * 2. **配了地址** —— 宁可没有入口,也不要一条指向空地址的死链。
 */

/**
 * 海外独立站入口要不要出现
 *
 * @param locale 当前 locale(只有 `"en"` 才出现)
 * @param url    独立站地址(来自 `siteConfig.internationalStoreUrl`)
 */
export function shouldShowInternationalStore(
  locale: string,
  url: string
): boolean {
  return locale === "en" && url.trim() !== "";
}
