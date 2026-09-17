/**
 * GET /api/store/products —— 列出 mock 产品
 *
 * 对齐 Medusa Store API `GET /store/products`:
 * https://docs.medusajs.com/api/store#products-get-products
 *
 * Query params:
 *  - series: 按 series handle 过滤(keychain / figure / magnet)
 *  - type: 按 productTypeCode 过滤(R / A / P / RM / LB / M)
 *  - limit: 最多返回多少条
 *
 * 切真 Medusa 时:此 Route 转发到 `GET /store/products` Medusa API。
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { withApiLogging } from "@/lib/api-logger";
import {
  filterBySeries,
  filterByTypeCode,
  MOCK_PRODUCTS,
} from "@/features/storefront/lib/mock-catalog";

export const runtime = "nodejs";

async function handle(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const series = searchParams.get("series");
  const type = searchParams.get("type");
  const limitStr = searchParams.get("limit");
  const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined;

  let products = MOCK_PRODUCTS;

  if (series) {
    products = filterBySeries(products, series);
  }
  if (type) {
    products = filterByTypeCode(products, type as Parameters<typeof filterByTypeCode>[1]);
  }
  if (limit && Number.isInteger(limit) && limit > 0) {
    products = products.slice(0, limit);
  }

  return NextResponse.json({
    products,
    count: products.length,
    offset: 0,
    limit: limit ?? products.length,
  });
}

export const GET = withApiLogging(handle);
