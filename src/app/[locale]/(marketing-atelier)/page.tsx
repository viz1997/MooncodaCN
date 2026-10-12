import type { Metadata } from "next";
import { siteConfig } from "@/config";
import { CommunityWall } from "@/features/marketing/components/storefront/community-wall";
import { CraftStory } from "@/features/marketing/components/storefront/craft-story";
import { FeaturedProducts } from "@/features/marketing/components/storefront/featured-products";
import { HowItWorks } from "@/features/marketing/components/storefront/how-it-works";
import { SeriesShowcase } from "@/features/marketing/components/storefront/series-showcase";
import { StoreHero } from "@/features/marketing/components/storefront/store-hero";

/**
 * 生成首页 Metadata
 *
 * 根 URL `/` 2026-09-17 改为 atelier 首页:6 段拼装 StoreHero → FeaturedProducts →
 * SeriesShowcase → HowItWorks → CraftStory → CommunityWall,顺序 1:1 对齐 atelier。
 *
 * 不做的事:
 *  - 不引入 atelier 的 StoreHeader / StoreFooter —— `(marketing)/layout.tsx` 已经提供
 *    Header + Footer,根页面只拼 main 内部 6 段,避免双 Header / 双 Footer。
 *  - 不引入 CartDrawer / ProductQuickView / CustomWorkshop —— 纯视觉展示,commerce 在
 *    Medusa storefront(见 [[mooncada-medusa-integration]])。
 *  - 不复用现有 marketing HeroSection / StatsSection / ... / CTASection —— atelier 视觉
 *    与原 11 段拼装不同,根路径只走 atelier 形态。
 *
 * 关联:`/marketing/products` 同样 6 段但略调顺序(见 wjp-storefront-atelier-port.md)。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh ? "Mooncoda" : "Mooncoda";

  const description = isZh
    ? "Mooncoda — WJP 全彩 3D 打印专家,宠物徽章 / 钥匙扣 / 冰箱贴 / 手办等一件定制、一件发货。"
    : "Mooncoda — WJP full-color 3D printing. Pet badges, keychains, fridge magnets, figures. Single-piece customization & shipping.";

  return {
    title,
    description,
    keywords: [
      "WJP 全彩 3D 打印",
      "宠物徽章",
      "钥匙扣",
      "冰箱贴",
      "手办",
      "一件定制",
      "一件发货",
      ...(isZh
        ? []
        : ["WJP 3D printing", "full-color 3D print", "custom figurine"]),
    ],
    alternates: {
      canonical: `${siteConfig.url}/${locale}`,
      languages: {
        en: `${siteConfig.url}/en`,
        zh: `${siteConfig.url}/zh`,
      },
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: `${siteConfig.url}/${locale}`,
      siteName: siteConfig.name,
      images: [
        {
          url: `${siteConfig.url}${siteConfig.ogImage}`,
          width: 1200,
          height: 630,
          alt: siteConfig.name,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${siteConfig.url}${siteConfig.ogImage}`],
    },
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const isZh = locale === "zh";

  return (
    <>
      {/* atelier 首页 6 段拼装,顺序 1:1 对齐 D:\下载\atelier-source\src\app\page.tsx */}
      <StoreHero />
      <FeaturedProducts locale={isZh ? "zh" : "en"} />
      <SeriesShowcase />
      <HowItWorks />
      <CraftStory />
      <CommunityWall />
    </>
  );
}
