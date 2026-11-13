"use client";

/**
 * 品类导航条 —— hero 正下方那一排品类入口。
 *
 * ## 为什么在 hero 下面
 *
 * 商城的标准动线是:先看品类,再看货,最后下单。首页第一屏如果只有一句 slogan
 * 和一张生活照,读者得先滚一整屏才知道这家店卖什么 —— 那是品牌站,不是商城。
 *
 * 这排品类就是把那件事提到第一屏:每格直接写清楚「做什么的 / 多少钱起 /
 * 有几件」。价格写在图上,不是藏在详情页里。
 *
 * ## 点一下会发生什么
 *
 * 点品类 = 设筛选 + 滚到商品网格(`#works`)。筛选值存在
 * `useShopFilter` 里 —— 品类导航条和商品网格是两棵子树,中间隔着场合色带,
 * 没法靠 props 传。
 *
 * ## `products` 从 props 来(2026-11-08)
 *
 * 以前直接 `import { findProductByHandle }` —— 价是**代码常量**,后台
 * `/admin/products` 改了基础价,首页品类条上的「¥19 起」不会变。
 *
 * 现在商品由**服务端父组件**取好传下来(价已经是 DB 里的)。品类「起售价」
 * 也从这些商品算(每个品类最便宜那件的基础价),客户端**一个价都不算**。
 */

import { LayoutGrid } from "lucide-react";
import { useCallback, useMemo } from "react";

import { useShopFilter } from "@/features/storefront/hooks/use-shop-filter";
import {
  pickByHandle,
  resolveSeriesFromPrices,
} from "@/features/storefront/lib/series-pricing";
import type { StorefrontProduct } from "@/features/storefront/types";
import { formatCents } from "@/lib/money";

import { WJP_SERIES } from "./wjp-store-data";

/** 商品网格的锚点 —— 跟顶部导航「作品」是同一个落点 */
const SHOP_ANCHOR = "works";

/**
 * 「全部商品」格里的三张缩略图 —— 跨三个品类,一眼看全这家店的货。
 *
 * 之前这一格是纯文字 + 一个图标,和右边三张「图 + 文」并排时高度对不齐,
 * 图像位还空着一大块。改成 2×2 拼贴(三张货 + 一格图标)后,整排四格的
 * 图位高度一致,读起来才像一排货架。
 *
 * 同样的约束跟首屏拼贴一样:这三张不能跟旁边三张系列封面
 * (`WJP_SERIES[].cover`)撞图,也不能跟 hero 拼贴撞图 —— 第一屏里
 * 同一张照片出现两次,一眼看过去像「只有一张图」。
 */
const PREVIEW_HANDLES = [
  "keychain-couple",
  "figure-baby-statue",
  "magnet-couple-fridge",
] as const;

export function CategoryStrip({
  locale,
  products,
}: {
  locale: "zh" | "en";
  products: StorefrontProduct[];
}) {
  const isZh = locale === "zh";
  const series = useShopFilter((s) => s.series);
  const selectSeries = useShopFilter((s) => s.selectSeries);
  const resetAll = useShopFilter((s) => s.resetAll);

  const preview = useMemo(
    () => pickByHandle(products, PREVIEW_HANDLES),
    [products]
  );

  // 品类「起售价」—— 从商品算(DB 的价),查不到退回静态兜底值
  const seriesFrom = useMemo(
    () => resolveSeriesFromPrices(products, WJP_SERIES),
    [products]
  );

  const scrollToShop = useCallback(() => {
    document
      .getElementById(SHOP_ANCHOR)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const pick = useCallback(
    (id: string) => {
      selectSeries(id);
      scrollToShop();
    },
    [selectSeries, scrollToShop]
  );

  // 「全部商品」= 两条轴都清掉 —— 场合筛选是从网格下面的色带带过来的,
  // 只清品类的话点「全部」还是只看到 3 件。
  const pickEverything = useCallback(() => {
    resetAll();
    scrollToShop();
  }, [resetAll, scrollToShop]);

  const totalCount = WJP_SERIES.reduce((sum, s) => sum + s.count, 0);

  return (
    <section className="border-y border-border/60 bg-[var(--card)]">
      <div className="atelier-container py-10 lg:py-12">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow text-[var(--accent)] mb-2.5">
              {isZh ? "按品类选购" : "Shop by category"}
            </p>
            <h2 className="text-2xl sm:text-3xl font-medium tracking-tight">
              {isZh ? "先挑做什么" : "Pick what to make"}
            </h2>
          </div>
          <p className="hidden text-sm text-muted-foreground sm:block">
            {isZh
              ? `${totalCount} 款在售,全部支持一件定制`
              : `${totalCount} pieces, all one-off customizable`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {/* 「全部」 —— 清掉品类筛选。
              图片位跟右边三张一样是 aspect-[4/3],卡片高度才齐 ——
              否则这一格是纯文字,四个格子排在一条线上,文字基线全错开。 */}
          <button
            type="button"
            onClick={pickEverything}
            aria-pressed={series === "all"}
            className={`group flex flex-col overflow-hidden rounded-lg border text-left transition-colors ${
              series === "all"
                ? "border-[var(--accent)] bg-[var(--secondary)]"
                : "border-border/70 hover:border-[var(--accent)]/50"
            }`}
          >
            <span className="grid aspect-[4/3] w-full grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden bg-muted">
              {preview.map((p) => (
                <span key={p.handle} className="relative overflow-hidden">
                  <img
                    src={p.thumbnail}
                    alt={isZh ? p.title : p.titleEn}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </span>
              ))}
              <span className="flex items-center justify-center bg-[var(--secondary)]">
                <LayoutGrid className="size-5 text-[var(--primary)]" />
              </span>
            </span>
            <span className="block p-4">
              <span className="block text-sm font-medium">
                {isZh ? "全部商品" : "Everything"}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {isZh ? "12 件在售" : "12 pieces"}
              </span>
            </span>
          </button>

          {WJP_SERIES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pick(s.id)}
              aria-pressed={series === s.id}
              className={`group overflow-hidden rounded-lg border text-left transition-colors ${
                series === s.id
                  ? "border-[var(--accent)]"
                  : "border-border/70 hover:border-[var(--accent)]/50"
              }`}
            >
              <span className="relative block aspect-[4/3] overflow-hidden bg-muted">
                <img
                  src={s.cover}
                  alt={s.name}
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  loading="lazy"
                />
              </span>
              <span className="block p-4">
                <span className="block text-sm font-medium">
                  {isZh ? s.name : s.nameEn}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {formatCents(seriesFrom.get(s.id) ?? s.fromPriceCents, {
                    locale: isZh ? "zh-CN" : "en",
                  })}{" "}
                  {isZh ? "起" : "from"}
                </span>
                <span className="mt-2 block text-[11px] text-muted-foreground/80">
                  {isZh ? `${s.count} 款` : `${s.count} designs`}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
