import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BreadcrumbJsonLd, ProductJsonLd } from "@/components/seo/json-ld";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Link } from "@/i18n/routing";
import { siteConfig } from "@/config";
import { ProductCard } from "@/features/products/components/product-card";
import {
  PRODUCT_CATEGORY_LABELS,
  getAllProductSlugs,
  getProductBySlug,
  getProductsByCategory,
} from "@/features/products/lib/data";

/**
 * SSG —— 静态化所有作品详情页
 */
export function generateStaticParams() {
  return getAllProductSlugs().map((slug) => ({ slug }));
}

/**
 * Metadata —— OpenGraph + canonical
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) return { title: "Not Found" };

  const t = product.translations[locale as "en" | "zh"];
  const url = `${siteConfig.url}/${locale}/products/${slug}`;

  return {
    title: t.name,
    description: t.tagline,
    alternates: {
      canonical: url,
      languages: {
        en: `${siteConfig.url}/en/products/${slug}`,
        zh: `${siteConfig.url}/zh/products/${slug}`,
      },
    },
    openGraph: {
      title: t.name,
      description: t.tagline,
      type: "website",
      url,
      siteName: siteConfig.name,
    },
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const product = getProductBySlug(slug);
  if (!product) notFound();

  const isZh = locale === "zh";
  const t = product.translations[isZh ? "zh" : "en"];
  const categoryLabel = PRODUCT_CATEGORY_LABELS[product.category][isZh ? "zh" : "en"];
  const priceDisplay =
    isZh
      ? `¥${product.basePriceCNY} / 件`
      : `from $${Math.round(product.basePriceCNY / 7)} / piece`;

  // 同分类下其他作品（最多 3 个，去掉当前）
  const related = getProductsByCategory(product.category)
    .filter((p) => p.slug !== slug)
    .slice(0, 3);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: isZh ? "首页" : "Home", url: `/${locale}` },
          { name: isZh ? "作品集" : "Gallery", url: `/${locale}/products` },
          { name: t.name, url: `/${locale}/products/${slug}` },
        ]}
      />
      <ProductJsonLd
        name={t.name}
        description={t.description}
        url={`${siteConfig.url}/${locale}/products/${slug}`}
        image={`${siteConfig.url}${product.cover}`}
        price={product.basePriceCNY}
        currency={isZh ? "CNY" : "USD"}
      />

      <main className="container py-12 md:py-16">
        <Link
          href="/products"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          ← {isZh ? "返回作品集" : "Back to gallery"}
        </Link>

        <article className="mt-6 grid gap-10 md:grid-cols-[1.05fr_0.95fr]">
          {/* 左：封面 / 占位 */}
          <div className="space-y-3">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900">
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                <span className="font-mono text-xs uppercase tracking-widest text-zinc-400">
                  {product.dimensions.width}×{product.dimensions.depth}×{product.dimensions.height}mm
                </span>
                <span className="text-xs text-zinc-500">
                  {isZh ? "图片占位 · 上传后展示" : "Image placeholder"}
                </span>
              </div>
            </div>
            {product.gallery.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {product.gallery.slice(0, 3).map((src) => (
                  <div
                    key={src}
                    className="aspect-square rounded-md border bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900"
                  />
                ))}
              </div>
            )}
          </div>

          {/* 右：详情 */}
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{categoryLabel}</Badge>
              <span className="font-mono text-xs text-muted-foreground">{product.material}</span>
            </div>

            <div>
              <h1 className="text-balance text-3xl font-extrabold tracking-tight md:text-4xl">
                {t.name}
              </h1>
              <p className="mt-3 text-pretty text-lg text-muted-foreground">
                {t.tagline}
              </p>
            </div>

            <Separator />

            <div>
              <p className="text-2xl font-semibold tabular-nums">{priceDisplay}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isZh ? "一件起定 · 单件独立包装" : "Single-piece min. · Individual packaging"}
              </p>
            </div>

            <p className="leading-relaxed text-muted-foreground">{t.description}</p>

            {t.highlights && t.highlights.length > 0 && (
              <ul className="space-y-2 text-sm">
                {t.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/70" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            )}

            {t.story && t.story.length > 0 && (
              <div className="rounded-xl border bg-muted/30 p-5 text-sm leading-relaxed text-muted-foreground">
                {t.story.map((para, i) => (
                  <p key={i} className={i > 0 ? "mt-3" : ""}>
                    {para}
                  </p>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              <Button size="lg" asChild>
                <Link href="/sign-up">{isZh ? "上传图片定制" : "Upload to customize"}</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/products">{isZh ? "查看更多" : "See more"}</Link>
              </Button>
            </div>

            {/* 规格表 */}
            <dl className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-5 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                  {isZh ? "尺寸" : "Dimensions"}
                </dt>
                <dd className="mt-1 font-mono tabular-nums">
                  {product.dimensions.width} × {product.dimensions.depth} × {product.dimensions.height} mm
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                  {isZh ? "工艺" : "Process"}
                </dt>
                <dd className="mt-1">{product.material}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs uppercase tracking-widest text-muted-foreground">
                  {isZh ? "适用场景" : "Use Cases"}
                </dt>
                <dd className="mt-1">
                  {product.occasion.map((o) => (
                    <Badge key={o} variant="outline" className="mr-1.5 mt-1">
                      {o}
                    </Badge>
                  ))}
                </dd>
              </div>
            </dl>
          </div>
        </article>

        {/* 同类推荐 */}
        {related.length > 0 && (
          <section className="mt-20">
            <div className="mb-6 flex items-baseline justify-between">
              <h2 className="text-xl font-semibold tracking-tight">
                {isZh ? "同类作品" : "More in this category"}
              </h2>
              <Link
                href="/products"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {isZh ? "查看全部" : "View all"} →
              </Link>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((p) => (
                <ProductCard key={p.slug} product={p} locale={isZh ? "zh" : "en"} />
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}