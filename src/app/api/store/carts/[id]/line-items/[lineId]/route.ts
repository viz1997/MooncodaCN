/**
 * PUT /api/store/carts/[id]/line-items/[lineId] —— 更新 line item 数量
 * PATCH /api/store/carts/[id]/line-items/[lineId] —— 改打印服务行的交期档位
 * DELETE /api/store/carts/[id]/line-items/[lineId] —— 删除 line item
 *
 * 数量改成 0(或更小)等同删除。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeDeliveryTier } from "@/features/print-quote/lib/delivery-tier";
import {
  getCart,
  isOwnCart,
  removeLineItem,
  updateLineItemQuantity,
  updatePrintLineDeliveryTier,
} from "@/features/storefront/lib/cart-store";
import { withApiLogging } from "@/lib/api-logger";
import { getSessionFromRequest } from "@/lib/auth/request-session";

export const runtime = "nodejs";
/** 一次写入 + 读回 + 逐行重算价 */
export const maxDuration = 15;

const updateQuantitySchema = z.object({
  quantity: z.number().int().min(0).max(100),
});

const updateTierSchema = z.object({
  deliveryTier: z.enum(["standard", "express", "urgent"]),
});

async function handlePut(
  request: Request,
  context: { params: Promise<{ id: string; lineId: string }> }
) {
  const { id, lineId } = await context.params;
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

  const parsed = updateQuantitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "quantity 必须在 0-100 之间(0 等同于删除)",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  try {
    const result = await updateLineItemQuantity(
      id,
      lineId,
      parsed.data.quantity
    );
    return NextResponse.json({ cart: result.cart, lineItem: result.lineItem });
  } catch (error) {
    return NextResponse.json(
      {
        error: "UPDATE_FAILED",
        message: error instanceof Error ? error.message : "更新数量失败",
      },
      { status: 500 }
    );
  }
}

/**
 * 改打印服务行的交期档位
 *
 * ## 归属校验在路由里
 *
 * 路径里的 id 必须是当前这个人的车 —— 别人的车不该能改(id 能被枚举,所以
 * 「查出来是 null」比 403 更合适)。
 *
 * 打印服务必须登录才能加,所以改档位也要登录。
 *
 * ## 改档位 = 先加后删
 *
 * 档位参与规格 hash,改了 hash 就得跟着改 —— 细节见
 * `storefront/lib/cart-store.ts` 的 `updatePrintLineDeliveryTier()`。
 * 价格是服务端重算的(加价按小计的比例收,见 `delivery-tier.ts`)。
 */
async function handlePatch(
  request: Request,
  context: { params: Promise<{ id: string; lineId: string }> }
) {
  const { id, lineId } = await context.params;

  const session = await getSessionFromRequest(request);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "AUTH_REQUIRED", message: "改交期需要先登录" },
      { status: 401 }
    );
  }

  if (!(await isOwnCart(id, userId))) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `购物车 ${id} 不存在` },
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

  const parsed = updateTierSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "交期档位不合法(standard / express / urgent)",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  try {
    const result = await updatePrintLineDeliveryTier(
      id,
      lineId,
      // 认不出来的档位一律按标准档(不额外收费)
      normalizeDeliveryTier(parsed.data.deliveryTier)
    );
    return NextResponse.json({ cart: result.cart, lineItem: result.lineItem });
  } catch (error) {
    return NextResponse.json(
      {
        error: "UPDATE_FAILED",
        message: error instanceof Error ? error.message : "改交期失败",
      },
      { status: 500 }
    );
  }
}

async function handleDelete(
  _request: Request,
  context: { params: Promise<{ id: string; lineId: string }> }
) {
  const { id, lineId } = await context.params;
  const cart = await getCart(id);
  if (!cart) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `cart ${id} 不存在` },
      { status: 404 }
    );
  }

  try {
    const result = await removeLineItem(id, lineId);
    return NextResponse.json({ cart: result.cart });
  } catch (error) {
    return NextResponse.json(
      {
        error: "DELETE_FAILED",
        message: error instanceof Error ? error.message : "删除失败",
      },
      { status: 500 }
    );
  }
}

export const PUT = withApiLogging(handlePut);
export const PATCH = withApiLogging(handlePatch);
export const DELETE = withApiLogging(handleDelete);
