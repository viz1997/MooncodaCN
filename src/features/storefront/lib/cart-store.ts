/**
 * 服务端 cart 存储(对齐 Medusa Store Cart schema)
 *
 * In-memory Map + cookie `wjp_cart_id`(对齐 Medusa V1 pattern)。
 * 重启服务器会丢失 cart(符合 mock 定位,见 [[wjp-mock-medusa-storefront]])。
 *
 * 切真 Medusa 时:此文件作废,Route Handlers 改为转发到 Medusa Store API,
 * client use-cart 不变。
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import type { Cart, CartLineItem, CartLineItemMetadata } from "../types";
import { findProductById } from "./mock-catalog";
import { calculatePricing } from "./pricing";

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
/*  In-memory Map(模块级单例)                                                */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ 服务端 in-memory 存储。
 * - 单进程 Vercel serverless:每次冷启动丢失,符合 mock 定位
 * - 持久化:不做,符合 mock 定位
 * - 切真 Medusa 时,此 Map 删除,Route Handlers 改为转发到 Medusa
 */
const CARTS = new Map<string, Cart>();

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/* -------------------------------------------------------------------------- */
/*  Cart CRUD                                                                */
/* -------------------------------------------------------------------------- */

export function createCart(): Cart {
  const id = generateId("cart");
  const now = nowIso();
  const cart: Cart = {
    id,
    currencyCode: "CNY",
    regionId: "china",
    items: [],
    createdAt: now,
    updatedAt: now,
  };
  CARTS.set(id, cart);
  return cart;
}

export function getCart(cartId: string): Cart | null {
  return CARTS.get(cartId) ?? null;
}

export function deleteCart(cartId: string): boolean {
  return CARTS.delete(cartId);
}

/**
 * 拿 cart_id 对应的 cart;不存在就创建一个新 cart
 * (用于 /api/store/carts 的 POST handler)
 */
export async function getOrCreateCart(): Promise<Cart> {
  const existingId = await getCartId();
  if (existingId) {
    const existing = getCart(existingId);
    if (existing) return existing;
    // cookie 有但内存里没有(可能冷启动过)→ 清掉 cookie,创建新 cart
    await clearCartId();
  }
  return createCart();
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
 * - 同 spec 完全一致的 item 合并 quantity
 * - 不一致则新增
 */
export async function addLineItem(
  cartId: string,
  input: AddLineItemInput
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  const cart = getCart(cartId);
  if (!cart) throw new Error(`cart ${cartId} 不存在`);

  const product = findProductById(input.productId);
  if (!product) throw new Error(`产品 ${input.productId} 不存在`);

  const quantity = input.quantity ?? 1;

  // 调定价 API(用 mock pricing)
  const pricing = await calculatePricing({
    productId: input.productId,
    productHandle: product.handle,
    productTypeCode: product.productTypeCode,
    materialId: input.spec.materialId,
    sizeId: input.spec.sizeId,
    aiStyleId: input.spec.aiStyleId,
    engravingText: input.spec.engravingText,
    rushOrder: input.spec.rushOrder,
    quantity,
    previewImageUrl: input.spec.previewImage,
    originalImageUrl: input.spec.originalImage,
  });

  // 找现有同 spec 的 line item,合并
  const existing = cart.items.find(
    (item) =>
      item.productId === input.productId &&
      item.metadata.materialId === input.spec.materialId &&
      item.metadata.sizeId === input.spec.sizeId &&
      item.metadata.aiStyleId === input.spec.aiStyleId &&
      item.metadata.engravingText === input.spec.engravingText &&
      item.metadata.rushOrder === input.spec.rushOrder &&
      item.metadata.previewImage === input.spec.previewImage
  );

  let lineItem: CartLineItem;
  if (existing) {
    existing.quantity += quantity;
    existing.unitPriceCents = pricing.unitPriceCents; // 用最新定价
    existing.updatedAt = nowIso();
    lineItem = existing;
  } else {
    const now = nowIso();
    lineItem = {
      id: generateId("item"),
      cartId,
      productId: input.productId,
      productHandle: product.handle,
      productTitle: product.title,
      productThumbnail: product.thumbnail,
      unitPriceCents: pricing.unitPriceCents,
      quantity,
      metadata: input.spec,
      createdAt: now,
      updatedAt: now,
    };
    cart.items.push(lineItem);
  }

  cart.updatedAt = nowIso();
  CARTS.set(cartId, cart);

  return { cart, lineItem };
}

export function updateLineItemQuantity(
  cartId: string,
  lineItemId: string,
  quantity: number
): { cart: Cart; lineItem: CartLineItem } {
  const cart = getCart(cartId);
  if (!cart) throw new Error(`cart ${cartId} 不存在`);
  const item = cart.items.find((it) => it.id === lineItemId);
  if (!item) throw new Error(`line item ${lineItemId} 不存在`);

  if (quantity < 1) {
    // qty=0 等同于删除
    return removeLineItem(cartId, lineItemId);
  }
  item.quantity = quantity;
  item.updatedAt = nowIso();
  cart.updatedAt = item.updatedAt;
  CARTS.set(cartId, cart);
  return { cart, lineItem: item };
}

export function removeLineItem(
  cartId: string,
  lineItemId: string
): { cart: Cart; lineItem: CartLineItem } {
  const cart = getCart(cartId);
  if (!cart) throw new Error(`cart ${cartId} 不存在`);
  const idx = cart.items.findIndex((it) => it.id === lineItemId);
  if (idx === -1) throw new Error(`line item ${lineItemId} 不存在`);
  const [item] = cart.items.splice(idx, 1);
  if (!item) throw new Error(`line item ${lineItemId} 已被删除`);
  cart.updatedAt = nowIso();
  CARTS.set(cartId, cart);
  return { cart, lineItem: item };
}
