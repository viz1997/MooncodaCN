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
 * 商品目录的真理源在本仓库,Sellbase 只做收银台 —— 目录不会外迁,
 * 这条 SSG 路线长期有效,不用改成客户端拉取
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
