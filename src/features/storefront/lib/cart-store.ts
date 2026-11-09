/**
 * 服务端 cart 存储 —— **DB 版**
 *
 * ## 2026-11-04:从进程内 Map 挪到 DB
 *
 * 之前是 `const CARTS = new Map<string, Cart>()`,三个毛病:
 *
 * 1. **重启即丢** —— Vercel 每次冷启动都清空,用户加购的东西没了
 * 2. **多实例各算各的** —— 部署两台,加购请求打到 A 机、结账请求打到 B 机,
 *    B 机压根不知道有这张购物车
 * 3. **后台看不见** —— 工作室想看「有谁在买什么」没处看
 *
 * 现在落在 `cart` / `cart_item` 两张表里,cookie `wjp_cart_id` 不变。
 *
 * ## 「同规格合并」靠数据库判重,不是靠内存比对
 *
 * `cart_item` 上有 `(cart_id, spec_hash)` 唯一索引,加购时用
 * `INSERT … ON CONFLICT DO UPDATE` 原子地累加数量 —— 两个并发请求同时
 * 加同一件商品,数据库保证只留一行、数量加两次。
 *
 * 之前那套「把整个购物车拉下来在内存里逐字段比」的做法在多实例下会
 * 合并出两行(两个请求都读到旧数据)。
 *
 * ## 读购物车时**重算**单价
 *
 * `cart_item.unit_price_cents` 只是**缓存**。落库之后购物车能活过一次
 * 部署,定价源(材质加价 / 配件价 / 基础价)改了之后,存量行带着旧价 ——
 * 结算时用户看到的价跟实际收的价对不上。
 *
 * 所以每次读购物车都按 `metadata` 重算一遍。算不出来(比如某个材质下架了)
 * 就退回存的那个价,别让整个购物车打不开。
 *
 * ## 账号归属
 *
 * cookie 是购物车的**唯一**身份。`cart.user_id` 只在两个时刻有意义:
 *
 * - **结算时**打上(那时必须登录)
 * - **换设备登录时**用它找回「我的购物车」
 *
 * 游客浏览时不做会话查询 —— 那是热路径,每次读购物车都查一次 session 表
 * 太贵。用户登录后 cookie 里还是游客那张车,结算时再打上 user_id。
 *
 * ## 一张车 = **只有目录商品**(2026-11-08)
 *
 * 工作室的说法:**「不要放入购物车,放在这里 account/print-orders」**。
 *
 * 打印服务**不进商城购物袋** —— 它是另一条线:工单自己建、自己收款
 * (`print_order` 那张表,列表在 `/account/print-orders`)。所以这张车里
 * 装的每一行都是**要寄出去的实物**,运费按整张小计算,¥8,到 ¥99 免。
 *
 * 2026-11-08 之前短暂地试过「打印服务并进商城购物袋」(整张车一次付款)
 * —— 那条路整个退回去了。顺带把 `cart.kind` 那一列从 schema 里删掉了:
 * 两张车合成一张,那个维度就没用了,而它在生产库上缺过一次,导致商城购物袋
 * 和打印单全线 500(Drizzle 查车时带上了库里没有的列,PG 报 42703)。
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import { PRICE_CURRENCY, PRICE_REGION_ID } from "@/config/currency";
import { db } from "@/db";
import { type CartItemRow, type CartRow, cart, cartItem } from "@/db/schema";
import {
  type CouponErrorCode,
  normalizeCouponCode,
} from "@/features/coupon/lib/coupon-calc";
import { evaluateCoupon } from "@/features/coupon/lib/coupon-service";
import type { Cart, CartLineItem, CartLineItemMetadata } from "../types";
import { computeSpecHash } from "./cart-spec";
import { findProductById } from "./mock-catalog";
import { getPriceSource } from "./price-source";
import type { PriceSource } from "./price-source-types";
import { calculatePricing, computeQuantityDiscount } from "./pricing";
import { calculateShippingCents } from "./pricing-constants";

/* -------------------------------------------------------------------------- */
/*  Cookie helper                                                            */
/* -------------------------------------------------------------------------- */

export const CART_COOKIE_NAME = "wjp_cart_id";
export const CART_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  /** 7 天(对齐 preview_share 默认过期时间) */
  maxAge: 60 * 60 * 24 * 7,
};

/**
 * 从 cookie 读 cart_id(服务端调用)
 */
export async function getCartId(): Promise<string | null> {
  const store = await cookies();
  return store.get(CART_COOKIE_NAME)?.value ?? null;
}

/**
 * 写 cart_id cookie(服务端调用,通常在 POST /api/store/carts 里)
 */
export async function setCartId(cartId: string): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE_NAME, cartId, CART_COOKIE_OPTIONS);
}

/**
 * 删 cart_id cookie(用于清空购物车)
 */
export async function clearCartId(): Promise<void> {
  const store = await cookies();
  store.delete(CART_COOKIE_NAME);
}

/* -------------------------------------------------------------------------- */
/*  账号归属                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 当前登录用户 id —— 没有会话 / 不在 request 作用域里都返回 null
 *
 * 用 `auth.api.getSession` 而不是自己解 cookie:会话有效性得由 Better Auth
 * 说了算。异常一律吞掉 —— 读购物车不该因为会话查询失败而整个挂掉。
 */
async function getCurrentUserId(): Promise<string | null> {
  try {
    const { getServerSession } = await import("@/lib/auth/server");
    const session = await getServerSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Row → Domain                                                              */
/* -------------------------------------------------------------------------- */

/**
 * 按 metadata 重算一行的价
 *
 * 算不出来就退回存的值 —— 定价规则变了(材质下架 / 配件停售)不该让
 * 整张购物车打不开,但那一行的价得让用户看见(或者让用户自己删掉)。
 *
 * ## `source` —— DB 里的价(2026-11-08)
 *
 * 后台 `/admin/products` 改的是 DB(`product.base_price_cents` /
 * `product_accessory_variant.price_delta_cents`),而这条链路原先读的是**代码
 * 常量** ⇒ 后台改价,商城网页不变。这里把 DB 的价传进来。
 *
 * **购物袋可以降级** —— DB 读失败时 `source.degraded` 为 true,价退回代码
 * 常量,页面照常显示(见 `price-source.ts` 的文件头)。
 * **收钱的地方不许降级** —— 那是 `checkout.ts` 的事,那里直接抛
 * `PRICING_FAILED`。
 */
function repriceLineItem(row: CartItemRow, source: PriceSource): CartLineItem {
  const metadata = row.metadata as unknown as CartLineItemMetadata;

  let unitPriceCents = row.unitPriceCents;
  let discountedUnitPriceCents = row.unitPriceCents;

  const product = findProductById(row.productId);
  if (product) {
    try {
      const pricing = calculatePricing(
        {
          productId: row.productId,
          productHandle: product.handle,
          productTypeCode: product.productTypeCode,
          materialId: metadata.materialId,
          sizeId: metadata.sizeId,
          aiStyleId: metadata.aiStyleId,
          engravingText: metadata.engravingText,
          rushOrder: metadata.rushOrder,
          accessoryVariantIds: metadata.accessoryVariantIds ?? [],
          quantity: row.quantity,
          previewImageUrl: metadata.previewImage,
          originalImageUrl: metadata.originalImage,
        },
        source
      );
      unitPriceCents = pricing.unitPriceCents;
      discountedUnitPriceCents = pricing.discountedUnitPriceCents;
    } catch {
      // 定价失败 → 用存着的价兜底
      //
      // **但阶梯折扣要留着** —— `row.unitPriceCents` 存的是**折前**单价
      // (加购那一刻 `pricing.unitPriceCents` 就是折前的那个)。直接拿它当
      // 折后单价,「买 10 件减 10%」那一档就**丢了** ⇒ 购物袋里摆的价比
      // 结算收的价**高**(结算那边走 `calculatePricing`,折扣是在的)。
      //
      // 兜底跟正算的差别,只在这一档折扣上 —— 别的地方两边一样。
      const fallback = computeQuantityDiscount(
        row.unitPriceCents,
        row.quantity
      );
      unitPriceCents = row.unitPriceCents;
      discountedUnitPriceCents = fallback.discountedUnitPriceCents;
    }
  }

  return {
    id: row.id,
    cartId: row.cartId,
    productId: row.productId,
    productHandle: row.productHandle,
    productTitle: row.productTitle,
    productThumbnail: row.productThumbnail ?? "",
    unitPriceCents,
    discountedUnitPriceCents,
    quantity: row.quantity,
    metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** cart 行 → domain Cart(带 items) */
function toCart(row: CartRow, items: CartItemRow[], source: PriceSource): Cart {
  return {
    id: row.id,
    currencyCode: row.currencyCode as typeof PRICE_CURRENCY,
    regionId: row.regionId,
    items: items.map((item) => repriceLineItem(item, source)),
    couponCode: row.couponCode,
    // 优惠效果是**异步**算的(要查库)—— 见 `buildCart`
    coupon: null,
    couponError: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * cart 行 → domain Cart(**带优惠效果**)
 *
 * ## 优惠码每次读车都**现算**
 *
 * 车上的 `coupon_code` 只存**码**,不存折扣金额 —— 车里的行数会变
 * (加一件 / 删一件),存的金额会过期。
 *
 * 算的时候用**折后小计**(用户看得见的那个数)当门槛基准,跟结算完全一致。
 *
 * ## 算不出来不抛
 *
 * 券过期 / 停用 / 没满门槛 → `coupon = null` + `couponError = 原因码`。
 * 界面据此说人话 + 给一个「去掉优惠码」按钮。
 * **购物袋是给人看的**,不该因为一张失效的券整个打不开。
 */
async function buildCart(
  row: CartRow,
  items: CartItemRow[],
  source: PriceSource
): Promise<Cart> {
  const cart = toCart(row, items, source);
  if (!row.couponCode) return cart;

  const subtotalCents = cart.items.reduce(
    (sum, item) => sum + item.discountedUnitPriceCents * item.quantity,
    0
  );
  const evaluation = await evaluateCoupon({
    code: row.couponCode,
    orderKind: "mall",
    couponBaseCents: subtotalCents,
    // 运费门槛按**折后小计**算(优惠之前)
    shippingCents: calculateShippingCents(subtotalCents),
    // 只有「新人首单券」/「每人限用」的券才会真的调它 —— 热路径不查会话
    resolveUserId: getCurrentUserId,
  });

  return {
    ...cart,
    coupon: evaluation.coupon,
    couponError: evaluation.error,
  };
}

/** 取 cart 的行 */
async function loadCartRow(cartId: string): Promise<CartRow | null> {
  const rows = await db.select().from(cart).where(eq(cart.id, cartId)).limit(1);
  return rows[0] ?? null;
}

/** 取 cart 的行(按创建时间排序) */
async function loadCartItemRows(cartId: string): Promise<CartItemRow[]> {
  return db
    .select()
    .from(cartItem)
    .where(eq(cartItem.cartId, cartId))
    .orderBy(cartItem.createdAt);
}

/* -------------------------------------------------------------------------- */
/*  Cart CRUD                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 新建一张空购物车
 *
 * 不写 cookie —— 写 cookie 的是 `getOrCreateCart`(它知道是不是该复用
 * 已有 cookie)。
 */
export async function createCart(userId?: string | null): Promise<Cart> {
  const id = `cart_${nanoid(16)}`;
  const now = new Date();

  await db.insert(cart).values({
    id,
    userId: userId ?? null,
    currencyCode: PRICE_CURRENCY,
    regionId: PRICE_REGION_ID,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    currencyCode: PRICE_CURRENCY,
    regionId: PRICE_REGION_ID,
    items: [],
    couponCode: null,
    coupon: null,
    couponError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * 取购物车(含行)
 *
 * 找不到返回 null。单价是**重算**过的,不是存的值。
 *
 * 价格源在**这个请求里只查一次**(`cache()`),车有几行都只查一次库。
 */
export async function getCart(cartId: string): Promise<Cart | null> {
  const row = await loadCartRow(cartId);
  if (!row) return null;
  const items = await loadCartItemRows(cartId);
  const source = await getPriceSource();
  return buildCart(row, items, source);
}

/**
 * 这张车是不是**这个人的**
 *
 * 两条路任一成立就算:
 *
 * - **cookie 里那张车就是它** —— 当前浏览器正在用的车(游客车也是)
 * - **车已经过户给这个账号** —— 换设备登录时,车跟着账号走
 *
 * 打印服务行必须过这一关:模型文件落在用户自己的 R2 分区里,归属校验靠
 * 对象键;车也一样,别人的车不该能往里加行(id 能被枚举)。
 *
 * 查不到就是 false —— 查出来是 null 比 403 更合适(id 能被枚举)。
 */
export async function isOwnCart(
  cartId: string,
  userId: string
): Promise<boolean> {
  const cookieId = await getCartId();
  if (cookieId && cookieId === cartId) return true;
  const row = await loadCartRow(cartId);
  return row?.userId === userId;
}

/**
 * 删掉整张购物车(行跟着 cascade 走)
 */
export async function deleteCart(cartId: string): Promise<boolean> {
  const deleted = await db
    .delete(cart)
    .where(eq(cart.id, cartId))
    .returning({ id: cart.id });
  return deleted.length > 0;
}

/**
 * 拿 cart_id 对应的 cart;不存在就创建一张新的
 *
 * 顺序:
 * 1. cookie 里的 cart 还在 → 用它
 * 2. cookie 过期了(或者没有)→ 登录用户找回「我的购物车」
 * 3. 都没有 → 新建
 */
export async function getOrCreateCart(): Promise<Cart> {
  const store = await cookies();
  const cookieId = store.get(CART_COOKIE_NAME)?.value ?? null;

  if (cookieId) {
    const row = await loadCartRow(cookieId);
    if (row) {
      // 这张车如果已经过户给某个账号了,把他别的车并进来(见 `mergeUserCarts`)
      if (row.userId) {
        await mergeUserCarts(row.id, row.userId);
      }
      const items = await loadCartItemRows(cookieId);
      const source = await getPriceSource();
      return buildCart(row, items, source);
    }
    // cookie 指向的 cart 没了(被删了 / 换了库)→ 清掉 cookie 往下走
    store.delete(CART_COOKIE_NAME);
  }

  // cookie 没了 —— 这时候才查一次会话(冷路径,不是热路径)
  const userId = await getCurrentUserId();
  if (userId) {
    const rows = await db
      .select()
      .from(cart)
      .where(eq(cart.userId, userId))
      .orderBy(cart.createdAt);
    const row = rows[0];
    if (row) {
      // 他可能有好几张车(换过设备 / 2026-11-08 之前的两张车)—— 并成一张
      await mergeUserCarts(
        row.id,
        userId,
        rows.slice(1).map((r) => r.id)
      );
      await setCartId(row.id);
      const items = await loadCartItemRows(row.id);
      const source = await getPriceSource();
      return buildCart(row, items, source);
    }
  }

  const created = await createCart(userId);
  await setCartId(created.id);
  return created;
}

/**
 * 把这个人别的车里的行搬进主车(2026-11-08)
 *
 * ## 为什么需要
 *
 * 2026-11-08 之前有「商城购物袋 + 打印单」两张车(同一张表,靠 `kind` 区分,
 * 两个 cookie)。现在合成一张 —— 留着旧车不动的话,那些行就**看不见了**:
 * 用户以为东西还在,结算时才发现少了一单。
 *
 * 合并是**搬行**,不是清空:搬完把旧车删掉。
 *
 * ## 同规格的行合并数量
 *
 * `(cart_id, spec_hash)` 是唯一索引 —— 搬过去可能撞上同样的规格,撞上了
 * 就把数量加起来(跟 `addLineItem()` 的 `ON CONFLICT DO UPDATE` 一个口径)。
 *
 * 打印服务行**不累加数量** —— 一件活一个模型,数量恒为 1(见
 * `addLineItem()`)。同一个模型在两张车里各一行,合并之后还是一件。
 *
 * ## 优惠码:主车的赢(2026-11-08)
 *
 * 主车 = 用户自己的车(有过户的那张),游客车是「额外的车」。
 *
 * - **主车有券** → 主车的赢,游客车那张券丢掉
 * - **主车没券、游客车有券** → 采纳游客车那张
 *
 * 采纳的那张**会被重新校验** —— 因为优惠码每次读车都现算(见
 * `buildCart()`),合并之后小计变了(门槛可能不再满足)、时间也过了(可能
 * 过期)、额度也可能用完了。校验不过就是 `coupon = null` +
 * `couponError` 说人话,**不静默按原价收**。
 */
async function mergeUserCarts(
  primaryId: string,
  userId: string,
  extraIds?: string[]
): Promise<void> {
  const extras =
    extraIds ??
    (
      await db
        .select({ id: cart.id })
        .from(cart)
        .where(and(eq(cart.userId, userId), sql`${cart.id} <> ${primaryId}`))
    ).map((row) => row.id);

  if (extras.length === 0) return;

  const now = new Date();
  for (const extraId of extras) {
    const rows = await db
      .select()
      .from(cartItem)
      .where(eq(cartItem.cartId, extraId));
    for (const item of rows) {
      await db
        .insert(cartItem)
        .values({
          id: `item_${nanoid(16)}`,
          cartId: primaryId,
          productId: item.productId,
          productHandle: item.productHandle,
          productTitle: item.productTitle,
          productThumbnail: item.productThumbnail,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
          metadata: item.metadata,
          specHash: item.specHash,
          createdAt: item.createdAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [cartItem.cartId, cartItem.specHash],
          set: {
            quantity: sql`${cartItem.quantity} + ${item.quantity}`,
            updatedAt: now,
          },
        });
    }

    // 主车没券、游客车有券 → 采纳游客车那张(读车时会重新校验)
    const primary = await loadCartRow(primaryId);
    if (primary && !primary.couponCode) {
      const extra = await loadCartRow(extraId);
      if (extra?.couponCode) {
        await db
          .update(cart)
          .set({ couponCode: extra.couponCode, updatedAt: now })
          .where(eq(cart.id, primaryId));
      }
    }

    await db.delete(cart).where(eq(cart.id, extraId));
  }

  await db.update(cart).set({ updatedAt: now }).where(eq(cart.id, primaryId));
}

/**
 * 给购物车打上主人(结算时调用 —— 那时必须登录)
 *
 * 游客购物车在结算这一刻「过户」给登录用户。
 */
export async function stampCartOwner(
  cartId: string,
  userId: string
): Promise<void> {
  await db
    .update(cart)
    .set({ userId, updatedAt: new Date() })
    .where(eq(cart.id, cartId));
}

/* -------------------------------------------------------------------------- */
/*  优惠码                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 给车**应用**一个优惠码
 *
 * ## 失败时**一个字都不写库**
 *
 * 码不存在 / 过期 / 停用 / 范围不对 / 没满门槛 / 超限 —— 全部返回
 * `{ ok: false, code }`,车的 `coupon_code` **保持原样**。
 *
 * 写坏了的后果:用户在购物袋里看到一个「省了 ¥20」的标签,结算时却没有那
 * 20 块的优惠 —— 用户会问「我的码呢」。
 *
 * ## 空串 = 去掉优惠码
 *
 * 用户明确要摘掉时走这条路 —— 直接把 `coupon_code` 清成 null。
 *
 * ## `options.userId` —— 判身份用的用户 id
 *
 * 「新人首单券」「每人限用」这两种券要判身份。不传就退回去查 cookie 会话
 * (浏览器那条路);调用方已经解析出会话了(比如 Bearer 那条路)就直接传进来,
 * 别再查一次。
 *
 * 传 `null` = **明确**表示「这个人没登录」—— 跟「不传」不是一回事。
 */
export async function setCartCoupon(
  cartId: string,
  code: string,
  options: { userId?: string | null } = {}
): Promise<{ cart: Cart; error: CouponErrorCode | null }> {
  const normalized = normalizeCouponCode(code);

  const resolveUserId = async (): Promise<string | null> => {
    if (options.userId !== undefined) return options.userId;
    return getCurrentUserId();
  };

  // 去掉优惠码
  if (!normalized) {
    await db
      .update(cart)
      .set({ couponCode: null, updatedAt: new Date() })
      .where(eq(cart.id, cartId));
    const cleared = await getCart(cartId);
    if (!cleared) throw new Error(`cart ${cartId} 不存在`);
    return { cart: cleared, error: null };
  }

  const row = await loadCartRow(cartId);
  if (!row) throw new Error(`cart ${cartId} 不存在`);
  const items = await loadCartItemRows(cartId);
  const source = await getPriceSource();
  const current = toCart(row, items, source);

  const subtotalCents = current.items.reduce(
    (sum, item) => sum + item.discountedUnitPriceCents * item.quantity,
    0
  );
  const evaluation = await evaluateCoupon({
    code: normalized,
    orderKind: "mall",
    couponBaseCents: subtotalCents,
    shippingCents: calculateShippingCents(subtotalCents),
    resolveUserId,
  });

  if (evaluation.error || !evaluation.coupon) {
    // **不写库** —— 车上的码原样保留
    return {
      cart: current,
      error: evaluation.error ?? "COUPON_NOT_FOUND",
    };
  }

  await db
    .update(cart)
    .set({ couponCode: normalized, updatedAt: new Date() })
    .where(eq(cart.id, cartId));

  const fresh = await getCart(cartId);
  if (!fresh) throw new Error(`cart ${cartId} 不存在`);
  // 以**这次**判定为准 —— `getCart()` 内部查的是 cookie 会话,
  // 调用方传了 `userId` 的话这里可能不是同一个判断。
  return {
    cart: { ...fresh, coupon: evaluation.coupon, couponError: null },
    error: null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Line item 操作                                                           */
/* -------------------------------------------------------------------------- */

export interface AddLineItemInput {
  productId: string;
  spec: CartLineItemMetadata;
  quantity?: number;
}

/**
 * 加 line item 到 cart
 *
 * - 同 spec 完全一致的 item 合并数量(靠 `(cart_id, spec_hash)` 唯一索引)
 * - 不一致则新增
 *
 * 合并用 `ON CONFLICT DO UPDATE` + 数据库里的 `quantity + excluded.quantity`
 * —— 原子操作,两个并发请求不会合并出两行,也不会丢掉一次加购。
 *
 * ## 这张车**只有目录商品**(2026-11-08)
 *
 * 打印服务**不进商城购物袋** —— 工单自己建、自己收款(见
 * `POST /api/print-orders`)。所以这里没有「打印服务行」那条分支:每一行
 * 都是目录里的商品,都查 `mock-catalog`,都按数量阶梯折扣算价。
 */
export async function addLineItem(
  cartId: string,
  input: AddLineItemInput
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  const cartRow = await loadCartRow(cartId);
  if (!cartRow) throw new Error(`cart ${cartId} 不存在`);

  const product = findProductById(input.productId);
  if (!product) throw new Error(`产品 ${input.productId} 不存在`);

  const quantity = input.quantity ?? 1;

  // 定价永远是服务端算的 —— 客户端带来的价一律不信
  //
  // 价从 **DB** 来(后台 `/admin/products` 改的就是它)——
  // 查不到就退回代码常量,购物袋可以降级(见 `price-source.ts`)。
  const source = await getPriceSource();
  const pricing = calculatePricing(
    {
      productId: input.productId,
      productHandle: product.handle,
      productTypeCode: product.productTypeCode,
      materialId: input.spec.materialId,
      sizeId: input.spec.sizeId,
      aiStyleId: input.spec.aiStyleId,
      engravingText: input.spec.engravingText,
      rushOrder: input.spec.rushOrder,
      accessoryVariantIds: input.spec.accessoryVariantIds ?? [],
      quantity,
      previewImageUrl: input.spec.previewImage,
      originalImageUrl: input.spec.originalImage,
    },
    source
  );

  const productId = input.productId;
  const productHandle = product.handle;
  const productTitle = product.title;
  const productThumbnail = product.thumbnail;
  const unitPriceCents = pricing.unitPriceCents;

  const specHash = computeSpecHash({
    productId,
    materialId: input.spec.materialId,
    sizeId: input.spec.sizeId,
    aiStyleId: input.spec.aiStyleId,
    engravingText: input.spec.engravingText,
    rushOrder: input.spec.rushOrder,
    accessoryVariantIds: input.spec.accessoryVariantIds ?? [],
    previewImage: input.spec.previewImage,
  });

  const now = new Date();

  // 命中已有行 → 数量累加;否则插新行
  const inserted = await db
    .insert(cartItem)
    .values({
      id: `item_${nanoid(16)}`,
      cartId,
      productId,
      productHandle,
      productTitle,
      productThumbnail,
      unitPriceCents,
      quantity,
      metadata: input.spec as unknown as Record<string, unknown>,
      specHash,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [cartItem.cartId, cartItem.specHash],
      set: {
        // 数量原子累加 —— 单价用最新的定价覆盖
        quantity: sql`${cartItem.quantity} + ${quantity}`,
        unitPriceCents,
        updatedAt: now,
      },
    })
    .returning();

  const row = inserted[0];
  if (!row) throw new Error("加入购物车失败");

  await db.update(cart).set({ updatedAt: now }).where(eq(cart.id, cartId));

  const fresh = await getCart(cartId);
  if (!fresh) throw new Error(`cart ${cartId} 不存在`);

  return {
    cart: fresh,
    lineItem: repriceLineItem(row, source),
  };
}

/**
 * 改数量(qty < 1 等同于删除)
 */
export async function updateLineItemQuantity(
  cartId: string,
  lineItemId: string,
  quantity: number
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  if (quantity < 1) {
    return removeLineItem(cartId, lineItemId);
  }

  const existing = await db
    .select({ id: cartItem.id })
    .from(cartItem)
    .where(and(eq(cartItem.id, lineItemId), eq(cartItem.cartId, cartId)))
    .limit(1);
  const existingRow = existing[0];
  if (!existingRow) throw new Error(`line item ${lineItemId} 不存在`);

  const rows = await db
    .update(cartItem)
    .set({ quantity, updatedAt: new Date() })
    .where(and(eq(cartItem.id, lineItemId), eq(cartItem.cartId, cartId)))
    .returning();

  const row = rows[0];
  if (!row) throw new Error(`line item ${lineItemId} 不存在`);

  await db
    .update(cart)
    .set({ updatedAt: new Date() })
    .where(eq(cart.id, cartId));

  const fresh = await getCart(cartId);
  if (!fresh) throw new Error(`cart ${cartId} 不存在`);

  const source = await getPriceSource();
  return {
    cart: fresh,
    lineItem: repriceLineItem(row, source),
  };
}

/**
 * 删一行
 */
export async function removeLineItem(
  cartId: string,
  lineItemId: string
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  const rows = await db
    .delete(cartItem)
    .where(and(eq(cartItem.id, lineItemId), eq(cartItem.cartId, cartId)))
    .returning();

  const row = rows[0];
  if (!row) throw new Error(`line item ${lineItemId} 不存在`);

  await db
    .update(cart)
    .set({ updatedAt: new Date() })
    .where(eq(cart.id, cartId));

  const fresh = await getCart(cartId);
  if (!fresh) throw new Error(`cart ${cartId} 不存在`);

  const source = await getPriceSource();
  return {
    cart: fresh,
    lineItem: repriceLineItem(row, source),
  };
}

/**
 * 清空购物车的行(下单成功后用 —— 购物车留着但清空,用户还能看到订单)
 */
export async function clearCartItems(cartId: string): Promise<void> {
  await db.delete(cartItem).where(eq(cartItem.cartId, cartId));
  await db
    .update(cart)
    .set({ updatedAt: new Date() })
    .where(eq(cart.id, cartId));
}

/**
 * 把「已经买掉的那些行」从用户的购物车里摘掉
 *
 * ## 什么时候用
 *
 * 2026-11-05 起购物车改成**付款成功才清空** —— 下单那一刻不动购物车,
 * 钱到了才摘掉买掉的那些行。没付钱就走的用户,购物车还是原样。
 *
 * ## 只摘买掉的那些
 *
 * 用户付款之后可能又往购物车里加了别的行 —— 那些得留着。所以不是「清空
 * 购物车」,而是「把买掉的那几行摘掉」。
 *
 * ## 按 `spec_hash` 摘,不是按行 id
 *
 * 订单行和购物车行不是同一张表,也没有共同的行 id。能对上的是**规格
 * hash** —— 同一份规格在哪儿都是同一个 hash(见 `cart-spec.ts`)。
 *
 * ## 是「减数量」不是「删行」
 *
 * 购物车里 3 件、订单里买了 2 件 → 购物车剩 1 件,不是整行删掉。
 *
 * ## 找哪些购物车
 *
 * `cart.user_id` —— 结算时打过户(见 `stampCartOwner`),所以这一列找得到
 * 这个人的所有购物车(换设备登录也在内)。已经买过的规格,别的设备上也不该
 * 再留着让人重复下单。
 *
 * ## 顺手**清掉优惠码**(2026-11-08)
 *
 * 优惠码是**订单级**的 —— 这一单已经用它了。留着的话,下一单会**自动**
 * 带着上一张券(用户没选过),而且那张券可能已经超限 / 过期。
 *
 * 留着它的后果是「用户没输码,却莫名其妙便宜了」—— 下一次结账时金额跟
 * 购物袋里看到的不一样,用户会问「我的码呢」。
 */
export async function removeOrderedLinesFromCarts(
  userId: string,
  ordered: Array<{ specHash: string; quantity: number }>
): Promise<void> {
  if (ordered.length === 0) return;

  const cartRows = await db
    .select({ id: cart.id })
    .from(cart)
    .where(eq(cart.userId, userId));
  if (cartRows.length === 0) return;

  const cartIds = cartRows.map((row) => row.id);
  const bought = new Map(ordered.map((line) => [line.specHash, line.quantity]));

  const rows = await db
    .select({
      id: cartItem.id,
      specHash: cartItem.specHash,
      quantity: cartItem.quantity,
    })
    .from(cartItem)
    .where(
      and(
        inArray(cartItem.cartId, cartIds),
        inArray(cartItem.specHash, [...bought.keys()])
      )
    );

  const now = new Date();
  if (rows.length > 0) {
    for (const row of rows) {
      const quantity = bought.get(row.specHash);
      if (quantity === undefined) continue;
      const remaining = row.quantity - quantity;
      if (remaining > 0) {
        await db
          .update(cartItem)
          .set({ quantity: remaining, updatedAt: now })
          .where(eq(cartItem.id, row.id));
      } else {
        await db.delete(cartItem).where(eq(cartItem.id, row.id));
      }
    }
  }

  await db
    .update(cart)
    .set({ couponCode: null, updatedAt: now })
    .where(inArray(cart.id, cartIds));
}
