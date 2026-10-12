"use client";

import { AnimatePresence } from "framer-motion";
import * as React from "react";
import { PRODUCTS } from "@/features/products/lib/data";
import { ProductCard } from "./product-card";

type Filter = { id: string; label: string };

const filters: Filter[] = [
  { id: "all", label: "全部" },
  { id: "keychain", label: "钥匙扣" },
  { id: "figure", label: "Q版手办" },
  { id: "magnet", label: "冰箱贴" },
];

const categoryToFilter: Record<string, string> = {
  keychain: "keychain",
  "fridge-magnet": "magnet",
  figure: "figure",
};

/**
 * WJP 作品集 FeaturedProducts —— 1:1 移植自 atelier `featured-products.tsx`。
 *
 * 适配差异:
 *  - data source 从 atelier `products` 切换到 NextDevTpl `PRODUCTS`
 *  - 分类 chips 数量对齐 atelier 4 个:全部 / 钥匙扣 / Q版手办 / 冰箱贴
 *  - 把现有 7 个 category(keychain / fridge-magnet / figure / badge / standee /
 *    gift)折叠成 atelier 的 3 个核心:keychain / figure / magnet
 *  - locale prop 下传 ProductCard 用于 i18n 渲染
 */
export function FeaturedProducts({ locale }: { locale: "zh" | "en" }) {
  const [active, setActive] = React.useState<string>("all");
  const filtered = React.useMemo(() => {
    if (active === "all") return PRODUCTS;
    return PRODUCTS.filter((p) => categoryToFilter[p.category] === active);
  }, [active]);

  return (
    <section id="new" className="bg-background py-12 lg:py-16">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-6 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                全部作品
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {filtered.length} 件可定制作品
              </p>
            </div>
          </div>

          {/* Filter tabs — Medusa style: simple text buttons */}
          <div className="flex flex-wrap items-center gap-1 -mx-1 overflow-x-auto no-scrollbar pb-1">
            {filters.map((f) => {
              const isActive = active === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setActive(f.id)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                    isActive
                      ? "bg-foreground text-background"
                      : "text-foreground/60 hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Product grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 lg:gap-x-8 lg:gap-y-12">
          <AnimatePresence mode="popLayout">
            {filtered.map((product, i) => (
              <ProductCard
                key={product.slug}
                product={product}
                index={i}
                locale={locale}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
