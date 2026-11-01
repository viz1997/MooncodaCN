import type { Metadata } from "next";
import { siteConfig } from "@/config";
import { CraftGallery } from "@/features/marketing/components/storefront/craft-gallery";
import { HowItWorks } from "@/features/marketing/components/storefront/how-it-works";
import { OccasionShelf } from "@/features/marketing/components/storefront/occasion-shelf";
import { StoreHero } from "@/features/marketing/components/storefront/store-hero";

/**
 * 生成首页 Metadata
 *
 * 根 URL `/` 2026-09-17 改为 atelier 首页;2026-10-31 精简为 4 段:
 * StoreHero → OccasionShelf → HowItWorks → CraftGallery。
 *
 * ## 2026-10-31:从 6 段收到 4 段
 *
 * 上一版是 6 段,读起来像「商品列表堆了 5 遍」:
 *  - 四段场合色带各用一种栅格(feature-left / triptych / wide-rows /
 *    feature-right),四套并排栅格在打架;
 *  - 四段色带已经把 12 件商品各展示了一遍,页尾的 FeaturedProducts 横向滚动条
 *    又把同样 12 件展示第二遍 —— unique 12 件摊成 24 次;
 *  - 顶部导航六项 + 移动端「按形态」三项,共九个去处。
 *
 * 现在:
 *  - 四段色带**统一版式**(大图 + 两张小卡),节奏只靠一屏一换的底色走;
 *  - 页尾那条重复的横向滚动条整段删掉 —— 首页不再有第二份目录,12 件商品
 *    各出现一次。全量目录 + 品类筛选留在作品集页 `/marketing/products`;
 *  - 「工艺故事」和「真实订单」两段合成一段 CraftGallery,页面上只出现一套
 *    标题栏;
 *  - 顶部导航收到 4 项:作品 / 流程 / 工艺 / 定制。
 *
 * 顺序的意思:先看是什么场合的礼物,再决定怎么做,最后建立信任。
 *
 * 不做的事:
 *  - 不引入 atelier 的 StoreHeader / StoreFooter —— `(marketing-atelier)/layout.tsx`
 *    已经提供 Header + Footer,根页面只拼 main 内部的段,避免双 Header / 双 Footer。
 *  - 不引入 CartDrawer / ProductQuickView / CustomWorkshop —— 它们挂在
 *    `(marketing-atelier)/layout.tsx` 上,全局可见(见该 layout 的 overlay 段)。
 *  - 不复用现有 marketing HeroSection / StatsSection / ... / CTASection —— atelier 视觉
 *    与原 11 段拼装不同,根路径只走 atelier 形态。
 *
 * 关联:`/marketing/products` 是独立页面,本次不动(见 wjp-storefront-atelier-port.md)。
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
      {/* atelier 首页 4 段(2026-10-31):
          hero → 四屏场合色带(同一版式,一屏一换底色)→ 流程 → 工艺 + 真实订单。
          12 件商品各出现一次,页面上没有第二份目录。 */}
      <StoreHero />
      <OccasionShelf locale={isZh ? "zh" : "en"} />
      <HowItWorks />
      <CraftGallery />
    </>
  );
}
