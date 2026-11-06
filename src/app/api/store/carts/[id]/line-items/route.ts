/**
 * POST /api/store/carts/[id]/line-items —— 加 line item 到**商城购物袋**
 *
 * 同规格的行会合并数量(靠 `(cart_id, spec_hash)` 唯一索引)。
 *
 * ## 这里只放目录商品(2026-11-06)
 *
 * 打印服务**不走商城购物袋** —— 工作室的说法:「模型打印是不走商城正常的
 * 购物车的,而是走打印下单」。打印服务行走
 * `POST /api/store/print-carts/[id]/line-items`(另一张车、另一个 cookie)。
 *
 * 所以这个接口**只认目录商品行**:带 `printSpec` 的请求直接 400,并把话
 * 直接说给用户听(带路去打印单页面)。
 *
 * 关卡在**数据层**(`cart-store.ts` 的 `addLineItem()`)—— 这里只是提前
 * 拦一道,好把话说清楚。绕过界面直接调 API 也进不去。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { CartKindMismatchError } from "@/features/storefront/lib/cart-kind";
import { addLineItem, getCart } from "@/features/storefront/lib/cart-store";
import type { CartLineItemMetadata } from "@/features/storefront/types";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";
/** 一次写入 + 读回 + 逐行重算价 */
export const maxDuration = 15;

/** 目录商品行 */
const catalogLineSchema = z.object({
  productId: z.string(),
  productHandle: z.string(),
  productTitle: z.string(),
  productThumbnail: z.string().url(),
  materialId: z.string().min(1),
  sizeId: z.string().min(1),
  sizeCm: z.number().int().positive(),
  aiStyleId: z.string().min(1),
  engravingText: z.string().max(30).default(""),
  rushOrder: z.boolean().default(false),
  /** 选中的配件变体 id(2026-11-02 新增) */
  accessoryVariantIds: z.array(z.string().min(1)).default([]),
  previewImage: z.string().url(),
  originalImage: z.string().url(),
});

const lineItemSchema = z.object({
  productId: z.string().min(1),
  /**
   * 目录商品行
   *
   * 打印服务那一套字段(`printSpec`)在这个接口里**不被接受** —— 判据是
   * 「有没有 printSpec」,不是 productId(见 `storefront/lib/print-service.ts`)。
   */
  spec: catalogLineSchema,
  quantity: z.number().int().min(1).max(100).default(1),
});

async function handle(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const cart = await getCart(id);
  if (!cart) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `cart ${id} 不存在` },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "请求体不是合法 JSON" },
      { status: 400 }
    );
  }

  const parsed = lineItemSchema.safeParse(body);
  if (!parsed.success) {
    // 带 printSpec 的请求会落到这里(zod 的 union 换成单条分支了)——
    // 那说明用户想加的是打印服务,话要说得准:带他去打印单页面,
    // 而不是「输入不合法」。
    const raw = body as { spec?: { printSpec?: unknown } } | null;
    if (raw?.spec && typeof raw.spec === "object" && "printSpec" in raw.spec) {
      return NextResponse.json(
        {
          error: "PRINT_SERVICE_NOT_ALLOWED",
          message: "打印服务不走商城购物袋,请到「打印单」页面下单",
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "line item 输入不合法",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  try {
    const result = await addLineItem(id, {
      productId: parsed.data.productId,
      spec: parsed.data.spec as CartLineItemMetadata,
      quantity: parsed.data.quantity,
    });
    return NextResponse.json(
      { cart: result.cart, lineItem: result.lineItem },
      { status: 201 }
    );
  } catch (error) {
    // 放错车 —— 400,话术带上路
    if (error instanceof CartKindMismatchError) {
      return NextResponse.json(
        { error: "CART_KIND_MISMATCH", message: error.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error: "ADD_LINE_ITEM_FAILED",
        message: error instanceof Error ? error.message : "加入购物车失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(handle);
