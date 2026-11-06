/**
 * PATCH /api/store/print-carts/[id]/line-items/[lineId] —— 改交期档位
 * DELETE /api/store/print-carts/[id]/line-items/[lineId] —— 删掉这一行
 *
 * ## 归属校验在路由里
 *
 * 路径里的 id 必须是当前 cookie 里那张打印单 —— 别人的打印单不该能改。
 * (id 能被枚举,所以「查出来是 null」比「403」更合适。)
 *
 * ## 改档位 = 先加后删
 *
 * 档位参与规格 hash,改了 hash 就得跟着改 —— 细节见
 * `storefront/lib/cart-store.ts` 的 `updatePrintLineDeliveryTier()`。
 * 价格是服务端重算的(加价按小计的比例收,见 `delivery-tier.ts`)。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeDeliveryTier } from "@/features/print-quote/lib/delivery-tier";
import {
  getCart,
  getPrintCartId,
  removeLineItem,
  updatePrintLineDeliveryTier,
} from "@/features/storefront/lib/cart-store";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";
/** 一次写入 + 读回 + 逐行重算价 */
export const maxDuration = 15;

const updateTierSchema = z.object({
  deliveryTier: z.enum(["standard", "express", "urgent"]),
});

/**
 * 这张打印单是不是当前请求者的
 *
 * 打印单靠 cookie(`wjp_print_cart_id`)认人 —— 归属校验放这里,
 * 跟「服务端不信客户端带来的价」是同一个思路:路径里的 id 只是线索,
 * 真正的身份是 cookie。
 */
async function isOwnPrintCart(cartId: string): Promise<boolean> {
  const own = await getPrintCartId();
  return Boolean(own) && own === cartId;
}

async function handlePatch(
  request: Request,
  context: { params: Promise<{ id: string; lineId: string }> }
) {
  const { id, lineId } = await context.params;

  if (!(await isOwnPrintCart(id))) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `打印单 ${id} 不存在` },
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

  if (!(await isOwnPrintCart(id))) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `打印单 ${id} 不存在` },
      { status: 404 }
    );
  }

  const cart = await getCart(id);
  if (!cart) {
    return NextResponse.json(
      { error: "CART_NOT_FOUND", message: `打印单 ${id} 不存在` },
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

export const PATCH = withApiLogging(handlePatch);
export const DELETE = withApiLogging(handleDelete);
