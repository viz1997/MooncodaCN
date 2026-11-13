"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import * as React from "react";
import { resolveSeriesFromPrices } from "@/features/storefront/lib/series-pricing";
import type { StorefrontProduct } from "@/features/storefront/types";
import { Link } from "@/i18n/routing";
import { formatCents } from "@/lib/money";
import { WJP_SERIES } from "./wjp-store-data";

/**
 * WJP 系列展示(品类 —— **二级**)。
 *
 * 2026-10-21:信息架构改成「场合为主」之后,品类从顶部导航的主轴降级成
 * 这一段。所以视觉权重刻意压低 —— eyebrow 小标题替代原来的 h2 大标题,
 * 卡片缩小、去掉大图渐变遮罩,不再跟上面的 OccasionShelf 色带抢戏。
 *
 * 锚点说明:每张卡的 `id={s.handle}`(#keychain / #figure / #magnet)是
 * header 移动端「按形态」二级列表的落点,不能删。
 *
 * 链接说明:原来链 `/products?s=${handle}`,但 `/products` 的 page.tsx 从来
 * 不读 searchParams —— 点了不会过滤。现改指 `/#all` 网格,品类信息以卡片上
 * 的色点呈现,不再假装能筛选。
 *
 * ## `products` 从 props 来(2026-11-08)
 *
 * 「起 ¥19」以前是 `WJP_SERIES[].fromPriceCents` 这个**代码常量** ——
 * 后台改基础价,这一段不动。现在从商品算(DB 的价),查不到才退回静态兜底。
 */
export function SeriesShowcase({
  products,
}: {
  products: StorefrontProduct[];
}) {
  const seriesFrom = React.useMemo(
    () => resolveSeriesFromPrices(products, WJP_SERIES),
    [products]
  );

  return (
    <section
      id="categories"
      className="bg-muted/40 py-12 lg:py-16 border-y scroll-mt-16"
    >
      <div className="atelier-container">
        <div className="mb-7 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <p className="eyebrow text-muted-foreground">按形态 · 按品类逛</p>
          <p className="text-sm text-muted-foreground">
            三种形态,全部由你的照片定制。
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 lg:gap-6">
          {WJP_SERIES.map((s, i) => (
            <motion.div
              key={s.id}
              id={s.handle}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="group relative scroll-mt-20"
            >
              <Link
                href="/#all"
                className="flex items-center gap-4 p-3 rounded-lg bg-background border border-border/60 hover:border-[var(--primary)]/40 transition-colors"
              >
                <img
                  src={s.cover}
                  alt={s.name}
                  className="size-20 lg:size-24 object-cover rounded-md shrink-0"
                  loading="lazy"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: s.accent }}
                    />
                    <h3 className="text-base font-medium">{s.name}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {s.tagline}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    起 {formatCents(seriesFrom.get(s.id) ?? s.fromPriceCents)} ·{" "}
                    {s.count} 款
                  </p>
                </div>
                <ArrowRight className="size-4 shrink-0 ml-auto text-muted-foreground/50 group-hover:text-[var(--accent)] group-hover:translate-x-0.5 transition-all" />
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
