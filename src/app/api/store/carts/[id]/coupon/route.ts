/**
 * POST /api/store/carts/[id]/coupon —— 给购物袋**应用 / 摘掉**优惠码
 *
 * body `{ code }` —— **空串 = 摘掉**优惠码。
 *
 * ## 优惠码住在**车上**,不在结算的 body 里
 *
 * 结算接口(`POST /api/store/checkout`)的 body **没有** `couponCode` 字段 ——
 * 车是服务端从 DB 读的,码就在车那一行上。少一个入口,少一处能传错的地方。
 *
 * ## 失败时**一个字节都不写库**
 *
 * 码不存在 / 过期 / 停用 / 范围不对 / 没满门槛 / 超限 —— 全部返 **400** +
 * 一个**稳定的原因码**(`couponErrorCode`),车的 `coupon_code` 原样保留。
 *
 * 写坏了的后果:购物袋里摆着「省了 ¥20」的标签,结算时却没有那 20 块的优惠 ——
 * 用户会问「我的码呢」。
 *
 * ## 归属校验在**数据层**
 *
 * 两条路任一成立就算这张车是这个人的:
 *
 * - cookie 里那张车就是它(游客车也是 —— 游客也能用券)
 * - 车已经过户给这个账号(换设备登录)
 *
 * 查不到就返 **404**(不是 403)—— id 能被枚举。
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getCartId,
  isOwnCart,
  setCartCoupon,
} from "@/features/storefront/lib/cart-store";
import { withApiLogging } from "@/lib/api-logger";
import { getSessionFromRequest } from "@/lib/auth/request-session";

export const runtime = "nodejs";
/** 一次 DB 查询 + 查券 + 逐行重算价 */
export const maxDuration = 15;

const couponBodySchema = z.object({
  /** 用户输入的码 —— 归一化(大写 + 去空格)在 `setCartCoupon` 里做 */
  code: z.string().max(64).default(""),
});

async function handle(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // 1. 解析 body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "请求体不是合法 JSON" },
      { status: 400 }
    );
  }

  const parsed = couponBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "优惠码输入不合法",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  // 2. 归属校验 —— cookie 里那张车,或者已经过户给这个账号的
  const session = await getSessionFromRequest(request);
  const cookieCartId = await getCartId();
  const ownsByCookie = Boolean(cookieCartId && cookieCartId === id);

  if (!ownsByCookie) {
    // cookie 不是这张车 → 只能靠「这张车过户给了这个账号」
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "CART_NOT_FOUND", message: `cart ${id} 不存在` },
        { status: 404 }
      );
    }
    const owns = await isOwnCart(id, session.user.id);
    if (!owns) {
      return NextResponse.json(
        { error: "CART_NOT_FOUND", message: `cart ${id} 不存在` },
        { status: 404 }
      );
    }
  }

  // 3. 应用 / 摘掉
  try {
    const result = await setCartCoupon(id, parsed.data.code, {
      userId: session?.user?.id ?? null,
    });

    if (result.error) {
      // **没写库** —— 车上的码原样保留
      return NextResponse.json(
        {
          error: "COUPON_INVALID",
          couponErrorCode: result.error,
          message: "这个优惠码用不了",
          cart: result.cart,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ cart: result.cart });
  } catch (error) {
    return NextResponse.json(
      {
        error: "APPLY_COUPON_FAILED",
        message: error instanceof Error ? error.message : "应用优惠码失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(handle);
