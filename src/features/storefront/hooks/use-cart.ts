/**
 * use-cart —— 客户端购物车 hook(TanStack Query)
 *
 * 替代 atelier 的 Zustand useCartStore,把 cart 状态搬到服务端。
 * - query: POST /api/store/carts(cookie 关联 cart_id)
 * - mutations:
 *   - ensureCart() — POST /api/store/carts(创建或取现有)
 *   - addLineItem(spec) —— 目录商品
 *   - addPrintLine(printSpec) —— 打印服务(用户自带 3D 模型,按克重计价)
 *   - updateLineItemQuantity(lineItemId, quantity)
 *   - updateDeliveryTier(lineItemId, tier) —— 打印服务行的交期档位
 *   - removeLineItem(lineItemId)
 *
 * 购物车现在落库了(见 `lib/cart-store.ts`),重启 dev server 不会丢。
 *
 * ## 一张车(2026-11-08)
 *
 * 打印服务**并进商城购物袋**了 —— 工作室的说法:「不要 print-order,进入商城
 * 那个」。所以只有**一个** query key、**一个** cookie、**一个**接口。
 * 2026-11-06 到 2026-11-08 之间有过「两张车」的版本(另有一个
 * `use-print-cart.ts` + `["store", "print-cart"]` 缓存),那一版已经删掉了。
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

import type { DeliveryTierId } from "@/features/print-quote/lib/delivery-tier";
import { toRequestError } from "@/features/shared/lib/request-error";

import { computeCartTotals } from "../lib/cart-totals";
import { getPrintServiceSpec } from "../lib/print-service";
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

/** 打印服务行 —— 几何 + 交期 + 模型文件 */
export type PrintLineInput = {
  printSpec: {
    volumeCM3: number;
    surfaceAreaCM2: number;
    dims: [number, number, number];
    supportWeightG: number | null;
    selfSupportRatio: number | null;
    deliveryTier: DeliveryTierId;
    modelFileName: string;
    modelObjectKey: string;
    modelUrl: string;
    modelSizeBytes: number | null;
  };
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

/**
 * 加一行打印服务 —— 跟目录商品**同一个接口**(2026-11-08)
 *
 * 服务端按「`spec` 里有没有 `printSpec`」分两条路(见
 * `app/api/store/carts/[id]/line-items/route.ts`):打印服务那一路多三道
 * 校验(登录 / 归属 / 文件存在),metadata 由服务端重建。
 */
async function addPrintLineFetch(
  cartId: string,
  input: PrintLineInput
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  return fetchJson<{ cart: Cart; lineItem: CartLineItem }>(
    `/api/store/carts/${cartId}/line-items`,
    {
      method: "POST",
      body: JSON.stringify({
        productId: "service_print_3d",
        spec: {
          productId: "service_print_3d",
          productHandle: "print-service",
          productTitle: "定制打印(按克重)",
          productThumbnail: "",
          printSpec: input.printSpec,
        },
        quantity: 1,
      }),
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

/** 改打印服务行的交期档位 */
async function updateTierFetch(
  cartId: string,
  lineItemId: string,
  deliveryTier: DeliveryTierId
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  return fetchJson<{ cart: Cart; lineItem: CartLineItem }>(
    `/api/store/carts/${cartId}/line-items/${lineItemId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ deliveryTier }),
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
  /** 添加目录商品到购物车 */
  addLineItem: UseMutationResult<
    { cart: Cart; lineItem: CartLineItem },
    Error,
    AddLineItemInput
  >;
  /** 添加打印服务行到购物车(用户自带模型) */
  addPrintLine: UseMutationResult<
    { cart: Cart; lineItem: CartLineItem },
    Error,
    PrintLineInput
  >;
  /** 更新数量(qty=0 等同删除) */
  updateLineItemQuantity: UseMutationResult<
    { cart: Cart; lineItem: CartLineItem },
    Error,
    { lineItemId: string; quantity: number }
  >;
  /** 改打印服务行的交期档位 */
  updateDeliveryTier: UseMutationResult<
    { cart: Cart; lineItem: CartLineItem },
    Error,
    { lineItemId: string; deliveryTier: DeliveryTierId }
  >;
  /** 删除 line item */
  removeLineItem: UseMutationResult<
    { cart: Cart },
    Error,
    { lineItemId: string }
  >;
  /** 小计(分)—— 全部行(目录商品 + 打印服务) */
  subtotalCents: number;
  /** 目录商品那部分的小计(分)—— **运费的基数** */
  catalogSubtotalCents: number;
  /** 打印服务那部分的小计(分) */
  printSubtotalCents: number;
  /** 总件数 */
  itemCount: number;
  /** 距离免运费还差多少(分,0 = 已免运费) */
  remainingForFreeShippingCents: number;
  /** 运费(分)—— 只按目录商品那部分算 */
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

  const addPrintLineMutation = useMutation({
    mutationFn: async (input: PrintLineInput) => {
      // 缓存还没回来就问服务端要这张车 —— 否则「刚打开页面就点加入」会报
      // 「购物车还没准备好」。
      const cart = query.data ?? (await ensureCart());
      return addPrintLineFetch(cart.id, input);
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

  const updateTierMutation = useMutation({
    mutationFn: async ({
      lineItemId,
      deliveryTier,
    }: {
      lineItemId: string;
      deliveryTier: DeliveryTierId;
    }) => {
      const cart = query.data ?? (await ensureCart());
      return updateTierFetch(cart.id, lineItemId, deliveryTier);
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

  // 3. selectors
  const items = query.data?.items ?? [];

  /**
   * 金额 —— **跟购物袋页 / 结算页用同一份口径**
   *
   * `computeCartTotals()` 是纯函数(见 `lib/cart-totals.ts`),购物袋详情页
   * 和结算页都 import 它。这里也用它,免得抽屉里的运费跟页面上摆的不一样。
   *
   * 运费的基数是**目录商品那部分** —— 打印服务不产生快递费(见
   * `pricing-constants.ts` 的 `shippingCentsForCart()`)。
   */
  const totals = useMemo(() => computeCartTotals(items), [items]);
  const itemCount = totals.itemCount;

  // 4. refetch helper
  const refetch = useCallback(() => query.refetch(), [query]);

  return {
    cart: query.data,
    items,
    isLoading: query.isLoading,
    error: query.error,
    addLineItem: addLineItemMutation,
    addPrintLine: addPrintLineMutation,
    updateLineItemQuantity: updateQuantityMutation,
    updateDeliveryTier: updateTierMutation,
    removeLineItem: removeLineItemMutation,
    subtotalCents: totals.subtotalCents,
    catalogSubtotalCents: totals.catalogSubtotalCents,
    printSubtotalCents: totals.printSubtotalCents,
    itemCount,
    remainingForFreeShippingCents: totals.remainingForFreeShippingCents,
    shippingCents: totals.shippingCents,
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

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 这一行是不是**打印服务行**
 *
 * 判据是「metadata 里有没有 printSpec」—— 不是 `productId`(打印服务在目录
 * 里没有对应的商品,`productId` 是个哨兵值)。见 `lib/print-service.ts`。
 *
 * 购物袋页 / 抽屉 / 结算页都要按这个分两套画法,所以放一个地方。
 */
export function isPrintLine(item: CartLineItem): boolean {
  return Boolean(getPrintServiceSpec(item.metadata));
}
