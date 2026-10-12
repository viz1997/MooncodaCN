import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { siteConfig } from "@/config";
import { ProductDetail } from "@/features/storefront/components/product-detail";
import {
  findProductByHandle,
  MOCK_PRODUCTS,
} from "@/features/storefront/lib/mock-catalog";

/**
 * SSG —— mock 阶段静态化所有 12 个产品详情页
 * 切真 Medusa 后改用 generateMetadata + 客户端 useProduct 拉取即可
 */
export function generateStaticParams() {
  return MOCK_PRODUCTS.map((p) => ({ handle: p.handle }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const product = findProductByHandle(handle);
  if (!product) return { title: "Not Found" };

  const url = `${siteConfig.url}/product/${handle}`;
  return {
    title: product.title,
    description: product.subtitle,
    alternates: { canonical: url },
    openGraph: {
      title: product.title,
      description: product.subtitle,
      type: "website",
      url,
      siteName: siteConfig.name,
      images: product.thumbnail ? [product.thumbnail] : undefined,
    },
  };
}

export default async function AtelierProductDetailPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const product = findProductByHandle(handle);
  if (!product) notFound();

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "首页", url: "/" },
          { name: product.seriesName, url: `/#${product.seriesId}` },
          { name: product.title, url: `/product/${handle}` },
        ]}
      />
      <ProductDetail handle={handle} />
    </>
  );
}
