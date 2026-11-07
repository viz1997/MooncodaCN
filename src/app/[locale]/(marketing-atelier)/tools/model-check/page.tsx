import { permanentRedirect } from "next/navigation";

/**
 * `/tools/model-check` —— 旧地址,2026-11-07 起 308 跳到 `/tools/workbench`
 *
 * ## 模型检查工具并进了打印前工作台
 *
 * 工作室的原话:**「不想分成两个工具页」**。两个工具问的是同一个模型的
 * 两个问题(能不能印 / 要多少料),以前同一个文件要拖两次、解压两次、量两遍,
 * 而且中间还要跳页。
 *
 * 现在合成**一个**打印前工作台(`/tools/workbench`),模型只载入一次,里面用
 * **检查 / 克重 / 摆盘** 三个视角看同一个模型:
 *
 * ```
 * /tools/workbench  →  拖进来  →  检查(能不能印)→ 克重(要多少料)→ 摆盘(怎么摆)
 * ```
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
export default async function ModelCheckPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/tools/workbench`);
}
