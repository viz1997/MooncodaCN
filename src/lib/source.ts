import { defineI18n } from "fumadocs-core/i18n";
import { loader } from "fumadocs-core/source";

import { blog, docs, legal } from "../../.source/server";

export const docsI18n = defineI18n({
  languages: ["en", "zh"],
  defaultLanguage: "en",
  parser: "dir",
  hideLocale: "never",
});

/**
 * 文档数据源
 *
 * 用于在页面中获取文档数据
 * 注意：i18n 由 Next.js 的 [locale] 路由处理，这里不需要配置
 */
export const docsSource = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  i18n: docsI18n,
  url: (slugs, locale) => {
    const language = locale ?? docsI18n.defaultLanguage;
    const path = slugs.length > 0 ? `/${slugs.join("/")}` : "";
    return `/${language}/docs${path}`;
  },
});

/**
 * 博客文章集合
 *
 * 直接导出博客集合数据数组
 */
export const blogPosts = blog;

/**
 * 法律文档集合
 *
 * 直接导出法律文档集合数据数组
 */
export const legalDocs = legal;

/**
 * 获取指定语言的博客文章列表
 */
export function getBlogPosts(locale: string) {
  return blog.filter((post) => {
    // 从文件路径中提取语言 (格式: en/hello-world.mdx)
    const pathLocale = post.info.path.split("/")[0];
    return pathLocale === locale;
  });
}

/**
 * 获取指定 slug 的博客文章
 */
export function getBlogPost(slug: string, locale: string) {
  const posts = getBlogPosts(locale);
  return posts.find((post) => {
    // 从文件路径中提取 slug (去掉语言前缀和 .mdx 后缀)
    const pathParts = post.info.path.split("/");
    const fileName = pathParts[pathParts.length - 1] ?? "";
    const postSlug = fileName.replace(/\.mdx$/, "");
    return postSlug === slug;
  });
}

/**
 * 获取所有博客文章的 slug 列表（用于 generateStaticParams）
 */
export function getAllBlogSlugs() {
  return blog.map((post) => {
    const pathParts = post.info.path.split("/");
    const locale = pathParts[0] ?? "en";
    const fileName = pathParts[pathParts.length - 1] ?? "";
    const slug = fileName.replace(/\.mdx$/, "");
    return { locale, slug };
  });
}

// ============================================
// 法律文档辅助函数
// ============================================

/**
 * 获取指定语言的法律文档列表
 */
export function getLegalDocs(locale: string) {
  return legal.filter((doc) => {
    // 从文件路径中提取语言 (格式: en/terms.mdx)
    const pathLocale = doc.info.path.split("/")[0];
    return pathLocale === locale;
  });
}

/**
 * 取文档的 slug —— 去掉语言前缀和 .mdx 后缀
 *
 * 路径形如 "zh/print-notice.mdx" → "print-notice"。
 *
 * 单独抽出来是因为「路由 slug」这个概念现在有三处要用(取文档、列全部
 * slug、页脚列出同语言的其他文档),各写一遍正则迟早会走偏。
 */
export function getLegalSlug(doc: { info: { path: string } }): string {
  const pathParts = doc.info.path.split("/");
  const fileName = pathParts[pathParts.length - 1] ?? "";
  return fileName.replace(/\.mdx$/, "");
}

/**
 * 获取指定 slug 的法律文档
 */
export function getLegalDoc(slug: string, locale: string) {
  const docs = getLegalDocs(locale);
  return docs.find((doc) => getLegalSlug(doc) === slug);
}

/**
 * 获取所有法律文档的 slug 列表（用于 generateStaticParams）
 */
export function getAllLegalSlugs() {
  return legal.map((doc) => {
    const pathParts = doc.info.path.split("/");
    const locale = pathParts[0] ?? "en";
    return { locale, slug: getLegalSlug(doc) };
  });
}
