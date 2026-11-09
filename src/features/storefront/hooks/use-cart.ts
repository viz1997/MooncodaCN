/**
 * use-cart —— 客户端购物车 hook(TanStack Query)
 *
 * 替代 atelier 的 Zustand useCartStore,把 cart 状态搬到服务端。
 * - query: POST /api/store/carts(cookie 关联 cart_id)
 * - mutations:
 *   - ensureCart() — POST /api/store/carts(创建或取现有)
 *   - addLineItem(spec) —— 目录商品
 *   - updateLineItemQuantity(lineItemId, quantity)
 *   - removeLineItem(lineItemId)
 *
 * 购物车现在落库了(见 `lib/cart-store.ts`),重启 dev server 不会丢。
 *
 * ## 车里**只有目录商品**(2026-11-08)
 *
 * 工作室的说法:「不要放入购物车,放在这里 account/print-orders」。打印服务
 * 是另一条线 —— 工单自己建、自己收款(见 `POST /api/print-orders`)。
 *
 * 所以这里只有**一个** query key、**一个** cookie、**一个**接口,车上的每一
 * 行都是要寄出去的实物。
 */

"use client";

import {
  type QueryClient,
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type {
  CouponErrorCode,
  CouponView,
} from "@/features/coupon/lib/coupon-calc";
import { toRequestError } from "@/features/shared/lib/request-error";

import { computeCartTotals } from "../lib/cart-totals";
import type { Cart, CartLineItem, CartLineItemMetadata } from "../types";

export const CART_QUERY_KEY = ["store", "cart"] as const;

/**
 * 付款成功后把购物车缓存作废
 *
 * 购物车是「**付款成功才清空**」(2026-11-05)—— 付款成功那一刻服务端把买掉
 * 的行从购物车里摘掉了(见 `payments/lib/settle.ts`)。客户端这份缓存得跟着
 * 作废,不然用户看到的还是买之前的购物袋(缓存 30 秒,而且窗口聚焦时不重拉)。
 */
export async function invalidateCartCache(
  queryClient: QueryClient
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
}

type AddLineItemInput = {
  productId: string;
  spec: CartLineItemMetadata;
  quantity?: number;
};

/* -------------------------------------------------------------------------- */
/*  Fetch helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 请求失败时抛 `RequestError` —— **带上服务端的 code**
 *
 * 服务端每个失败都带一个稳定的 code(`MODEL_NOT_FOUND` / `CART_NOT_FOUND` /
 * `R2_NOT_CONFIGURED` …)。界面拿 code 查文案,用户看到的是「模型文件没找到,
 * 请重新上传」而不是一句「请稍后重试」。见 `shared/lib/request-error.ts`。
 */
async function fetchJson<T>(
  input: string | URL,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw toRequestError(body, res.status);
  }
  return res.json() as Promise<T>;
}

async function ensureCart(): Promise<Cart> {
  const body = await fetchJson<{ cart: Cart }>("/api/store/carts", {
    method: "POST",
  });
  return body.cart;
}

async function addLineItemFetch(
  cartId: string,
  input: AddLineItemInput
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  return fetchJson<{ cart: Cart; lineItem: CartLineItem }>(
    `/api/store/carts/${cartId}/line-items`,
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  );
}

async function updateQuantityFetch(
  cartId: string,
  lineItemId: string,
  quantity: number
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  return fetchJson<{ cart: Cart; lineItem: CartLineItem }>(
    `/api/store/carts/${cartId}/line-items/${lineItemId}`,
    {
      method: "PUT",
      body: JSON.stringify({ quantity }),
    }
  );
}

async function removeLineItemFetch(
  cartId: string,
  lineItemId: string
): Promise<{ cart: Cart }> {
  return fetchJson<{ cart: Cart }>(
    `/api/store/carts/${cartId}/line-items/${lineItemId}`,
    { method: "DELETE" }
  );
}

/**
 * 应用 / 摘掉优惠码(2026-11-08)
 *
 * **空串 = 摘掉**优惠码。
 *
 * 失败时服务端返 400 + `{ error: "COUPON_INVALID", couponErrorCode }` ——
 * 这里把 `couponErrorCode` 一起抛出去,界面按它说人话(「这个券过期了」)
 * 而不是一句笼统的「用不了」。
 */
async function applyCouponFetch(
  cartId: string,
  code: string
): Promise<{ cart: Cart }> {
  const res = await fetch(`/api/store/carts/${cartId}/coupon`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const error = toRequestError(body, res.status);
    // 精确原因(过期 / 没满门槛 / 超限 …)—— 界面按它查文案
    const couponErrorCode =
      body && typeof body === "object"
        ? ((body as Record<string, unknown>).couponErrorCode as
            | CouponErrorCode
            | undefined)
        : undefined;
    if (couponErrorCode) {
      throw new CouponRequestError(couponErrorCode, error.message, error);
    }
    throw error;
  }

  return res.json() as Promise<{ cart: Cart }>;
}

/** 优惠码不可用 —— 带着**精确原因码** */
export class CouponRequestError extends Error {
  readonly code: CouponErrorCode;

  constructor(code: CouponErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "CouponRequestError";
    this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/*  Main hook                                                                 */
/* -------------------------------------------------------------------------- */

export interface UseCartResult {
  /** 当前 cart(可能为 undefined 当 cart_id 还没创建时) */
  cart: Cart | undefined;
  /** line items */
  items: CartLineItem[];
  /** 加载中 */
  isLoading: boolean;
  /** 错误 */
  error: Error | null;
  /** 添加目录商品到购物车 */
  addLineItem: UseMutationResult<
    { cart: Cart; lineItem: CartLineItem },
    Error,
    AddLineItemInput
  >;
  /** 更新数量(qty=0 等同删除) */
  updateLineItemQuantity: UseMutationResult<
    { cart: Cart; lineItem: CartLineItem },
    Error,
    { lineItemId: string; quantity: number }
  >;
  /** 删除 line item */
  removeLineItem: UseMutationResult<
    { cart: Cart },
    Error,
    { lineItemId: string }
  >;
  /**
   * 应用优惠码(2026-11-08)
   *
   * 传**空串** = 摘掉优惠码。
   *
   * 失败时抛 `CouponRequestError`(带精确原因码)—— 界面按它说人话,
   * 并给一个「去掉优惠码」按钮。
   */
  applyCoupon: UseMutationResult<{ cart: Cart }, Error, { code: string }>;
  /** 小计(分) */
  subtotalCents: number;
  /** 总件数 */
  itemCount: number;
  /** 距离免运费还差多少(分,0 = 已免运费) */
  remainingForFreeShippingCents: number;
  /** 运费(分) */
  shippingCents: number;
  /**
   * 优惠码减掉的金额(分)—— 0 = 没用券
   *
   * **服务端算的** —— 客户端一个加法都不做。
   */
  couponDiscountCents: number;
  /** 生效的优惠码效果 —— null = 没有券,或者券不可用 */
  coupon: CouponView | null;
  /** 优惠码不可用的原因码 —— null = 没有码,或者券完全可用 */
  couponError: CouponErrorCode | null;
  /**
   * 合计(分)—— 小计 − 优惠 + 运费
   *
   * **唯一的一份** —— 抽屉 / 购物袋页 / 结算页都读它,免得三处各算一遍
   * 算出三个数。
   */
  totalCents: number;
  /** 强制重新拉 cart */
  refetch: () => Promise<unknown>;
}

export function useCart(): UseCartResult {
  const queryClient = useQueryClient();

  // 1. 拿 cart(从 cookie 关联的 cart_id)
  const query = useQuery({
    queryKey: CART_QUERY_KEY,
    queryFn: async () => {
      const cart = await ensureCart();
      return cart;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // 2. mutations
  const addLineItemMutation = useMutation({
    mutationFn: async (input: AddLineItemInput) => {
      const cart = query.data ?? (await ensureCart());
      return addLineItemFetch(cart.id, input);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(CART_QUERY_KEY, data.cart);
    },
  });

  const updateQuantityMutation = useMutation({
    mutationFn: async ({
      lineItemId,
      quantity,
    }: {
      lineItemId: string;
      quantity: number;
    }) => {
      // 缓存还没回来就退一步去问服务端要这张车 —— 跟加购那条一样。
      // 否则「页面刚打开就点 +」会直接报「cart 还没准备好」。
      const cart = query.data ?? (await ensureCart());
      return updateQuantityFetch(cart.id, lineItemId, quantity);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(CART_QUERY_KEY, data.cart);
    },
  });

  const removeLineItemMutation = useMutation({
    mutationFn: async ({ lineItemId }: { lineItemId: string }) => {
      const cart = query.data ?? (await ensureCart());
      return removeLineItemFetch(cart.id, lineItemId);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(CART_QUERY_KEY, data.cart);
    },
  });

  /**
   * 优惠码(2026-11-08)
   *
   * **失败时不写缓存** —— 服务端失败时一个字节都没写库,车上的码原样保留。
   * 所以 `onError` 里**不要**动缓存,让界面按 `couponError` 说人话。
   */
  const applyCouponMutation = useMutation({
    mutationFn: async ({ code }: { code: string }) => {
      const cart = query.data ?? (await ensureCart());
      return applyCouponFetch(cart.id, code);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(CART_QUERY_KEY, data.cart);
    },
  });

  // 3. selectors
  const items = query.data?.items ?? [];

  /**
   * 优惠码效果 —— **服务端算好的快照**
   *
   * `cart.coupon` 是服务端读车时算的(折扣金额是**服务端**算的,客户端一个
   * 加法都不做)。`cart.couponError` 是它不可用的原因码。
   */
  const coupon = query.data?.coupon ?? null;
  const couponError = query.data?.couponError ?? null;

  /**
   * 金额 —— **跟购物袋页 / 结算页用同一份口径**
   *
   * `computeCartTotals()` 是纯函数(见 `lib/cart-totals.ts`),购物袋详情页
   * 和结算页都 import 它。这里也用它,免得抽屉里的运费跟页面上摆的不一样。
   *
   * **第二个参数是优惠效果** —— 优惠码是订单级的,减整单,不落在任何一行上。
   */
  const totals = useMemo(
    () => computeCartTotals(items, coupon),
    [items, coupon]
  );
  const itemCount = totals.itemCount;

  // 4. refetch helper
  const refetch = useCallback(() => query.refetch(), [query]);

  return {
    cart: query.data,
    items,
    isLoading: query.isLoading,
    error: query.error,
    addLineItem: addLineItemMutation,
    updateLineItemQuantity: updateQuantityMutation,
    removeLineItem: removeLineItemMutation,
    applyCoupon: applyCouponMutation,
    subtotalCents: totals.subtotalCents,
    itemCount,
    remainingForFreeShippingCents: totals.remainingForFreeShippingCents,
    shippingCents: totals.shippingCents,
    couponDiscountCents: totals.couponDiscountCents,
    coupon,
    couponError,
    totalCents: totals.totalCents,
    refetch,
  };
}

/* -------------------------------------------------------------------------- */
/*  Cart UI state(drawer 开关)                                                */
/* -------------------------------------------------------------------------- */

/**
 * 客户端 store 管理 cart drawer 开关(独立于 cart 数据)。
 * 使用 Zustand 简单 store,不需要 persist。
 */
import { create } from "zustand";

interface CartUiState {
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
}

export const useCartUi = create<CartUiState>((set) => ({
  isOpen: false,
  openCart: () => set({ isOpen: true }),
  closeCart: () => set({ isOpen: false }),
  toggleCart: () => set((s) => ({ isOpen: !s.isOpen })),
}));
