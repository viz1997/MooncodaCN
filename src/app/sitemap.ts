import type { MetadataRoute } from "next";

import { siteConfig } from "@/config";
import { getAllPseoParams } from "@/features/pseo/lib/pseo-data";
import { getAllBlogSlugs, getAllLegalSlugs } from "@/lib/source";

/** Supported locales */
const locales = ["en", "zh"] as const;

/**
 * 动态生成 sitemap.xml
 *
 * 包含所有公开页面的 URL
 * 用于搜索引擎索引
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteConfig.url;
  const now = new Date();

  // Static pages that exist for each locale
  const staticPaths = [
    "", // homepage
    "/blog",
    "/pseo",
    // 工具中心(2026-11-01):克重计算器 + 模型检查
    // `/pricing` 不再进 sitemap —— 它 308 跳到 `/tools/weight`,留旧地址在
    // sitemap 里等于告诉搜索引擎「这个页面也是正式页面」。
    "/tools",
    "/tools/weight",
    "/tools/model-check",
    // 打印服务:**不进 sitemap** —— 打印单(`/print-order`)是每个用户自己的
    // 一页(打印列表 + 下单金额),对爬虫没有内容;报价台(`/quote`)2026-11-06
    // 已整页删掉,只留一个重定向。打印服务对外的公开入口是克重工具
    // (`/tools/weight`,上面已经在列表里)。
  ];

  // Generate static routes for each locale
  const staticRoutes = locales.flatMap((locale) =>
    staticPaths.map((path) => ({
      url: `${baseUrl}/${locale}${path}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : 0.8,
    }))
  );

  // Blog posts (dynamic)
  const blogSlugs = getAllBlogSlugs();
  const blogRoutes = blogSlugs.map(
    ({ locale, slug }: { locale: string; slug: string }) => ({
      url: `${baseUrl}/${locale}/blog/${slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })
  );

  // Legal pages (dynamic)
  const legalSlugs = getAllLegalSlugs();
  const legalRoutes = legalSlugs.map(
    ({ locale, slug }: { locale: string; slug: string }) => ({
      url: `${baseUrl}/${locale}/legal/${slug}`,
      lastModified: now,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })
  );

  const pseoSlugs = getAllPseoParams();
  const pseoRoutes = pseoSlugs.map(({ locale, slug }) => ({
    url: `${baseUrl}/${locale}/pseo/${slug}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...blogRoutes, ...legalRoutes, ...pseoRoutes];
}
