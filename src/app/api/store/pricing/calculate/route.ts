/**
 * POST /api/store/pricing/calculate —— mock pricing
 *
 * 对齐 atelier `/api/pricing/calculate`。
 * 定价的真理源在本仓库 —— 结算时服务端会用 pricing.ts 重算一遍,
 * 这个 Route 只是给前端预览用,不会转发到任何外部定价服务。
 *
 * ## 价从 DB 来(2026-11-08)
 *
 * 后台 `/admin/products` 改的是 DB 的价,而这个预览接口原先读的是**代码
 * 常量** ⇒ 定制页显示 ¥19、结算按 ¥25 收,用户看着像「改了不生效」。
 * 这里跟结算走**同一份**价格源(`price-source.ts`),预览跟实收一致。
 *
 * **DB 读失败时降级到代码常量**(预览而已,不是收钱的地方)——
 * 那种情况下结算会直接失败(`PRICING_FAILED`),不会有「按旧价收款」。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getPriceSource } from "@/features/storefront/lib/price-source";
import { calculatePricing } from "@/features/storefront/lib/pricing";
import { withApiLogging } from "@/lib/api-logger";

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
  /** 选中的配件变体 id(2026-11-02 新增) */
  accessoryVariantIds: z.array(z.string().min(1)).default([]),
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
      { status: 400 }
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
      { status: 400 }
    );
  }

  try {
    const source = await getPriceSource();
    const result = calculatePricing(parsed.data, source);
    return NextResponse.json({ pricing: result });
  } catch (error) {
    return NextResponse.json(
      {
        error: "PRICING_FAILED",
        message: error instanceof Error ? error.message : "定价失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(handle);
