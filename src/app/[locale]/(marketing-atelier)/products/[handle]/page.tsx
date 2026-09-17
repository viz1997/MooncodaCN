/**
 * /products/[handle] —— atelier `ProductDetail` 1:1 移植
 *
 * 静态生成:从 mock catalog 拉所有 handle,build time 产出。
 * 切真 Medusa 时:generateStaticParams 改成 on-demand revalidate (revalidate=60) +
 * fetch handle 列表从 Medusa。
 *
 * 数据流:
 *  - 服务端:findProductByHandle(handle) → StorefrontProduct
 *  - 服务端:findRelatedProducts(handle) → StorefrontProduct[]
 *  - 客户端:ProductDetail 内部 useStorefrontModal.setCustomize + 切到 CustomWorkshop
 *    (overlay 已挂在 (marketing-atelier)/layout.tsx)
 */

import { notFound } from "next/navigation";

import { ProductDetail } from "@/features/storefront/components/product-detail";
import {
  findProductByHandle,
  findRelatedProducts,
  MOCK_PRODUCTS,
} from "@/features/storefront/lib/mock-catalog";

interface PageProps {
  params: Promise<{ handle: string }>;
}

export function generateStaticParams() {
  return MOCK_PRODUCTS.map((p) => ({ handle: p.handle }));
}

export const dynamicParams = false;

export default async function ProductDetailPage({ params }: PageProps) {
  const { handle } = await params;
  const product = findProductByHandle(handle);
  if (!product) {
    notFound();
  }
  const related = findRelatedProducts(handle, 4);

  return <ProductDetail product={product} related={related} />;
}
