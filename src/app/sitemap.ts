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
    // 工具中心(2026-11-01):打印前工作台(检查 / 克重 / 摆盘)
    // 三个老地址都不进 sitemap —— 它们各自 308 跳到 `/tools/workbench`,
    // 留旧地址在 sitemap 里等于告诉搜索引擎「这个页面也是正式页面」。
    // (`/pricing` / `/tools/weight` / `/tools/model-check`)
    "/tools",
    "/tools/workbench",
    // 打印服务:**不进 sitemap** —— 打印单(`/print-order`)2026-11-08 整页
    // 删掉(打印服务并进商城购物袋),只留一个重定向到 `/cart`;报价台
    // (`/quote`)2026-11-06 也已整页删掉。打印服务对外的公开入口是打印前
    // 工作台(`/tools/workbench`,上面已经在列表里)。
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
