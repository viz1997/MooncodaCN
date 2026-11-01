/**
 * use-series-filter —— 首页 FeaturedProducts 的品类筛选(二级轴)
 *
 * 2026-10-21:形态(钥匙扣 / 手办 / 冰箱贴)从顶部导航的主轴降级成首页的筛选 chip
 * 后,「按形态」这个入口就分裂成了两处 —— 页内的 chip,和移动端菜单里的二级列表。
 * 两处必须共享同一个值,否则移动端选完形态、滚到页内发现 chip 还停在「全部」。
 *
 * 所以它得是全局的,而不是 FeaturedProducts 的 useState:header 和
 * FeaturedProducts 是两棵互不相干的子树(一个在 layout 里,一个在 page 里)。
 * 同一个 store 让移动端点击能直接预设好筛选,滚到 #all 就是筛好的结果。
 *
 * 与 useStorefrontModal / useCartUi 同一套 zustand 约定:纯 UI 状态,数据本身
 * 仍然走 MOCK_PRODUCTS / use-products。
 *
 * **值是 `WJP_SERIES` 的 `id`**(`"s_keychain"`),不是 `handle`(`"keychain"`)——
 * 与 `StorefrontProduct.seriesId` 同源。见 featured-products.tsx 里的对照注释。
 */

"use client";

import { create } from "zustand";

interface SeriesFilterState {
  /** 当前选中的 `WJP_SERIES.id`;`"all"` = 不筛 */
  series: string;
  select: (series: string) => void;
}

export const useSeriesFilter = create<SeriesFilterState>((set) => ({
  series: "all",

  select: (series) =>
    set({
      // 同一个值重复选中也要触发一次 set,让移动端 → #all 的跳转逻辑保持简单
      series,
    }),
}));
