import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { siteConfig } from "@/config";
import { CommunityWall } from "@/features/marketing/components/storefront/community-wall";
import { CraftStory } from "@/features/marketing/components/storefront/craft-story";
import { FeaturedProducts } from "@/features/marketing/components/storefront/featured-products";
import { HowItWorks } from "@/features/marketing/components/storefront/how-it-works";
import { SeriesShowcase } from "@/features/marketing/components/storefront/series-showcase";
import { StoreHero } from "@/features/marketing/components/storefront/store-hero";
import { getStorefrontProducts } from "@/features/storefront/lib/price-source";

/**
 * 这一页**不能静态预渲染** —— 价必须是当下的。
 *
 * 理由跟首页一样(`(marketing-atelier)/page.tsx`):`connection()` 是唯一的
 * 「别静态」声明处,这里再显式写一遍 `force-dynamic` 是双保险 ——
 * 构建期把价烤进 HTML,后台改完价刷新还是旧价。
 */
export const dynamic = "force-dynamic";

/**
 * 作品集页 —— `/products`
 *
 * **2026-11-13 从 `/marketing/products` 搬过来**(工作室问「为什么还有
 * zh/products」)。搬动的两个原因:
 *
 *  1. **URL**:模板那套静态作品集(6 件写死的演示数据、封面全是破图、不能
 *     下单)占着 `/products`;真目录却躲在 `/marketing/products` 下。现在
 *     `/products` 就是**能下单的真目录** —— 商城头尾那套导航里的「Gallery」
 *     指的也是它。
 *  2. **外壳**:这一页渲染的是商城组件(`StoreHero` / `SeriesShowcase` / …),
 *     但它原先住在 `(marketing)` 组里 ⇒ **拿不到 `.atelier-root` 的配色 /
 *     圆角 / 字体 token**。搬进 `(marketing-atelier)` 之后,整站只有一套
 *     头尾、一张脸。
 *
 * 旧地址 `/marketing/products` 留了一个 308 桩(见同目录下的
 * `../marketing/products/page.tsx`)—— 书签 / 外链 / 已被收录的 URL 不能断。
 */

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
      canonical: `${siteConfig.url}/${locale}/products`,
      languages: {
        en: `${siteConfig.url}/en/products`,
        zh: `${siteConfig.url}/zh/products`,
      },
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: `${siteConfig.url}/${locale}/products`,
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

  // 商品(价来自 DB)—— 服务端取一次,传给三个客户端组件。
  // `getStorefrontProducts()` 内部有 `await connection()`,所以这一页
  // **不会**被静态预渲染 —— 价必须是当下的。
  const products = await getStorefrontProducts();

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: isZh ? "首页" : "Home", url: `/${locale}` },
          {
            name: isZh ? "作品集" : "Gallery",
            url: `/${locale}/products`,
          },
        ]}
      />

      {/* atelier-style 品牌 store 页面 (5 段拼装) */}
      <StoreHero locale={isZh ? "zh" : "en"} products={products} />
      <SeriesShowcase products={products} />
      <HowItWorks />
      <FeaturedProducts locale={isZh ? "zh" : "en"} products={products} />
      <CraftStory />
      <CommunityWall />
    </>
  );
}
