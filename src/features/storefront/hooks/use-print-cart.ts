/**
 * use-print-cart —— 客户端**打印单** hook(TanStack Query)
 *
 * ## 为什么是另一个 hook
 *
 * 打印服务**不走商城购物袋** —— 工作室的说法:「模型打印是不走商城正常的
 * 购物车的,而是走打印下单」。所以打印单是**另一张车**:
 *
 * | | 商城购物袋 | 打印单 |
 * |---|---|---|
 * | query key | `["store", "cart"]` | `["store", "print-cart"]` |
 * | cookie | `wjp_cart_id` | `wjp_print_cart_id` |
 * | 接口 | `/api/store/carts/**` | `/api/store/print-carts/**` |
 * | 装什么 | 目录商品 | 打印服务(自带模型) |
 * | 运费 | ¥8,小计到 ¥99 免 | **没有**(价就是报价本身) |
 *
 * 两套缓存各管各的 —— 商城购物袋的改动不会把打印单里的行弄丢,反之亦然。
 *
 * ## 金额口径
 *
 * 打印单**没有运费** —— 打印服务的价就是报价本身(见
 * `print-quote/lib/payment.ts`:工单的支付金额恒等于 `total_price_cents`)。
 * 报价台显示多少、工单上写多少、这里显示多少、实际收多少,是同一个数。
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

import type { Cart, CartLineItem } from "../types";

export const PRINT_CART_QUERY_KEY = ["store", "print-cart"] as const;

/**
 * 付款成功后把打印单缓存作废
 *
 * 打印单也是「**付款成功才清空**」—— 钱到了才摘掉买掉的行(服务端在收款
 * 回调里摘,见 `payments/lib/settle.ts`)。
 */
export async function invalidatePrintCartCache(
  queryClient: QueryClient
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: PRINT_CART_QUERY_KEY });
}

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

/** 取(或建)当前打印单 */
async function ensurePrintCart(): Promise<Cart> {
  const body = await fetchJson<{ cart: Cart }>("/api/store/print-carts", {
    method: "POST",
  });
  return body.cart;
}

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

async function addPrintLineFetch(
  cartId: string,
  input: PrintLineInput
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  return fetchJson<{ cart: Cart; lineItem: CartLineItem }>(
    `/api/store/print-carts/${cartId}/line-items`,
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

async function updateTierFetch(
  cartId: string,
  lineItemId: string,
  deliveryTier: DeliveryTierId
): Promise<{ cart: Cart; lineItem: CartLineItem }> {
  return fetchJson<{ cart: Cart; lineItem: CartLineItem }>(
    `/api/store/print-carts/${cartId}/line-items/${lineItemId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ deliveryTier }),
    }
  );
}

async function removePrintLineFetch(
  cartId: string,
  lineItemId: string
): Promise<{ cart: Cart }> {
  return fetchJson<{ cart: Cart }>(
    `/api/store/print-carts/${cartId}/line-items/${lineItemId}`,
    { method: "DELETE" }
  );
}

/* -------------------------------------------------------------------------- */
/*  Main hook                                                                 */
/* -------------------------------------------------------------------------- */

export interface UsePrintCartResult {
  /** 当前打印单 */
  cart: Cart | undefined;
  /** 打印服务行 */
  items: CartLineItem[];
  /** 加载中 */
  isLoading: boolean;
  /** 错误 */
  error: Error | null;
  /** 加一行打印服务 */
  addPrintLine: UseMutationResult<
    { cart: Cart; lineItem: CartLineItem },
    Error,
    PrintLineInput
  >;
  /** 改交期档位 */
  updateDeliveryTier: UseMutationResult<
    { cart: Cart; lineItem: CartLineItem },
    Error,
    { lineItemId: string; deliveryTier: DeliveryTierId }
  >;
  /** 删一行 */
  removePrintLine: UseMutationResult<
    { cart: Cart },
    Error,
    { lineItemId: string }
  >;
  /** 下单金额(分)—— Σ 折后单价 × 数量,没有运费 */
  totalCents: number;
  /** 件数 */
  itemCount: number;
  /** 强制重新拉 */
  refetch: () => Promise<unknown>;
}

/**
 * 打印单 hook
 *
 * `enabled: false` —— **不自动拉打印单**。报价台用这个模式:打开报价台不该
 * 顺手建一张空打印单(每个访客一行 DB + 一个 cookie)。等用户真的点了「加入
 * 打印单」,`addPrintLine` 自己去要那张车(见下面的 `ensurePrintCart()`)。
 */
export function usePrintCart(options?: {
  /** false = 不自动拉(报价台用) */
  enabled?: boolean;
}): UsePrintCartResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: PRINT_CART_QUERY_KEY,
    queryFn: ensurePrintCart,
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const addPrintLineMutation = useMutation({
    mutationFn: async (input: PrintLineInput) => {
      // 缓存还没回来就问服务端要这张车 —— 否则「刚打开页面就点加入」会报
      // 「打印单还没准备好」。
      const cart = query.data ?? (await ensurePrintCart());
      return addPrintLineFetch(cart.id, input);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PRINT_CART_QUERY_KEY, data.cart);
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
      const cart = query.data ?? (await ensurePrintCart());
      return updateTierFetch(cart.id, lineItemId, deliveryTier);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PRINT_CART_QUERY_KEY, data.cart);
    },
  });

  const removePrintLineMutation = useMutation({
    mutationFn: async ({ lineItemId }: { lineItemId: string }) => {
      const cart = query.data ?? (await ensurePrintCart());
      return removePrintLineFetch(cart.id, lineItemId);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PRINT_CART_QUERY_KEY, data.cart);
    },
  });

  const items = query.data?.items ?? [];

  /**
   * 下单金额 —— 打印单**没有运费**
   *
   * 每行的单价就是报价(按克重算出来的那个数,含交期加价)。Σ 起来就是
   * 用户要付的数 —— 跟报价台看到的、工单上写的、收款通道收的,是同一个数。
   */
  const totalCents = useMemo(
    () =>
      items.reduce(
        (sum, it) => sum + it.discountedUnitPriceCents * it.quantity,
        0
      ),
    [items]
  );

  const itemCount = useMemo(
    () => items.reduce((sum, it) => sum + it.quantity, 0),
    [items]
  );

  const refetch = useCallback(() => query.refetch(), [query]);

  return {
    cart: query.data,
    items,
    isLoading: query.isLoading,
    error: query.error,
    addPrintLine: addPrintLineMutation,
    updateDeliveryTier: updateTierMutation,
    removePrintLine: removePrintLineMutation,
    totalCents,
    itemCount,
    refetch,
  };
}
