import type { Metadata } from "next";
import { siteConfig } from "@/config";
import { CategoryStrip } from "@/features/marketing/components/storefront/category-strip";
import { CraftGallery } from "@/features/marketing/components/storefront/craft-gallery";
import { HowItWorks } from "@/features/marketing/components/storefront/how-it-works";
import { OccasionShelf } from "@/features/marketing/components/storefront/occasion-shelf";
import { ShopAnnouncement } from "@/features/marketing/components/storefront/shop-announcement";
import { ShopGrid } from "@/features/marketing/components/storefront/shop-grid";
import { StoreHero } from "@/features/marketing/components/storefront/store-hero";
import { getStorefrontProducts } from "@/features/storefront/lib/price-source";

/**
 * 这一页**不能静态预渲染** —— 价必须是当下的。
 *
 * `getStorefrontProducts()` 内部有 `await connection()`,正常情况下它就够
 * (那是「这一页别静态」的唯一声明处)。这里再显式写一遍
 * `force-dynamic` 是**双保险**:构建期预渲染万一因为别的原因没走到
 * `connection()`,价会被烤进 HTML —— 后台改完价刷新还是旧价,
 * **「改了不生效」原地复发,只是换了个原因**。
 *
 * 只加在**显示目录价的两个页面**上 —— 博客 / 价格页 / 法律页那些不显示
 * 目录价,不受影响。
 */
export const dynamic = "force-dynamic";

/**
 * 生成首页 Metadata
 *
 * 根 URL `/` 2026-09-17 改为 atelier 首页;2026-11-01 改成商城的动线:
 *
 * ```
 * 公告条 → Hero(商品拼贴 + 价格锚点) → 品类导航 → 全部商品网格
 *        → 场合促销行 → 流程 → 工艺 + 真实订单
 * ```
 *
 * ## 2026-11-01:「不像商城」的改法
 *
 * 上一版是「品牌叙事页」:首屏一句 slogan + 一张生活照,往下四段整屏色带,
 * 每段摆 3 件商品。读起来像四篇图文,不像一个店 —— 想比价的人得滚四屏,
 * 想看全部的人得滚到最底下,首屏连一个价格都没有。
 *
 * 现在的动线按商场的标准顺序排:
 *  - **公告条** —— 先说清楚怎么买(免运费门槛 / 一件也发货 / 工期);
 *  - **Hero 右侧换成 2×2 商品拼贴**,每块角上写价格,首屏就摆货;
 *  - **品类导航** —— 每格写清楚「做什么的 / 多少钱起 / 有几件」;
 *  - **全部商品网格**(#works)—— 12 件的唯一直录,带品类筛选,价格和
 *    「同款定制」都在卡上;顶部导航「作品」和 hero 的「看全部商品」都落这儿;
 *  - **场合促销行** —— 从「再陈列一遍商品」改成导购入口,点 CTA 设场合筛选
 *    并滚回商品网格。
 *
 * 商品因此只出现一次(网格里 12 件),加上首屏拼贴里的 4 件 —— 拼贴是
 * 商城的常规做法,不重复目录。
 *
 * ## 2026-10-31:从 6 段收到 4 段(已被上面覆盖,但结论还在)
 *
 *  - 四段色带曾各用一种栅格,四套并排栅格在打架;
 *  - 四段色带 + 页尾 FeaturedProducts 横向滚动条 = 12 件摊成 24 次;
 *  - 「工艺故事」和「真实订单」合成一段 CraftGallery,页面上只出现一套标题栏。
 *
 * 不做的事:
 *  - 不引入 atelier 的 StoreHeader / StoreFooter —— `(marketing-atelier)/layout.tsx`
 *    已经提供 Header + Footer,根页面只拼 main 内部的段,避免双 Header / 双 Footer。
 *  - 不引入 CartDrawer / ProductQuickView / CustomWorkshop —— 它们挂在
 *    `(marketing-atelier)/layout.tsx` 上,全局可见(见该 layout 的 overlay 段)。
 *  - 不复用现有 marketing HeroSection / StatsSection / ... / CTASection —— atelier 视觉
 *    与原 11 段拼装不同,根路径只走 atelier 形态。
 *
 * 关联:`/products` 是独立页面(作品集),2026-11-13 从 `/marketing/products`
 * 归位过来(见 wjp-storefront-atelier-port.md)。
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

  // 商品(价来自 DB)—— 服务端取一次,传给出图的所有客户端组件。
  // `getStorefrontProducts()` 内部有 `await connection()`,所以这一页
  // **不会**被静态预渲染 —— 价必须是当下的,不能烤进构建产物里。
  const products = await getStorefrontProducts();

  return (
    <>
      {/* 商城动线(2026-11-01):
          公告条 → hero(商品拼贴 + 价格) → 品类导航 → 12 件商品网格
          → 场合促销行 → 流程 → 工艺 + 真实订单。
          商品目录只有网格这一处,场合色带只做导购入口。 */}
      <ShopAnnouncement locale={isZh ? "zh" : "en"} />
      <StoreHero locale={isZh ? "zh" : "en"} products={products} />
      <CategoryStrip locale={isZh ? "zh" : "en"} products={products} />
      <ShopGrid locale={isZh ? "zh" : "en"} products={products} />
      <OccasionShelf locale={isZh ? "zh" : "en"} />
      <HowItWorks />
      <CraftGallery />
    </>
  );
}
