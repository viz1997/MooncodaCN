import { permanentRedirect } from "next/navigation";

/**
 * `/tools/weight` —— 旧地址,2026-11-07 起 308 跳到 `/tools/workbench`
 *
 * ## 为什么搬家
 *
 * 打印前工作台有三个视角(**检查 / 克重 / 摆盘**),`/tools/weight` 这个名字
 * 只说了其中一个 —— 名字跟内容对不上,老链接也对不上。
 *
 * 现在工作台住在 `/tools/workbench`,三个老地址(`/pricing` /
 * `/tools/weight` / `/tools/model-check`)都跳过去。
 *
 * ## 为什么留一个重定向而不是 404
 *
 * 老的链接(导航、书签、分享出去的地址、搜索引擎收录的)不该断。重定向比
 * 404 多做一件事:把人送到现在唯一正确的那个页面。
 *
 * 用 `permanentRedirect` 而不是 `redirect`:这是**永久搬家**,308 才能让搜索
 * 引擎把权重转给新地址;307 会被当成临时跳转,权重不转移。
 *
 * 用 `next/navigation` 的 `permanentRedirect` 而不是 `@/i18n/routing` 里那个:
 * 后者是从 `next-intl/navigation` 导出的,那个入口在 client 组件里解析到的
 * 是 react-client 版本(没有 `permanentRedirect`),放进共享模块会在打包时炸。
 * 这里手写 locale 前缀 —— `localePrefix` 是默认的 `always`,URL 一定带前缀。
 *
 * 跟 `/pricing` → `/tools/workbench` 是同一套写法。
 */
export default async function WeightToolPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/tools/workbench`);
}
