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
 */

import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";

import { db } from "@/db";
import { type CartItemRow, type CartRow, cart, cartItem } from "@/db/schema";
import { computePrintServiceLinePrice } from "@/features/print-quote/lib/quote-server";
import type { Cart, CartLineItem, CartLineItemMetadata } from "../types";
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
      // 耗材克重由**服务端**回填 —— 客户端没有材料密度,自己算不出来。
      // 只影响展示(购物车里显示「XX g」),不参与定价。
      metadata = {
        ...metadata,
        printSpec: {
          ...printSpec,
          materialWeightG: priced.quote.materialWeightG,
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
  return {
    id: row.id,
    currencyCode: row.currencyCode as "CNY",
    regionId: row.regionId,
    items: items.map(repriceLineItem),
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
 */
export async function createCart(userId?: string | null): Promise<Cart> {
  const id = `cart_${nanoid(16)}`;
  const now = new Date();

  await db.insert(cart).values({
    id,
    userId: userId ?? null,
    currencyCode: "CNY",
    regionId: "china",
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    currencyCode: "CNY",
    regionId: "china",
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
 */
export async function getOrCreateCart(): Promise<Cart> {
  const cookieId = await getCartId();

  if (cookieId) {
    const row = await loadCartRow(cookieId);
    if (row) {
      const items = await loadCartItemRows(cookieId);
      return toCart(row, items);
    }
    // cookie 指向的 cart 没了(被删了 / 换了库)→ 清掉 cookie 往下走
    await clearCartId();
  }

  // cookie 没了 —— 这时候才查一次会话(冷路径,不是热路径)
  const userId = await getCurrentUserId();
  if (userId) {
    const rows = await db
      .select()
      .from(cart)
      .where(eq(cart.userId, userId))
      .limit(1);
    const row = rows[0];
    if (row) {
      await setCartId(row.id);
      const items = await loadCartItemRows(row.id);
      return toCart(row, items);
    }
  }

  const created = await createCart(userId);
  await setCartId(created.id);
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
 */
export async function addLineItem(
  cartId: string,
  input: AddLineItemInput
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  const cartRow = await loadCartRow(cartId);
  if (!cartRow) throw new Error(`cart ${cartId} 不存在`);

  const printSpec = getPrintServiceSpec(input.spec);

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
