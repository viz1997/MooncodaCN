"use client";

/**
 * use-shop-filter —— 首页商场的两条筛选轴(品类 / 场合)
 *
 * ## 为什么是全局 store,不是组件里的 useState
 *
 * 筛选的**发起方**和**执行方**在两棵互不相干的子树里:
 *  - 品类导航条(`CategoryStrip`)在 hero 下面,点一下要滚到商品网格;
 *  - 场合色带(`OccasionShelf`)在网格下面,点「看生日礼物」也要滚回网格;
 *  - 真正执行筛选的是商品网格(`ShopGrid`)。
 *
 * 发起方和执行方之间隔着几百像素和两段版式,没法靠 props 传。用组件内的
 * useState 的话,品类导航条改了值,网格根本不知道。
 *
 * 同一个 store 还顺带解决了跨页继承:作品集页(`/products`)的
 * `FeaturedProducts` 读的是同一条 `series` —— 首页筛完品类跳过去,那边
 * 还是筛好的。
 *
 * ## 值分别是哪一套 id
 *
 *  - `series` —— `WJP_SERIES.id`(`"s_keychain"`),**不是** `handle`
 *    (`"keychain"`)。`StorefrontProduct.seriesId` 存的是前者,拿 handle
 *    去比 seriesId 会让每个品类都过滤出 0 件。
 *  - `occasion` —— `OCCASIONS[].id`(`"birthday"`),对应 `occasion-data.ts`
 *    里那一组 handle。
 *
 * ## 两条轴的交互
 *
 * 网格里两条轴取交集。`selectOccasion` 会把 `series` 复位成 `"all"` ——
 * 场合是一次新的浏览起点,不该被上一条轴卡住(「冰箱贴」×「毕业季」交集为空,
 * 网格会空掉)。`resetAll` 两条轴一起清,给品类导航条的「全部商品」用。
 *
 * 与 useStorefrontModal / useCartUi 同一套 zustand 约定:纯 UI 状态,
 * 数据本身仍然走 MOCK_PRODUCTS。
 */

import { create } from "zustand";

interface ShopFilterState {
  /** 当前选中的品类(`WJP_SERIES.id`);`"all"` = 不筛 */
  series: string;
  /** 当前选中的场合(`OCCASIONS[].id`);`null` = 不筛 */
  occasion: string | null;
  /** 切品类 */
  selectSeries: (series: string) => void;
  /** 切场合(并清掉品类筛选) */
  selectOccasion: (occasion: string) => void;
  /** 取消场合筛选 */
  clearOccasion: () => void;
  /** 两条轴都清掉 —— 「全部商品」入口 */
  resetAll: () => void;
}

export const useShopFilter = create<ShopFilterState>((set) => ({
  series: "all",
  occasion: null,

  selectSeries: (series) =>
    set({
      // 同一个值重复选中也要触发一次 set,让「选中 → 滚到网格」的逻辑保持简单
      series,
    }),

  // 选场合会清掉品类筛选 —— 否则两条轴取交集可能一件都不剩(比如
  // 「冰箱贴」×「毕业季」)。场合是一次新的浏览起点,不该被上一条轴卡住。
  selectOccasion: (occasion) => set({ occasion, series: "all" }),

  clearOccasion: () => set({ occasion: null }),

  resetAll: () => set({ series: "all", occasion: null }),
}));
