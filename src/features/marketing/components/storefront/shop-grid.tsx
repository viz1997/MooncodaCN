"use client";

/**
 * 商品网格 —— 首页的「货架」。
 *
 * ## 为什么要有这一段
 *
 * 2026-11-01 之前首页没有货架:12 件商品散在四段整屏场合色带里,每段 3 件。
 * 读起来是「四篇图文」,不是「一个店」—— 想比价的人得滚四屏,想看全部的人
 * 得滚到最底下。这正是「不像商城」的另一半原因(另一半是首屏没有价目)。
 *
 * 现在:首屏是公告条 + 商品拼贴 + 品类导航,再往下是这一段 12 件的网格。
 * 网格是唯一的目录 —— 12 件各出现一次,场合色带退成「按场合选购」的入口。
 *
 * ## 两条筛选轴
 *
 *  - **品类**(chip 行):全部 / 钥匙扣 / Q版手办 / 冰箱贴
 *  - **场合**(可关闭的小 chip):从下面的场合色带点「看生日礼物」带过来的
 *
 * 两条轴同时生效时取交集。筛选值在 `useShopFilter` 里 —— 品类导航条和场合
 * 色带都在这个网格之外,没法靠 props 传。
 *
 * ## `products` 从 props 来(2026-11-08)
 *
 * 以前这个组件直接 `import { MOCK_PRODUCTS }` —— 价是**代码常量**,
 * 后台 `/admin/products` 改了基础价,商城网页不变。
 *
 * 现在商品由**服务端父组件**取好传下来(价已经是 DB 里的),客户端**一个价
 * 都不算**。
 */

import { X } from "lucide-react";

import { useShopFilter } from "@/features/storefront/hooks/use-shop-filter";
import type { StorefrontProduct } from "@/features/storefront/types";

import { OCCASIONS } from "./occasion-data";
import { ProductCard } from "./product-card";
import { WJP_SERIES } from "./wjp-store-data";

export function ShopGrid({
  locale,
  products,
}: {
  locale: "zh" | "en";
  products: StorefrontProduct[];
}) {
  const isZh = locale === "zh";
  const series = useShopFilter((s) => s.series);
  const occasion = useShopFilter((s) => s.occasion);
  const selectSeries = useShopFilter((s) => s.selectSeries);
  const clearOccasion = useShopFilter((s) => s.clearOccasion);

  const occasionDef = occasion
    ? (OCCASIONS.find((o) => o.id === occasion) ?? null)
    : null;
  const occasionHandles = new Set(occasionDef?.handles ?? []);

  const shown: StorefrontProduct[] = products.filter(
    (p) =>
      (series === "all" || p.seriesId === series) &&
      (!occasionDef || occasionHandles.has(p.handle))
  );

  const chips = [
    { id: "all", label: isZh ? "全部" : "All" },
    ...WJP_SERIES.map((s) => ({
      id: s.id,
      label: isZh ? s.name : s.nameEn,
    })),
  ];

  return (
    // id="works" —— 顶部导航「作品」和 footer「全部作品」的落点。
    // scroll-mt-16 = sticky header 高度,锚点跳转不被遮。
    <section id="works" className="scroll-mt-16 bg-background py-16 lg:py-24">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-5 lg:mb-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <p className="eyebrow text-[var(--accent)] mb-3">
              {isZh ? "全部商品" : "Everything we make"}
            </p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-balance">
              {isZh ? "十二件都能定制" : "Twelve pieces, all customizable"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {isZh
                ? "每件都可以换成你自己的照片 —— 选一款,上传照片,14 天后到手。"
                : "Swap in your own photo on any of them — pick one, upload a photo, get it in 14 days."}
            </p>
          </div>

          {/* 品类 chip —— 商城筛选的标准形态 */}
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        </div>

        {/* 场合筛选 —— 从下面的场合色带带过来的,可关掉 */}
        {occasionDef ? (
          <div className="mb-7 flex items-center gap-3">
            <button
              type="button"
              onClick={clearOccasion}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--accent-foreground)] transition-opacity hover:opacity-90"
            >
              {isZh ? "场合" : "Occasion"}:{" "}
              {isZh ? occasionDef.label : occasionDef.labelEn}
              <X className="size-3" />
            </button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {shown.length}
            </span>
          </div>
        ) : null}

        {shown.length === 0 ? (
          <p className="rounded-lg border border-border/70 bg-[var(--secondary)]/40 px-4 py-10 text-center text-sm text-muted-foreground">
            {isZh
              ? "这个组合下暂时没有商品 —— 换个品类看看?"
              : "Nothing matches that combination — try another category?"}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-9 md:grid-cols-3 lg:grid-cols-4">
            {shown.map((product, i) => (
              <ProductCard
                key={product.handle}
                product={product}
                index={i}
                locale={locale}
                priority={i < 4}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
