/**
 * GET /api/store/products/[handle] —— 单个产品详情
 *
 * 对齐 Medusa Store API `GET /store/products/{handle}`。
 *
 * 切真 Medusa 时:转发到 Medusa Store API。
 */

import { NextResponse } from "next/server";

import { withApiLogging } from "@/lib/api-logger";
import {
  findProductByHandle,
  findRelatedProducts,
} from "@/features/storefront/lib/mock-catalog";

export const runtime = "nodejs";

async function handle(
  _request: Request,
  context: { params: Promise<{ handle: string }> },
) {
  const { handle } = await context.params;
  const product = findProductByHandle(handle);

  if (!product) {
    return NextResponse.json(
      { error: "PRODUCT_NOT_FOUND", message: `产品 ${handle} 不存在` },
      { status: 404 },
    );
  }

  const related = findRelatedProducts(handle, 4);

  return NextResponse.json({ product, related });
}

export const GET = withApiLogging(handle);
