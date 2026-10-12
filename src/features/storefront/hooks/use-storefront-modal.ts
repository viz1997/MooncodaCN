/**
 * use-storefront-modal —— Quick View + Custom Workshop 客户端 modal state
 *
 * 替代 atelier Zustand `useCartStore` 里的 quickViewProduct / customizeProduct
 * 字段(只为 UI 状态,数据本身走 use-products)。
 */

"use client";

import { create } from "zustand";

import type { StorefrontProduct } from "../types";

interface StorefrontModalState {
  /** 当前打开 Quick View 的 product(null = 关闭) */
  quickViewProduct: StorefrontProduct | null;
  /** 当前打开 Custom Workshop 的 product(null = 关闭) */
  customizeProduct: StorefrontProduct | null;

  setQuickView: (product: StorefrontProduct | null) => void;
  setCustomize: (product: StorefrontProduct | null) => void;
  closeAll: () => void;
}

export const useStorefrontModal = create<StorefrontModalState>((set) => ({
  quickViewProduct: null,
  customizeProduct: null,

  setQuickView: (product) =>
    set({
      quickViewProduct: product,
      // 互斥:打开 Quick View 时关 Workshop
      customizeProduct: product ? null : null,
    }),

  setCustomize: (product) =>
    set({
      customizeProduct: product,
      // 互斥:打开 Workshop 时关 Quick View
      quickViewProduct: product ? null : null,
    }),

  closeAll: () => set({ quickViewProduct: null, customizeProduct: null }),
}));
