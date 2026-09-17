"use client";

import { AnimatePresence } from "framer-motion";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  PRODUCT_CATEGORY_LABELS,
  PRODUCTS,
  type ProductCategory,
} from "@/features/products/lib/data";
import { ProductCard } from "./product-card";

type Filter = { id: ProductCategory | "all"; label: string };

const filters: Filter[] = [
  { id: "all", label: "全部" },
  { id: "keychain", label: "钥匙扣" },
  { id: "figure", label: "Q版手办" },
  { id: "fridge-magnet", label: "冰箱贴" },
  { id: "badge", label: "徽章" },
  { id: "standee", label: "立牌" },
  { id: "gift", label: "礼品套装" },
];

/**
 * WJP 作品集 FeaturedProducts —— 1:1 移植自 atelier `featured-products.tsx`。
 *
 * 适配差异:
 *  - data source 从 atelier `products` 切换到 NextDevTpl `PRODUCTS` (中文产品分类)
 *  - 分类 chips 数量:atelier 4 个 / WJP 7 个(全/钥匙扣/手办/冰箱贴/徽章/立牌/礼品)
 *  - locale prop 下传 ProductCard 用于 i18n 渲染
 */
export function FeaturedProducts({ locale }: { locale: "zh" | "en" }) {
  const [active, setActive] = React.useState<ProductCategory | "all">("all");
  const filtered = React.useMemo(() => {
    if (active === "all") return PRODUCTS;
    return PRODUCTS.filter((p) => p.category === active);
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
                {filtered.length} 件可定制
                {filtered.length === 1 ? "作品" : "作品"}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="self-start sm:self-end"
              asChild
            >
              <a href="/image-gen">去生图 →</a>
            </Button>
          </div>

          {/* Filter tabs */}
          <div className="flex flex-wrap items-center gap-1 -mx-1 overflow-x-auto no-scrollbar pb-1">
            {filters.map((f) => {
              const isActive = active === f.id;
              const label =
                f.id === "all"
                  ? "全部"
                  : (PRODUCT_CATEGORY_LABELS[f.id]?.zh ?? f.label);
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
                  {label}
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
