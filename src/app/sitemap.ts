import type { MetadataRoute } from "next";

import { siteConfig } from "@/config";
import { getAllPseoParams } from "@/features/pseo/lib/pseo-data";
import { getAllLegalSlugs } from "@/lib/source";

/** Supported locales */
const locales = ["en", "zh"] as const;

/**
 * 动态生成 sitemap.xml
 *
 * 包含所有公开页面的 URL
 * 用于搜索引擎索引
 *
 * 2026-11-12:**博客不再进 sitemap** —— 工作室的原话:「不再展示这些页面,
 * 即原项目的页面」。模板自带的两篇博客(「你好世界」「Mooncoda 开源了」)
 * 讲的是这个 Next.js SaaS 模板,跟打印业务无关,MDX 已删。**博客这一节本身
 * 留着**(工作室随时能写自己的文章),只是没有文章之前不占导航位、不进
 * sitemap —— 留一个空列表页在 sitemap 里等于告诉搜索引擎「这是个正式页面」。
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteConfig.url;
  const now = new Date();

  // Static pages that exist for each locale
  const staticPaths = [
    "", // homepage
    "/pseo",
    // 工具中心(2026-11-01):打印前工作台(检查 / 克重 / 摆盘)
    // 三个老地址都不进 sitemap —— 它们各自 308 跳到 `/tools/workbench`,
    // 留旧地址在 sitemap 里等于告诉搜索引擎「这个页面也是正式页面」。
    // (`/pricing` / `/tools/weight` / `/tools/model-check`)
    "/tools",
    "/tools/workbench",
    // 打印服务:**不进 sitemap** —— 打印单(`/print-order`)2026-11-08 整页
    // 删掉(打印服务直接建工单,工单在 `/account/print-orders` 那个列表里),
    // 只留一个重定向;报价台(`/quote`)2026-11-06 也已整页删掉。打印服务对外的
    // 公开入口是打印前工作台(`/tools/workbench`,上面已经在列表里)。
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

  return [...staticRoutes, ...legalRoutes, ...pseoRoutes];
}
