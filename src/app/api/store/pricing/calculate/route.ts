/**
 * POST /api/store/pricing/calculate —— mock pricing
 *
 * 对齐 atelier `/api/pricing/calculate`。
 * 切真 Medusa 时:转发到 Medusa pricing API 或保留 mock 计算。
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiLogging } from "@/lib/api-logger";
import { calculatePricing } from "@/features/storefront/lib/pricing";

export const runtime = "nodejs";

const pricingInputSchema = z.object({
  productId: z.string().min(1),
  productHandle: z.string().min(1),
  productTypeCode: z.enum(["R", "A", "P", "RM", "LB", "M"]),
  materialId: z.string().min(1),
  sizeId: z.string().min(1),
  aiStyleId: z.string().min(1),
  engravingText: z.string().max(30).default(""),
  rushOrder: z.boolean().default(false),
  quantity: z.number().int().min(1).max(100),
  previewImageUrl: z.string().url(),
  originalImageUrl: z.string().url(),
});

async function handle(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "请求体不是合法 JSON" },
      { status: 400 },
    );
  }

  const parsed = pricingInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "pricing 输入参数不合法",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const result = calculatePricing(parsed.data);
    return NextResponse.json({ pricing: result });
  } catch (error) {
    return NextResponse.json(
      {
        error: "PRICING_FAILED",
        message: error instanceof Error ? error.message : "定价失败",
      },
      { status: 500 },
    );
  }
}

export const POST = withApiLogging(handle);
