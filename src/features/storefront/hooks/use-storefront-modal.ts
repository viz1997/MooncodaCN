/**
 * use-storefront-modal —— Quick View + 品类选择层 + Custom Workshop 客户端 modal state
 *
 * 替代 atelier Zustand `useCartStore` 里的 quickViewProduct / customizeProduct
 * 字段(只为 UI 状态,数据本身走 use-products)。
 *
 * ## 为什么多了一个 `customizePickerOpen`(2026-10-22)
 *
 * `CustomWorkshop` 是**商品作用域**的:`if (!product) return null`,没选中商品
 * 时整个 Dialog 不渲染。商品卡 / 详情页的「定制」天然带着商品,直接
 * `setCustomize(product)` 就够;但导航和 Hero 的「定制」是**无商品**入口,
 * 需要先让访客选一个品类(钥匙扣 / Q 版手办 / 冰箱贴),再把该品类的代表商品
 * 交给 Workshop。这就是选择层的职责。
 *
 * 之前这两个入口链 `/image-gen` —— 那是登录后的 SaaS 工作台
 * (`proxy.ts` 会把未登录访客弹到 `/sign-in?callbackUrl=/image-gen`),
 * 公开店铺的访客点「定制」会撞登录墙,等于把匿名可用的
 * `/api/store/*` 链路绕开,白扔一个可用功能。（2026-11-13 起那条公开的生图路由也删了 —— 工作室不要公开的生图页面；生图能力还在控制台的 `/dashboard/generate`）
 *
 * ## 2026-11-02:生图要登录
 *
 * 这个 store 只管「弹什么」,不管「谁有资格弹」—— 登录门槛在调用方
 * (`use-require-sign-in.ts`),不在这里。品类选择层照常给未登录访客逛,
 * 但选完品类要进 Workshop 时会被送去登录页。
 */

"use client";

import { create } from "zustand";

import type { StorefrontProduct } from "../types";

interface StorefrontModalState {
  /** 当前打开 Quick View 的 product(null = 关闭) */
  quickViewProduct: StorefrontProduct | null;
  /** 当前打开 Custom Workshop 的 product(null = 关闭) */
  customizeProduct: StorefrontProduct | null;
  /** 品类选择层是否打开(无商品的「定制」入口用) */
  customizePickerOpen: boolean;

  setQuickView: (product: StorefrontProduct | null) => void;
  setCustomize: (product: StorefrontProduct | null) => void;
  openCustomizePicker: () => void;
  closeCustomizePicker: () => void;
  closeAll: () => void;
}

export const useStorefrontModal = create<StorefrontModalState>((set) => ({
  quickViewProduct: null,
  customizeProduct: null,
  customizePickerOpen: false,

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
      // 选完品类后 Workshop 接管,顺手把选择层收掉,避免两层 Dialog 叠着
      customizePickerOpen: false,
    }),

  openCustomizePicker: () =>
    set({ customizePickerOpen: true, quickViewProduct: null }),

  closeCustomizePicker: () => set({ customizePickerOpen: false }),

  closeAll: () =>
    set({
      quickViewProduct: null,
      customizeProduct: null,
      customizePickerOpen: false,
    }),
}));
