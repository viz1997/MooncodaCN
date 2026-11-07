import { permanentRedirect } from "next/navigation";

/**
 * `/pricing` —— 旧地址,2026-11-01 起 308 跳到 `/tools/workbench`。
 *
 * 克重计算器从「商城里的一个品类」改成了「工具中心里的一个工具」,导航只留
 * 一个「工具」入口。老地址不能断 —— 已经被搜索引擎收录,也被分享过。
 *
 * 用 `permanentRedirect` 而不是 `redirect`:这是**永久搬家**,308 才能让搜索
 * 引擎把权重转给新地址;307 会被当成临时跳转,权重不转移。
 *
 * 用 `next/navigation` 的 `permanentRedirect` 而不是 `@/i18n/routing` 里那个:
 * 后者是从 `next-intl/navigation` 导出的,那个入口在 client 组件里解析到的是
 * react-client 版本(没有 `permanentRedirect`),放进共享模块会在打包时炸。
 * 这里手写 locale 前缀 —— `localePrefix` 是默认的 `always`,URL 一定带前缀。
 */
export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/tools/workbench`);
}
