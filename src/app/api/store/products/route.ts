/**
 * GET /api/store/products —— 列出 mock 产品
 *
 * 对齐 atelier 的 store 契约(`GET /store/products`,简化版:分页只有
 * offset / limit,不是完整 schema)。
 *
 * 商品目录的真理源在本仓库 —— Sellbase 只做收银台、不提供商品目录读取
 * 接口,所以这个 Route 永远读本仓库的数据,不会转发出去。
 *
 * Query params:
 *  - series: 按 series handle 过滤(keychain / figure / magnet)
 *  - type: 按 productTypeCode 过滤(R / A / P / RM / LB / M)
 *  - limit: 最多返回多少条
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  filterBySeries,
  filterByTypeCode,
  MOCK_PRODUCTS,
} from "@/features/storefront/lib/mock-catalog";
import { withApiLogging } from "@/lib/api-logger";

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
    products = filterByTypeCode(
      products,
      type as Parameters<typeof filterByTypeCode>[1]
    );
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
