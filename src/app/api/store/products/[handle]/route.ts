/**
 * GET /api/store/products/[handle] —— 单个产品详情
 *
 * 对齐 atelier 的 store 契约(`GET /store/products/{handle}`,简化版)。
 *
 * 商品目录的真理源在本仓库,Sellbase 只做收银台 —— 这个 Route 永远读
 * 本仓库的数据,不会转发出去。
 */

import { NextResponse } from "next/server";
import {
  findProductByHandle,
  findRelatedProducts,
} from "@/features/storefront/lib/mock-catalog";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

async function handle(
  _request: Request,
  context: { params: Promise<{ handle: string }> }
) {
  const { handle } = await context.params;
  const product = findProductByHandle(handle);

  if (!product) {
    return NextResponse.json(
      { error: "PRODUCT_NOT_FOUND", message: `产品 ${handle} 不存在` },
      { status: 404 }
    );
  }

  const related = findRelatedProducts(handle, 4);

  return NextResponse.json({ product, related });
}

export const GET = withApiLogging(handle);
