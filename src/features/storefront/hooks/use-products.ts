/**
 * use-products —— 客户端产品查询 hook(TanStack Query)
 *
 * 替代 atelier 直接 import mock data 的方式。
 * 切真 Medusa 时:fetch URL 不变,只改 Route Handler 转发到 Medusa。
 */

"use client";

import { type UseQueryResult, useQuery } from "@tanstack/react-query";

import type {
  ProductCategory,
  ProductTypeCode,
  StorefrontProduct,
} from "../types";

const PRODUCTS_QUERY_KEY = ["store", "products"] as const;

interface ProductsResponse {
  products: StorefrontProduct[];
  count: number;
  offset: number;
  limit: number;
}

async function fetchProducts(params: {
  series?: ProductCategory;
  type?: ProductTypeCode;
  limit?: number;
}): Promise<ProductsResponse> {
  const search = new URLSearchParams();
  if (params.series) search.set("series", params.series);
  if (params.type) search.set("type", params.type);
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  const res = await fetch(`/api/store/products${qs ? `?${qs}` : ""}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<ProductsResponse>;
}

async function fetchProductByHandle(
  handle: string
): Promise<{ product: StorefrontProduct; related: StorefrontProduct[] }> {
  const res = await fetch(`/api/store/products/${handle}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{
    product: StorefrontProduct;
    related: StorefrontProduct[];
  }>;
}

/**
 * 列产品
 */
export function useProducts(
  filters: {
    series?: ProductCategory;
    type?: ProductTypeCode;
    limit?: number;
  } = {}
): UseQueryResult<ProductsResponse, Error> {
  return useQuery({
    queryKey: [...PRODUCTS_QUERY_KEY, filters] as const,
    queryFn: () => fetchProducts(filters),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * 单个产品(按 handle)
 */
export function useProduct(
  handle: string
): UseQueryResult<
  { product: StorefrontProduct; related: StorefrontProduct[] },
  Error
> {
  return useQuery({
    queryKey: [...PRODUCTS_QUERY_KEY, "handle", handle] as const,
    queryFn: () => fetchProductByHandle(handle),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: Boolean(handle),
  });
}
