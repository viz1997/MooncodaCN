import { permanentRedirect } from "next/navigation";

/**
 * `/marketing/products` —— 旧地址,2026-11-13 起 308 跳到 `/products`。
 *
 * 作品集从 `/marketing/products` 搬到 `/products`(真目录归位到该占的地址 ——
 * 模板那套 6 件写死的演示数据把 `/products` 占着)。老地址不能断:已经被搜索
 * 引擎收录,也被分享过。
 *
 * 用 `permanentRedirect` 而不是 `redirect`:这是**永久搬家**,308 才能让搜索
 * 引擎把权重转给新地址;307 会被当成临时跳转,权重不转移。
 *
 * 用 `next/navigation` 的 `permanentRedirect` 而不是 `@/i18n/routing` 里那个:
 * 后者是从 `next-intl/navigation` 导出的,那个入口在 client 组件里解析到的是
 * react-client 版本(没有 `permanentRedirect`),放进共享模块会在打包时炸。
 * 这里手写 locale 前缀 —— `localePrefix` 是默认的 `always`,URL 一定带前缀。
 */
export default async function LegacyMarketingProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/products`);
}
