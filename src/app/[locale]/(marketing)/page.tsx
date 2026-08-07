import type { Metadata } from "next";
import { siteConfig } from "@/config";
import {
  CTASection,
  FAQSection,
  FeatureGrid,
  HeroSection,
  HowItWorks,
  PricingSection,
  Testimonials,
  UseCasesSection,
} from "@/features/marketing/components";

/**
 * 生成首页 Metadata
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
    ? "Mooncoda — WJP 全彩 3D 打印专家，宠物徽章 / 钥匙扣 / 冰箱贴 / 手办等一件定制、一件发货。"
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
      ...(isZh ? [] : ["WJP 3D printing", "full-color 3D print", "custom figurine"]),
    ],
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
  // 当前 body 不依赖 locale，但保留 params 形参以匹配 generateMetadata 的签名
  // 并保证后续接入按地区分支的 JSON-LD 或内容块时不需要再改路由。
  await params;

  return (
    <>
      {/* JSON-LD Structured Data — TODO: 接入 LocalBusiness / Product schema */}
      <HeroSection />
      <FeatureGrid />
      <HowItWorks />
      <UseCasesSection />
      <Testimonials />
      <PricingSection />
      <FAQSection />
      <CTASection />
    </>
  );
}
