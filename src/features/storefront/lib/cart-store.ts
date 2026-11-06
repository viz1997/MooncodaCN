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
 * ## 两种车(2026-11-06)
 *
 * 打印服务**不再走商城购物袋** —— 工作室的说法:「模型打印是不走商城正常
 * 的购物车的,而是走打印下单」。
 *
 * | 性质 | 装什么 | cookie |
 * |---|---|---|
 * | `storefront` 商城购物袋 | 只放目录商品 | `wjp_cart_id` |
 * | `print` 打印单 | 只放打印服务(自带模型) | `wjp_print_cart_id` |
 *
 * 两种车在同一张 `cart` 表里,靠 `cart.kind` 区分。**关卡在数据层**:
 * `addLineItem()` 拒绝放错车的行 —— 绕过界面的直接调 API 也进不去。
 * 读车的时候也按性质过滤(`toCart()`),所以老购物车里混着的打印服务行
 * 不会出现在商城购物袋里。
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";
import { PRICE_CURRENCY, PRICE_REGION_ID } from "@/config/currency";
import { db } from "@/db";
import { type CartItemRow, type CartRow, cart, cartItem } from "@/db/schema";
import type { DeliveryTierId } from "@/features/print-quote/lib/delivery-tier";
import { computePrintServiceLinePrice } from "@/features/print-quote/lib/quote-server";
import type { Cart, CartLineItem, CartLineItemMetadata } from "../types";
import {
  assertLineAllowedInCart,
  type CartKind,
  isLineAllowedInCart,
  normalizeCartKind,
  PRINT_CART_KIND,
  STOREFRONT_CART_KIND,
} from "./cart-kind";
import { computeSpecHash } from "./cart-spec";
import { findProductById } from "./mock-catalog";
import { calculatePricing } from "./pricing";
import {
  getPrintServiceSpec,
  PRINT_SERVICE_HANDLE,
  PRINT_SERVICE_PRODUCT_ID,
  PRINT_SERVICE_TITLE,
  printServiceSpecToQuoteInput,
} from "./print-service";

/* -------------------------------------------------------------------------- */
/*  Cookie helper                                                            */
/* -------------------------------------------------------------------------- */

export const CART_COOKIE_NAME = "wjp_cart_id";
/**
 * 打印单的 cookie(2026-11-06)
 *
 * 跟商城购物袋**分开** —— 两张车两种性质,不能共用一个 cookie:共用的话
 * 「商城购物袋」会指向一张打印单(或者反过来),用户在商城里结算时看到的是
 * 一堆打印服务行。
 */
export const PRINT_CART_COOKIE_NAME = "wjp_print_cart_id";
export const CART_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  /** 7 天(对齐 preview_share 默认过期时间) */
  maxAge: 60 * 60 * 24 * 7,
};

/** 性质 → cookie 名 */
export function cartCookieName(kind: CartKind): string {
  return kind === PRINT_CART_KIND ? PRINT_CART_COOKIE_NAME : CART_COOKIE_NAME;
}

/**
 * 从 cookie 读 cart_id(服务端调用)
 */
export async function getCartId(): Promise<string | null> {
  const store = await cookies();
  return store.get(CART_COOKIE_NAME)?.value ?? null;
}

/**
 * 从 cookie 读打印单的 id(服务端调用)
 */
export async function getPrintCartId(): Promise<string | null> {
  const store = await cookies();
  return store.get(PRINT_CART_COOKIE_NAME)?.value ?? null;
}

/**
 * 写 cart_id cookie(服务端调用,通常在 POST /api/store/carts 里)
 */
export async function setCartId(cartId: string): Promise<void> {
  const store = await cookies();
  store.set(CART_COOKIE_NAME, cartId, CART_COOKIE_OPTIONS);
}

/**
 * 写打印单的 cookie
 */
export async function setPrintCartId(cartId: string): Promise<void> {
  const store = await cookies();
  store.set(PRINT_CART_COOKIE_NAME, cartId, CART_COOKIE_OPTIONS);
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
 * 打印服务行走的是另一套定价(按克重),见 `computePrintServiceLinePrice()`。
 */
function repriceLineItem(row: CartItemRow): CartLineItem {
  let metadata = row.metadata as unknown as CartLineItemMetadata;

  let unitPriceCents = row.unitPriceCents;
  let discountedUnitPriceCents = row.unitPriceCents;

  const printSpec = getPrintServiceSpec(metadata);
  if (printSpec) {
    // 打印服务行:按克重计价,不查目录
    const priced = computePrintServiceLinePrice(
      printServiceSpecToQuoteInput(printSpec)
    );
    if (priced) {
      unitPriceCents = priced.unitPriceCents;
      discountedUnitPriceCents = priced.discountedUnitPriceCents;
      // 耗材克重 / 交期加价 / 各档比例 由**服务端**回填 —— 客户端没有材料
      // 密度,也不认一份加价比例(比例可以用环境变量调)。
      // 都只影响展示(购物车里显示「XX g」、打印单上摆出三档的加价),不参与定价。
      metadata = {
        ...metadata,
        printSpec: {
          ...printSpec,
          materialWeightG: priced.quote.materialWeightG,
          deliveryFeeCents: priced.quote.deliveryFeeCents,
          deliveryRates: priced.quote.deliveryRates,
        },
      };
    }
  } else {
    const product = findProductById(row.productId);
    if (product) {
      try {
        const pricing = calculatePricing({
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
        });
        unitPriceCents = pricing.unitPriceCents;
        discountedUnitPriceCents = pricing.discountedUnitPriceCents;
      } catch {
        // 定价失败 → 用存着的价兜底
      }
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
function toCart(row: CartRow, items: CartItemRow[]): Cart {
  const kind = normalizeCartKind(row.kind);
  return {
    id: row.id,
    kind,
    currencyCode: row.currencyCode as typeof PRICE_CURRENCY,
    regionId: row.regionId,
    // 按性质过滤 —— 商城购物袋里不会有打印服务行,打印单里不会有目录商品行。
    //
    // 老购物车(2026-11-06 之前)可能混着打印服务行(那是「打印服务进商城
    // 购物车」那版留下的),那些行**还在库里**,只是不再出现在商城购物袋里。
    items: items
      .filter((item) =>
        isLineAllowedInCart(
          kind,
          item.metadata as unknown as CartLineItemMetadata
        )
      )
      .map(repriceLineItem),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
 *
 * `kind` 决定这张车能装什么:商城购物袋只装目录商品,打印单只装打印服务。
 */
export async function createCart(
  userId?: string | null,
  kind: CartKind = STOREFRONT_CART_KIND
): Promise<Cart> {
  const id = `cart_${nanoid(16)}`;
  const now = new Date();

  await db.insert(cart).values({
    id,
    userId: userId ?? null,
    kind,
    currencyCode: PRICE_CURRENCY,
    regionId: PRICE_REGION_ID,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    kind,
    currencyCode: PRICE_CURRENCY,
    regionId: PRICE_REGION_ID,
    items: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * 取购物车(含行)
 *
 * 找不到返回 null。单价是**重算**过的,不是存的值。
 */
export async function getCart(cartId: string): Promise<Cart | null> {
  const row = await loadCartRow(cartId);
  if (!row) return null;
  const items = await loadCartItemRows(cartId);
  return toCart(row, items);
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
 *
 * **只找商城购物袋**(`kind = "storefront"`)—— 打印单是另一张车,另一个
 * cookie。混起来的话,用户在商城里结算时看到的会是一堆打印服务行。
 */
export async function getOrCreateCart(): Promise<Cart> {
  return getOrCreateCartOfKind(STOREFRONT_CART_KIND);
}

/**
 * 拿打印单;不存在就创建一张新的
 *
 * 跟 `getOrCreateCart()` 是同一个流程,只是 cookie 和性质不同。
 */
export async function getOrCreatePrintCart(): Promise<Cart> {
  return getOrCreateCartOfKind(PRINT_CART_KIND);
}

/**
 * 按性质拿车(两种车共用这一份流程)
 */
async function getOrCreateCartOfKind(kind: CartKind): Promise<Cart> {
  const cookieName = cartCookieName(kind);
  const store = await cookies();
  const cookieId = store.get(cookieName)?.value ?? null;

  if (cookieId) {
    const row = await loadCartRow(cookieId);
    // cookie 指向的车**性质对得上**才认 —— 否则清掉 cookie 往下走
    // (老 cookie 指向的车没有 kind 列,迁移后默认 storefront,打印单的
    //  cookie 撞上商城车的情况只可能出现在手工改过 cookie 的情况下)
    if (row && normalizeCartKind(row.kind) === kind) {
      const items = await loadCartItemRows(cookieId);
      return toCart(row, items);
    }
    // cookie 指向的 cart 没了(被删了 / 换了库)→ 清掉 cookie 往下走
    store.delete(cookieName);
  }

  // cookie 没了 —— 这时候才查一次会话(冷路径,不是热路径)
  const userId = await getCurrentUserId();
  if (userId) {
    const rows = await db
      .select()
      .from(cart)
      .where(and(eq(cart.userId, userId), eq(cart.kind, kind)))
      .limit(1);
    const row = rows[0];
    if (row) {
      if (kind === PRINT_CART_KIND) {
        await setPrintCartId(row.id);
      } else {
        await setCartId(row.id);
      }
      const items = await loadCartItemRows(row.id);
      return toCart(row, items);
    }
  }

  const created = await createCart(userId, kind);
  if (kind === PRINT_CART_KIND) {
    await setPrintCartId(created.id);
  } else {
    await setCartId(created.id);
  }
  return created;
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
 * ## 打印服务行
 *
 * `spec.printSpec` 有值就是打印服务行:
 * - 不查目录(打印服务不在 `mock-catalog` 里)
 * - 定价走 `computePrintServiceLinePrice()`(按克重)
 * - **数量恒为 1** —— 一件活一个模型,客户端传什么都按 1 算
 *
 * ## 放错车 → 抛错(2026-11-06)
 *
 * 商城购物袋只放目录商品,打印单只放打印服务。**关卡在数据层** ——
 * 绕过界面的直接调 API 也进不去。抛的是 `CartKindMismatchError`,
 * 路由层翻译成 400 并把话带给用户(见 `storefront/lib/cart-kind.ts`)。
 */
export async function addLineItem(
  cartId: string,
  input: AddLineItemInput
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  const cartRow = await loadCartRow(cartId);
  if (!cartRow) throw new Error(`cart ${cartId} 不存在`);

  const kind = normalizeCartKind(cartRow.kind);
  const printSpec = getPrintServiceSpec(input.spec);

  // 放错车 → 拒(不是静默忽略:用户点了「加入」却什么都没发生,最费解)
  assertLineAllowedInCart(kind, input.spec);

  let productId: string;
  let productHandle: string;
  let productTitle: string;
  let productThumbnail: string;
  let unitPriceCents: number;
  let quantity: number;

  if (printSpec) {
    // 打印服务行 —— 按克重计价,不走目录
    const priced = computePrintServiceLinePrice(
      printServiceSpecToQuoteInput(printSpec)
    );
    if (!priced) {
      throw new Error("这组模型数据算不出报价,请回工具页重新测量");
    }
    unitPriceCents = priced.unitPriceCents;
    // productId 用**服务端**的哨兵值,不信客户端传来的
    productId = PRINT_SERVICE_PRODUCT_ID;
    productHandle = PRINT_SERVICE_HANDLE;
    productTitle = PRINT_SERVICE_TITLE;
    // 打印服务行**没有封面图** —— 手上有的是模型文件(一个 zip)。
    // 塞 zip 的 URL 进 `<img src>` 只会显示裂图;购物车认到 printSpec
    // 会改画包裹图标。
    productThumbnail = "";
    // 打印服务恒为一件 —— 数量阶梯折扣对它没有意义
    quantity = 1;
  } else {
    const product = findProductById(input.productId);
    if (!product) throw new Error(`产品 ${input.productId} 不存在`);

    quantity = input.quantity ?? 1;

    // 定价永远是服务端算的 —— 客户端带来的价一律不信
    const pricing = calculatePricing({
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
    });
    unitPriceCents = pricing.unitPriceCents;
    productId = input.productId;
    productHandle = product.handle;
    productTitle = product.title;
    productThumbnail = product.thumbnail;
  }

  const specHash = computeSpecHash({
    productId,
    materialId: input.spec.materialId,
    sizeId: input.spec.sizeId,
    aiStyleId: input.spec.aiStyleId,
    engravingText: input.spec.engravingText,
    rushOrder: input.spec.rushOrder,
    accessoryVariantIds: input.spec.accessoryVariantIds ?? [],
    previewImage: input.spec.previewImage,
    printSpec: printSpec ?? undefined,
  });

  const now = new Date();

  // 命中已有行 → 数量累加;否则插新行
  //
  // 打印服务行的数量**恒为 1** —— 同一个模型加购两次不是「两件」,还是一件
  // (两件得是两个不同的模型文件,而模型对象键在 hash 里,不同模型本来就
  // 是两行)。所以这里不累加,直接置 1。
  const conflictQuantity = printSpec
    ? 1
    : sql`${cartItem.quantity} + ${quantity}`;

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
        quantity: conflictQuantity,
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

  return { cart: fresh, lineItem: repriceLineItem(row) };
}

/**
 * 改数量(qty < 1 等同于删除)
 *
 * 打印服务行的数量**恒为 1** —— 一件活一个模型,加购两次还是那一件
 * (要买两件就得是两个不同的模型文件,那本来就是两行)。客户端传 3 也按 1 写。
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
    .select({ id: cartItem.id, metadata: cartItem.metadata })
    .from(cartItem)
    .where(and(eq(cartItem.id, lineItemId), eq(cartItem.cartId, cartId)))
    .limit(1);
  const existingRow = existing[0];
  if (!existingRow) throw new Error(`line item ${lineItemId} 不存在`);

  const metadata = existingRow.metadata as unknown as CartLineItemMetadata;
  const finalQuantity = getPrintServiceSpec(metadata) ? 1 : quantity;

  const rows = await db
    .update(cartItem)
    .set({ quantity: finalQuantity, updatedAt: new Date() })
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

  return { cart: fresh, lineItem: repriceLineItem(row) };
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

  return { cart: fresh, lineItem: repriceLineItem(row) };
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
 * 改打印服务行的交期档位(打印单专用)
 *
 * ## 为什么不直接 UPDATE 那一行
 *
 * 档位参与「同 spec 合并」的 hash(见 `print-service.ts` 的
 * `printServiceSpecHashParts()`)—— 改了档位,hash 就变了,那一行的
 * `spec_hash` 也得跟着改。直接改 metadata 而不改 hash,这一行就跟自己的
 * 规格对不上了:后面再加同样规格的东西,合并判据会失灵(算出两个 hash)。
 *
 * ## 所以是「先加后删」
 *
 * 1. 按新档位 `addLineItem()` —— 走同一套合并逻辑(万一已经有一行同样
 *    规格的,合并进去,数量仍然是 1)
 * 2. 再把旧行删掉
 *
 * 顺序反了会出事:先删再加的话,加的那一步失败,用户的这一行就凭空没了。
 * 现在这个顺序里,加失败 → 旧行还在(什么都没变),加成功 → 旧行删掉。
 *
 * 档位没变 → 什么都不做(直接返回这一行)。不然「先加后删」会把自己
 * 刚加的那行删掉(同一份规格,hash 一样,合并到自己头上)。
 */
export async function updatePrintLineDeliveryTier(
  cartId: string,
  lineItemId: string,
  deliveryTier: DeliveryTierId
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  const existing = await db
    .select()
    .from(cartItem)
    .where(and(eq(cartItem.id, lineItemId), eq(cartItem.cartId, cartId)))
    .limit(1);
  const existingRow = existing[0];
  if (!existingRow) throw new Error(`line item ${lineItemId} 不存在`);

  const metadata = existingRow.metadata as unknown as CartLineItemMetadata;
  const printSpec = getPrintServiceSpec(metadata);
  if (!printSpec) {
    throw new Error("这一行不是打印服务行,没有交期档位");
  }

  if (printSpec.deliveryTier === deliveryTier) {
    const fresh = await getCart(cartId);
    if (!fresh) throw new Error(`cart ${cartId} 不存在`);
    return { cart: fresh, lineItem: repriceLineItem(existingRow) };
  }

  // 1. 按新档位加一行(价格服务端重算 —— 加价是按小计的比例收的)
  const added = await addLineItem(cartId, {
    productId: PRINT_SERVICE_PRODUCT_ID,
    spec: {
      ...metadata,
      printSpec: { ...printSpec, deliveryTier },
    } as CartLineItemMetadata,
    quantity: 1,
  });

  // 2. 删掉旧行
  await db
    .delete(cartItem)
    .where(and(eq(cartItem.id, lineItemId), eq(cartItem.cartId, cartId)));

  await db
    .update(cart)
    .set({ updatedAt: new Date() })
    .where(eq(cart.id, cartId));

  const fresh = await getCart(cartId);
  if (!fresh) throw new Error(`cart ${cartId} 不存在`);

  return { cart: fresh, lineItem: added.lineItem };
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
 * **再按性质分一次**(2026-11-06)—— 商城购物袋和打印单是两张车:
 * 买的是打印服务就去打印单上摘,买的是目录商品就去商城购物袋上摘。
 */
export async function removeOrderedLinesFromCarts(
  userId: string,
  ordered: Array<{ specHash: string; quantity: number }>,
  kind: CartKind = STOREFRONT_CART_KIND
): Promise<void> {
  if (ordered.length === 0) return;

  const cartRows = await db
    .select({ id: cart.id })
    .from(cart)
    .where(and(eq(cart.userId, userId), eq(cart.kind, kind)));
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
  if (rows.length === 0) return;

  const now = new Date();
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

  await db
    .update(cart)
    .set({ updatedAt: now })
    .where(inArray(cart.id, cartIds));
}
