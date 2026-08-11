import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { Separator } from "@/components/ui/separator";
import { siteConfig } from "@/config";
import { ProductCard } from "@/features/products/components/product-card";
import {
  getFeaturedProducts,
  PRODUCT_CATEGORY_LABELS,
  PRODUCTS,
} from "@/features/products/lib/data";

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

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const isZh = locale === "zh";
  const featured = getFeaturedProducts();
  const others = PRODUCTS.filter((p) => !p.featured);
  // 合并：推荐款优先展示
  const ordered = [...featured, ...others];

  // 按分类分组（仅用于侧栏 / 顶部 chip 标签，可选）
  const categories = Array.from(
    new Set(PRODUCTS.map((p) => p.category))
  ) as Array<keyof typeof PRODUCT_CATEGORY_LABELS>;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: isZh ? "首页" : "Home", url: `/${locale}` },
          { name: isZh ? "作品集" : "Gallery", url: `/${locale}/products` },
        ]}
      />

      <main className="container py-12 md:py-16">
        {/* 头部 */}
        <header className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">{isZh ? "作品集" : "Gallery"}</span>
          <h1 className="mt-4 text-balance text-3xl font-extrabold tracking-tight md:text-4xl">
            {isZh
              ? "每一件，都是真实客户的定制"
              : "Every piece is a real commission"}
          </h1>
          <p className="mt-4 text-muted-foreground">
            {isZh
              ? "从宠物纪念到企业伴手礼，从个人收藏到婚礼纪念——WJP 全彩 3D 打印让每份想象都被认真对待。"
              : "From pet memorials to corporate gifts, personal collections to wedding favors — WJP full-color 3D printing treats every idea with care."}
          </p>
        </header>

        {/* 分类标签 */}
        <nav
          aria-label={isZh ? "按分类筛选" : "Filter by category"}
          className="mt-10 flex flex-wrap items-center justify-center gap-2"
        >
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            {isZh ? "分类" : "Categories"}
          </span>
          {categories.map((c) => (
            <span
              key={c}
              className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground"
            >
              {PRODUCT_CATEGORY_LABELS[c][isZh ? "zh" : "en"]}
            </span>
          ))}
        </nav>

        <Separator className="my-10" />

        {/* 网格 */}
        <section
          aria-label={isZh ? "作品列表" : "Product list"}
          className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {ordered.map((p) => (
            <ProductCard
              key={p.slug}
              product={p}
              locale={isZh ? "zh" : "en"}
              featured={p.featured}
            />
          ))}
        </section>

        {/* 底部 CTA */}
        <section className="mt-16 rounded-2xl border bg-muted/30 px-6 py-12 text-center md:px-12">
          <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
            {isZh ? "想要一件属于自己的？" : "Want one of your own?"}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground md:text-base">
            {isZh
              ? "上传一张照片或描述你的想法，48 小时内收到 3D 建模稿。一件起定，一件发货。"
              : "Upload a photo or describe your idea — receive a 3D proof within 48 hours. Single-piece start, single-piece shipping."}
          </p>
        </section>
      </main>
    </>
  );
}
