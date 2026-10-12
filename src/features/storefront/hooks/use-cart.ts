/**
 * use-cart —— 客户端购物车 hook(TanStack Query)
 *
 * 替代 atelier 的 Zustand useCartStore,把 cart 状态搬到服务端。
 * - query: GET /api/store/carts/[id] (cookie 关联 cart_id)
 * - mutations:
 *   - ensureCart() — POST /api/store/carts(创建或取现有)
 *   - addLineItem(spec)
 *   - updateLineItemQuantity(lineItemId, quantity)
 *   - removeLineItem(lineItemId)
 *
 * 切真 Medusa 时:fetch URL 不变,只改 Route Handler 转发。
 */

"use client";

import {
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { Cart, CartLineItem, CartLineItemMetadata } from "../types";

const CART_QUERY_KEY = ["store", "cart"] as const;

type AddLineItemInput = {
  productId: string;
  spec: CartLineItemMetadata;
  quantity?: number;
};

/* -------------------------------------------------------------------------- */
/*  Fetch helpers                                                            */
/* -------------------------------------------------------------------------- */

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
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `HTTP ${res.status} ${res.statusText}`);
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
  /** 添加到购物车 */
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
  /** 小计(分) */
  subtotalCents: number;
  /** 总件数 */
  itemCount: number;
  /** 距离免运费还差多少(分,0 = 已免运费) */
  remainingForFreeShippingCents: number;
  /** 运费(分) */
  shippingCents: number;
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
      if (!query.data) throw new Error("cart 还没准备好");
      return updateQuantityFetch(query.data.id, lineItemId, quantity);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(CART_QUERY_KEY, data.cart);
    },
  });

  const removeLineItemMutation = useMutation({
    mutationFn: async ({ lineItemId }: { lineItemId: string }) => {
      if (!query.data) throw new Error("cart 还没准备好");
      return removeLineItemFetch(query.data.id, lineItemId);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(CART_QUERY_KEY, data.cart);
    },
  });

  // 3. selectors
  const items = query.data?.items ?? [];
  const subtotalCents = useMemo(
    () => items.reduce((sum, it) => sum + it.unitPriceCents * it.quantity, 0),
    [items]
  );
  const itemCount = useMemo(
    () => items.reduce((sum, it) => sum + it.quantity, 0),
    [items]
  );
  const FREE_SHIPPING_THRESHOLD_CENTS = 9900;
  const DEFAULT_SHIPPING_CENTS = 800;
  const remainingForFreeShippingCents = Math.max(
    0,
    FREE_SHIPPING_THRESHOLD_CENTS - subtotalCents
  );
  const shippingCents =
    subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : DEFAULT_SHIPPING_CENTS;

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
    subtotalCents,
    itemCount,
    remainingForFreeShippingCents,
    shippingCents,
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
