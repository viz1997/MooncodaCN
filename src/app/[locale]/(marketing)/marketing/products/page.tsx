import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { siteConfig } from "@/config";
import { CommunityWall } from "@/features/marketing/components/storefront/community-wall";
import { CraftStory } from "@/features/marketing/components/storefront/craft-story";
import { FeaturedProducts } from "@/features/marketing/components/storefront/featured-products";
import { HowItWorks } from "@/features/marketing/components/storefront/how-it-works";
import { SeriesShowcase } from "@/features/marketing/components/storefront/series-showcase";
import { StoreHero } from "@/features/marketing/components/storefront/store-hero";

/**
 * 生成作品集列表页 Metadata
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh ? "作品集 · Mooncoda" : "Gallery · Mooncoda";
  const description = isZh
    ? "Mooncoda 梦可达全彩 3D 打印作品精选——宠物徽章、钥匙扣、冰箱贴、手办、立牌、礼品套装。每一件都是真实客户定制案例。"
    : "Mooncoda WJP full-color 3D printing gallery — pet badges, keychains, fridge magnets, figures, standees, gift sets. Every piece is a real customer commission.";

  return {
    title,
    description,
    alternates: {
      canonical: `${siteConfig.url}/${locale}/marketing/products`,
      languages: {
        en: `${siteConfig.url}/en/marketing/products`,
        zh: `${siteConfig.url}/zh/marketing/products`,
      },
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: `${siteConfig.url}/${locale}/marketing/products`,
      siteName: siteConfig.name,
    },
  };
}

export default async function MarketingProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const isZh = locale === "zh";

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: isZh ? "首页" : "Home", url: `/${locale}` },
          {
            name: isZh ? "作品集" : "Gallery",
            url: `/${locale}/marketing/products`,
          },
        ]}
      />

      {/* atelier-style 品牌 store 页面 (5 段拼装) */}
      <StoreHero />
      <SeriesShowcase />
      <HowItWorks />
      <FeaturedProducts locale={isZh ? "zh" : "en"} />
      <CraftStory />
      <CommunityWall />
    </>
  );
}
