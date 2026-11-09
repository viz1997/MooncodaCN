"use client";

/**
 * 全部作品(锚点 #all)—— 导航「全部」落在这里。
 *
 * 2026-10-21 第二次改版:
 *  - **12 宫格 → 横向滚动条**。原先 4 个 occasion 色带已经各铺了 3 张卡
 *    (共 12 件),这里再来个 12 宫格 = 24 张卡 / 10 个 section 里 5 个网格。
 *    改成一条不换行的横向滚动条,形态上就跟上面的整屏色带区分开了,
 *    同时保留「一次看全」的入口。
 *  - **品类从死掉的 SeriesShowcase 收编成这里的筛选 chip**。上一版把品类
 *    「降级」成了一个 3 张图 0 张卡、点了没反应的空壳(它原本链的
 *    `/products?s=` 页面根本不读 searchParams)。现在它是一个真的二级轴:
 *    点 chip 就地过滤滚动条里的卡片。
 *
 * 筛选值存在 zustand(`useShopFilter`)而不是本地 useState:移动端菜单里
 * 也有一个「按形态」二级列表,它点完直接滚到这里并预设好 chip —— 两棵子树
 * 共享同一个值。见 `@/features/storefront/hooks/use-shop-filter.ts`。
 *
 * 滚动实现:snap-x + scrollBy 按钮(桌面端没有可见滚动条,必须有按钮
 * 才知道下面还有东西)。卡片宽度固定,容器 overflow-x-auto。
 *
 * ## `products` 从 props 来(2026-11-08)
 *
 * 以前直接 `import { MOCK_PRODUCTS }` —— 价是**代码常量**,后台
 * `/admin/products` 改了基础价,商城网页不变。
 *
 * 现在商品由**服务端父组件**取好传下来(价已经是 DB 里的),客户端**一个价
 * 都不算**。
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

import { useShopFilter } from "@/features/storefront/hooks/use-shop-filter";
import type { StorefrontProduct } from "@/features/storefront/types";

import { ProductCard } from "./product-card";
import { WJP_SERIES } from "./wjp-store-data";

type SeriesFilter = "all" | string;

export function FeaturedProducts({
  locale,
  products,
}: {
  locale: "zh" | "en";
  products: StorefrontProduct[];
}) {
  const isZh = locale === "zh";
  const series = useShopFilter((s) => s.series);
  const selectSeries = useShopFilter((s) => s.selectSeries);
  const railRef = React.useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(false);

  const shown: StorefrontProduct[] =
    series === "all" ? products : products.filter((p) => p.seriesId === series);

  // 滚动位置 → 两端按钮的禁用态
  const syncEdges = React.useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  // 换筛选后卡片数量变、rail 的 scrollWidth 跟着变,atStart / atEnd 必须重算,
  // 否则「下一屏」按钮会带着上一轮的禁用态。effect 体内读不到 series,biome
  // 判它多余,属误报 —— 所以必须显式列入依赖。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 见上,series 是必要的
  React.useEffect(() => {
    syncEdges();
  }, [syncEdges, series]);

  const nudge = (dir: 1 | -1) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({
      left: dir * Math.round(el.clientWidth * 0.8),
      behavior: "smooth",
    });
  };

  // chip id 必须是 `s.id`(= product.seriesId),不能用 `s.handle`
  // —— handle 是 "keychain" 而 seriesId 是 "s_keychain",拿 handle 去比
  // seriesId 会让每个品类 chip 都过滤出 0 件
  const chips: { id: SeriesFilter; label: string }[] = [
    { id: "all", label: isZh ? "全部" : "All" },
    ...WJP_SERIES.map((s) => ({
      id: s.id,
      label: isZh ? s.name : s.nameEn,
    })),
  ];

  return (
    <section id="all" className="bg-background py-16 lg:py-24 scroll-mt-16">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        {/* Header —— eyebrow + 衬线标题 + 两端的滚动按钮 */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-8 lg:mb-10">
          <div className="max-w-xl">
            <p className="eyebrow text-[var(--accent)] mb-3">
              {isZh ? "全部作品" : "All Work"}
            </p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-balance">
              {isZh ? "十二件都能定制" : "Twelve pieces, all customizable"}
            </h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              {isZh
                ? "按形态筛一筛,或者横向拖着看。"
                : "Filter by form, or drag sideways."}
            </p>
          </div>

          {/* 滚动按钮 —— 桌面端滚动条不可见,靠它提示右边还有 */}
          <div className="hidden lg:flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => nudge(-1)}
              disabled={atStart}
              aria-label={isZh ? "向左" : "Scroll left"}
              className="size-10 rounded-full border border-border/70 flex items-center justify-center text-foreground/70 hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => nudge(1)}
              disabled={atEnd}
              aria-label={isZh ? "向右" : "Scroll right"}
              className="size-10 rounded-full border border-border/70 flex items-center justify-center text-foreground/70 hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-30 disabled:pointer-events-none"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        {/* 品类筛选 —— 品类作为二级轴落在这里(取代旧的 SeriesShowcase 空壳) */}
        <div className="flex flex-wrap items-center gap-2 mb-7">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectSeries(c.id)}
              aria-pressed={series === c.id}
              className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-colors ${
                series === c.id
                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "border-border/70 text-muted-foreground hover:border-[var(--accent)] hover:text-[var(--accent)]"
              }`}
            >
              {c.label}
            </button>
          ))}
          <span className="ml-1 text-xs text-muted-foreground tabular-nums">
            {shown.length}
          </span>
        </div>
      </div>

      {/* 横向滚动条 —— 全宽出血,卡片在容器内 snap */}
      <div className="relative">
        <div
          ref={railRef}
          onScroll={syncEdges}
          className="flex gap-5 overflow-x-auto snap-x snap-mandatory scroll-smooth px-4 sm:px-6 lg:px-8 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {shown.map((product, i) => (
            <div
              key={product.handle}
              className="w-[68vw] max-w-[260px] min-w-[220px] shrink-0 snap-start"
            >
              <ProductCard
                product={product}
                index={i}
                locale={locale}
                priority={i < 3}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
